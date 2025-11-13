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

export async function generateMasterKeyPair() {
  logger.info('Generating master keypair for chain authentication');
  masterKeyPair = await crypto.generateEd25519KeyPair();
  return masterKeyPair;
}

export function getMasterKeyPair() {
  return masterKeyPair;
}

export function setMasterKeyPair(keyPair) {
  masterKeyPair = keyPair;
}

export async function generateGenesisSigners(count = 3) {
  logger.info(`Generating ${count} genesis signer keypairs`);
  const signers = [];
  for (let i = 0; i < count; i++) {
    const keyPair = await crypto.generateEd25519KeyPair();
    signers.push(keyPair);
  }
  return signers;
}

export async function createGenesisBlock() {
  if (!masterKeyPair) {
    throw new Error('Master key must be loaded before creating genesis block');
  }
  const template = deepClone(getGenesisTemplate());
  const chainId = crypto.sha512(`genesis-${Date.now()}-${Math.random()}`);
  genesisBlock = {
    ...template,
    chainId,
    createdAt: getCurrentTimestamp(),
    masterPubKey: masterKeyPair.publicKey
  };
  const genesisData = JSON.stringify({
    chainId: genesisBlock.chainId,
    createdAt: genesisBlock.createdAt,
    masterPubKey: genesisBlock.masterPubKey
  });
  genesisBlock.chainSignature = crypto.signEd25519(genesisData, masterKeyPair.privateKey);
  logger.info('Genesis block created', { chainId });
  return genesisBlock;
}

export function getGenesisBlock() {
  return genesisBlock;
}

export function setGenesisBlock(block) {
  genesisBlock = block;
}

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

export function isAuthorizedGenesisSigner(publicKey) {
  const consensusConfig = getConsensusConfig();
  return consensusConfig.KeyRegistry.includes(publicKey);
}

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
