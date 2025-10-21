import * as crypto from './crypto.mjs';
import * as logger from './logger.mjs';
import { getCurrentTimestamp, deepClone } from './utils.mjs';
import { getGenesisTemplate, getConsensusConfig } from './config.mjs';

let masterKeyPair = null;
let genesisBlock = null;

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
 * @param {Array<string>} authorizedKeys - Public keys of authorized genesis signers
 * @returns {Promise<Object>} Genesis block
 */
export async function createGenesisBlock(authorizedKeys) {
  if (!masterKeyPair) {
    await generateMasterKeyPair();
  }
  
  const template = deepClone(getGenesisTemplate());
  const consensusConfig = getConsensusConfig();
  
  const chainId = crypto.sha512(`genesis-${Date.now()}-${Math.random()}`);
  
  genesisBlock = {
    ...template,
    chainId,
    createdAt: getCurrentTimestamp(),
    masterPubKey: masterKeyPair.publicKey,
    authorizedGenesisKeys: authorizedKeys || consensusConfig.genesisKeyRegistry,
    signingPolicy: consensusConfig.requiredSignatures
  };
  
  // Sign the genesis block with master key
  const genesisData = JSON.stringify({
    chainId: genesisBlock.chainId,
    createdAt: genesisBlock.createdAt,
    masterPubKey: genesisBlock.masterPubKey,
    authorizedGenesisKeys: genesisBlock.authorizedGenesisKeys,
    signingPolicy: genesisBlock.signingPolicy
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
    masterPubKey: block.masterPubKey,
    authorizedGenesisKeys: block.authorizedGenesisKeys,
    signingPolicy: block.signingPolicy
  });
  
  return crypto.verifyEd25519(genesisData, block.chainSignature, block.masterPubKey);
}

/**
 * Check if a public key is authorized as genesis signer
 * @param {string} publicKey - Public key to check
 * @returns {boolean} True if authorized
 */
export function isAuthorizedGenesisSigner(publicKey) {
  if (!genesisBlock) {
    return false;
  }
  return genesisBlock.authorizedGenesisKeys.includes(publicKey);
}

/**
 * Get required signatures count for an operation
 * @param {string} operation - Operation type (registration, update)
 * @returns {number} Required signature count
 */
export function getRequiredSignatures(operation) {
  if (!genesisBlock) {
    return 0;
  }
  return genesisBlock.signingPolicy[operation] || 0;
}

export default {
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
