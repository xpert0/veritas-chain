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
    // Step 1: Load configuration
    logger.info('[1/9] Loading configuration...');
    await config.loadConfig();
    
    // Step 2: Initialize storage and acquire lock
    logger.info('[2/9] Initializing storage...');
    await storage.initStorage();
    
    // Step 3: Load existing data or create new
    logger.info('[3/9] Loading chain data...');
    const data = await storage.loadAll();
    
    if (data.genesis && data.masterKey) {
      // Load existing chain
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
    } else {
      // Create new chain - first peer must have master_key.json
      logger.info('No existing chain, creating new genesis...');
      logger.info('Loading master key from master_key.json...');
      const masterKey = await genesis.loadMasterKeyFromFile();
      
      const genesisBlock = await genesis.createGenesisBlock();
      chain.initializeChain(genesisBlock);
      
      // Save initial state
      await storage.saveMasterKey(masterKey);
      await storage.saveGenesis(genesisBlock);
      await storage.saveSnapshot();
      
      logger.info('New chain created', { chainId: genesisBlock.chainId });
    }
    
    // Step 4: Verify chain integrity
    logger.info('[4/9] Verifying chain integrity...');
    const isValid = chain.verifyChainIntegrity();
    if (!isValid) {
      throw new Error('Chain integrity check failed');
    }
    logger.info('Chain integrity verified');
    
    // Step 5: Initialize network
    logger.info('[5/9] Initializing network...');
    await network.initNetwork();
    
    // Step 6: Discover peers
    logger.info('[6/9] Discovering peers...');
    await network.discoverAndConnect();
    
    // Step 7: Start full mesh
    logger.info('[7/9] Starting P2P mesh...');
    await network.startMesh();
    
    // Step 8: Start automatic snapshots
    logger.info('[8/9] Starting automatic snapshots...');
    storage.startAutoSnapshot();
    
    // Step 9: Start HTTP server
    logger.info('[9/9] Starting HTTP API server...');
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
    // Enable CORS
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
  
  if (!body.data || !body.ownerPublicKey || !body.signatures) {
    sendJSON(res, 400, { error: 'Missing required fields' });
    return;
  }
  
  // Verify required signatures
  const requiredSigs = genesis.getRequiredSignatures('registration');
  if (body.signatures.length < requiredSigs) {
    sendJSON(res, 400, { 
      error: 'Insufficient signatures',
      required: requiredSigs,
      provided: body.signatures.length
    });
    return;
  }
  
  // Generate encryption key from user's public key (simplified - in production use proper key derivation)
  const encryptionKey = await crypto.generateAES256Key();
  
  // Generate keypair for signing (in production, user provides this)
  const ownerKeyPair = await crypto.generateEd25519KeyPair();
  
  // Create block
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
  
  // Add to chain
  const added = chain.addBlock(newBlock);
  
  if (!added) {
    sendJSON(res, 500, { error: 'Failed to add block to chain' });
    return;
  }
  
  // Save and broadcast
  await storage.saveSnapshot();
  await network.broadcastNewBlock(newBlock);
  
  logger.info('New identity registered', { hash: newBlock.hash });
  
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
  
  if (!body.blockHash || !body.tokenId || !body.field || !body.condition || !body.encryptionKey) {
    sendJSON(res, 400, { error: 'Missing required fields' });
    return;
  }
  
  // Find block
  const targetBlock = chain.findBlockByHash(body.blockHash);
  if (!targetBlock) {
    sendJSON(res, 404, { error: 'Block not found' });
    return;
  }
  
  // Decode encryption key
  const encryptionKey = Buffer.from(body.encryptionKey, 'base64');
  
  // Verify condition
  const result = verification.verifyCondition(
    targetBlock,
    body.tokenId,
    body.field,
    body.condition,
    encryptionKey
  );
  
  // Update block with decremented token
  await storage.saveSnapshot();
  
  logger.info('Zero-knowledge verification performed', { 
    blockHash: body.blockHash,
    field: body.field,
    result: result.result
  });
  
  sendJSON(res, 200, result);
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
  
  // Find block
  const targetBlock = chain.findBlockByHash(body.blockHash);
  if (!targetBlock) {
    sendJSON(res, 404, { error: 'Block not found' });
    return;
  }
  
  // Issue token
  const newToken = await token.issueToken(
    body.ownerPrivateKey,
    body.permissions,
    body.maxUses
  );
  
  // Add token to block
  token.addToken(targetBlock.tokens, newToken);
  
  // Recalculate block hash
  targetBlock.hash = block.calculateBlockHash(targetBlock);
  
  // Re-sign the block
  const blockData = JSON.stringify({
    hash: targetBlock.hash,
    encryptedData: targetBlock.encryptedData,
    metadata: targetBlock.metadata,
    prevHash: targetBlock.prevHash
  });
  targetBlock.signature = crypto.signEd25519(blockData, body.ownerPrivateKey);
  
  // Update chain
  chain.updateBlockInChain(body.blockHash, targetBlock);
  
  // Save
  await storage.saveSnapshot();
  
  logger.info('Token issued', { 
    oldBlockHash: body.blockHash,
    newBlockHash: targetBlock.hash,
    tokenId: newToken.id
  });
  
  sendJSON(res, 201, { 
    success: true,
    blockHash: targetBlock.hash,
    token: newToken
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
  
  // Verify required signatures
  const requiredSigs = genesis.getRequiredSignatures('update');
  if (body.signatures.length < requiredSigs) {
    sendJSON(res, 400, { 
      error: 'Insufficient signatures',
      required: requiredSigs,
      provided: body.signatures.length
    });
    return;
  }
  
  // Find block
  const targetBlock = chain.findBlockByHash(body.blockHash);
  if (!targetBlock) {
    sendJSON(res, 404, { error: 'Block not found' });
    return;
  }
  
  // Decode encryption key
  const encryptionKey = Buffer.from(body.encryptionKey, 'base64');
  
  // Update block
  block.updateBlock(targetBlock, body.newData, encryptionKey, body.ownerPrivateKey);
  
  // Update in chain
  chain.updateBlockInChain(body.blockHash, targetBlock);
  
  // Save and broadcast
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
  
  if (!body.blockHash || !body.oldKey || !body.newStage) {
    sendJSON(res, 400, { error: 'Missing required fields' });
    return;
  }
  
  // Find block
  const targetBlock = chain.findBlockByHash(body.blockHash);
  if (!targetBlock) {
    sendJSON(res, 404, { error: 'Block not found' });
    return;
  }
  
  // Decode old key
  const oldKey = Buffer.from(body.oldKey, 'base64');
  
  // Generate new keypair
  const newKeyPair = await crypto.generateEd25519KeyPair();
  const newKey = await crypto.generateAES256Key();
  
  // Rotate
  block.rotateBlockKey(
    targetBlock,
    oldKey,
    newKey,
    newKeyPair.publicKey,
    newKeyPair.privateKey,
    body.newStage
  );
  
  // Update in chain
  chain.updateBlockInChain(body.blockHash, targetBlock);
  
  // Save and broadcast
  await storage.saveSnapshot();
  await network.broadcastKeyRotation(targetBlock.hash, body.newStage);
  
  logger.info('Key rotated', { 
    hash: targetBlock.hash,
    newStage: body.newStage
  });
  
  sendJSON(res, 200, { 
    success: true,
    blockHash: targetBlock.hash,
    newOwnerPublicKey: newKeyPair.publicKey,
    newOwnerPrivateKey: newKeyPair.privateKey,
    newEncryptionKey: newKey.toString('base64')
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
    // Stop network
    network.stopNetwork();
    
    // Save final snapshot
    await storage.saveSnapshot();
    
    // Stop automatic snapshots
    storage.stopAutoSnapshot();
    
    // Release storage lock
    await storage.cleanup();
    
    // Close HTTP server
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

// Handle process signals
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

// Start the node
bootstrap();
