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
const CONCEALMENT_KEY = 'networkHandshakeToken';
const DERIVATION_SALT = 'zkic-chain-auth-v1';
const ENCODING_ROUNDS = 10000;

export async function initStorage() {
  const config = getStorageConfig();
  storagePath = path.resolve(config.path);
  try {
    await fs.mkdir(storagePath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
  logger.info('Storage initialized', { path: storagePath });
}

export async function saveGenesis(genesisBlock) {
  if (!storagePath) {
    throw new Error('Storage not initialized');
  }
  const masterKey = genesis.getMasterKeyPair();
  const genesisToSave = { ...genesisBlock };
  if (masterKey) {
    genesisToSave[CONCEALMENT_KEY] = concealMasterKey(masterKey, genesisBlock.chainId);
    logger.debug('Master key concealed in genesis block as handshake token');
  }
  const genesisPath = path.join(storagePath, GENESIS_FILE);
  await fs.writeFile(genesisPath, JSON.stringify(genesisToSave, null, 2));
  logger.debug('Genesis block saved with concealed master key');
}

export async function loadGenesis(stripConcealment = false) {
  if (!storagePath) {
    throw new Error('Storage not initialized');
  }
  const genesisPath = path.join(storagePath, GENESIS_FILE);
  try {
    const data = await fs.readFile(genesisPath, 'utf8');
    const genesisBlock = JSON.parse(data);
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

function concealMasterKey(keyPair, chainId) {
  const protocolConfig = getProtocolConfig();
  const interval = protocolConfig.internalOffsetBounds || 16;
  const injectionSize = protocolConfig.internalSegmentSize || 2;
  const keyData = JSON.stringify(keyPair);
  const derivedKey = crypto.pbkdf2Sync(
    chainId,
    DERIVATION_SALT,
    ENCODING_ROUNDS,
    32,
    'sha512'
  );
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  let encrypted = cipher.update(keyData, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  const baseConcealed = iv.toString('hex') + encrypted + authTag.toString('hex');
  let concealed = '';
  for (let i = 0; i < baseConcealed.length; i += interval) {
    const chunk = baseConcealed.substring(i, i + interval);
    concealed += chunk;
    if (i + interval < baseConcealed.length) {
      const noise = crypto.randomBytes(Math.ceil(injectionSize / 2)).toString('hex').substring(0, injectionSize);
      concealed += noise;
    }
  }
  return concealed;
}

function revealMasterKey(concealedToken, chainId) {
  try {
    const protocolConfig = getProtocolConfig();
    const interval = protocolConfig.internalOffsetBounds || 16;
    const injectionSize = protocolConfig.internalSegmentSize || 2;
    let baseConcealed = '';
    let readPos = 0;
    let chunkNum = 0;
    while (readPos < concealedToken.length) {
      const chunk = concealedToken.substring(readPos, readPos + interval);
      if (chunk.length === 0) break;
      baseConcealed += chunk;
      readPos += interval;
      readPos += injectionSize;
      chunkNum++;
      if (chunkNum > 1000) break;
    }
    const derivedKey = crypto.pbkdf2Sync(
      chainId,
      DERIVATION_SALT,
      ENCODING_ROUNDS,
      32,
      'sha512'
    );
    const iv = Buffer.from(baseConcealed.substring(0, 32), 'hex');
    const authTag = Buffer.from(baseConcealed.substring(baseConcealed.length - 32), 'hex');
    const encrypted = baseConcealed.substring(32, baseConcealed.length - 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (error) {
    throw new Error('Failed to reveal master key - data may be corrupted: ' + error.message);
  }
}

export async function saveMasterKey(keyPair) {
  logger.debug('Master key concealment handled by genesis block');
}

export async function loadMasterKey() {
  if (!storagePath) {
    throw new Error('Storage not initialized');
  }
  
  try {
    const genesisBlock = await loadGenesis();
    if (!genesisBlock || !genesisBlock[CONCEALMENT_KEY]) {
      return null;
    }
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

export function stopAutoSnapshot() {
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
    logger.debug('Auto snapshot stopped');
  }
}

export async function loadAll() {
  const genesisBlock = await loadGenesis();
  const masterKey = await loadMasterKey();
  const snapshot = await loadSnapshot();
  return { genesis: genesisBlock, masterKey, snapshot };
}

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
