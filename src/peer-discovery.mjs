import { exec } from 'child_process';
import { promisify } from 'util';
import dns from 'dns';
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

/**
 * Discover peers on local network using IP scan
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
    
    logger.debug('Scanning network', { 
      subnet: config.subnet, 
      hostCount,
      localIP 
    });
    
    // Limit scan to reasonable size to avoid overwhelming the network
    const maxHosts = Math.min(hostCount, 65536);
    
    if (maxHosts > 1024) {
      logger.warn('Large subnet detected, limiting scan', { 
        hostCount: maxHosts,
        note: 'Consider using a smaller subnet for faster discovery'
      });
    }
    
    // Scan all IPs in the subnet range
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
    
    logger.info('Local peers discovered', { count: peers.length });
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
    const net = require('net');
    const socket = new net.Socket();
    
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, 100);
    
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

/**
 * Discover peers via DNS TXT records
 * @returns {Promise<string[]>} Array of peer addresses
 */
export async function discoverDNSPeers() {
  const config = getNetworkConfig();
  
  if (!config.discoveryDNS) {
    return [];
  }
  
  const peers = [];
  
  try {
    logger.debug('Querying DNS for peers', { dns: config.discoveryDNS });
    
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
    
    logger.info('DNS peers discovered', { count: peers.length });
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      logger.debug('No DNS TXT records found');
    } else {
      logger.error('DNS peer discovery failed', error.message);
    }
  }
  
  return peers;
}

/**
 * Discover all peers (local + DNS)
 * @returns {Promise<string[]>} Array of unique peer addresses
 */
export async function discoverPeers() {
  logger.info('Starting peer discovery');
  
  const [localPeers, dnsPeers] = await Promise.all([
    discoverLocalPeers(),
    discoverDNSPeers()
  ]);
  
  const allPeers = [...new Set([...localPeers, ...dnsPeers])];
  
  logger.info('Peer discovery completed', { totalPeers: allPeers.length });
  
  return allPeers;
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
 * @param {number} intervalSeconds - Discovery interval in seconds
 * @returns {NodeJS.Timeout} Interval handle
 */
export function startPeriodicDiscovery(intervalSeconds = 300) {
  logger.info('Starting periodic peer discovery', { intervalSeconds });
  
  return setInterval(async () => {
    try {
      await discoverPeers();
    } catch (error) {
      logger.error('Periodic discovery failed', error.message);
    }
  }, intervalSeconds * 1000);
}

export default {
  discoverLocalPeers,
  discoverDNSPeers,
  discoverPeers,
  getDiscoveredPeers,
  addPeer,
  removePeer,
  clearPeers,
  startPeriodicDiscovery
};
