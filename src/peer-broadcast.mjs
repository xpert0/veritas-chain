import net from 'net';
import * as logger from './logger.mjs';
import { getCurrentTimestamp } from './utils.mjs';

/**
 * Broadcast event to peer
 * @param {string} peerAddress - Peer address
 * @param {Object} event - Event to broadcast
 * @returns {Promise<boolean>} True if sent successfully
 */
export async function broadcastToPeer(peerAddress, event) {
  return new Promise((resolve) => {
    const [host, port] = peerAddress.split(':');
    const client = new net.Socket();
    
    const timeout = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 3000);
    
    client.connect(parseInt(port), host, () => {
      client.write(JSON.stringify(event) + '\n');
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
 * Broadcast event to all peers
 * @param {string[]} peerAddresses - Array of peer addresses
 * @param {Object} event - Event to broadcast
 * @returns {Promise<number>} Number of successful broadcasts
 */
export async function broadcastToAll(peerAddresses, event) {
  if (peerAddresses.length === 0) {
    logger.debug('No peers to broadcast to');
    return 0;
  }
  
  logger.debug('Broadcasting event', { 
    type: event.type,
    peerCount: peerAddresses.length 
  });
  
  const promises = peerAddresses.map(address => broadcastToPeer(address, event));
  const results = await Promise.allSettled(promises);
  
  const successCount = results.filter(
    r => r.status === 'fulfilled' && r.value
  ).length;
  
  logger.debug('Broadcast complete', { 
    total: peerAddresses.length,
    successful: successCount
  });
  
  return successCount;
}

/**
 * Create new block event
 * @param {Object} block - New block
 * @returns {Object} Event object
 */
export function createNewBlockEvent(block) {
  return {
    type: 'NEW_BLOCK',
    block,
    timestamp: getCurrentTimestamp()
  };
}

/**
 * Create block update event
 * @param {Object} block - Updated block
 * @returns {Object} Event object
 */
export function createUpdateBlockEvent(block) {
  return {
    type: 'UPDATE_BLOCK',
    block,
    timestamp: getCurrentTimestamp()
  };
}

/**
 * Create key rotation event
 * @param {string} blockHash - Block hash
 * @param {string} newStage - New lifecycle stage
 * @returns {Object} Event object
 */
export function createRotateKeyEvent(blockHash, newStage) {
  return {
    type: 'ROTATE_KEY',
    blockHash,
    newStage,
    timestamp: getCurrentTimestamp()
  };
}

/**
 * Create block prune event
 * @param {string} blockHash - Pruned block hash
 * @returns {Object} Event object
 */
export function createPruneBlockEvent(blockHash) {
  return {
    type: 'PRUNE_BLOCK',
    blockHash,
    timestamp: getCurrentTimestamp()
  };
}

/**
 * Create token issued event
 * @param {string} blockHash - Block hash
 * @param {string} tokenId - Token ID
 * @returns {Object} Event object
 */
export function createTokenIssuedEvent(blockHash, tokenId) {
  return {
    type: 'TOKEN_ISSUED',
    blockHash,
    tokenId,
    timestamp: getCurrentTimestamp()
  };
}

/**
 * Create chain state event
 * @param {number} chainLength - Chain length
 * @param {string} chainHash - Chain hash
 * @returns {Object} Event object
 */
export function createChainStateEvent(chainLength, chainHash) {
  return {
    type: 'CHAIN_STATE',
    chainLength,
    chainHash,
    timestamp: getCurrentTimestamp()
  };
}

/**
 * Handle incoming event
 * @param {Object} event - Event object
 * @returns {{processed: boolean, action?: string, data?: any}}
 */
export function handleEvent(event) {
  if (!event || !event.type) {
    return { processed: false };
  }
  
  logger.debug('Event received', { type: event.type });
  
  switch (event.type) {
    case 'NEW_BLOCK':
      return { 
        processed: true, 
        action: 'add_block', 
        data: event.block 
      };
      
    case 'UPDATE_BLOCK':
      return { 
        processed: true, 
        action: 'update_block', 
        data: event.block 
      };
      
    case 'ROTATE_KEY':
      return { 
        processed: true, 
        action: 'rotate_key', 
        data: { 
          blockHash: event.blockHash, 
          newStage: event.newStage 
        } 
      };
      
    case 'PRUNE_BLOCK':
      return { 
        processed: true, 
        action: 'prune_block', 
        data: { blockHash: event.blockHash } 
      };
      
    case 'TOKEN_ISSUED':
      return { 
        processed: true, 
        action: 'token_issued', 
        data: { 
          blockHash: event.blockHash, 
          tokenId: event.tokenId 
        } 
      };
      
    case 'CHAIN_STATE':
      return { 
        processed: true, 
        action: 'chain_state', 
        data: { 
          chainLength: event.chainLength, 
          chainHash: event.chainHash 
        } 
      };
      
    default:
      logger.warn('Unknown event type', { type: event.type });
      return { processed: false };
  }
}

/**
 * Broadcast new block to network
 * @param {string[]} peerAddresses - Peer addresses
 * @param {Object} block - New block
 * @returns {Promise<number>} Number of successful broadcasts
 */
export async function broadcastNewBlock(peerAddresses, block) {
  const event = createNewBlockEvent(block);
  return await broadcastToAll(peerAddresses, event);
}

/**
 * Broadcast block update to network
 * @param {string[]} peerAddresses - Peer addresses
 * @param {Object} block - Updated block
 * @returns {Promise<number>} Number of successful broadcasts
 */
export async function broadcastBlockUpdate(peerAddresses, block) {
  const event = createUpdateBlockEvent(block);
  return await broadcastToAll(peerAddresses, event);
}

/**
 * Broadcast key rotation to network
 * @param {string[]} peerAddresses - Peer addresses
 * @param {string} blockHash - Block hash
 * @param {string} newStage - New lifecycle stage
 * @returns {Promise<number>} Number of successful broadcasts
 */
export async function broadcastKeyRotation(peerAddresses, blockHash, newStage) {
  const event = createRotateKeyEvent(blockHash, newStage);
  return await broadcastToAll(peerAddresses, event);
}

/**
 * Broadcast block pruning to network
 * @param {string[]} peerAddresses - Peer addresses
 * @param {string} blockHash - Pruned block hash
 * @returns {Promise<number>} Number of successful broadcasts
 */
export async function broadcastPruning(peerAddresses, blockHash) {
  const event = createPruneBlockEvent(blockHash);
  return await broadcastToAll(peerAddresses, event);
}

/**
 * Broadcast chain state to network
 * @param {string[]} peerAddresses - Peer addresses
 * @param {number} chainLength - Chain length
 * @param {string} chainHash - Chain hash
 * @returns {Promise<number>} Number of successful broadcasts
 */
export async function broadcastChainState(peerAddresses, chainLength, chainHash) {
  const event = createChainStateEvent(chainLength, chainHash);
  return await broadcastToAll(peerAddresses, event);
}

export default {
  broadcastToPeer,
  broadcastToAll,
  createNewBlockEvent,
  createUpdateBlockEvent,
  createRotateKeyEvent,
  createPruneBlockEvent,
  createTokenIssuedEvent,
  createChainStateEvent,
  handleEvent,
  broadcastNewBlock,
  broadcastBlockUpdate,
  broadcastKeyRotation,
  broadcastPruning,
  broadcastChainState
};
