import * as crypto from './crypto.mjs';
import * as logger from './logger.mjs';
import { getCurrentTimestamp } from './utils.mjs';
import { getSecurityConfig } from './config.mjs';

/**
 * Issue a new permission token
 * @param {string} ownerPrivateKey - Private key of block owner
 * @param {string[]} permissions - Fields this token can access
 * @param {number} maxUses - Maximum number of uses
 * @returns {Promise<Object>} Token object with id and token data
 */
export async function issueToken(ownerPrivateKey, permissions, maxUses = 1) {
  const config = getSecurityConfig();
  const tokenId = crypto.generateTokenId(config.tokenLength);
  
  // Token data without redundant id field (id is the parent key in tokens object)
  const token = {
    permissions,
    remainingUses: maxUses,
    issuedAt: getCurrentTimestamp()
  };
  
  // Sign token with owner's private key
  // Include tokenId in signature but not in token object (it's stored as parent key)
  // Note: remainingUses is NOT included in signature as it's a mutable counter
  const tokenData = JSON.stringify({
    id: tokenId,
    permissions: token.permissions,
    issuedAt: token.issuedAt
  });
  
  token.signature = crypto.signEd25519(tokenData, ownerPrivateKey);
  
  logger.debug('Token issued', { tokenId, permissions, maxUses });
  
  // Return both tokenId and token data for storage as tokens[tokenId] = token
  return { id: tokenId, token };
}

/**
 * Verify token signature
 * @param {string} tokenId - Token ID (parent key in tokens object)
 * @param {Object} token - Token object (without id field)
 * @param {string} ownerPublicKey - Public key of block owner
 * @returns {boolean} True if signature is valid
 */
export function verifyToken(tokenId, token, ownerPublicKey) {
  if (!token || !token.signature) {
    return false;
  }
  
  // Note: remainingUses is NOT included in signature as it's a mutable counter
  // tokenId is included in signature but stored as parent key, not in token object
  const tokenData = JSON.stringify({
    id: tokenId,
    permissions: token.permissions,
    issuedAt: token.issuedAt
  });
  
  return crypto.verifyEd25519(tokenData, token.signature, ownerPublicKey);
}

/**
 * Check if token has permission for a field
 * @param {Object} token - Token object
 * @param {string} field - Field name
 * @returns {boolean} True if permitted
 */
export function hasPermission(token, field) {
  if (!token || !token.permissions) {
    return false;
  }
  return token.permissions.includes(field);
}

/**
 * Check if token has remaining uses
 * @param {Object} token - Token object
 * @returns {boolean} True if has remaining uses
 */
export function hasRemainingUses(token) {
  return token && token.remainingUses > 0;
}

/**
 * Decrement token usage count
 * @param {Object} token - Token object
 * @returns {Object} Updated token
 */
export function decrementTokenUse(token) {
  if (token.remainingUses > 0) {
    token.remainingUses--;
  }
  return token;
}

/**
 * Validate token for use
 * @param {string} tokenId - Token ID (parent key in tokens object)
 * @param {Object} token - Token object (without id field)
 * @param {string} ownerPublicKey - Public key of block owner
 * @param {string} field - Field to access
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateTokenForUse(tokenId, token, ownerPublicKey, field) {
  if (!token) {
    return { valid: false, reason: 'Token not provided' };
  }
  
  if (!verifyToken(tokenId, token, ownerPublicKey)) {
    return { valid: false, reason: 'Invalid token signature' };
  }
  
  if (!hasRemainingUses(token)) {
    return { valid: false, reason: 'Token has no remaining uses' };
  }
  
  if (!hasPermission(token, field)) {
    return { valid: false, reason: `Token does not have permission for field: ${field}` };
  }
  
  return { valid: true };
}

/**
 * Get token from tokens object by ID
 * @param {Object} tokens - Tokens object
 * @param {string} tokenId - Token ID
 * @returns {Object|null} Token or null
 */
export function getTokenById(tokens, tokenId) {
  return tokens[tokenId] || null;
}

/**
 * Add token to tokens object
 * @param {Object} tokens - Tokens object
 * @param {string} tokenId - Token ID (becomes parent key)
 * @param {Object} token - Token data (without id field)
 * @returns {Object} Updated tokens object
 */
export function addToken(tokens, tokenId, token) {
  tokens[tokenId] = token;
  return tokens;
}

/**
 * Update token in tokens object
 * @param {Object} tokens - Tokens object
 * @param {string} tokenId - Token ID
 * @param {Object} updates - Updates to apply
 * @returns {Object} Updated tokens object
 */
export function updateToken(tokens, tokenId, updates) {
  if (tokens[tokenId]) {
    tokens[tokenId] = { ...tokens[tokenId], ...updates };
  }
  return tokens;
}

/**
 * Remove expired tokens (remainingUses = 0)
 * @param {Object} tokens - Tokens object
 * @returns {Object} Cleaned tokens object
 */
export function cleanExpiredTokens(tokens) {
  const cleaned = {};
  for (const [id, token] of Object.entries(tokens)) {
    if (token.remainingUses > 0) {
      cleaned[id] = token;
    }
  }
  return cleaned;
}

export default {
  issueToken,
  verifyToken,
  hasPermission,
  hasRemainingUses,
  decrementTokenUse,
  validateTokenForUse,
  getTokenById,
  addToken,
  updateToken,
  cleanExpiredTokens
};
