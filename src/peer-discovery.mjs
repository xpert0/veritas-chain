import { exec } from 'child_process';
import { promisify } from 'util';
import dns from 'dns';
import net from 'net';
import os from 'os';
import * as logger from './logger.mjs';
import { getNetworkConfig } from './config.mjs';

const execAsync = promisify(exec);
const resolveTxt = promisify(dns.resolveTxt);

const discoveredPeers = new Set();

/**
 * Parse CIDR notation and return network info
 * @param {string} cidr - CIDR notation (e.g., "192.168.1.0/24")
 * @returns {Object} Network info with base IP and host count
 */
function parseCIDR(cidr) {
  const [baseIP, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  
  if (!baseIP || isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR notation: ${cidr}`);
  }
  
  const parts = baseIP.split('.');
  if (parts.length !== 4 || parts.some(p => isNaN(parseInt(p, 10)))) {
    throw new Error(`Invalid IP address in CIDR: ${baseIP}`);
  }
  
  const hostBits = 32 - prefix;
  const hostCount = Math.pow(2, hostBits);
  
  // Convert IP to number
  const ipNum = parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
  
  // Calculate network address
  const mask = (0xFFFFFFFF << hostBits) >>> 0;
  const networkNum = (ipNum & mask) >>> 0;
  
  return {
    networkNum,
    hostCount,
    prefix
  };
}

/**
 * Convert number to IP string
 * @param {number} num - IP as number
 * @returns {string} IP address string
 */
function numToIP(num) {
  return [
    (num >>> 24) & 0xFF,
    (num >>> 16) & 0xFF,
    (num >>> 8) & 0xFF,
    num & 0xFF
  ].join('.');
}

/**
 * Get local IP address (cross-platform)
 * @returns {string|null} Local IP address or null
 */
function getLocalIP() {
  try {
    const interfaces = os.networkInterfaces();
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal and non-IPv4 addresses
        if (!iface.internal && iface.family === 'IPv4') {
          return iface.address;
        }
      }
    }
    
    return null;
  } catch (error) {
    logger.error('Failed to get local IP', error.message);
    return null;
  }
}

let scanCount = 0;

/**
 * Discover peers on local network using IP scan
 * Scans constantly without delay but logs only every 100 scans
 * Don't log if at least one peer found (to reduce noise)
 * @returns {Promise<string[]>} Array of peer addresses
 */
export async function discoverLocalPeers() {
  const config = getNetworkConfig();
  
  if (!config.ipDiscovery || !config.subnet) {
    return [];
  }
  
  const peers = [];
  
  try {
    const localIP = getLocalIP();
    
    if (!localIP) {
      logger.warn('Could not determine local IP');
      return [];
    }
    
    // Parse CIDR notation
    const { networkNum, hostCount, prefix } = parseCIDR(config.subnet);
    
    // Increment scan count and log only every 100 scans
    scanCount++;
    const shouldLog = (scanCount % 100 === 0);
    
    // Limit scan to reasonable size to avoid overwhelming the network
    const maxHosts = Math.min(hostCount, 65536);
    
    if (maxHosts > 1024 && scanCount === 1) {
      logger.warn('Large subnet detected, limiting scan', { 
        hostCount: maxHosts,
        note: 'Consider using a smaller subnet for faster discovery'
      });
    }
    
    // Scan all IPs in the subnet range - NO DELAY between checks
    const promises = [];
    for (let i = 1; i < maxHosts - 1; i++) {
      const ip = numToIP(networkNum + i);
      if (ip !== localIP) {
        promises.push(checkPeerAvailability(ip, config.p2pPort));
      }
    }
    
    const results = await Promise.allSettled(promises);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        peers.push(result.value);
        discoveredPeers.add(result.value);
      }
    }
    
    // Only log if: 
    // 1. It's the designated log cycle (every 100 scans) AND no peers found
    // 2. OR it's the first scan
    if (scanCount === 1 && peers.length === 0) {
      logger.debug('Scanning network', { 
        subnet: config.subnet, 
        hostCount,
        localIP,
        scanNumber: scanCount
      });
    } else if (shouldLog && peers.length === 0) {
      logger.info('Local peer scan update', { count: 0, scanNumber: scanCount });
    }
    // Don't log if at least one peer found
  } catch (error) {
    logger.error('Local peer discovery failed', error.message);
  }
  
  return peers;
}

/**
 * Check if peer is available at address
 * @param {string} ip - IP address
 * @param {number} port - Port number
 * @returns {Promise<string|null>} Peer address or null
 */
async function checkPeerAvailability(ip, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    
    // Reduced timeout for faster scanning (50ms instead of 100ms)
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, 50);
    
    socket.connect(port, ip, () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(`${ip}:${port}`);
    });
    
    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

let lastDNSDiscovery = 0;
let dnsQueryCount = 0;

/**
 * Discover peers via DNS TXT records
 * Only log if record is invalid (once every 3 scans)
 * @returns {Promise<string[]>} Array of peer addresses
 */
export async function discoverDNSPeers() {
  const config = getNetworkConfig();
  
  if (!config.discoveryDNS) {
    return [];
  }
  
  const peers = [];
  dnsQueryCount++;
  
  try {
    const records = await resolveTxt(config.discoveryDNS);
    
    for (const record of records) {
      const txt = record.join('');
      
      // Expected format: "peer1.example1.com, peer2.example2.com,..."
      // Split by comma and trim whitespace
      const hostnames = txt.split(',').map(h => h.trim()).filter(h => h.length > 0);
      
      for (const hostname of hostnames) {
        // Add with default port if not specified
        const address = hostname.includes(':') ? hostname : `${hostname}:${config.p2pPort}`;
        peers.push(address);
        discoveredPeers.add(address);
      }
    }
    
    // Don't log successful DNS discoveries to reduce noise
  } catch (error) {
    // Only log invalid DNS records once every 3 scans
    if ((error.code === 'ENOTFOUND' || error.code === 'ENODATA') && (dnsQueryCount % 3 === 0)) {
      logger.debug('DNS record not found or empty', { dns: config.discoveryDNS, queryCount: dnsQueryCount });
    } else if (error.code !== 'ENOTFOUND' && error.code !== 'ENODATA') {
      // Always log actual errors (not just missing records)
      logger.error('DNS peer discovery failed', error.message);
    }
  }
  
  return peers;
}

/**
 * Discover all peers (local + DNS with throttling)
 * @returns {Promise<string[]>} Array of unique peer addresses
 */
export async function discoverPeers() {
  const now = Date.now();
  const timeSinceLastDNS = now - lastDNSDiscovery;
  
  // Always do local discovery (no delay)
  const localPeersPromise = discoverLocalPeers();
  
  // DNS discovery with 30 second throttle
  let dnsPeersPromise;
  if (timeSinceLastDNS >= 30000) { // 30 seconds
    dnsPeersPromise = discoverDNSPeers();
    lastDNSDiscovery = now;
  } else {
    dnsPeersPromise = Promise.resolve([]);
  }
  
  const [localPeers, dnsPeers] = await Promise.all([localPeersPromise, dnsPeersPromise]);
  
  const allPeers = [...new Set([...localPeers, ...dnsPeers])];
  
  return allPeers;
}

/**
 * Bootstrap peer discovery - scan subnet 3 times, then DNS once
 * Used during initial startup to find peers before deciding whether to create new chain
 * @returns {Promise<string[]>} Array of unique peer addresses
 */
export async function bootstrapDiscovery() {
  logger.info('Starting bootstrap peer discovery');
  const allPeers = new Set();
  
  // Scan subnet 3 times
  logger.info('Scanning local subnet (3 attempts)');
  for (let i = 0; i < 3; i++) {
    const localPeers = await discoverLocalPeers();
    localPeers.forEach(peer => allPeers.add(peer));
    logger.debug(`Subnet scan ${i + 1}/3 completed`, { peersFound: localPeers.length });
  }
  
  // Then scan DNS once
  logger.info('Scanning DNS for peers (1 attempt)');
  const dnsPeers = await discoverDNSPeers();
  dnsPeers.forEach(peer => allPeers.add(peer));
  lastDNSDiscovery = Date.now(); // Mark DNS as queried
  
  const peers = Array.from(allPeers);
  logger.info('Bootstrap discovery completed', { totalPeers: peers.length });
  
  return peers;
}

/**
 * Get all discovered peers
 * @returns {string[]} Array of peer addresses
 */
export function getDiscoveredPeers() {
  return Array.from(discoveredPeers);
}

/**
 * Add peer manually
 * @param {string} address - Peer address (ip:port)
 */
export function addPeer(address) {
  discoveredPeers.add(address);
  logger.debug('Peer added manually', { address });
}

/**
 * Remove peer
 * @param {string} address - Peer address
 */
export function removePeer(address) {
  discoveredPeers.delete(address);
  logger.debug('Peer removed', { address });
}

/**
 * Clear all discovered peers
 */
export function clearPeers() {
  discoveredPeers.clear();
  logger.debug('All peers cleared');
}

/**
 * Start periodic peer discovery
 * Scans constantly but with DNS throttling
 * @param {number} intervalSeconds - Discovery interval in seconds (for local scan)
 * @returns {NodeJS.Timeout} Interval handle
 */
export function startPeriodicDiscovery(intervalSeconds = 300) {
  logger.info('Starting periodic peer discovery', { intervalSeconds });
  
  return setInterval(async () => {
    try {
      const peers = await discoverPeers();
      
      // Return the discovered peers so the network module can reconnect
      if (peers.length > 0) {
        logger.debug('Periodic discovery found peers', { count: peers.length });
      }
    } catch (error) {
      logger.error('Periodic discovery failed', error.message);
    }
  }, intervalSeconds * 1000);
}

export default {
  discoverLocalPeers,
  discoverDNSPeers,
  discoverPeers,
  bootstrapDiscovery,
  getDiscoveredPeers,
  addPeer,
  removePeer,
  clearPeers,
  startPeriodicDiscovery
};
