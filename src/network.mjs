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

export async function initNetwork() {
  peerId = `peer-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  logger.info('Network initialized', { peerId });
}

export async function startP2PServer() {
  const config = getNetworkConfig();
  p2pServer = net.createServer((socket) => {
    let dataBuffer = '';
    socket.on('data', async (data) => {
      dataBuffer += data.toString();
      const messages = dataBuffer.split('\n');
      dataBuffer = messages.pop();
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
      const metadata = chain.getChainMetadata();
      if (eventResult.data.chainLength > metadata.length) {
        logger.info('Detected longer chain, syncing...');
      }
      break;
    default:
      logger.debug('Event action processed', { action: eventResult.action });
  }
}

export async function discoverAndConnect() {
  logger.info('Starting peer discovery and connection');
  const peers = await discovery.discoverPeers();
  if (peers.length === 0) {
    logger.warn('No peers discovered');
    return;
  }
  const handshakeResults = await handshake.handshakeWithPeers(peers, peerId);
  const connectedPeers = handshakeResults
    .filter(r => r.success)
    .map(r => ({
      address: peers[handshakeResults.indexOf(r)],
      chainLength: r.peerChainLength,
      lastUpdated: r.peerLastUpdated,
      needsSync: r.needsSync
    }));
  activePeers = connectedPeers.map(p => p.address);
  gossip.updatePeerList(activePeers);
  logger.info('Connected to peers', { count: activePeers.length });
  const peersNeedingSync = connectedPeers.filter(p => p.needsSync);
  if (peersNeedingSync.length > 0) {
    await sync.syncWithBestPeer(peersNeedingSync);
  }
}

async function periodicDiscoveryAndConnect() {
  try {
    const peers = await discovery.discoverPeers();
    if (peers.length === 0) {
      return;
    }
    // Filter out already connected peers
    const newPeers = peers.filter(p => !activePeers.includes(p));
    if (newPeers.length === 0) {
      return;
    }
    logger.info('New peers discovered', { count: newPeers.length });
    const handshakeResults = await handshake.handshakeWithPeers(newPeers, peerId);
    const connectedPeers = handshakeResults
      .filter(r => r.success)
      .map(r => ({
        address: newPeers[handshakeResults.indexOf(r)],
        chainLength: r.peerChainLength,
        lastUpdated: r.peerLastUpdated,
        needsSync: r.needsSync
      }));
    // Add new peers to active peers list
    const newActivePeers = connectedPeers.map(p => p.address);
    activePeers.push(...newActivePeers);
    gossip.updatePeerList(activePeers);
    logger.info('Connected to new peers', { count: newActivePeers.length, total: activePeers.length });
    // Sync with new peers if needed
    const peersNeedingSync = connectedPeers.filter(p => p.needsSync);
    if (peersNeedingSync.length > 0) {
      await sync.syncWithBestPeer(peersNeedingSync);
    }
  } catch (error) {
    logger.error('Periodic discovery and connect failed', error.message);
  }
}

export async function startMesh() {
  await startP2PServer();
  await discoverAndConnect();
  // Start periodic discovery with handshake and sync
  discoveryInterval = setInterval(periodicDiscoveryAndConnect, 30000); // Every 30 seconds
  gossipInterval = gossip.startGossip(activePeers, 30); // Every 30 seconds
  logger.info('Full mesh networking started');
}

export async function startPeriodicDiscoveryAndGossip() {
  // Start periodic discovery with handshake and sync
  discoveryInterval = setInterval(periodicDiscoveryAndConnect, 30000); // Every 30 seconds
  gossipInterval = gossip.startGossip(activePeers, 30); // Every 30 seconds
  logger.info('Periodic discovery and gossip started');
}

export function stopNetwork() {
  gossip.stopGossip();
  if (discoveryInterval) {
    clearInterval(discoveryInterval);
    discoveryInterval = null;
  }
  if (p2pServer) {
    p2pServer.close(() => {
      logger.info('P2P server stopped');
    });
    p2pServer = null;
  }
  logger.info('Network stopped');
}

export function getActivePeers() {
  return activePeers;
}

export function getPeerId() {
  return peerId;
}

export async function broadcastNewBlock(block) {
  return await broadcast.broadcastNewBlock(activePeers, block);
}

export async function broadcastBlockUpdate(block) {
  return await broadcast.broadcastBlockUpdate(activePeers, block);
}

export async function broadcastKeyRotation(blockHash, newStage) {
  return await broadcast.broadcastKeyRotation(activePeers, blockHash, newStage);
}

export async function broadcastPruning(blockHash) {
  return await broadcast.broadcastPruning(activePeers, blockHash);
}

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
  startPeriodicDiscoveryAndGossip,
  stopNetwork,
  getActivePeers,
  getPeerId,
  broadcastNewBlock,
  broadcastBlockUpdate,
  broadcastKeyRotation,
  broadcastPruning,
  getNetworkStatus
};
