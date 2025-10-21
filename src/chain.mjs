import * as crypto from './crypto.mjs';
import * as logger from './logger.mjs';
import * as block from './block.mjs';
import * as genesis from './genesis.mjs';
import { isValidBlockStructure } from './utils.mjs';

const chain = [];
let chainHash = null;
let chainSignature = null;

/**
 * Initialize chain with genesis block
 * @param {Object} genesisBlock - Genesis block
 */
export function initializeChain(genesisBlock) {
  if (!genesis.verifyGenesisBlock(genesisBlock)) {
    throw new Error('Invalid genesis block');
  }
  
  genesis.setGenesisBlock(genesisBlock);
  chain.length = 0;
  updateChainHash();
  
  logger.info('Chain initialized', { chainId: genesisBlock.chainId });
}

/**
 * Get current chain
 * @returns {Array<Object>} Chain blocks
 */
export function getChain() {
  return chain;
}

/**
 * Get chain length
 * @returns {number} Chain length
 */
export function getChainLength() {
  return chain.length;
}

/**
 * Get chain hash
 * @returns {string|null} Chain hash
 */
export function getChainHash() {
  return chainHash;
}

/**
 * Get chain signature
 * @returns {string|null} Chain signature
 */
export function getChainSignature() {
  return chainSignature;
}

/**
 * Add block to chain
 * @param {Object} newBlock - Block to add
 * @returns {boolean} True if added successfully
 */
export function addBlock(newBlock) {
  // Validate block structure
  if (!isValidBlockStructure(newBlock)) {
    logger.warn('Invalid block structure');
    return false;
  }
  
  // Verify block hash
  if (!block.verifyBlockHash(newBlock)) {
    logger.warn('Invalid block hash');
    return false;
  }
  
  // Verify block signature
  if (!block.verifyBlockSignature(newBlock)) {
    logger.warn('Invalid block signature');
    return false;
  }
  
  // Verify previous hash linkage
  if (chain.length > 0) {
    const lastBlock = chain[chain.length - 1];
    if (newBlock.prevHash !== lastBlock.hash) {
      logger.warn('Invalid previous hash linkage');
      return false;
    }
  } else {
    if (newBlock.prevHash !== null) {
      logger.warn('First block must have null prevHash');
      return false;
    }
  }
  
  // Add to chain
  chain.push(newBlock);
  
  // Update chain hash and signature
  updateChainHash();
  
  logger.info('Block added to chain', { 
    hash: newBlock.hash, 
    chainLength: chain.length 
  });
  
  return true;
}

/**
 * Find block by hash
 * @param {string} hash - Block hash
 * @returns {Object|null} Block or null
 */
export function findBlockByHash(hash) {
  return chain.find(b => b.hash === hash) || null;
}

/**
 * Find block by owner public key
 * @param {string} publicKey - Owner public key
 * @returns {Object|null} Block or null
 */
export function findBlockByOwner(publicKey) {
  return chain.find(b => b.metadata.ownerPubKey === publicKey) || null;
}

/**
 * Update existing block in chain
 * @param {string} hash - Hash of block to update
 * @param {Object} updatedBlock - Updated block
 * @returns {boolean} True if updated
 */
export function updateBlockInChain(hash, updatedBlock) {
  const index = chain.findIndex(b => b.hash === hash);
  
  if (index === -1) {
    logger.warn('Block not found for update', { hash });
    return false;
  }
  
  // Verify updated block
  if (!block.verifyBlockHash(updatedBlock)) {
    logger.warn('Invalid updated block hash');
    return false;
  }
  
  if (!block.verifyBlockSignature(updatedBlock)) {
    logger.warn('Invalid updated block signature');
    return false;
  }
  
  // Update in chain
  chain[index] = updatedBlock;
  
  // Recalculate hashes for subsequent blocks
  for (let i = index + 1; i < chain.length; i++) {
    chain[i].prevHash = chain[i - 1].hash;
    chain[i].hash = block.calculateBlockHash(chain[i]);
  }
  
  // Update chain hash
  updateChainHash();
  
  logger.info('Block updated in chain', { hash: updatedBlock.hash });
  return true;
}

/**
 * Remove block from chain (pruning)
 * @param {string} hash - Hash of block to remove
 * @returns {boolean} True if removed
 */
export function removeBlock(hash) {
  const index = chain.findIndex(b => b.hash === hash);
  
  if (index === -1) {
    logger.warn('Block not found for removal', { hash });
    return false;
  }
  
  // Remove block
  chain.splice(index, 1);
  
  // Update chain hash
  updateChainHash();
  
  logger.info('Block removed from chain', { hash });
  return true;
}

/**
 * Calculate global chain hash
 * @returns {string} Chain hash
 */
function calculateChainHash() {
  const genesisBlock = genesis.getGenesisBlock();
  if (!genesisBlock) {
    return null;
  }
  
  const chainData = {
    chainId: genesisBlock.chainId,
    blocks: chain.map(b => b.hash),
    length: chain.length
  };
  
  return crypto.sha512(JSON.stringify(chainData));
}

/**
 * Update chain hash and sign with master key
 */
function updateChainHash() {
  chainHash = calculateChainHash();
  
  const masterKeyPair = genesis.getMasterKeyPair();
  if (masterKeyPair && chainHash) {
    chainSignature = crypto.signEd25519(chainHash, masterKeyPair.privateKey);
  }
}

/**
 * Verify chain authenticity
 * @param {string} hash - Chain hash to verify
 * @param {string} signature - Chain signature
 * @param {string} masterPubKey - Master public key
 * @returns {boolean} True if authentic
 */
export function verifyChainAuthenticity(hash, signature, masterPubKey) {
  return crypto.verifyEd25519(hash, signature, masterPubKey);
}

/**
 * Verify entire chain integrity
 * @returns {boolean} True if chain is valid
 */
export function verifyChainIntegrity() {
  // Check each block
  for (let i = 0; i < chain.length; i++) {
    const currentBlock = chain[i];
    
    // Verify block hash
    if (!block.verifyBlockHash(currentBlock)) {
      logger.error('Invalid block hash at index', i);
      return false;
    }
    
    // Verify block signature
    if (!block.verifyBlockSignature(currentBlock)) {
      logger.error('Invalid block signature at index', i);
      return false;
    }
    
    // Verify linkage
    if (i > 0) {
      const prevBlock = chain[i - 1];
      if (currentBlock.prevHash !== prevBlock.hash) {
        logger.error('Invalid chain linkage at index', i);
        return false;
      }
    }
  }
  
  // Verify chain hash
  const calculatedHash = calculateChainHash();
  if (calculatedHash !== chainHash) {
    logger.error('Chain hash mismatch');
    return false;
  }
  
  // Verify chain signature
  const genesisBlock = genesis.getGenesisBlock();
  if (genesisBlock && chainSignature) {
    if (!verifyChainAuthenticity(chainHash, chainSignature, genesisBlock.masterPubKey)) {
      logger.error('Invalid chain signature');
      return false;
    }
  }
  
  return true;
}

/**
 * Prune expired blocks
 * @returns {number} Number of blocks pruned
 */
export function pruneExpiredBlocks() {
  let prunedCount = 0;
  
  for (let i = chain.length - 1; i >= 0; i--) {
    if (block.shouldPruneBlock(chain[i])) {
      const hash = chain[i].hash;
      if (removeBlock(hash)) {
        prunedCount++;
      }
    }
  }
  
  if (prunedCount > 0) {
    logger.info('Pruned expired blocks', { count: prunedCount });
  }
  
  return prunedCount;
}

/**
 * Replace chain with new chain (used during sync)
 * @param {Array<Object>} newChain - New chain
 * @param {string} newChainHash - New chain hash
 * @param {string} newChainSignature - New chain signature
 * @returns {boolean} True if replaced
 */
export function replaceChain(newChain, newChainHash, newChainSignature) {
  const genesisBlock = genesis.getGenesisBlock();
  
  // Verify new chain authenticity
  if (!verifyChainAuthenticity(newChainHash, newChainSignature, genesisBlock.masterPubKey)) {
    logger.warn('New chain has invalid signature');
    return false;
  }
  
  // Verify new chain integrity
  const originalChain = [...chain];
  const originalHash = chainHash;
  const originalSignature = chainSignature;
  
  // Temporarily replace
  chain.length = 0;
  chain.push(...newChain);
  chainHash = newChainHash;
  chainSignature = newChainSignature;
  
  if (!verifyChainIntegrity()) {
    // Restore original
    chain.length = 0;
    chain.push(...originalChain);
    chainHash = originalHash;
    chainSignature = originalSignature;
    logger.warn('New chain failed integrity check');
    return false;
  }
  
  logger.info('Chain replaced', { 
    oldLength: originalChain.length, 
    newLength: chain.length 
  });
  
  return true;
}

/**
 * Get chain metadata
 * @returns {Object} Chain metadata
 */
export function getChainMetadata() {
  const genesisBlock = genesis.getGenesisBlock();
  
  return {
    chainId: genesisBlock?.chainId || null,
    length: chain.length,
    chainHash,
    chainSignature,
    masterPubKey: genesisBlock?.masterPubKey || null,
    lastUpdated: chain.length > 0 ? chain[chain.length - 1].metadata.updatedAt : null
  };
}

export default {
  initializeChain,
  getChain,
  getChainLength,
  getChainHash,
  getChainSignature,
  addBlock,
  findBlockByHash,
  findBlockByOwner,
  updateBlockInChain,
  removeBlock,
  verifyChainAuthenticity,
  verifyChainIntegrity,
  pruneExpiredBlocks,
  replaceChain,
  getChainMetadata
};
