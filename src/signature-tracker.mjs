import { promises as fs } from 'fs';
import path from 'path';
import * as logger from './logger.mjs';
import { getStorageConfig } from './config.mjs';

const SIGNATURES_FILE = 'used-signatures.json';

let storagePath = null;
let usedSignatures = new Set();

/**
 * Initialize signature tracker
 * @returns {Promise<void>}
 */
export async function initSignatureTracker() {
  const config = getStorageConfig();
  storagePath = path.resolve(config.path);
  
  // Load existing used signatures
  await loadUsedSignatures();
  
  logger.info('Signature tracker initialized', { 
    trackedSignatures: usedSignatures.size 
  });
}

/**
 * Check if a signature has been used
 * @param {string} signature - Signature to check
 * @returns {boolean} True if signature has been used
 */
export function isSignatureUsed(signature) {
  return usedSignatures.has(signature);
}

/**
 * Mark a signature as used
 * @param {string} signature - Signature to mark as used
 * @returns {Promise<void>}
 */
export async function markSignatureAsUsed(signature) {
  if (usedSignatures.has(signature)) {
    throw new Error('Signature already used');
  }
  
  usedSignatures.add(signature);
  await saveUsedSignatures();
  
  logger.debug('Signature marked as used', { 
    signature: signature.substring(0, 20) + '...' 
  });
}

/**
 * Mark multiple signatures as used
 * @param {string[]} signatures - Array of signatures to mark as used
 * @returns {Promise<void>}
 */
export async function markSignaturesAsUsed(signatures) {
  for (const signature of signatures) {
    if (usedSignatures.has(signature)) {
      throw new Error(`Signature already used: ${signature.substring(0, 20)}...`);
    }
  }
  
  for (const signature of signatures) {
    usedSignatures.add(signature);
  }
  
  await saveUsedSignatures();
  
  logger.debug('Multiple signatures marked as used', { count: signatures.length });
}

/**
 * Save used signatures to disk
 * @returns {Promise<void>}
 */
async function saveUsedSignatures() {
  if (!storagePath) {
    throw new Error('Signature tracker not initialized');
  }
  
  const signaturesPath = path.join(storagePath, SIGNATURES_FILE);
  const data = {
    signatures: Array.from(usedSignatures),
    lastUpdated: Date.now()
  };
  
  await fs.writeFile(signaturesPath, JSON.stringify(data, null, 2));
  
  logger.debug('Used signatures saved to disk', { count: usedSignatures.size });
}

/**
 * Load used signatures from disk
 * @returns {Promise<void>}
 */
async function loadUsedSignatures() {
  if (!storagePath) {
    throw new Error('Signature tracker not initialized');
  }
  
  const signaturesPath = path.join(storagePath, SIGNATURES_FILE);
  
  try {
    const data = await fs.readFile(signaturesPath, 'utf8');
    const parsed = JSON.parse(data);
    
    usedSignatures = new Set(parsed.signatures || []);
    
    logger.debug('Used signatures loaded from disk', { count: usedSignatures.size });
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, start with empty set
      usedSignatures = new Set();
      logger.debug('No existing signatures file, starting fresh');
    } else {
      throw error;
    }
  }
}

/**
 * Get statistics about used signatures
 * @returns {Object} Statistics
 */
export function getSignatureStats() {
  return {
    totalUsed: usedSignatures.size
  };
}

export default {
  initSignatureTracker,
  isSignatureUsed,
  markSignatureAsUsed,
  markSignaturesAsUsed,
  getSignatureStats
};
