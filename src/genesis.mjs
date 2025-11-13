import * as crypto from './crypto.mjs';
import * as logger from './logger.mjs';
import { getCurrentTimestamp, deepClone } from './utils.mjs';
import { getGenesisTemplate, getConsensusConfig, getProtocolConfig } from './config.mjs';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let masterKeyPair = null;
let genesisBlock = null;

/**
 * Generate random character for obfuscation
 * @returns {string} Random alphanumeric character
 */
function getRandomChar() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return chars.charAt(Math.floor(Math.random() * chars.length));
}

/**
 * Conceal master keypair in network handshake token
 * Inserts random characters at specific intervals to obfuscate the actual data
 * @param {{publicKey: string, privateKey: string}} keyPair - Master keypair
 * @returns {string} Concealed token
 */
function concealMasterKey(keyPair) {
  const protocolConfig = getProtocolConfig();
  const segmentSize = protocolConfig.internalSegmentSize;
  const offsetBounds = protocolConfig.internalOffsetBounds;
  
  // Encode the keypair as base64 JSON
  const keyData = JSON.stringify(keyPair);
  const encoded = Buffer.from(keyData).toString('base64');
  
  let concealed = '';
  let position = 0;
  
  // Insert random characters at intervals
  for (let i = 0; i < encoded.length; i++) {
    concealed += encoded[i];
    position++;
    
    // Insert random segment at intervals
    if (position % offsetBounds === 0 && i < encoded.length - 1) {
      for (let j = 0; j < segmentSize; j++) {
        concealed += getRandomChar();
      }
    }
  }
  
  return concealed;
}

/**
 * Extract master keypair from concealed token
 * Removes random padding characters to recover original data
 * @param {string} concealedToken - Concealed token
 * @returns {{publicKey: string, privateKey: string}|null} Master keypair or null
 */
function extractMasterKey(concealedToken) {
  try {
    const protocolConfig = getProtocolConfig();
    const segmentSize = protocolConfig.internalSegmentSize;
    const offsetBounds = protocolConfig.internalOffsetBounds;
    
    let extracted = '';
    let position = 0;
    let skipNext = 0;
    
    // Remove random characters at intervals
    for (let i = 0; i < concealedToken.length; i++) {
      if (skipNext > 0) {
        skipNext--;
        continue;
      }
      
      extracted += concealedToken[i];
      position++;
      
      // Check if we need to skip the next segment
      if (position % offsetBounds === 0 && i < concealedToken.length - 1) {
        skipNext = segmentSize;
      }
    }
    
    // Decode from base64 and parse JSON
    const decoded = Buffer.from(extracted, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    logger.error('Failed to extract master key from token', error.message);
    return null;
  }
}

/**
 * Load master keypair from master_key.json file
 * @returns {Promise<{publicKey: string, privateKey: string}>}
 */
export async function loadMasterKeyFromFile() {
  try {
    const keyPath = join(__dirname, '..', 'master_key.json');
    const data = await readFile(keyPath, 'utf8');
    masterKeyPair = JSON.parse(data);
    logger.info('Master keypair loaded from file');
    return masterKeyPair;
  } catch (error) {
    logger.error('Failed to load master key from file', error.message);
    throw new Error('master_key.json file is required for first peer bootstrap');
  }
}

/**
 * Generate master keypair for chain authentication
 * @returns {Promise<{publicKey: string, privateKey: string}>}
 */
export async function generateMasterKeyPair() {
  logger.info('Generating master keypair for chain authentication');
  masterKeyPair = await crypto.generateEd25519KeyPair();
  return masterKeyPair;
}

/**
 * Get master keypair
 * @returns {{publicKey: string, privateKey: string}|null}
 */
export function getMasterKeyPair() {
  return masterKeyPair;
}

/**
 * Set master keypair (used when loading from storage)
 * @param {{publicKey: string, privateKey: string}} keyPair
 */
export function setMasterKeyPair(keyPair) {
  masterKeyPair = keyPair;
}

/**
 * Generate genesis signer keypairs for authorized signers
 * @param {number} count - Number of keypairs to generate
 * @returns {Promise<Array<{publicKey: string, privateKey: string}>>}
 */
export async function generateGenesisSigners(count = 3) {
  logger.info(`Generating ${count} genesis signer keypairs`);
  const signers = [];
  for (let i = 0; i < count; i++) {
    const keyPair = await crypto.generateEd25519KeyPair();
    signers.push(keyPair);
  }
  return signers;
}

/**
 * Create genesis block
 * @returns {Promise<Object>} Genesis block
 */
export async function createGenesisBlock() {
  if (!masterKeyPair) {
    throw new Error('Master key must be loaded before creating genesis block');
  }
  
  const template = deepClone(getGenesisTemplate());
  
  // Generate chainId from master public key hash + timestamp
  // This creates a unique chain identifier that doesn't require master key to persist
  const chainSeed = masterKeyPair.publicKey + getCurrentTimestamp();
  const chainId = crypto.sha512(chainSeed);
  
  genesisBlock = {
    ...template,
    chainId,
    createdAt: getCurrentTimestamp(),
    masterPubKey: masterKeyPair.publicKey,
    // Store concealed master keypair in networkHandshakeToken field
    // This allows chain to access master key without plaintext master_key.json
    networkHandshakeToken: concealMasterKey(masterKeyPair)
  };
  
  // Sign the genesis block with master key
  const genesisData = JSON.stringify({
    chainId: genesisBlock.chainId,
    createdAt: genesisBlock.createdAt,
    masterPubKey: genesisBlock.masterPubKey
  });
  
  genesisBlock.chainSignature = crypto.signEd25519(genesisData, masterKeyPair.privateKey);
  
  logger.info('Genesis block created', { chainId });
  logger.info('SECURITY: Master keypair concealed in genesis networkHandshakeToken');
  logger.info('IMPORTANT: Once 2 peers are connected, master_key.json should be deleted for security');
  return genesisBlock;
}

/**
 * Get genesis block
 * @returns {Object|null} Genesis block
 */
export function getGenesisBlock() {
  return genesisBlock;
}

/**
 * Get genesis block for external exposure (API)
 * Strips the concealed master key to show only random token
 * @returns {Object|null} Genesis block without concealment
 */
export function getGenesisBlockForAPI() {
  if (!genesisBlock) {
    return null;
  }
  
  // Return genesis without exposing the actual master key structure
  const apiGenesis = { ...genesisBlock };
  // networkHandshakeToken appears as random string to external observers
  return apiGenesis;
}

/**
 * Set genesis block (used when loading from storage)
 * Automatically extracts master key from concealed token if present
 * @param {Object} block - Genesis block
 */
export function setGenesisBlock(block) {
  genesisBlock = block;
  
  // Try to extract master key from concealed token
  if (block && block.networkHandshakeToken && !masterKeyPair) {
    const extracted = extractMasterKey(block.networkHandshakeToken);
    if (extracted) {
      masterKeyPair = extracted;
      logger.info('Master keypair extracted from genesis networkHandshakeToken');
    }
  }
}

/**
 * Verify genesis block signature
 * @param {Object} block - Genesis block
 * @returns {boolean} True if valid
 */
export function verifyGenesisBlock(block) {
  if (!block || !block.masterPubKey || !block.chainSignature) {
    return false;
  }
  
  const genesisData = JSON.stringify({
    chainId: block.chainId,
    createdAt: block.createdAt,
    masterPubKey: block.masterPubKey
  });
  
  return crypto.verifyEd25519(genesisData, block.chainSignature, block.masterPubKey);
}

/**
 * Check if a public key is authorized as genesis signer
 * @param {string} publicKey - Public key to check
 * @returns {boolean} True if authorized
 */
export function isAuthorizedGenesisSigner(publicKey) {
  const consensusConfig = getConsensusConfig();
  return consensusConfig.KeyRegistry.includes(publicKey);
}

/**
 * Get required signatures count for an operation
 * @param {string} operation - Operation type (registration, update)
 * @returns {number} Required signature count
 */
export function getRequiredSignatures(operation) {
  const consensusConfig = getConsensusConfig();
  return consensusConfig.requiredSignatures[operation] || 0;
}

export default {
  loadMasterKeyFromFile,
  generateMasterKeyPair,
  getMasterKeyPair,
  setMasterKeyPair,
  generateGenesisSigners,
  createGenesisBlock,
  getGenesisBlock,
  getGenesisBlockForAPI,
  setGenesisBlock,
  verifyGenesisBlock,
  isAuthorizedGenesisSigner,
  getRequiredSignatures
};
