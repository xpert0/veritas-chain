import { promises as fs } from 'fs';
import path from 'path';
import * as logger from './logger.mjs';
import * as genesis from './genesis.mjs';
import * as chain from './chain.mjs';
import { getStorageConfig } from './config.mjs';

const CHAIN_FILE = 'chain.json';
const GENESIS_FILE = 'genesis.json';
const MASTER_KEY_FILE = 'master_key.json';

let storagePath = null;
let snapshotInterval = null;

/**
 * Initialize storage
 * @returns {Promise<void>}
 */
export async function initStorage() {
  const config = getStorageConfig();
  storagePath = path.resolve(config.path);
  
  // Create storage directory if it doesn't exist
  try {
    await fs.mkdir(storagePath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
  
  logger.info('Storage initialized', { path: storagePath });
}

/**
 * Save genesis block
 * @param {Object} genesisBlock - Genesis block to save
 * @returns {Promise<void>}
 */
export async function saveGenesis(genesisBlock) {
  if (!storagePath) {
    throw new Error('Storage not initialized');
  }
  
  const genesisPath = path.join(storagePath, GENESIS_FILE);
  await fs.writeFile(genesisPath, JSON.stringify(genesisBlock, null, 2));
  
  logger.debug('Genesis block saved');
}

/**
 * Load genesis block
 * @returns {Promise<Object|null>} Genesis block or null
 */
export async function loadGenesis() {
  if (!storagePath) {
    throw new Error('Storage not initialized');
  }
  
  const genesisPath = path.join(storagePath, GENESIS_FILE);
  
  try {
    const data = await fs.readFile(genesisPath, 'utf8');
    const genesisBlock = JSON.parse(data);
    
    logger.debug('Genesis block loaded');
    return genesisBlock;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Save master key pair
 * @param {Object} keyPair - Master key pair
 * @returns {Promise<void>}
 */
export async function saveMasterKey(keyPair) {
  if (!storagePath) {
    throw new Error('Storage not initialized');
  }
  
  const keyPath = path.join(storagePath, MASTER_KEY_FILE);
  await fs.writeFile(keyPath, JSON.stringify(keyPair, null, 2));
  
  logger.debug('Master key saved');
}

/**
 * Load master key pair
 * @returns {Promise<Object|null>} Master key pair or null
 */
export async function loadMasterKey() {
  if (!storagePath) {
    throw new Error('Storage not initialized');
  }
  
  const keyPath = path.join(storagePath, MASTER_KEY_FILE);
  
  try {
    const data = await fs.readFile(keyPath, 'utf8');
    const keyPair = JSON.parse(data);
    
    logger.debug('Master key loaded');
    return keyPair;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Save chain snapshot
 * @returns {Promise<void>}
 */
export async function saveSnapshot() {
  if (!storagePath) {
    throw new Error('Storage not initialized');
  }
  
  const chainPath = path.join(storagePath, CHAIN_FILE);
  
  const snapshot = {
    chain: chain.getChain(),
    chainHash: chain.getChainHash(),
    chainSignature: chain.getChainSignature(),
    timestamp: Date.now()
  };
  
  await fs.writeFile(chainPath, JSON.stringify(snapshot, null, 2));
  
  logger.debug('Chain snapshot saved', { blocks: snapshot.chain.length });
}

/**
 * Load chain snapshot
 * @returns {Promise<Object|null>} Chain snapshot or null
 */
export async function loadSnapshot() {
  if (!storagePath) {
    throw new Error('Storage not initialized');
  }
  
  const chainPath = path.join(storagePath, CHAIN_FILE);
  
  try {
    const data = await fs.readFile(chainPath, 'utf8');
    const snapshot = JSON.parse(data);
    
    logger.debug('Chain snapshot loaded', { blocks: snapshot.chain.length });
    return snapshot;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Start automatic snapshots
 */
export function startAutoSnapshot() {
  const config = getStorageConfig();
  
  if (snapshotInterval) {
    return;
  }
  
  snapshotInterval = setInterval(async () => {
    try {
      await saveSnapshot();
    } catch (error) {
      logger.error('Auto snapshot failed', error.message);
    }
  }, config.snapshotIntervalSeconds * 1000);
  
  logger.info('Auto snapshot started', { 
    intervalSeconds: config.snapshotIntervalSeconds 
  });
}

/**
 * Stop automatic snapshots
 */
export function stopAutoSnapshot() {
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
    logger.debug('Auto snapshot stopped');
  }
}

/**
 * Load all data from storage
 * @returns {Promise<{genesis: Object|null, masterKey: Object|null, snapshot: Object|null}>}
 */
export async function loadAll() {
  const genesisBlock = await loadGenesis();
  const masterKey = await loadMasterKey();
  const snapshot = await loadSnapshot();
  
  return { genesis: genesisBlock, masterKey, snapshot };
}

/**
 * Save all data to storage
 * @returns {Promise<void>}
 */
export async function saveAll() {
  const genesisBlock = genesis.getGenesisBlock();
  const masterKey = genesis.getMasterKeyPair();
  
  if (genesisBlock) {
    await saveGenesis(genesisBlock);
  }
  
  if (masterKey) {
    await saveMasterKey(masterKey);
  }
  
  await saveSnapshot();
  
  logger.info('All data saved to storage');
}

export default {
  initStorage,
  saveGenesis,
  loadGenesis,
  saveMasterKey,
  loadMasterKey,
  saveSnapshot,
  loadSnapshot,
  startAutoSnapshot,
  stopAutoSnapshot,
  loadAll,
  saveAll
};
