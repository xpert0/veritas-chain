import * as crypto from './crypto.mjs';
import * as logger from './logger.mjs';
import * as tokenModule from './token.mjs';
import { evaluateCondition } from './utils.mjs';

/**
 * Verify zero-knowledge condition
 * @param {Object} block - Block containing encrypted data
 * @param {string} tokenId - Token ID for access
 * @param {string} field - Field to verify
 * @param {string} condition - Condition to evaluate (e.g., "dob <= 2007-10-20")
 * @param {Buffer} encryptionKey - Decryption key for the block
 * @returns {{result: boolean, error?: string}}
 */
export function verifyCondition(block, tokenId, field, condition, encryptionKey) {
  try {
    // Get token from block
    const token = tokenModule.getTokenById(block.tokens, tokenId);
    
    // Validate token
    const validation = tokenModule.validateTokenForUse(token, block.metadata.ownerPubKey, field);
    if (!validation.valid) {
      return { result: false, error: validation.reason };
    }
    
    // Decrypt only the requested field
    const decryptedData = crypto.decryptFields(block.encryptedData, encryptionKey, [field]);
    
    if (!decryptedData[field]) {
      return { result: false, error: `Field ${field} not found` };
    }
    
    // Evaluate condition
    const result = evaluateCondition(decryptedData[field], condition);
    
    // Decrement token usage
    tokenModule.decrementTokenUse(token);
    
    logger.debug('Zero-knowledge verification performed', { 
      field, 
      condition, 
      result,
      remainingUses: token.remainingUses 
    });
    
    return { result };
  } catch (error) {
    logger.error('Verification failed', error.message);
    return { result: false, error: error.message };
  }
}

/**
 * Verify multiple conditions (AND logic)
 * @param {Object} block - Block containing encrypted data
 * @param {string} tokenId - Token ID for access
 * @param {Array<{field: string, condition: string}>} conditions - Conditions to verify
 * @param {Buffer} encryptionKey - Decryption key for the block
 * @returns {{result: boolean, details?: Object[], error?: string}}
 */
export function verifyMultipleConditions(block, tokenId, conditions, encryptionKey) {
  try {
    const token = tokenModule.getTokenById(block.tokens, tokenId);
    if (!token) {
      return { result: false, error: 'Token not found' };
    }
    
    const details = [];
    let allPassed = true;
    
    for (const { field, condition } of conditions) {
      // Validate token has permission for each field
      const validation = tokenModule.validateTokenForUse(token, block.metadata.ownerPubKey, field);
      if (!validation.valid) {
        return { result: false, error: validation.reason };
      }
      
      // Decrypt field
      const decryptedData = crypto.decryptFields(block.encryptedData, encryptionKey, [field]);
      
      if (!decryptedData[field]) {
        return { result: false, error: `Field ${field} not found` };
      }
      
      // Evaluate condition
      const result = evaluateCondition(decryptedData[field], condition);
      details.push({ field, condition, result });
      
      if (!result) {
        allPassed = false;
      }
    }
    
    // Decrement token usage once for all conditions
    tokenModule.decrementTokenUse(token);
    
    logger.debug('Multiple conditions verified', { 
      count: conditions.length,
      result: allPassed,
      remainingUses: token.remainingUses
    });
    
    return { result: allPassed, details };
  } catch (error) {
    logger.error('Multiple verification failed', error.message);
    return { result: false, error: error.message };
  }
}

/**
 * Verify field exists without revealing value
 * @param {Object} block - Block containing encrypted data
 * @param {string} tokenId - Token ID for access
 * @param {string} field - Field to check
 * @returns {{exists: boolean, error?: string}}
 */
export function verifyFieldExists(block, tokenId, field) {
  try {
    const token = tokenModule.getTokenById(block.tokens, tokenId);
    
    const validation = tokenModule.validateTokenForUse(token, block.metadata.ownerPubKey, field);
    if (!validation.valid) {
      return { exists: false, error: validation.reason };
    }
    
    const exists = !!block.encryptedData[field];
    
    // Decrement token usage
    tokenModule.decrementTokenUse(token);
    
    logger.debug('Field existence verified', { field, exists });
    
    return { exists };
  } catch (error) {
    logger.error('Field existence verification failed', error.message);
    return { exists: false, error: error.message };
  }
}

/**
 * Verify range condition (e.g., age between 18-65)
 * @param {Object} block - Block containing encrypted data
 * @param {string} tokenId - Token ID for access
 * @param {string} field - Field to verify
 * @param {any} min - Minimum value
 * @param {any} max - Maximum value
 * @param {Buffer} encryptionKey - Decryption key
 * @returns {{result: boolean, error?: string}}
 */
export function verifyRange(block, tokenId, field, min, max, encryptionKey) {
  try {
    const token = tokenModule.getTokenById(block.tokens, tokenId);
    
    const validation = tokenModule.validateTokenForUse(token, block.metadata.ownerPubKey, field);
    if (!validation.valid) {
      return { result: false, error: validation.reason };
    }
    
    const decryptedData = crypto.decryptFields(block.encryptedData, encryptionKey, [field]);
    
    if (!decryptedData[field]) {
      return { result: false, error: `Field ${field} not found` };
    }
    
    const value = decryptedData[field];
    const minResult = evaluateCondition(value, `>= ${min}`);
    const maxResult = evaluateCondition(value, `<= ${max}`);
    
    const result = minResult && maxResult;
    
    tokenModule.decrementTokenUse(token);
    
    logger.debug('Range verification performed', { field, min, max, result });
    
    return { result };
  } catch (error) {
    logger.error('Range verification failed', error.message);
    return { result: false, error: error.message };
  }
}

/**
 * Verify membership in a set
 * @param {Object} block - Block containing encrypted data
 * @param {string} tokenId - Token ID for access
 * @param {string} field - Field to verify
 * @param {Array} allowedValues - Allowed values
 * @param {Buffer} encryptionKey - Decryption key
 * @returns {{result: boolean, error?: string}}
 */
export function verifyMembership(block, tokenId, field, allowedValues, encryptionKey) {
  try {
    const token = tokenModule.getTokenById(block.tokens, tokenId);
    
    const validation = tokenModule.validateTokenForUse(token, block.metadata.ownerPubKey, field);
    if (!validation.valid) {
      return { result: false, error: validation.reason };
    }
    
    const decryptedData = crypto.decryptFields(block.encryptedData, encryptionKey, [field]);
    
    if (!decryptedData[field]) {
      return { result: false, error: `Field ${field} not found` };
    }
    
    const result = allowedValues.includes(decryptedData[field]);
    
    tokenModule.decrementTokenUse(token);
    
    logger.debug('Membership verification performed', { field, result });
    
    return { result };
  } catch (error) {
    logger.error('Membership verification failed', error.message);
    return { result: false, error: error.message };
  }
}

export default {
  verifyCondition,
  verifyMultipleConditions,
  verifyFieldExists,
  verifyRange,
  verifyMembership
};
