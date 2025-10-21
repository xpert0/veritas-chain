import { exec } from 'child_process';
import { promisify } from 'util';
import dns from 'dns';
import * as logger from './logger.mjs';
import { getNetworkConfig } from './config.mjs';

const execAsync = promisify(exec);
const resolveTxt = promisify(dns.resolveTxt);

const discoveredPeers = new Set();

/**
 * Discover peers on local network using IP scan
 * @returns {Promise<string[]>} Array of peer addresses
 */
export async function discoverLocalPeers() {
  const config = getNetworkConfig();
  
  if (!config.ipDiscovery) {
    return [];
  }
  
  const peers = [];
  
  try {
    // Get local IP
    const { stdout } = await execAsync("hostname -I | awk '{print $1}'");
    const localIP = stdout.trim();
    
    if (!localIP) {
      logger.warn('Could not determine local IP');
      return [];
    }
    
    // Extract /24 subnet
    const parts = localIP.split('.');
    if (parts.length !== 4) {
      logger.warn('Invalid IP format', { localIP });
      return [];
    }
    
    const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
    
    logger.debug('Scanning local network', { subnet });
    
    // Scan common IPs in subnet (skip full scan for performance)
    // In production, you'd use a proper network scanner
    const promises = [];
    for (let i = 1; i < 255; i++) {
      const ip = `${subnet}.${i}`;
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
      
      // Expected format: "zkic-peer=<ip>:<port>"
      if (txt.startsWith('zkic-peer=')) {
        const address = txt.substring(10);
        
        // Validate format
        if (address.includes(':')) {
          peers.push(address);
          discoveredPeers.add(address);
        }
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
