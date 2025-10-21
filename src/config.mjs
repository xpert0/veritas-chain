import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as logger from './logger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let config = null;

/**
 * Load configuration from config.json
 * @returns {Promise<Object>} Configuration object
 */
export async function loadConfig() {
  if (config) {
    return config;
  }
  
  try {
    const configPath = join(__dirname, '..', 'config.json');
    const data = await readFile(configPath, 'utf8');
    config = JSON.parse(data);
    
    validateConfig(config);
    logger.info('Configuration loaded successfully');
    return config;
  } catch (error) {
    logger.error('Failed to load configuration', error.message);
    throw error;
  }
}

/**
 * Validate configuration schema
 * @param {Object} cfg - Configuration object
 */
function validateConfig(cfg) {
  const required = [
    'network',
    'security',
    'identity',
    'consensus',
    'blockTemplate',
    'genesisTemplate',
    'storage'
  ];
  
  for (const key of required) {
    if (!cfg[key]) {
      throw new Error(`Missing required configuration section: ${key}`);
    }
  }
  
  // Validate network
  if (!cfg.network.httpPort || !cfg.network.p2pPort) {
    throw new Error('Missing required network ports');
  }
  
  // Validate security algorithms
  const allowedAlgorithms = ['sha512', 'ed25519', 'aes-256-gcm'];
  if (!allowedAlgorithms.includes(cfg.security.hashAlgorithm)) {
    throw new Error('Invalid hash algorithm');
  }
  if (!allowedAlgorithms.includes(cfg.security.asymmetric)) {
    throw new Error('Invalid asymmetric encryption');
  }
  if (!allowedAlgorithms.includes(cfg.security.encryption)) {
    throw new Error('Invalid symmetric encryption');
  }
  
  // Validate lifecycle
  if (!cfg.identity.lifecycle || 
      !cfg.identity.lifecycle.guardianAge || 
      !cfg.identity.lifecycle.selfAge) {
    throw new Error('Invalid identity lifecycle configuration');
  }
  
  // Validate consensus
  if (!cfg.consensus.requiredSignatures) {
    throw new Error('Missing required signatures configuration');
  }
}

/**
 * Get configuration
 * @returns {Object} Configuration object
 */
export function getConfig() {
  if (!config) {
    throw new Error('Configuration not loaded. Call loadConfig() first.');
  }
  return config;
}

/**
 * Get network configuration
 * @returns {Object} Network config
 */
export function getNetworkConfig() {
  return getConfig().network;
}

/**
 * Get security configuration
 * @returns {Object} Security config
 */
export function getSecurityConfig() {
  return getConfig().security;
}

/**
 * Get identity configuration
 * @returns {Object} Identity config
 */
export function getIdentityConfig() {
  return getConfig().identity;
}

/**
 * Get consensus configuration
 * @returns {Object} Consensus config
 */
export function getConsensusConfig() {
  return getConfig().consensus;
}

/**
 * Get storage configuration
 * @returns {Object} Storage config
 */
export function getStorageConfig() {
  return getConfig().storage;
}

/**
 * Get block template
 * @returns {Object} Block template
 */
export function getBlockTemplate() {
  return getConfig().blockTemplate;
}

/**
 * Get genesis template
 * @returns {Object} Genesis template
 */
export function getGenesisTemplate() {
  return getConfig().genesisTemplate;
}

export default {
  loadConfig,
  getConfig,
  getNetworkConfig,
  getSecurityConfig,
  getIdentityConfig,
  getConsensusConfig,
  getStorageConfig,
  getBlockTemplate,
  getGenesisTemplate
};
