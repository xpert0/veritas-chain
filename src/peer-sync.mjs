import net from 'net';
import * as logger from './logger.mjs';
import * as chain from './chain.mjs';
import * as storage from './storage.mjs';

export async function requestSync(peerAddress, fromIndex = 0) {
  return new Promise((resolve, reject) => {
    const [host, port] = peerAddress.split(':');
    const client = new net.Socket();
    let responseData = '';
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Sync request timeout'));
    }, 10000);
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
      if (responseData.includes('\n')) {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(responseData.trim());
          client.destroy();
          resolve(response);
        } catch (error) {
          if (responseData.length > 10000000) {
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

export function handleSyncRequest(message) {
  if (message.type !== 'SYNC_REQUEST') {
    throw new Error('Invalid message type');
  }
  const fromIndex = message.fromIndex || 0;
  const fullChain = chain.getChain();
  const metadata = chain.getChainMetadata();
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
  let newChain;
  if (fromIndex === 0) {
    newChain = syncData.blocks;
  } else {
    newChain = [
      ...currentChain.slice(0, fromIndex),
      ...syncData.blocks
    ];
  }
  try {
    const localGenesis = genesis.getGenesisBlock();
    console.log(localGenesis);
    if (!localGenesis) {
      // const candidate = newChain[0];
      const candidate = syncData.genesisBlock;
      console.log(candidate);
      if (!candidate) {
        logger.warn('No genesis candidate in sync data; aborting sync');
        return false;
      }
      if (candidate.masterPubKey && candidate.chainSignature) {
        genesis.setGenesisBlock(candidate);
        try {
          await storage.saveGenesis(candidate);
          logger.info('Genesis block set from peer and persisted', { chainId: candidate.chainId });
        } catch (err) {
          logger.warn('Failed to persist genesis block received from peer', err.message);
        }
      } else {
        logger.warn('Incoming genesis candidate is missing required fields; aborting sync');
        return false;
      }
    }
  } catch (err) {
    logger.error('Error while setting genesis from sync data', err.message);
    return false;
  }
  const success = chain.replaceChain(
    newChain,
    syncData.chainHash,
    syncData.chainSignature
  );
  if (success) {
    try {
      await storage.saveSnapshot();
      console.log(chain.getChainLength());
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

export async function syncWithBestPeer(peers) {
  if (peers.length === 0) {
    logger.debug('No peers to sync with');
    return false;
  }
  const sortedPeers = [...peers].sort((a, b) => {
    if (b.chainLength !== a.chainLength) {
      return b.chainLength - a.chainLength;
    }
    return b.lastUpdated - a.lastUpdated;
  });
  const bestPeer = sortedPeers[0];
  const currentLength = chain.getChainLength();
  const fromIndex = (bestPeer.chainLength > currentLength) ? currentLength : 0;
  return await syncWithPeer(bestPeer.address, fromIndex);
}

export async function incrementalSync(peerAddress) {
  const currentLength = chain.getChainLength();
  return await syncWithPeer(peerAddress, currentLength);
}

export async function fullSync(peerAddress) {
  return await syncWithPeer(peerAddress, 0);
}

export async function syncDifferences(peerAddress, peerChainHash) {
  const currentHash = chain.getChainHash();
  if (currentHash === peerChainHash) {
    logger.debug('Chains are identical, no sync needed');
    return true;
  }
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
