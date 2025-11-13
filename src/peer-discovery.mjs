import { exec } from 'child_process';
import { promisify } from 'util';
import dns from 'dns';
import os from 'os';
import net from 'net';
import * as logger from './logger.mjs';
import { getNetworkConfig } from './config.mjs';

const execAsync = promisify(exec);
const resolveTxt = promisify(dns.resolveTxt);
const discoveredPeers = new Set();

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
  const ipNum = parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
  const mask = (0xFFFFFFFF << hostBits) >>> 0;
  const networkNum = (ipNum & mask) >>> 0;
  return {
    networkNum,
    hostCount,
    prefix
  };
}

function numToIP(num) {
  return [
    (num >>> 24) & 0xFF,
    (num >>> 16) & 0xFF,
    (num >>> 8) & 0xFF,
    num & 0xFF
  ].join('.');
}

function getLocalIP() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
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
    const { networkNum, hostCount, prefix } = parseCIDR(config.subnet);
    logger.debug('Scanning network', { 
      subnet: config.subnet, 
      hostCount,
      localIP 
    });
    const maxHosts = Math.min(hostCount, 65536);
    // if (maxHosts > 1024) {
    //   logger.warn('Large subnet detected, limiting scan', { 
    //     hostCount: maxHosts,
    //     note: 'Consider using a smaller subnet for faster discovery'
    //   });
    // }
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

async function checkPeerAvailability(ip, port) {
  return new Promise((resolve) => {
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
      const hostnames = txt.split(',').map(h => h.trim()).filter(h => h.length > 0);
      for (const hostname of hostnames) {
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

export function getDiscoveredPeers() {
  return Array.from(discoveredPeers);
}

export function addPeer(address) {
  discoveredPeers.add(address);
  logger.debug('Peer added manually', { address });
}

export function removePeer(address) {
  discoveredPeers.delete(address);
  logger.debug('Peer removed', { address });
}

export function clearPeers() {
  discoveredPeers.clear();
  logger.debug('All peers cleared');
}

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
