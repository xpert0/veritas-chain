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
import * as sync from './src/peer-sync.mjs';

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
    
    // Step 3: Initialize network first (needed for peer discovery)
    logger.info('[3/9] Initializing network...');
    await network.initNetwork();
    
    // Step 4: Start P2P server (must start before discovering peers)
    logger.info('[4/9] Starting P2P server...');
    await network.startP2PServer();
    
    // Step 5: Bootstrap peer discovery (3x subnet + 1x DNS)
    logger.info('[5/9] Discovering peers before chain initialization...');
    const { hasPeers, bestPeer } = await network.bootstrapPeerDiscovery();
    
    // Step 6: Load existing data or create new / sync from network
    logger.info('[6/9] Loading or initializing chain...');
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
      
      // Sync with network if peers found and they have longer chain
      if (hasPeers && bestPeer && bestPeer.chainLength > chain.getChainLength()) {
        logger.info('Syncing with network (longer chain available)');
        await sync.syncWithPeer(bestPeer.address, chain.getChainLength());
      }
    } else if (hasPeers) {
      // No local chain but peers exist - sync from network
      logger.info('No local chain, syncing from network peer with longest chain');
      logger.info('Getting chain from peer', { 
        peer: bestPeer.address, 
        chainLength: bestPeer.chainLength,
        chainId: bestPeer.chainId 
      });
      
      // First, get the sync data to extract genesis block
      const syncData = await sync.requestSync(bestPeer.address, 0);
      
      if (syncData && syncData.blocks && syncData.blocks.length > 0) {
        // Extract and set genesis block first
        const genesisBlock = syncData.blocks[0];
        
        if (!genesis.verifyGenesisBlock(genesisBlock)) {
          throw new Error('Invalid genesis block received from peer');
        }
        
        // Set genesis block to enable chain operations
        genesis.setGenesisBlock(genesisBlock);
        chain.initializeChain(genesisBlock);
        
        logger.info('Genesis block received from network', { 
          chainId: genesisBlock.chainId 
        });
        
        // Now apply the full sync data (including all blocks)
        const syncSuccess = await sync.applySyncData(syncData);
        
        if (syncSuccess) {
          // Save the synced chain
          await storage.saveGenesis(genesisBlock);
          await storage.saveSnapshot();
          
          logger.info('Chain synced from network', { 
            chainId: genesisBlock.chainId, 
            blocks: chain.getChainLength() 
          });
        } else {
          throw new Error('Failed to apply synced chain data');
        }
      } else {
        throw new Error('No valid chain data received from peer');
      }
    } else {
      // No peers and no local chain - create new chain (first peer)
      logger.info('No peers found and no existing chain, creating new genesis...');
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
    
    // Step 7: Verify chain integrity
    logger.info('[7/9] Verifying chain integrity...');
    const isValid = chain.verifyChainIntegrity();
    if (!isValid) {
      throw new Error('Chain integrity check failed');
    }
    logger.info('Chain integrity verified');
    
    // Step 8: Start continuous peer discovery and gossip
    logger.info('[8/9] Starting continuous peer discovery and gossip...');
    await network.startMesh();
    
    // Step 9: Check peer count and warn about master_key.json if needed
    logger.info('[9/11] Checking network peer count...');
    checkMasterKeyDeletion();
    
    // Step 10: Start automatic snapshots
    logger.info('[10/11] Starting automatic snapshots...');
    storage.startAutoSnapshot();
    
    // Step 11: Start HTTP server
    logger.info('[11/11] Starting HTTP API server...');
    await startHTTPServer();
    
    logger.info('===== ZKIC Bootstrap Complete =====');
    logger.info('Node is ready', network.getNetworkStatus());
    
    // Start periodic master key deletion check (every 5 minutes)
    setInterval(() => {
      checkMasterKeyDeletion();
    }, 5 * 60 * 1000); // 5 minutes
    
  } catch (error) {
    logger.error('Bootstrap failed', error);
    await shutdown();
    process.exit(1);
  }
}

/**
 * Check if master_key.json should be deleted based on peer count
 */
function checkMasterKeyDeletion() {
  const peers = network.getActivePeers();
  const peerCount = peers.length;
  
  // Check if we have the master key (only genesis creator has this)
  const masterKey = genesis.getMasterKeyPair();
  
  if (masterKey && peerCount >= 1) {
    logger.warn('==================== SECURITY NOTICE ====================');
    logger.warn(`Network has ${peerCount + 1} total peers (including this node)`);
    logger.warn('master_key.json should now be DELETED for security');
    logger.warn('The chain ID and genesis are already persisted in the blockchain');
    logger.warn('Command: rm master_key.json');
    logger.warn('========================================================');
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
  } else if (req.method === 'POST' && path === '/api/keyregister') {
    await handleKeyRegister(req, res);
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
  
  if (!body.data || !body.registrarPrivateKey || !body.signatures || !body.parentKeys) {
    sendJSON(res, 400, { error: 'Missing required fields: data, registrarPrivateKey, signatures (array), parentKeys' });
    return;
  }
  
  // Validate signatures is an array
  if (!Array.isArray(body.signatures)) {
    sendJSON(res, 400, { error: 'signatures must be an array' });
    return;
  }
  
  // Validate parent keys (at least one parent required, both preferred)
  if (!Array.isArray(body.parentKeys) || body.parentKeys.length === 0) {
    sendJSON(res, 400, { 
      error: 'At least one parent key required',
      message: 'Provide array of parent keys (both parents preferred)'
    });
    return;
  }
  
  // Get required number of signatures from config
  const consensusConfig = config.getConsensusConfig();
  const requiredSigs = consensusConfig.requiredSignatures.registration;
  
  // Check if we have enough signatures (signatures must be from other registrars, not the submitter)
  if (body.signatures.length < requiredSigs) {
    sendJSON(res, 403, { 
      error: `Insufficient signatures. Required: ${requiredSigs}, provided: ${body.signatures.length}`
    });
    return;
  }
  
  // Verify the submitting registrar is authorized
  let submittingRegistrarPubKey;
  try {
    submittingRegistrarPubKey = crypto.derivePublicKeyFromPrivate(body.registrarPrivateKey);
  } catch (error) {
    sendJSON(res, 400, { error: 'Invalid registrar private key format' });
    return;
  }
  
  if (!consensusConfig.KeyRegistry || !consensusConfig.KeyRegistry.includes(submittingRegistrarPubKey)) {
    sendJSON(res, 403, { error: `Submitting registrar not authorized: ${submittingRegistrarPubKey}` });
    return;
  }
  
  // Message to verify signatures against (the data being registered)
  const message = JSON.stringify(body.data);
  const validatedRegistrars = new Set();
  
  // Verify signatures from other registrars (not the submitting one)
  for (const signature of body.signatures) {
    if (typeof signature !== 'string') {
      sendJSON(res, 400, { error: 'Each signature must be a base64 string' });
      return;
    }
    
    // Try to verify the signature against each registrar in KeyRegistry
    let signatureValid = false;
    let validRegistrar = null;
    
    for (const registrarPubKey of consensusConfig.KeyRegistry) {
      // Skip the submitting registrar - signatures must be from others
      if (registrarPubKey === submittingRegistrarPubKey) {
        continue;
      }
      
      // Skip if this registrar already signed
      if (validatedRegistrars.has(registrarPubKey)) {
        continue;
      }
      
      // Try to verify signature with this registrar's public key
      const isValid = crypto.verifyEd25519(message, signature, registrarPubKey);
      if (isValid) {
        signatureValid = true;
        validRegistrar = registrarPubKey;
        break;
      }
    }
    
    if (!signatureValid) {
      sendJSON(res, 401, { error: 'Invalid signature or signature from unauthorized/duplicate/submitting registrar' });
      return;
    }
    
    validatedRegistrars.add(validRegistrar);
  }
  
  // Generate keypair for newborn
  const ownerKeyPair = await crypto.generateEd25519KeyPair();
  
  // Generate encryption key
  const encryptionKey = await crypto.generateAES256Key();
  
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
  
  logger.info('New identity registered', { hash: newBlock.hash, parents: body.parentKeys.length, registrars: validatedRegistrars.size });
  
  sendJSON(res, 201, { 
    success: true,
    blockHash: newBlock.hash,
    ownerPublicKey: ownerKeyPair.publicKey,
    ownerPrivateKey: ownerKeyPair.privateKey,
    encryptionKey: encryptionKey.toString('base64')
  });
}

/**
 * Handle POST /api/keyregister
 * Register a new authorized registrar
 */
async function handleKeyRegister(req, res) {
  const body = await readBody(req);
  
  if (!body.newRegistrarPrivateKey || !body.signatures) {
    sendJSON(res, 400, { 
      error: 'Missing required fields: newRegistrarPrivateKey, signatures (array)' 
    });
    return;
  }
  
  // Validate signatures is an array
  if (!Array.isArray(body.signatures)) {
    sendJSON(res, 400, { error: 'signatures must be an array' });
    return;
  }
  
  // Get required number of signatures from config
  const consensusConfig = config.getConsensusConfig();
  const requiredSigs = consensusConfig.requiredSignatures.keyregistration || 3;
  
  if (body.signatures.length < requiredSigs) {
    sendJSON(res, 403, { 
      error: `Insufficient signatures. Required: ${requiredSigs}, provided: ${body.signatures.length}`
    });
    return;
  }
  
  // Derive public key from new registrar's private key
  let newRegistrarPublicKey;
  try {
    newRegistrarPublicKey = crypto.derivePublicKeyFromPrivate(body.newRegistrarPrivateKey);
  } catch (error) {
    sendJSON(res, 400, { error: 'Invalid private key format' });
    return;
  }
  
  // Check if registrar already exists
  if (consensusConfig.KeyRegistry && consensusConfig.KeyRegistry.includes(newRegistrarPublicKey)) {
    sendJSON(res, 400, { error: 'Registrar already exists in KeyRegistry' });
    return;
  }
  
  // Message to verify signatures against (the new registrar's public key)
  const message = newRegistrarPublicKey;
  const validatedRegistrars = new Set();
  
  // Verify signatures from existing registrars
  for (const signature of body.signatures) {
    if (typeof signature !== 'string') {
      sendJSON(res, 400, { error: 'Each signature must be a base64 string' });
      return;
    }
    
    // Try to verify the signature against each registrar in KeyRegistry
    let signatureValid = false;
    let validRegistrar = null;
    
    for (const registrarPubKey of consensusConfig.KeyRegistry) {
      // Skip if this registrar already signed
      if (validatedRegistrars.has(registrarPubKey)) {
        continue;
      }
      
      // Try to verify signature with this registrar's public key
      const isValid = crypto.verifyEd25519(message, signature, registrarPubKey);
      if (isValid) {
        signatureValid = true;
        validRegistrar = registrarPubKey;
        break;
      }
    }
    
    if (!signatureValid) {
      sendJSON(res, 401, { error: 'Invalid signature or signature from unauthorized/duplicate registrar' });
      return;
    }
    
    validatedRegistrars.add(validRegistrar);
  }
  
  // Add new registrar to KeyRegistry (update config.json)
  // Note: This requires updating the config file, which is not typical for runtime changes
  // For now, we'll return success but note that manual config update is needed
  logger.info('New registrar approved', { 
    publicKey: newRegistrarPublicKey.substring(0, 50) + '...',
    approvedBy: validatedRegistrars.size 
  });
  
  sendJSON(res, 201, { 
    success: true,
    registrarPublicKey: newRegistrarPublicKey,
    message: 'New registrar approved. Add this public key to config.json KeyRegistry to complete registration.',
    approvedBy: Array.from(validatedRegistrars).map(pk => pk.substring(0, 20) + '...')
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
  
  // Validate conditions is an array
  if (!Array.isArray(body.conditions) || body.conditions.length === 0) {
    sendJSON(res, 400, { error: 'conditions must be a non-empty array' });
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
  
  // Use verifyMultipleConditions which checks all permissions first
  const verificationResult = verification.verifyMultipleConditions(
    targetBlock,
    body.tokenId,
    body.conditions,
    encryptionKey
  );
  
  // If unauthorized fields detected, return early with 403
  if (verificationResult.unauthorizedFields) {
    sendJSON(res, 403, { 
      success: false,
      error: verificationResult.error,
      unauthorizedFields: verificationResult.unauthorizedFields
    });
    return;
  }
  
  // Update block with decremented token (only once for all conditions)
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
  
  // Enforce max value of 5 for maxUses
  if (body.maxUses > 5 || body.maxUses < 1) {
    sendJSON(res, 400, { 
      error: 'Invalid maxUses value',
      message: 'maxUses must be between 1 and 5'
    });
    return;
  }
  
  // Find block
  const targetBlock = chain.findBlockByHash(body.blockHash);
  if (!targetBlock) {
    sendJSON(res, 404, { error: 'Block not found' });
    return;
  }
  
  // Issue token (returns {id, token})
  const { id: tokenId, token: tokenData } = await token.issueToken(
    body.ownerPrivateKey,
    body.permissions,
    body.maxUses
  );
  
  // Add token to block (tokenId as parent key, tokenData without id)
  token.addToken(targetBlock.tokens, tokenId, tokenData);
  
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
  
  if (!body.blockHash || !body.newData || !body.encryptionKey || !body.ownerPrivateKey || !body.registrarPrivateKey || !body.signatures) {
    sendJSON(res, 400, { error: 'Missing required fields: blockHash, newData, encryptionKey, ownerPrivateKey, registrarPrivateKey, signatures' });
    return;
  }
  
  // Validate signatures is an array
  if (!Array.isArray(body.signatures)) {
    sendJSON(res, 400, { error: 'signatures must be an array' });
    return;
  }
  
  // Get required number of signatures from config
  const consensusConfig = config.getConsensusConfig();
  const requiredSigs = consensusConfig.requiredSignatures.update;
  
  // Check if we have enough signatures (signatures must be from other registrars, not the submitter)
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
  
  // Verify the submitting registrar is authorized
  let submittingRegistrarPubKey;
  try {
    submittingRegistrarPubKey = crypto.derivePublicKeyFromPrivate(body.registrarPrivateKey);
  } catch (error) {
    sendJSON(res, 400, { error: 'Invalid registrar private key format' });
    return;
  }
  
  if (!consensusConfig.KeyRegistry || !consensusConfig.KeyRegistry.includes(submittingRegistrarPubKey)) {
    sendJSON(res, 403, { error: `Submitting registrar not authorized: ${submittingRegistrarPubKey}` });
    return;
  }
  
  // Message to verify signatures against (the newData being updated)
  const message = JSON.stringify(body.newData);
  const validatedRegistrars = new Set();
  
  // Verify signatures from other registrars (not the submitting one)
  for (const signature of body.signatures) {
    if (typeof signature !== 'string') {
      sendJSON(res, 400, { error: 'Each signature must be a base64 string' });
      return;
    }
    
    // Try to verify the signature against each registrar in KeyRegistry
    let signatureValid = false;
    let validRegistrar = null;
    
    for (const registrarPubKey of consensusConfig.KeyRegistry) {
      // Skip the submitting registrar - signatures must be from others
      if (registrarPubKey === submittingRegistrarPubKey) {
        continue;
      }
      
      // Skip if this registrar already signed
      if (validatedRegistrars.has(registrarPubKey)) {
        continue;
      }
      
      // Try to verify signature with this registrar's public key
      const isValid = crypto.verifyEd25519(message, signature, registrarPubKey);
      if (isValid) {
        signatureValid = true;
        validRegistrar = registrarPubKey;
        break;
      }
    }
    
    if (!signatureValid) {
      sendJSON(res, 401, { error: 'Invalid signature or signature from unauthorized/duplicate/submitting registrar' });
      return;
    }
    
    validatedRegistrars.add(validRegistrar);
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
  
  logger.info('Block updated', { 
    hash: targetBlock.hash,
    registrars: validatedRegistrars.size 
  });
  
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
  
  // Find block
  const targetBlock = chain.findBlockByHash(body.blockHash);
  if (!targetBlock) {
    sendJSON(res, 404, { error: 'Block not found' });
    return;
  }
  
  // Decode old encryption key
  const oldKey = Buffer.from(body.oldEncryptionKey, 'base64');
  
  // Verify old private key matches current owner
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
  
  // Calculate new public key from new private key
  let newPublicKey;
  try {
    newPublicKey = crypto.derivePublicKeyFromPrivate(body.newPrivateKey);
  } catch (error) {
    sendJSON(res, 400, { error: 'Invalid new private key format' });
    return;
  }
  
  // Calculate new lifecycle stage based on rotation count
  const currentStage = targetBlock.metadata.lifecycleStage;
  const rotationsLeft = targetBlock.metadata.rotationsLeft;
  const totalRotations = config.getIdentityConfig().maxKeyRotations;
  const rotationCount = totalRotations - rotationsLeft;
  
  let newStage = currentStage;
  
  // Determine new stage based on rotation count
  // rotation 0: genesis (initial state)
  // rotation 1: guardian (first rotation, ~age 5)
  // rotation 2: self (second rotation, ~age 18)
  // rotations 3-4: self (additional rotations while alive)
  // rotation 5: would be expired/death
  if (rotationCount === 0) {
    newStage = 'guardian'; // genesis → guardian
  } else if (rotationCount === 1) {
    newStage = 'self'; // guardian → self
  } else if (rotationCount >= 2) {
    newStage = 'self'; // self → self (subsequent rotations)
  }
  
  // Generate new encryption key
  const newKey = await crypto.generateAES256Key();
  
  // Rotate
  block.rotateBlockKey(
    targetBlock,
    oldKey,
    newKey,
    newPublicKey,
    body.newPrivateKey,
    newStage
  );
  
  // Update in chain
  chain.updateBlockInChain(body.blockHash, targetBlock);
  
  // Save and broadcast
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
    // Stop network
    network.stopNetwork();
    
    // Save final snapshot
    await storage.saveSnapshot();
    
    // Stop automatic snapshots
    storage.stopAutoSnapshot();
    
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
