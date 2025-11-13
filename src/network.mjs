import net from 'net';
import * as logger from './logger.mjs';
import * as discovery from './peer-discovery.mjs';
import * as handshake from './peer-handshake.mjs';
import * as sync from './peer-sync.mjs';
import * as gossip from './peer-gossip.mjs';
import * as broadcast from './peer-broadcast.mjs';
import * as chain from './chain.mjs';
import { getNetworkConfig } from './config.mjs';
import { getCurrentTimestamp } from './utils.mjs';

let p2pServer = null;
let peerId = null;
let activePeers = [];
let discoveryInterval = null;
let gossipInterval = null;

/**
 * Initialize network
 * @returns {Promise<void>}
 */
export async function initNetwork() {
  peerId = `peer-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  logger.info('Network initialized', { peerId });
}

/**
 * Start P2P server
 * @returns {Promise<void>}
 */
export async function startP2PServer() {
  const config = getNetworkConfig();
  
  p2pServer = net.createServer((socket) => {
    let dataBuffer = '';
    
    socket.on('data', async (data) => {
      dataBuffer += data.toString();
      
      // Process complete messages (ending with \n)
      const messages = dataBuffer.split('\n');
      dataBuffer = messages.pop(); // Keep incomplete message
      
      for (const messageStr of messages) {
        if (!messageStr.trim()) continue;
        
        try {
          const message = JSON.parse(messageStr);
          await handleIncomingMessage(message, socket);
        } catch (error) {
          logger.error('Failed to process message', error.message);
        }
      }
    });
    
    socket.on('error', (error) => {
      logger.debug('Socket error', error.message);
    });
    
    socket.on('close', () => {
      logger.debug('Socket closed');
    });
  });
  
  return new Promise((resolve, reject) => {
    p2pServer.listen(config.p2pPort, () => {
      logger.info('P2P server started', { port: config.p2pPort });
      resolve();
    });
    
    p2pServer.on('error', (error) => {
      logger.error('P2P server error', error.message);
      reject(error);
    });
  });
}

/**
 * Handle incoming message
 * @param {Object} message - Message object
 * @param {net.Socket} socket - Socket connection
 */
async function handleIncomingMessage(message, socket) {
  logger.debug('Message received', { type: message.type });
  
  switch (message.type) {
    case 'HANDSHAKE':
      const handshakeResponse = handshake.handleHandshake(message, peerId);
      socket.write(JSON.stringify(handshakeResponse) + '\n');
      break;
      
    case 'SYNC_REQUEST':
      const syncResponse = sync.handleSyncRequest(message);
      socket.write(JSON.stringify(syncResponse) + '\n');
      break;
      
    case 'GOSSIP':
      const gossipAction = gossip.handleGossip(message, socket.remoteAddress);
      if (gossipAction.action === 'sync') {
        // Trigger sync in background
        sync.syncWithPeer(gossipAction.peerAddress).catch(err =>
          logger.error('Auto-sync failed', err.message)
        );
      }
      break;
      
    case 'NEW_BLOCK':
    case 'UPDATE_BLOCK':
    case 'ROTATE_KEY':
    case 'PRUNE_BLOCK':
    case 'TOKEN_ISSUED':
    case 'CHAIN_STATE':
      const eventResult = broadcast.handleEvent(message);
      if (eventResult.processed) {
        await processEventAction(eventResult);
      }
      break;
      
    default:
      logger.warn('Unknown message type', { type: message.type });
  }
}

/**
 * Process event action
 * @param {Object} eventResult - Event result from handleEvent
 */
async function processEventAction(eventResult) {
  switch (eventResult.action) {
    case 'add_block':
      chain.addBlock(eventResult.data);
      break;
      
    case 'update_block':
      const block = eventResult.data;
      chain.updateBlockInChain(block.hash, block);
      break;
      
    case 'prune_block':
      chain.removeBlock(eventResult.data.blockHash);
      break;
      
    case 'chain_state':
      // Check if we need to sync
      const metadata = chain.getChainMetadata();
      if (eventResult.data.chainLength > metadata.length) {
        logger.info('Detected longer chain, syncing...');
      }
      break;
      
    default:
      logger.debug('Event action processed', { action: eventResult.action });
  }
}

/**
 * Discover and connect to peers
 * @returns {Promise<void>}
 */
export async function discoverAndConnect() {
  logger.info('Starting peer discovery and connection');
  
  // Discover peers
  const peers = await discovery.discoverPeers();
  
  if (peers.length === 0) {
    logger.warn('No peers discovered');
    return;
  }
  
  // Handshake with peers
  const handshakeResults = await handshake.handshakeWithPeers(peers, peerId);
  
  // Filter successful handshakes
  const connectedPeers = handshakeResults
    .filter(r => r.success)
    .map(r => ({
      address: peers[handshakeResults.indexOf(r)],
      chainLength: r.peerChainLength,
      lastUpdated: r.peerLastUpdated,
      needsSync: r.needsSync
    }));
  
  activePeers = connectedPeers.map(p => p.address);
  
  // Update gossip peer list
  gossip.updatePeerList(activePeers);
  
  logger.info('Connected to peers', { count: activePeers.length });
  
  // Sync if needed
  const peersNeedingSync = connectedPeers.filter(p => p.needsSync);
  if (peersNeedingSync.length > 0) {
    await sync.syncWithBestPeer(peersNeedingSync);
  }
}

/**
 * Start full mesh networking
 * @returns {Promise<void>}
 */
export async function startMesh() {
  // Start P2P server
  await startP2PServer();
  
  // Discover and connect to peers
  await discoverAndConnect();
  
  // Start periodic discovery
  discoveryInterval = discovery.startPeriodicDiscovery(300); // Every 5 minutes
  
  // Start gossip
  gossipInterval = gossip.startGossip(activePeers, 30); // Every 30 seconds
  
  logger.info('Full mesh networking started');
}

/**
 * Stop networking
 */
export function stopNetwork() {
  // Stop gossip
  gossip.stopGossip();
  
  // Stop discovery
  if (discoveryInterval) {
    clearInterval(discoveryInterval);
    discoveryInterval = null;
  }
  
  // Close P2P server
  if (p2pServer) {
    p2pServer.close(() => {
      logger.info('P2P server stopped');
    });
    p2pServer = null;
  }
  
  logger.info('Network stopped');
}

/**
 * Get active peers
 * @returns {string[]} Array of peer addresses
 */
export function getActivePeers() {
  return activePeers;
}

/**
 * Get peer ID
 * @returns {string} Peer ID
 */
export function getPeerId() {
  return peerId;
}

/**
 * Broadcast new block to network
 * @param {Object} block - New block
 * @returns {Promise<number>} Number of successful broadcasts
 */
export async function broadcastNewBlock(block) {
  return await broadcast.broadcastNewBlock(activePeers, block);
}

/**
 * Broadcast block update to network
 * @param {Object} block - Updated block
 * @returns {Promise<number>} Number of successful broadcasts
 */
export async function broadcastBlockUpdate(block) {
  return await broadcast.broadcastBlockUpdate(activePeers, block);
}

/**
 * Broadcast key rotation to network
 * @param {string} blockHash - Block hash
 * @param {string} newStage - New lifecycle stage
 * @returns {Promise<number>} Number of successful broadcasts
 */
export async function broadcastKeyRotation(blockHash, newStage) {
  return await broadcast.broadcastKeyRotation(activePeers, blockHash, newStage);
}

/**
 * Broadcast block pruning to network
 * @param {string} blockHash - Pruned block hash
 * @returns {Promise<number>} Number of successful broadcasts
 */
export async function broadcastPruning(blockHash) {
  return await broadcast.broadcastPruning(activePeers, blockHash);
}

/**
 * Get network status
 * @returns {Object} Network status
 */
export function getNetworkStatus() {
  return {
    peerId,
    activePeers: activePeers.length,
    isServerRunning: p2pServer !== null,
    timestamp: getCurrentTimestamp()
  };
}

export default {
  initNetwork,
  startP2PServer,
  discoverAndConnect,
  startMesh,
  stopNetwork,
  getActivePeers,
  getPeerId,
  broadcastNewBlock,
  broadcastBlockUpdate,
  broadcastKeyRotation,
  broadcastPruning,
  getNetworkStatus
};
