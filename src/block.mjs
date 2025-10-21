import * as crypto from './crypto.mjs';
import * as logger from './logger.mjs';
import { getCurrentTimestamp, deepClone, calculateAge } from './utils.mjs';
import { getBlockTemplate, getIdentityConfig } from './config.mjs';

/**
 * Create a new identity block
 * @param {Object} data - Identity data to encrypt
 * @param {string} ownerPublicKey - Public key of the owner
 * @param {Buffer} encryptionKey - AES encryption key for data
 * @param {string} ownerPrivateKey - Private key for signing
 * @param {string|null} prevHash - Previous block hash
 * @returns {Promise<Object>} New block
 */
export async function createBlock(data, ownerPublicKey, encryptionKey, ownerPrivateKey, prevHash = null) {
  const template = deepClone(getBlockTemplate());
  
  // Encrypt each field separately
  const encryptedData = crypto.encryptFields(data, encryptionKey);
  
  const block = {
    encryptedData,
    tokens: {},
    metadata: {
      ...template.metadata,
      createdAt: getCurrentTimestamp(),
      updatedAt: getCurrentTimestamp(),
      ownerPubKey: ownerPublicKey,
      lifecycleStage: 'genesis',
      deathDate: null,
      rotationsLeft: getIdentityConfig().maxKeyRotations
    },
    prevHash
  };
  
  // Calculate block hash (without signature)
  block.hash = calculateBlockHash(block);
  
  // Sign the block
  const blockData = JSON.stringify({
    hash: block.hash,
    encryptedData: block.encryptedData,
    metadata: block.metadata,
    prevHash: block.prevHash
  });
  
  block.signature = crypto.signEd25519(blockData, ownerPrivateKey);
  
  logger.debug('Block created', { hash: block.hash });
  return block;
}

/**
 * Calculate block hash
 * @param {Object} block - Block object
 * @returns {string} Block hash
 */
export function calculateBlockHash(block) {
  const hashData = JSON.stringify({
    encryptedData: block.encryptedData,
    tokens: block.tokens,
    metadata: {
      createdAt: block.metadata.createdAt,
      updatedAt: block.metadata.updatedAt,
      ownerPubKey: block.metadata.ownerPubKey,
      lifecycleStage: block.metadata.lifecycleStage,
      deathDate: block.metadata.deathDate,
      rotationsLeft: block.metadata.rotationsLeft
    },
    prevHash: block.prevHash
  });
  return crypto.sha512(hashData);
}

/**
 * Verify block signature
 * @param {Object} block - Block to verify
 * @returns {boolean} True if valid
 */
export function verifyBlockSignature(block) {
  if (!block || !block.signature || !block.metadata || !block.metadata.ownerPubKey) {
    return false;
  }
  
  const blockData = JSON.stringify({
    hash: block.hash,
    encryptedData: block.encryptedData,
    metadata: block.metadata,
    prevHash: block.prevHash
  });
  
  return crypto.verifyEd25519(blockData, block.signature, block.metadata.ownerPubKey);
}

/**
 * Verify block hash integrity
 * @param {Object} block - Block to verify
 * @returns {boolean} True if hash is valid
 */
export function verifyBlockHash(block) {
  const calculatedHash = calculateBlockHash(block);
  return calculatedHash === block.hash;
}

/**
 * Update block data
 * @param {Object} block - Block to update
 * @param {Object} newData - New data fields
 * @param {Buffer} encryptionKey - AES encryption key
 * @param {string} ownerPrivateKey - Private key for signing
 * @returns {Object} Updated block
 */
export function updateBlock(block, newData, encryptionKey, ownerPrivateKey) {
  // Decrypt existing data
  const existingFields = Object.keys(block.encryptedData);
  const decryptedData = crypto.decryptFields(block.encryptedData, encryptionKey, existingFields);
  
  // Merge with new data
  const mergedData = { ...decryptedData, ...newData };
  
  // Re-encrypt
  block.encryptedData = crypto.encryptFields(mergedData, encryptionKey);
  block.metadata.updatedAt = getCurrentTimestamp();
  
  // Recalculate hash
  block.hash = calculateBlockHash(block);
  
  // Re-sign
  const blockData = JSON.stringify({
    hash: block.hash,
    encryptedData: block.encryptedData,
    metadata: block.metadata,
    prevHash: block.prevHash
  });
  
  block.signature = crypto.signEd25519(blockData, ownerPrivateKey);
  
  logger.debug('Block updated', { hash: block.hash });
  return block;
}

/**
 * Rotate block encryption key (lifecycle transition)
 * @param {Object} block - Block to rotate
 * @param {Buffer} oldKey - Old encryption key
 * @param {Buffer} newKey - New encryption key
 * @param {string} newOwnerPublicKey - New owner public key
 * @param {string} newOwnerPrivateKey - New owner private key
 * @param {string} newStage - New lifecycle stage
 * @returns {Object} Updated block
 */
export function rotateBlockKey(block, oldKey, newKey, newOwnerPublicKey, newOwnerPrivateKey, newStage) {
  if (block.metadata.rotationsLeft <= 0) {
    throw new Error('No rotations left');
  }
  
  // Decrypt with old key
  const fields = Object.keys(block.encryptedData);
  const decryptedData = crypto.decryptFields(block.encryptedData, oldKey, fields);
  
  // Re-encrypt with new key
  block.encryptedData = crypto.encryptFields(decryptedData, newKey);
  
  // Update metadata
  block.metadata.ownerPubKey = newOwnerPublicKey;
  block.metadata.lifecycleStage = newStage;
  block.metadata.rotationsLeft--;
  block.metadata.updatedAt = getCurrentTimestamp();
  
  // Recalculate hash
  block.hash = calculateBlockHash(block);
  
  // Sign with new key
  const blockData = JSON.stringify({
    hash: block.hash,
    encryptedData: block.encryptedData,
    metadata: block.metadata,
    prevHash: block.prevHash
  });
  
  block.signature = crypto.signEd25519(blockData, newOwnerPrivateKey);
  
  logger.info('Block key rotated', { hash: block.hash, newStage });
  return block;
}

/**
 * Check lifecycle transition eligibility
 * @param {Object} block - Block to check
 * @param {Buffer} encryptionKey - Encryption key to decrypt DOB
 * @returns {{eligible: boolean, nextStage?: string, reason?: string}}
 */
export function checkLifecycleTransition(block, encryptionKey) {
  const lifecycle = getIdentityConfig().lifecycle;
  const currentStage = block.metadata.lifecycleStage;
  
  if (currentStage === 'expired') {
    return { eligible: false, reason: 'Block already expired' };
  }
  
  // Decrypt DOB to check age
  let age = 0;
  try {
    const decrypted = crypto.decryptFields(block.encryptedData, encryptionKey, ['dob']);
    age = calculateAge(decrypted.dob);
  } catch (error) {
    return { eligible: false, reason: 'Cannot decrypt DOB' };
  }
  
  if (currentStage === 'genesis' && age >= lifecycle.guardianAge) {
    return { eligible: true, nextStage: 'guardian' };
  }
  
  if (currentStage === 'guardian' && age >= lifecycle.selfAge) {
    return { eligible: true, nextStage: 'self' };
  }
  
  return { eligible: false, reason: 'Not eligible for transition' };
}

/**
 * Mark block as deceased
 * @param {Object} block - Block to update
 * @param {string} ownerPrivateKey - Private key for signing
 * @returns {Object} Updated block
 */
export function markAsDeceased(block, ownerPrivateKey) {
  block.metadata.deathDate = getCurrentTimestamp();
  block.metadata.updatedAt = getCurrentTimestamp();
  
  // Recalculate hash
  block.hash = calculateBlockHash(block);
  
  // Re-sign
  const blockData = JSON.stringify({
    hash: block.hash,
    encryptedData: block.encryptedData,
    metadata: block.metadata,
    prevHash: block.prevHash
  });
  
  block.signature = crypto.signEd25519(blockData, ownerPrivateKey);
  
  logger.info('Block marked as deceased', { hash: block.hash });
  return block;
}

/**
 * Check if block should be pruned
 * @param {Object} block - Block to check
 * @returns {boolean} True if should be pruned
 */
export function shouldPruneBlock(block) {
  if (!block.metadata.deathDate) {
    return false;
  }
  
  const lifecycle = getIdentityConfig().lifecycle;
  const graceSeconds = lifecycle.deceasedGraceYears * 365 * 24 * 60 * 60;
  const currentTime = getCurrentTimestamp();
  
  return (currentTime - block.metadata.deathDate) > graceSeconds;
}

/**
 * Update lifecycle stage
 * @param {Object} block - Block to update
 * @param {string} newStage - New lifecycle stage
 */
export function updateLifecycleStage(block, newStage) {
  block.metadata.lifecycleStage = newStage;
  block.metadata.updatedAt = getCurrentTimestamp();
}

export default {
  createBlock,
  calculateBlockHash,
  verifyBlockSignature,
  verifyBlockHash,
  updateBlock,
  rotateBlockKey,
  checkLifecycleTransition,
  markAsDeceased,
  shouldPruneBlock,
  updateLifecycleStage
};
