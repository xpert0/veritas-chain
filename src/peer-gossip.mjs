import net from 'net';
import * as logger from './logger.mjs';
import * as chain from './chain.mjs';
import { getCurrentTimestamp } from './utils.mjs';

let gossipInterval = null;
let connectedPeers = new Map(); // address -> connection info

/**
 * Create gossip message
 * @returns {Object} Gossip message
 */
export function createGossipMessage() {
  const metadata = chain.getChainMetadata();
  
  return {
    type: 'GOSSIP',
    chainLength: metadata.length,
    chainHash: metadata.chainHash,
    lastUpdated: metadata.lastUpdated,
    timestamp: getCurrentTimestamp()
  };
}

/**
 * Send gossip to peer
 * @param {string} peerAddress - Peer address
 * @returns {Promise<boolean>} True if sent successfully
 */
export async function sendGossipToPeer(peerAddress) {
  return new Promise((resolve) => {
    const [host, port] = peerAddress.split(':');
    const client = new net.Socket();
    
    const timeout = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 2000);
    
    client.connect(parseInt(port), host, () => {
      const message = createGossipMessage();
      client.write(JSON.stringify(message) + '\n');
      clearTimeout(timeout);
      client.destroy();
      resolve(true);
    });
    
    client.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Handle incoming gossip
 * @param {Object} message - Gossip message
 * @param {string} peerAddress - Peer address
 * @returns {{action: string, reason?: string}}
 */
export function handleGossip(message, peerAddress) {
  if (message.type !== 'GOSSIP') {
    return { action: 'ignore', reason: 'Invalid message type' };
  }
  
  const metadata = chain.getChainMetadata();
  
  // Update peer info
  connectedPeers.set(peerAddress, {
    chainLength: message.chainLength,
    chainHash: message.chainHash,
    lastUpdated: message.lastUpdated,
    lastSeen: getCurrentTimestamp()
  });
  
  // Check if peer has longer/newer chain
  if (message.chainLength > metadata.length ||
      (message.chainLength === metadata.length && 
       message.lastUpdated > metadata.lastUpdated)) {
    
    logger.debug('Peer has newer chain', { 
      peer: peerAddress,
      peerLength: message.chainLength,
      ourLength: metadata.length
    });
    
    return { 
      action: 'sync',
      peerAddress,
      chainLength: message.chainLength,
      lastUpdated: message.lastUpdated
    };
  }
  
  return { action: 'ignore', reason: 'Chain up to date' };
}

/**
 * Broadcast gossip to all peers
 * @param {string[]} peerAddresses - Array of peer addresses
 * @returns {Promise<number>} Number of successful sends
 */
export async function broadcastGossip(peerAddresses) {
  if (peerAddresses.length === 0) {
    return 0;
  }
  
  logger.debug('Broadcasting gossip', { peerCount: peerAddresses.length });
  
  const promises = peerAddresses.map(address => sendGossipToPeer(address));
  const results = await Promise.allSettled(promises);
  
  const successCount = results.filter(
    r => r.status === 'fulfilled' && r.value
  ).length;
  
  logger.debug('Gossip broadcast complete', { 
    total: peerAddresses.length,
    successful: successCount
  });
  
  return successCount;
}

/**
 * Start periodic gossip
 * @param {string[]} peerAddresses - Array of peer addresses
 * @param {number} intervalSeconds - Gossip interval in seconds
 * @returns {NodeJS.Timeout} Interval handle
 */
export function startGossip(peerAddresses, intervalSeconds = 30) {
  if (gossipInterval) {
    stopGossip();
  }
  
  logger.info('Starting periodic gossip', { 
    intervalSeconds,
    peerCount: peerAddresses.length
  });
  
  // Initial gossip
  broadcastGossip(peerAddresses).catch(err => 
    logger.error('Initial gossip failed', err.message)
  );
  
  // Periodic gossip
  gossipInterval = setInterval(async () => {
    try {
      await broadcastGossip(peerAddresses);
    } catch (error) {
      logger.error('Periodic gossip failed', error.message);
    }
  }, intervalSeconds * 1000);
  
  return gossipInterval;
}

/**
 * Stop periodic gossip
 */
export function stopGossip() {
  if (gossipInterval) {
    clearInterval(gossipInterval);
    gossipInterval = null;
    logger.debug('Periodic gossip stopped');
  }
}

/**
 * Get peer information
 * @param {string} peerAddress - Peer address
 * @returns {Object|null} Peer info or null
 */
export function getPeerInfo(peerAddress) {
  return connectedPeers.get(peerAddress) || null;
}

/**
 * Get all connected peers
 * @returns {Map<string, Object>} Map of peer addresses to info
 */
export function getAllPeers() {
  return new Map(connectedPeers);
}

/**
 * Remove stale peers
 * @param {number} staleThresholdSeconds - Seconds after which peer is considered stale
 * @returns {number} Number of removed peers
 */
export function removeStalePeers(staleThresholdSeconds = 300) {
  const now = getCurrentTimestamp();
  let removedCount = 0;
  
  for (const [address, info] of connectedPeers.entries()) {
    if (now - info.lastSeen > staleThresholdSeconds) {
      connectedPeers.delete(address);
      removedCount++;
    }
  }
  
  if (removedCount > 0) {
    logger.debug('Stale peers removed', { count: removedCount });
  }
  
  return removedCount;
}

/**
 * Update peer list for gossip
 * @param {string[]} newPeerAddresses - New peer addresses
 */
export function updatePeerList(newPeerAddresses) {
  // Add new peers
  for (const address of newPeerAddresses) {
    if (!connectedPeers.has(address)) {
      connectedPeers.set(address, {
        chainLength: 0,
        chainHash: null,
        lastUpdated: null,
        lastSeen: getCurrentTimestamp()
      });
    }
  }
  
  logger.debug('Peer list updated', { totalPeers: connectedPeers.size });
}

/**
 * Get peers that need sync (have longer/newer chains)
 * @returns {Array<{address: string, chainLength: number, lastUpdated: number}>}
 */
export function getPeersNeedingSync() {
  const metadata = chain.getChainMetadata();
  const peersToSync = [];
  
  for (const [address, info] of connectedPeers.entries()) {
    if (info.chainLength > metadata.length ||
        (info.chainLength === metadata.length && 
         info.lastUpdated > metadata.lastUpdated)) {
      peersToSync.push({
        address,
        chainLength: info.chainLength,
        lastUpdated: info.lastUpdated
      });
    }
  }
  
  return peersToSync;
}

export default {
  createGossipMessage,
  sendGossipToPeer,
  handleGossip,
  broadcastGossip,
  startGossip,
  stopGossip,
  getPeerInfo,
  getAllPeers,
  removeStalePeers,
  updatePeerList,
  getPeersNeedingSync
};
