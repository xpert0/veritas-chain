import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as logger from './logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_FILE = 'config.json';
let configPath = null;
let currentConfig = null;

/**
 * Initialize key registry with current config
 * @param {Object} config - Current configuration
 */
export function initKeyRegistry(config) {
  currentConfig = config;
  configPath = path.join(__dirname, '..', CONFIG_FILE);
  logger.info('Key registry initialized', { 
    registrars: currentConfig.consensus.KeyRegistry.length 
  });
}

/**
 * Add a new registrar to the KeyRegistry
 * @param {string} publicKey - Public key to add
 * @returns {Promise<void>}
 */
export async function addRegistrar(publicKey) {
  if (!currentConfig) {
    throw new Error('Key registry not initialized');
  }
  
  // Check if already exists
  if (currentConfig.consensus.KeyRegistry.includes(publicKey)) {
    throw new Error('Registrar already exists in KeyRegistry');
  }
  
  // Add to in-memory config
  currentConfig.consensus.KeyRegistry.push(publicKey);
  
  // Save to disk
  await saveConfig();
  
  logger.info('New registrar added to KeyRegistry', { 
    publicKey: publicKey.substring(0, 50) + '...',
    totalRegistrars: currentConfig.consensus.KeyRegistry.length 
  });
}

/**
 * Get current KeyRegistry
 * @returns {string[]} Array of public keys
 */
export function getKeyRegistry() {
  if (!currentConfig) {
    throw new Error('Key registry not initialized');
  }
  
  return currentConfig.consensus.KeyRegistry;
}

/**
 * Check if a public key is in the KeyRegistry
 * @param {string} publicKey - Public key to check
 * @returns {boolean} True if registrar is authorized
 */
export function isRegistrar(publicKey) {
  if (!currentConfig) {
    throw new Error('Key registry not initialized');
  }
  
  return currentConfig.consensus.KeyRegistry.includes(publicKey);
}

/**
 * Save current config to disk
 * @returns {Promise<void>}
 */
async function saveConfig() {
  if (!configPath) {
    throw new Error('Config path not set');
  }
  
  await fs.writeFile(configPath, JSON.stringify(currentConfig, null, 2));
  
  logger.debug('Config saved to disk');
}

/**
 * Get config for external use
 * @returns {Object} Current configuration
 */
export function getConfig() {
  return currentConfig;
}

export default {
  initKeyRegistry,
  addRegistrar,
  getKeyRegistry,
  isRegistrar,
  getConfig
};
