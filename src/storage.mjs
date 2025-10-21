import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as logger from './logger.mjs';
import * as genesis from './genesis.mjs';
import * as chain from './chain.mjs';
import { getStorageConfig, getProtocolConfig } from './config.mjs';

const CHAIN_FILE = 'chain.json';
const GENESIS_FILE = 'genesis.json';

let storagePath = null;
let snapshotInterval = null;

// Concealment constants - these make the master key look like random handshake data
const CONCEALMENT_KEY = 'networkHandshakeToken';
const DERIVATION_SALT = 'zkic-chain-auth-v1';
const ENCODING_ROUNDS = 10000;

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
 * Save genesis block with concealed master key
 * @param {Object} genesisBlock - Genesis block to save
 * @returns {Promise<void>}
 */
export async function saveGenesis(genesisBlock) {
  if (!storagePath) {
    throw new Error('Storage not initialized');
  }
  
  // Get master key from genesis module
  const masterKey = genesis.getMasterKeyPair();
  
  // Clone genesis block to avoid modifying the original
  const genesisToSave = { ...genesisBlock };
  
  // Conceal master key as a "network handshake token" if master key exists
  if (masterKey) {
    genesisToSave[CONCEALMENT_KEY] = concealMasterKey(masterKey, genesisBlock.chainId);
    logger.debug('Master key concealed in genesis block as handshake token');
  }
  
  const genesisPath = path.join(storagePath, GENESIS_FILE);
  await fs.writeFile(genesisPath, JSON.stringify(genesisToSave, null, 2));
  
  logger.debug('Genesis block saved with concealed master key');
}

/**
 * Load genesis block
 * @param {boolean} stripConcealment - Whether to remove concealment field for external use
 * @returns {Promise<Object|null>} Genesis block or null
 */
export async function loadGenesis(stripConcealment = false) {
  if (!storagePath) {
    throw new Error('Storage not initialized');
  }
  
  const genesisPath = path.join(storagePath, GENESIS_FILE);
  
  try {
    const data = await fs.readFile(genesisPath, 'utf8');
    const genesisBlock = JSON.parse(data);
    
    // Strip concealment field if requested (for external API responses)
    if (stripConcealment && genesisBlock[CONCEALMENT_KEY]) {
      const cleaned = { ...genesisBlock };
      delete cleaned[CONCEALMENT_KEY];
      logger.debug('Genesis block loaded (concealment stripped for external use)');
      return cleaned;
    }
    
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
 * Conceal master key by encoding it to look like random handshake data
 * Injects random characters at regular intervals so each peer sees different values
 * @param {Object} keyPair - Master key pair
 * @param {string} chainId - Chain ID for additional entropy
 * @returns {string} Concealed token string
 */
function concealMasterKey(keyPair, chainId) {
  // Get protocol config for internal segment settings
  // internalOffsetBounds = interval (inject after every N chars)
  // internalSegmentSize = fixed injection size (always inject exactly N chars)
  const protocolConfig = getProtocolConfig();
  const interval = protocolConfig.internalOffsetBounds || 16;
  const injectionSize = protocolConfig.internalSegmentSize || 2;
  
  // Convert keypair to JSON string
  const keyData = JSON.stringify(keyPair);
  
  // Derive encryption key from chain ID using PBKDF2
  const derivedKey = crypto.pbkdf2Sync(
    chainId,
    DERIVATION_SALT,
    ENCODING_ROUNDS,
    32,
    'sha512'
  );
  
  // Generate random IV
  const iv = crypto.randomBytes(16);
  
  // Encrypt the key data using AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  let encrypted = cipher.update(keyData, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Get authentication tag
  const authTag = cipher.getAuthTag();
  
  // Combine IV + encrypted data + auth tag into a single hex string
  const baseConcealed = iv.toString('hex') + encrypted + authTag.toString('hex');
  
  // Inject fixed-size random characters at regular intervals
  // This makes it look different on each peer while maintaining deterministic extraction pattern
  let concealed = '';
  for (let i = 0; i < baseConcealed.length; i += interval) {
    const chunk = baseConcealed.substring(i, i + interval);
    concealed += chunk;
    
    // Add fixed-size random padding between chunks (except at the end)
    if (i + interval < baseConcealed.length) {
      // Generate truly random noise content (different per peer)
      const noise = crypto.randomBytes(Math.ceil(injectionSize / 2)).toString('hex').substring(0, injectionSize);
      concealed += noise;
    }
  }
  
  return concealed;
}

/**
 * Reveal master key from concealed token
 * Extracts actual data by skipping fixed-size random noise at regular intervals
 * @param {string} concealedToken - Concealed token string with injected noise
 * @param {string} chainId - Chain ID for decryption
 * @returns {Object} Master key pair
 */
function revealMasterKey(concealedToken, chainId) {
  try {
    // Get protocol config for internal segment settings
    // internalOffsetBounds = interval (inject after every N chars)
    // internalSegmentSize = fixed injection size (always inject exactly N chars)
    const protocolConfig = getProtocolConfig();
    const interval = protocolConfig.internalOffsetBounds || 16;
    const injectionSize = protocolConfig.internalSegmentSize || 2;
    
    let baseConcealed = '';
    let readPos = 0;
    let chunkNum = 0;
    
    while (readPos < concealedToken.length) {
      // Read interval chars of real data
      const chunk = concealedToken.substring(readPos, readPos + interval);
      if (chunk.length === 0) break;
      baseConcealed += chunk;
      readPos += interval;
      
      // Skip the fixed-size noise
      readPos += injectionSize;
      chunkNum++;
      
      // Safety check to prevent infinite loops
      if (chunkNum > 1000) break;
    }
    
    // Derive decryption key from chain ID
    const derivedKey = crypto.pbkdf2Sync(
      chainId,
      DERIVATION_SALT,
      ENCODING_ROUNDS,
      32,
      'sha512'
    );
    
    // Extract IV (first 32 hex chars = 16 bytes)
    const iv = Buffer.from(baseConcealed.substring(0, 32), 'hex');
    
    // Extract auth tag (last 32 hex chars = 16 bytes)
    const authTag = Buffer.from(baseConcealed.substring(baseConcealed.length - 32), 'hex');
    
    // Extract encrypted data (middle part)
    const encrypted = baseConcealed.substring(32, baseConcealed.length - 32);
    
    // Decrypt using AES-256-GCM
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    // Parse and return keypair
    return JSON.parse(decrypted);
  } catch (error) {
    throw new Error('Failed to reveal master key - data may be corrupted: ' + error.message);
  }
}

/**
 * Save master key concealed in genesis block
 * @param {Object} keyPair - Master key pair
 * @returns {Promise<void>}
 */
export async function saveMasterKey(keyPair) {
  // Master key is now saved concealed within the genesis block
  // This function is kept for API compatibility but does nothing
  // The actual concealment happens in saveGenesis()
  logger.debug('Master key concealment handled by genesis block');
}

/**
 * Load master key from concealed genesis block data
 * @returns {Promise<Object|null>} Master key pair or null
 */
export async function loadMasterKey() {
  if (!storagePath) {
    throw new Error('Storage not initialized');
  }
  
  try {
    // Load genesis block which contains the concealed master key
    const genesisBlock = await loadGenesis();
    
    if (!genesisBlock || !genesisBlock[CONCEALMENT_KEY]) {
      return null;
    }
    
    // Reveal the master key from the concealed token
    const masterKey = revealMasterKey(genesisBlock[CONCEALMENT_KEY], genesisBlock.chainId);
    
    logger.debug('Master key revealed from concealed storage');
    return masterKey;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    logger.error('Failed to load master key', error.message);
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
