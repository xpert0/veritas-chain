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
  // Generate peer ID
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
  
  const config = getNetworkConfig();
  
  switch (message.type) {
    case 'HANDSHAKE':
      const handshakeResponse = handshake.handleHandshake(message, peerId, config.p2pPort);
      socket.write(JSON.stringify(handshakeResponse) + '\n');
      
      // Add peer to active peers if not already there
      // Use the p2pPort from the handshake message if available
      const peerPort = message.p2pPort || socket.remotePort;
      const peerAddress = `${socket.remoteAddress.replace('::ffff:', '')}:${peerPort}`;
      if (!activePeers.includes(peerAddress)) {
        activePeers.push(peerAddress);
        discovery.addPeer(peerAddress);
        gossip.updatePeerList(activePeers);
        logger.info('New peer added from incoming handshake', { 
          peer: peerAddress,
          totalPeers: activePeers.length 
        });
      }
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
  
  const config = getNetworkConfig();
  
  // Discover peers
  const peers = await discovery.discoverPeers();
  
  if (peers.length === 0) {
    logger.debug('No new peers discovered');
    return;
  }
  
  logger.info('Discovered peers, initiating handshakes', { count: peers.length });
  
  // Handshake with peers
  const handshakeResults = await handshake.handshakeWithPeers(peers, peerId, config.p2pPort);
  
  // Filter successful handshakes and build peer info
  const connectedPeers = [];
  for (let i = 0; i < handshakeResults.length; i++) {
    const result = handshakeResults[i];
    if (result.success) {
      connectedPeers.push({
        address: peers[i],
        chainLength: result.peerChainLength,
        lastUpdated: result.peerLastUpdated,
        needsSync: result.needsSync
      });
    }
  }
  
  if (connectedPeers.length === 0) {
    logger.warn('No successful peer connections');
    return;
  }
  
  // Update active peers list (merge with existing)
  const newPeers = connectedPeers.map(p => p.address);
  let newPeersAdded = 0;
  for (const peer of newPeers) {
    if (!activePeers.includes(peer)) {
      activePeers.push(peer);
      newPeersAdded++;
    }
  }
  
  // Update gossip peer list
  gossip.updatePeerList(activePeers);
  
  logger.info('Peer connection update', { 
    totalActivePeers: activePeers.length,
    newPeersAdded,
    connectedThisRound: connectedPeers.length
  });
  
  // Sync if needed
  const peersNeedingSync = connectedPeers.filter(p => p.needsSync);
  if (peersNeedingSync.length > 0) {
    logger.info('Peers requiring sync detected', { count: peersNeedingSync.length });
    const syncSuccess = await sync.syncWithBestPeer(peersNeedingSync);
    if (syncSuccess) {
      logger.info('Chain synchronized successfully');
    } else {
      logger.warn('Chain synchronization failed');
    }
  }
}

/**
 * Start full mesh networking
 * @returns {Promise<void>}
 */
export async function startMesh() {
  logger.info('Starting mesh network initialization');
  
  // Start P2P server
  await startP2PServer();
  
  // Initial discovery and connection
  logger.info('Performing initial peer discovery and connection');
  await discoverAndConnect();
  
  // Start continuous local scan (every 1 second) with throttled DNS
  // Logs only every 100 scans
  logger.info('Starting continuous peer discovery (1 second intervals)');
  discoveryInterval = setInterval(async () => {
    try {
      await discoverAndConnect();
    } catch (error) {
      logger.error('Continuous discovery and connection failed', error.message);
    }
  }, 1000); // Every 1 second for constant scanning
  
  // Start gossip
  gossipInterval = gossip.startGossip(activePeers, 30); // Every 30 seconds
  
  logger.info('Full mesh networking started', {
    p2pServerRunning: true,
    continuousScanEnabled: true,
    gossipEnabled: true
  });
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
