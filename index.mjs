import http from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as logger from './src/logger.mjs';
import * as config from './src/config.mjs';
import * as crypto from './src/crypto.mjs';
import * as genesis from './src/genesis.mjs';
import * as block from './src/block.mjs';
import * as token from './src/token.mjs';
import * as verification from './src/verification.mjs';
import * as chain from './src/chain.mjs';
import * as storage from './src/storage.mjs';
import * as network from './src/network.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let httpServer = null;

/**
 * Bootstrap the node
 */
async function bootstrap() {
  logger.info('===== ZKIC Bootstrap Starting =====');
  try {
    logger.info('[1/9] Loading configuration...');
    await config.loadConfig();
    logger.info('[2/9] Initializing storage...');
    await storage.initStorage();
    const data = await storage.loadAll();
<<<<<<< HEAD
    logger.info('[3/9] Initializing network...');
    await network.initNetwork();
    logger.info('[4/9] Discovering peers...');
    await network.discoverAndConnect();
    logger.info('[5/9] Starting P2P mesh...');
    await network.startMesh();
    logger.info('[6/9] Loading chain data...');
    // const data = await storage.loadAll();
=======
    
    let chainInitialized = false;
    
>>>>>>> 0603e4b348fb99821ce54469ab83685f77c98cef
    if (data.genesis && data.masterKey) {
      logger.info('Existing chain found, loading...');
      genesis.setMasterKeyPair(data.masterKey);
      genesis.setGenesisBlock(data.genesis);
      chain.initializeChain(data.genesis);
      if (data.snapshot && data.snapshot.chain) {
        chain.replaceChain(
          data.snapshot.chain,
          data.snapshot.chainHash,
          data.snapshot.chainSignature
        );
        logger.info('Chain snapshot loaded', { blocks: data.snapshot.chain.length });
      }
<<<<<<< HEAD
    } else {
      logger.info('No existing chain, creating new genesis...');
      logger.info('Loading master key from master_key.json...');
      const masterKey = await genesis.loadMasterKeyFromFile();
      const genesisBlock = await genesis.createGenesisBlock();
      chain.initializeChain(genesisBlock);
      await storage.saveMasterKey(masterKey);
      await storage.saveGenesis(genesisBlock);
      await storage.saveSnapshot(); 
      logger.info('New chain created', { chainId: genesisBlock.chainId });
    }
=======
      
      chainInitialized = true;
    }
    
    // Step 4: Initialize network first
    logger.info('[4/9] Initializing network...');
    await network.initNetwork();
    
    // Step 5: Discover peers before creating chain (if no chain exists)
    logger.info('[5/9] Discovering peers...');
    const discoveredPeers = await network.discoverAndConnect();
    
    // Step 6: If no existing chain, decide whether to create or sync
    if (!chainInitialized) {
      if (discoveredPeers && discoveredPeers.length > 0) {
        // Peers found - sync chain from them
        logger.info('Peers discovered, syncing chain from network...', { peerCount: discoveredPeers.length });
        
        // The discoverAndConnect already attempted sync, chain should be loaded
        // Load synced data
        const syncedData = await storage.loadAll();
        if (syncedData.genesis && syncedData.masterKey) {
          genesis.setMasterKeyPair(syncedData.masterKey);
          genesis.setGenesisBlock(syncedData.genesis);
          chain.initializeChain(syncedData.genesis);
          
          if (syncedData.snapshot && syncedData.snapshot.chain) {
            chain.replaceChain(
              syncedData.snapshot.chain,
              syncedData.snapshot.chainHash,
              syncedData.snapshot.chainSignature
            );
            logger.info('Chain synced from network', { blocks: syncedData.snapshot.chain.length });
          }
          chainInitialized = true;
        }
      }
      
      // If still no chain (no peers or sync failed), create new genesis
      if (!chainInitialized) {
        logger.info('No peers found or sync failed, creating new genesis block...');
        logger.info('Loading master key from master_key.json...');
        const masterKey = await genesis.loadMasterKeyFromFile();
        
        const genesisBlock = await genesis.createGenesisBlock();
        chain.initializeChain(genesisBlock);
        
        // Save initial state
        await storage.saveMasterKey(masterKey);
        await storage.saveGenesis(genesisBlock);
        await storage.saveSnapshot();
        
        logger.info('New chain created', { chainId: genesisBlock.chainId });
        chainInitialized = true;
      }
    }
    
    // Step 7: Verify chain integrity
>>>>>>> 0603e4b348fb99821ce54469ab83685f77c98cef
    logger.info('[7/9] Verifying chain integrity...');
    const isValid = chain.verifyChainIntegrity();
    if (!isValid) {
      throw new Error('Chain integrity check failed');
    }
    logger.info('Chain integrity verified');
<<<<<<< HEAD
    logger.info('[8/9] Starting automatic snapshots...');
    storage.startAutoSnapshot();
    logger.info('[9/9] Starting HTTP API server...');
=======
    
    // Step 8: Start full mesh
    logger.info('[8/9] Starting P2P mesh...');
    await network.startMesh();
    
    // Step 9: Start automatic snapshots
    logger.info('[9/9] Starting automatic snapshots...');
    storage.startAutoSnapshot();
    
    // Step 10: Start HTTP server
    logger.info('[10/10] Starting HTTP API server...');
>>>>>>> 0603e4b348fb99821ce54469ab83685f77c98cef
    await startHTTPServer();
    logger.info('===== ZKIC Bootstrap Complete =====');
    logger.info('Node is ready', network.getNetworkStatus());
  } catch (error) {
    logger.error('Bootstrap failed', error);
    await shutdown();
    process.exit(1);
  }
}

/**
 * Start HTTP API server
 */
async function startHTTPServer() {
  const cfg = config.getNetworkConfig();
  httpServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      await handleRequest(req, res, url);
    } catch (error) {
      logger.error('Request handling failed', error);
      sendJSON(res, 500, { error: 'Internal server error', message: error.message });
    }
  });
  return new Promise((resolve) => {
    httpServer.listen(cfg.httpPort, () => {
      logger.info('HTTP server started', { port: cfg.httpPort });
      resolve();
    });
  });
}

/**
 * Handle HTTP request
 */
async function handleRequest(req, res, url) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/docs') {
    handleDocs(req, res);
  } else if (req.method === 'GET' && path === '/api/chain') {
    handleGetChain(req, res);
  } else if (req.method === 'POST' && path === '/api/register') {
    await handleRegister(req, res);
  } else if (req.method === 'POST' && path === '/api/verify') {
    await handleVerify(req, res);
  } else if (req.method === 'POST' && path === '/api/token') {
    await handleIssueToken(req, res);
  } else if (req.method === 'POST' && path === '/api/update') {
    await handleUpdate(req, res);
  } else if (req.method === 'POST' && path === '/api/rotate') {
    await handleRotate(req, res);
  } else {
    sendJSON(res, 404, { error: 'Not found' });
  }
}

/**
 * Handle GET /docs
 */
async function handleDocs(req, res) {
  try {
    const docsPath = join(__dirname, 'docs', 'index.html');
    const html = await readFile(docsPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } catch (error) {
    logger.error('Failed to serve documentation', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Documentation not available');
  }
}

/**
 * Handle GET /api/chain
 */
function handleGetChain(req, res) {
  const metadata = chain.getChainMetadata();
  const networkStatus = network.getNetworkStatus();
  sendJSON(res, 200, {
    chain: metadata,
    network: networkStatus,
    health: 'healthy'
  });
}

/**
 * Handle POST /api/register
 */
async function handleRegister(req, res) {
  const body = await readBody(req);
<<<<<<< HEAD
  if (!body.data || !body.registrarPrivateKey || !body.registrarSignature || !body.parentKeys) {
    sendJSON(res, 400, { error: 'Missing required fields: data, registrarPrivateKey, registrarSignature, parentKeys' });
    return;
  }
  const registrarPublicKey = crypto.derivePublicKeyFromPrivate(body.registrarPrivateKey);
=======
  
  if (!body.data || !body.registrarSignatures || !body.parentKeys) {
    sendJSON(res, 400, { error: 'Missing required fields: data, registrarSignatures (array), parentKeys' });
    return;
  }
  
  // Validate registrarSignatures is an array
  if (!Array.isArray(body.registrarSignatures)) {
    sendJSON(res, 400, { error: 'registrarSignatures must be an array' });
    return;
  }
  
  // Get required number of signatures from config
>>>>>>> 0603e4b348fb99821ce54469ab83685f77c98cef
  const consensusConfig = config.getConsensusConfig();
  const requiredSigs = consensusConfig.requiredSignatures.registration;
  
  if (body.registrarSignatures.length < requiredSigs) {
    sendJSON(res, 403, { 
      error: `Insufficient signatures. Required: ${requiredSigs}, provided: ${body.registrarSignatures.length}`
    });
    return;
  }
  if (!Array.isArray(body.parentKeys) || body.parentKeys.length === 0) {
    sendJSON(res, 400, { 
      error: 'At least one parent key required',
      message: 'Provide array of parent keys (both parents preferred)'
    });
    return;
  }
<<<<<<< HEAD
=======
  
  // Verify all signatures against the data being registered
  const message = JSON.stringify(body.data);
  const validatedRegistrars = new Set();
  
  for (const sig of body.registrarSignatures) {
    if (!sig.signature || !sig.registrarPrivateKey) {
      sendJSON(res, 400, { error: 'Each signature must include signature and registrarPrivateKey' });
      return;
    }
    
    // Derive public key from private key
    const registrarPublicKey = crypto.derivePublicKeyFromPrivate(sig.registrarPrivateKey);
    
    // Verify registrar is in KeyRegistry
    if (!consensusConfig.KeyRegistry || !consensusConfig.KeyRegistry.includes(registrarPublicKey)) {
      sendJSON(res, 403, { error: `Registrar not authorized: ${registrarPublicKey}` });
      return;
    }
    
    // Prevent duplicate registrars
    if (validatedRegistrars.has(registrarPublicKey)) {
      sendJSON(res, 400, { error: 'Duplicate registrar signatures detected' });
      return;
    }
    
    // Verify signature of the data
    const isValid = crypto.verifyEd25519Signature(message, sig.signature, registrarPublicKey);
    if (!isValid) {
      sendJSON(res, 401, { error: `Invalid signature from registrar: ${registrarPublicKey}` });
      return;
    }
    
    validatedRegistrars.add(registrarPublicKey);
  }
  
  // Generate keypair for newborn
>>>>>>> 0603e4b348fb99821ce54469ab83685f77c98cef
  const ownerKeyPair = await crypto.generateEd25519KeyPair();
  const encryptionKey = await crypto.generateAES256Key();
  const prevHash = chain.getChainLength() > 0 
    ? chain.getChain()[chain.getChainLength() - 1].hash 
    : null;
  const newBlock = await block.createBlock(
    body.data,
    ownerKeyPair.publicKey,
    encryptionKey,
    ownerKeyPair.privateKey,
    prevHash
  );
  const added = chain.addBlock(newBlock);
  if (!added) {
    sendJSON(res, 500, { error: 'Failed to add block to chain' });
    return;
  }
  await storage.saveSnapshot();
  await network.broadcastNewBlock(newBlock);
<<<<<<< HEAD
  logger.info('New identity registered', { hash: newBlock.hash, parents: body.parentKeys.length });
=======
  
  logger.info('New identity registered', { hash: newBlock.hash, parents: body.parentKeys.length, registrars: validatedRegistrars.size });
  
>>>>>>> 0603e4b348fb99821ce54469ab83685f77c98cef
  sendJSON(res, 201, { 
    success: true,
    blockHash: newBlock.hash,
    ownerPublicKey: ownerKeyPair.publicKey,
    ownerPrivateKey: ownerKeyPair.privateKey,
    encryptionKey: encryptionKey.toString('base64')
  });
}

/**
 * Handle POST /api/verify
 */
async function handleVerify(req, res) {
  const body = await readBody(req);
  if (!body.blockHash || !body.tokenId || !body.conditions || !body.encryptionKey) {
    sendJSON(res, 400, { error: 'Missing required fields: blockHash, tokenId, conditions, encryptionKey' });
    return;
  }
  if (!Array.isArray(body.conditions) || body.conditions.length === 0) {
    sendJSON(res, 400, { error: 'conditions must be a non-empty array' });
    return;
  }
  const targetBlock = chain.findBlockByHash(body.blockHash);
  if (!targetBlock) {
    sendJSON(res, 404, { error: 'Block not found' });
    return;
  }
  const encryptionKey = Buffer.from(body.encryptionKey, 'base64');
  const verificationResult = verification.verifyMultipleConditions(
    targetBlock,
    body.tokenId,
    body.conditions,
    encryptionKey
  );
  if (verificationResult.unauthorizedFields) {
    sendJSON(res, 403, { 
      success: false,
      error: verificationResult.error,
      unauthorizedFields: verificationResult.unauthorizedFields
    });
    return;
  }
  await storage.saveSnapshot();
  logger.info('Zero-knowledge verification performed', { 
    blockHash: body.blockHash,
    conditionsCount: body.conditions.length,
    allPassed: verificationResult.result
  });
  sendJSON(res, 200, { 
    success: true,
    results: verificationResult.details,
    allPassed: verificationResult.result
  });
}

/**
 * Handle POST /api/token
 */
async function handleIssueToken(req, res) {
  const body = await readBody(req);
  if (!body.blockHash || !body.ownerPrivateKey || !body.permissions || !body.maxUses) {
    sendJSON(res, 400, { error: 'Missing required fields' });
    return;
  }
  if (body.maxUses > 5 || body.maxUses < 1) {
    sendJSON(res, 400, { 
      error: 'Invalid maxUses value',
      message: 'maxUses must be between 1 and 5'
    });
    return;
  }
  const targetBlock = chain.findBlockByHash(body.blockHash);
  if (!targetBlock) {
    sendJSON(res, 404, { error: 'Block not found' });
    return;
  }
  const { id: tokenId, token: tokenData } = await token.issueToken(
    body.ownerPrivateKey,
    body.permissions,
    body.maxUses
  );
  token.addToken(targetBlock.tokens, tokenId, tokenData);
  targetBlock.hash = block.calculateBlockHash(targetBlock);
  const blockData = JSON.stringify({
    hash: targetBlock.hash,
    encryptedData: targetBlock.encryptedData,
    metadata: targetBlock.metadata,
    prevHash: targetBlock.prevHash
  });
  targetBlock.signature = crypto.signEd25519(blockData, body.ownerPrivateKey);
  chain.updateBlockInChain(body.blockHash, targetBlock);
  await storage.saveSnapshot();
  logger.info('Token issued', { 
    oldBlockHash: body.blockHash,
    newBlockHash: targetBlock.hash,
    tokenId: tokenId,
    maxUses: body.maxUses
  });
  sendJSON(res, 201, { 
    success: true,
    blockHash: targetBlock.hash,
    tokenId: tokenId,
    token: tokenData
  });
}

/**
 * Handle POST /api/update
 */
async function handleUpdate(req, res) {
  const body = await readBody(req);
  if (!body.blockHash || !body.newData || !body.encryptionKey || !body.ownerPrivateKey || !body.signatures) {
    sendJSON(res, 400, { error: 'Missing required fields' });
    return;
  }
  const requiredSigs = genesis.getRequiredSignatures('update');
  if (body.signatures.length < requiredSigs) {
    sendJSON(res, 400, { 
      error: 'Insufficient signatures',
      required: requiredSigs,
      provided: body.signatures.length
    });
    return;
  }
  const targetBlock = chain.findBlockByHash(body.blockHash);
  if (!targetBlock) {
    sendJSON(res, 404, { error: 'Block not found' });
    return;
  }
  const encryptionKey = Buffer.from(body.encryptionKey, 'base64');
  block.updateBlock(targetBlock, body.newData, encryptionKey, body.ownerPrivateKey);
  chain.updateBlockInChain(body.blockHash, targetBlock);
  await storage.saveSnapshot();
  await network.broadcastBlockUpdate(targetBlock);
  logger.info('Block updated', { hash: targetBlock.hash });
  sendJSON(res, 200, { 
    success: true,
    blockHash: targetBlock.hash
  });
}

/**
 * Handle POST /api/rotate
 */
async function handleRotate(req, res) {
  const body = await readBody(req);
  if (!body.blockHash || !body.oldPrivateKey || !body.newPrivateKey || !body.oldEncryptionKey) {
    sendJSON(res, 400, { error: 'Missing required fields: blockHash, oldPrivateKey, newPrivateKey, oldEncryptionKey' });
    return;
  }
  const targetBlock = chain.findBlockByHash(body.blockHash);
  if (!targetBlock) {
    sendJSON(res, 404, { error: 'Block not found' });
    return;
  }
  const oldKey = Buffer.from(body.oldEncryptionKey, 'base64');
  const testData = 'test_signature_verification';
  const testSig = crypto.signEd25519(testData, body.oldPrivateKey);
  const oldPublicKey = targetBlock.metadata.ownerPubKey;
  if (!crypto.verifyEd25519(testData, testSig, oldPublicKey)) {
    sendJSON(res, 403, { 
      success: false,
      error: 'Old private key does not match block owner' 
    });
    return;
  }
  const newPublicKey = crypto.derivePublicKeyFromPrivate(body.newPrivateKey);
  const currentStage = targetBlock.metadata.lifecycleStage;
  const rotationsLeft = targetBlock.metadata.rotationsLeft;
  const totalRotations = config.getIdentityConfig().maxKeyRotations;
  const rotationCount = totalRotations - rotationsLeft;
  let newStage = currentStage;
  if (rotationCount === 0) {
    newStage = 'guardian';
  } else if (rotationCount === 1) {
    newStage = 'self';
  } else if (rotationCount >= 2) {
    newStage = 'self';
  }
  const newKey = await crypto.generateAES256Key();
  block.rotateBlockKey(
    targetBlock,
    oldKey,
    newKey,
    newPublicKey,
    body.newPrivateKey,
    newStage
  );
  chain.updateBlockInChain(body.blockHash, targetBlock);
  await storage.saveSnapshot();
  await network.broadcastKeyRotation(targetBlock.hash, newStage);
  logger.info('Key rotated', { 
    hash: targetBlock.hash,
    rotationNumber: rotationCount + 1,
    newStage: newStage,
    rotationsLeft: targetBlock.metadata.rotationsLeft
  });
  sendJSON(res, 200, { 
    success: true,
    blockHash: targetBlock.hash,
    newPublicKey: newPublicKey,
    newEncryptionKey: newKey.toString('base64'),
    lifecycleStage: newStage,
    rotationNumber: rotationCount + 1,
    rotationsLeft: targetBlock.metadata.rotationsLeft
  });
}

/**
 * Read request body
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * Shutdown gracefully
 */
async function shutdown() {
  logger.info('Shutting down...');
  try {
    network.stopNetwork();
    await storage.saveSnapshot();
    storage.stopAutoSnapshot();
    if (httpServer) {
      httpServer.close(() => {
        logger.info('HTTP server closed');
      });
    }
    logger.info('Shutdown complete');
  } catch (error) {
    logger.error('Shutdown error', error);
  }
}
process.on('SIGINT', async () => {
  logger.info('SIGINT received');
  await shutdown();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');
  await shutdown();
  process.exit(0);
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  shutdown().then(() => process.exit(1));
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', reason);
});

bootstrap();
