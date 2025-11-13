import * as crypto from './crypto.mjs';
import * as logger from './logger.mjs';
import { getCurrentTimestamp, deepClone } from './utils.mjs';
import { getGenesisTemplate, getConsensusConfig } from './config.mjs';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let masterKeyPair = null;
let genesisBlock = null;

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
  
  // Generate chainId deterministically from master public key
  // This ensures all peers using the same master key create the same chain
  const chainId = crypto.sha512(masterKeyPair.publicKey);
  
  genesisBlock = {
    ...template,
    chainId,
    createdAt: getCurrentTimestamp(),
    masterPubKey: masterKeyPair.publicKey
  };
  
  // Sign the genesis block with master key
  const genesisData = JSON.stringify({
    chainId: genesisBlock.chainId,
    createdAt: genesisBlock.createdAt,
    masterPubKey: genesisBlock.masterPubKey
  });
  
  genesisBlock.chainSignature = crypto.signEd25519(genesisData, masterKeyPair.privateKey);
  
  logger.info('Genesis block created', { chainId });
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
 * Set genesis block (used when loading from storage)
 * @param {Object} block - Genesis block
 */
export function setGenesisBlock(block) {
  genesisBlock = block;
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
  setGenesisBlock,
  verifyGenesisBlock,
  isAuthorizedGenesisSigner,
  getRequiredSignatures
};
