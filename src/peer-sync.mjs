import net from 'net';
import * as logger from './logger.mjs';
import * as chain from './chain.mjs';
import * as storage from './storage.mjs';

/**
 * Request chain sync from peer
 * @param {string} peerAddress - Peer address
 * @param {number} fromIndex - Start index (0 for full sync)
 * @returns {Promise<Object>} Sync data
 */
export async function requestSync(peerAddress, fromIndex = 0) {
  return new Promise((resolve, reject) => {
    const [host, port] = peerAddress.split(':');
    const client = new net.Socket();
    
    let responseData = '';
    
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Sync request timeout'));
    }, 30000); // 30 second timeout for sync
    
    client.connect(parseInt(port), host, () => {
      const message = {
        type: 'SYNC_REQUEST',
        fromIndex,
        timestamp: Date.now()
      };
      client.write(JSON.stringify(message) + '\n');
    });
    
    client.on('data', (data) => {
      responseData += data.toString();
      
      // Check for end marker or complete JSON
      if (responseData.includes('\n')) {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(responseData.trim());
          client.destroy();
          resolve(response);
        } catch (error) {
          // Might be incomplete, continue receiving
          if (responseData.length > 10000000) { // 10MB limit
            client.destroy();
            reject(new Error('Sync response too large'));
          }
        }
      }
    });
    
    client.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    
    client.on('close', () => {
      clearTimeout(timeout);
      if (responseData && responseData.includes('{')) {
        try {
          const response = JSON.parse(responseData.trim());
          resolve(response);
        } catch (error) {
          reject(new Error('Invalid sync response'));
        }
      } else {
        reject(new Error('Connection closed without response'));
      }
    });
  });
}

/**
 * Handle sync request from peer
 * @param {Object} message - Sync request message
 * @returns {Object} Sync response
 */
export function handleSyncRequest(message) {
  if (message.type !== 'SYNC_REQUEST') {
    throw new Error('Invalid message type');
  }
  
  const fromIndex = message.fromIndex || 0;
  const fullChain = chain.getChain();
  const metadata = chain.getChainMetadata();
  
  // Return blocks from the requested index
  const blocks = fullChain.slice(fromIndex);
  
  logger.debug('Sync request handled', { 
    fromIndex,
    blocksReturned: blocks.length
  });
  
  return {
    type: 'SYNC_RESPONSE',
    fromIndex,
    blocks,
    chainHash: metadata.chainHash,
    chainSignature: metadata.chainSignature,
    totalLength: fullChain.length,
    timestamp: Date.now()
  };
}

/**
 * Apply sync data to local chain
 * @param {Object} syncData - Sync data from peer
 * @returns {Promise<boolean>} True if sync applied successfully
 */
export async function applySyncData(syncData) {
  if (syncData.type !== 'SYNC_RESPONSE') {
    logger.warn('Invalid sync data type');
    return false;
  }
  
  if (!syncData.blocks || syncData.blocks.length === 0) {
    logger.debug('No blocks to sync');
    return true;
  }
  
  logger.info('Applying sync data', { 
    fromIndex: syncData.fromIndex,
    blockCount: syncData.blocks.length 
  });
  
  const currentChain = chain.getChain();
  const fromIndex = syncData.fromIndex;
  
  // Build new chain
  let newChain;
  if (fromIndex === 0) {
    // Full replacement
    newChain = syncData.blocks;
  } else {
    // Incremental update
    newChain = [
      ...currentChain.slice(0, fromIndex),
      ...syncData.blocks
    ];
  }
  
  // Replace chain
  const success = chain.replaceChain(
    newChain,
    syncData.chainHash,
    syncData.chainSignature
  );
  
  if (success) {
    // Save to storage
    try {
      await storage.saveSnapshot();
      logger.info('Chain synced successfully', { 
        newLength: chain.getChainLength() 
      });
    } catch (error) {
      logger.error('Failed to save synced chain', error.message);
    }
  } else {
    logger.warn('Failed to apply sync data');
  }
  
  return success;
}

/**
 * Sync with a specific peer
 * @param {string} peerAddress - Peer address
 * @param {number} fromIndex - Start index for sync
 * @returns {Promise<boolean>} True if synced successfully
 */
export async function syncWithPeer(peerAddress, fromIndex = 0) {
  try {
    logger.info('Syncing with peer', { peer: peerAddress, fromIndex });
    
    const syncData = await requestSync(peerAddress, fromIndex);
    const success = await applySyncData(syncData);
    
    if (success) {
      logger.info('Sync completed successfully', { peer: peerAddress });
    }
    
    return success;
  } catch (error) {
    logger.error('Sync failed', { 
      peer: peerAddress,
      error: error.message 
    });
    return false;
  }
}

/**
 * Sync with best peer from multiple peers
 * @param {Array<{address: string, chainLength: number, lastUpdated: number}>} peers - Peer info
 * @returns {Promise<boolean>} True if synced successfully
 */
export async function syncWithBestPeer(peers) {
  if (peers.length === 0) {
    logger.debug('No peers to sync with');
    return false;
  }
  
  // Sort by chain length (descending), then by last updated (descending)
  const sortedPeers = [...peers].sort((a, b) => {
    if (b.chainLength !== a.chainLength) {
      return b.chainLength - a.chainLength;
    }
    return b.lastUpdated - a.lastUpdated;
  });
  
  const bestPeer = sortedPeers[0];
  const currentLength = chain.getChainLength();
  
  logger.info('Syncing with best peer', {
    peer: bestPeer.address,
    peerChainLength: bestPeer.chainLength,
    localChainLength: currentLength,
    peerLastUpdated: bestPeer.lastUpdated
  });
  
  // Determine if we need full or incremental sync
  const fromIndex = (bestPeer.chainLength > currentLength) ? currentLength : 0;
  
  const success = await syncWithPeer(bestPeer.address, fromIndex);
  
  if (!success) {
    logger.warn('Failed to sync with best peer, trying alternatives');
    // Try next best peers
    for (let i = 1; i < Math.min(sortedPeers.length, 3); i++) {
      const altPeer = sortedPeers[i];
      logger.info('Attempting sync with alternative peer', { peer: altPeer.address });
      const altSuccess = await syncWithPeer(altPeer.address, fromIndex);
      if (altSuccess) {
        return true;
      }
    }
    return false;
  }
  
  return success;
}

/**
 * Perform incremental sync (only get missing blocks)
 * @param {string} peerAddress - Peer address
 * @returns {Promise<boolean>} True if synced successfully
 */
export async function incrementalSync(peerAddress) {
  const currentLength = chain.getChainLength();
  return await syncWithPeer(peerAddress, currentLength);
}

/**
 * Perform full sync (get entire chain)
 * @param {string} peerAddress - Peer address
 * @returns {Promise<boolean>} True if synced successfully
 */
export async function fullSync(peerAddress) {
  return await syncWithPeer(peerAddress, 0);
}

/**
 * Detect and sync chain differences
 * @param {string} peerAddress - Peer address
 * @param {string} peerChainHash - Peer's chain hash
 * @returns {Promise<boolean>} True if synced successfully
 */
export async function syncDifferences(peerAddress, peerChainHash) {
  const currentHash = chain.getChainHash();
  
  if (currentHash === peerChainHash) {
    logger.debug('Chains are identical, no sync needed');
    return true;
  }
  
  // Perform incremental sync to get differences
  return await incrementalSync(peerAddress);
}

export default {
  requestSync,
  handleSyncRequest,
  applySyncData,
  syncWithPeer,
  syncWithBestPeer,
  incrementalSync,
  fullSync,
  syncDifferences
};
