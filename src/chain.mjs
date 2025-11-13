import * as crypto from './crypto.mjs';
import * as logger from './logger.mjs';
import * as block from './block.mjs';
import * as genesis from './genesis.mjs';
import { isValidBlockStructure } from './utils.mjs';

const chain = [];
let chainHash = null;
let chainSignature = null;

export function initializeChain(genesisBlock) {
  if (!genesis.verifyGenesisBlock(genesisBlock)) {
    throw new Error('Invalid genesis block');
  }
  genesis.setGenesisBlock(genesisBlock);
  chain.length = 0;
  updateChainHash();
  logger.info('Chain initialized', { chainId: genesisBlock.chainId });
}

export function getChain() {
  return chain;
}

export function getChainLength() {
  return chain.length;
}

export function getChainHash() {
  return chainHash;
}

export function getChainSignature() {
  return chainSignature;
}

export function addBlock(newBlock) {
  if (!isValidBlockStructure(newBlock)) {
    logger.warn('Invalid block structure');
    return false;
  }
  if (!block.verifyBlockHash(newBlock)) {
    logger.warn('Invalid block hash');
    return false;
  }
  if (!block.verifyBlockSignature(newBlock)) {
    logger.warn('Invalid block signature');
    return false;
  }
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
  chain.push(newBlock);
  updateChainHash();
  logger.info('Block added to chain', { 
    hash: newBlock.hash, 
    chainLength: chain.length 
  });
  return true;
}

export function findBlockByHash(hash) {
  return chain.find(b => b.hash === hash) || null;
}

export function findBlockByOwner(publicKey) {
  return chain.find(b => b.metadata.ownerPubKey === publicKey) || null;
}

export function updateBlockInChain(hash, updatedBlock) {
  const index = chain.findIndex(b => b.hash === hash);
  if (index === -1) {
    logger.warn('Block not found for update', { hash });
    return false;
  }
  if (!block.verifyBlockHash(updatedBlock)) {
    logger.warn('Invalid updated block hash');
    return false;
  }
  if (!block.verifyBlockSignature(updatedBlock)) {
    logger.warn('Invalid updated block signature');
    return false;
  }
  chain[index] = updatedBlock;
  for (let i = index + 1; i < chain.length; i++) {
    chain[i].prevHash = chain[i - 1].hash;
    chain[i].hash = block.calculateBlockHash(chain[i]);
  }
  updateChainHash();
  logger.info('Block updated in chain', { hash: updatedBlock.hash });
  return true;
}

export function removeBlock(hash) {
  const index = chain.findIndex(b => b.hash === hash);
  if (index === -1) {
    logger.warn('Block not found for removal', { hash });
    return false;
  }
  chain.splice(index, 1);
  updateChainHash();
  logger.info('Block removed from chain', { hash });
  return true;
}

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

function updateChainHash() {
  chainHash = calculateChainHash();
  
  const masterKeyPair = genesis.getMasterKeyPair();
  if (masterKeyPair && chainHash) {
    chainSignature = crypto.signEd25519(chainHash, masterKeyPair.privateKey);
  }
}

export function verifyChainAuthenticity(hash, signature, masterPubKey) {
  return crypto.verifyEd25519(hash, signature, masterPubKey);
}

export function verifyChainIntegrity() {
  for (let i = 0; i < chain.length; i++) {
    const currentBlock = chain[i];
    if (!block.verifyBlockHash(currentBlock)) {
      logger.error('Invalid block hash at index', i);
      return false;
    }
    if (!block.verifyBlockSignature(currentBlock)) {
      logger.error('Invalid block signature at index', i);
      return false;
    }
    if (i > 0) {
      const prevBlock = chain[i - 1];
      if (currentBlock.prevHash !== prevBlock.hash) {
        logger.error('Invalid chain linkage at index', i);
        return false;
      }
    }
  }
  const calculatedHash = calculateChainHash();
  if (calculatedHash !== chainHash) {
    logger.error('Chain hash mismatch');
    return false;
  }
  const genesisBlock = genesis.getGenesisBlock();
  if (genesisBlock && chainSignature) {
    if (!verifyChainAuthenticity(chainHash, chainSignature, genesisBlock.masterPubKey)) {
      logger.error('Invalid chain signature');
      return false;
    }
  }
  return true;
}

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

export function replaceChain(newChain, newChainHash, newChainSignature) {
  const genesisBlock = genesis.getGenesisBlock();
  if (!verifyChainAuthenticity(newChainHash, newChainSignature, genesisBlock.masterPubKey)) {
    logger.warn('New chain has invalid signature');
    return false;
  }
  const originalChain = [...chain];
  const originalHash = chainHash;
  const originalSignature = chainSignature;
  chain.length = 0;
  chain.push(...newChain);
  chainHash = newChainHash;
  chainSignature = newChainSignature;
  if (!verifyChainIntegrity()) {
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
