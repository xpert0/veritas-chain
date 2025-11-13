import net from 'net';
import * as logger from './logger.mjs';
import * as genesis from './genesis.mjs';
import * as chain from './chain.mjs';
import { getCurrentTimestamp } from './utils.mjs';

/**
 * Create handshake message
 * @param {string} peerId - This peer's ID
 * @param {number} p2pPort - This peer's P2P port
 * @returns {Object} Handshake message
 */
export function createHandshakeMessage(peerId, p2pPort = null) {
  const genesisBlock = genesis.getGenesisBlock();
  const metadata = chain.getChainMetadata();
  
  return {
    type: 'HANDSHAKE',
    peerId,
    p2pPort,
    chainId: genesisBlock?.chainId || null,
    chainLength: metadata.length,
    chainHash: metadata.chainHash,
    chainSignature: metadata.chainSignature,
    masterPubKey: metadata.masterPubKey,
    lastUpdated: metadata.lastUpdated,
    timestamp: getCurrentTimestamp()
  };
}

/**
 * Send handshake to peer
 * @param {string} peerAddress - Peer address (ip:port)
 * @param {string} peerId - This peer's ID
 * @param {number} p2pPort - This peer's P2P port
 * @returns {Promise<Object>} Handshake response
 */
export async function sendHandshake(peerAddress, peerId, p2pPort = null) {
  return new Promise((resolve, reject) => {
    const [host, port] = peerAddress.split(':');
    const client = new net.Socket();
    
    let responseData = '';
    
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Handshake timeout'));
    }, 5000);
    
    client.connect(parseInt(port), host, () => {
      const message = createHandshakeMessage(peerId, p2pPort);
      client.write(JSON.stringify(message) + '\n');
    });
    
    client.on('data', (data) => {
      responseData += data.toString();
      
      // Check if we have a complete JSON message
      if (responseData.includes('\n')) {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(responseData.trim());
          client.destroy();
          resolve(response);
        } catch (error) {
          client.destroy();
          reject(new Error('Invalid handshake response'));
        }
      }
    });
    
    client.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    
    client.on('close', () => {
      clearTimeout(timeout);
      if (responseData === '') {
        reject(new Error('Connection closed without response'));
      }
    });
  });
}

/**
 * Handle incoming handshake
 * @param {Object} message - Handshake message
 * @param {string} peerId - This peer's ID
 * @param {number} p2pPort - This peer's P2P port
 * @returns {Object} Handshake response
 */
export function handleHandshake(message, peerId, p2pPort = null) {
  if (message.type !== 'HANDSHAKE') {
    throw new Error('Invalid message type');
  }
  
  logger.debug('Handshake received', { 
    from: message.peerId,
    chainLength: message.chainLength 
  });
  
  // Create response with our chain info
  const response = createHandshakeMessage(peerId, p2pPort);
  response.type = 'HANDSHAKE_RESPONSE';
  
  return response;
}

/**
 * Validate handshake response
 * @param {Object} response - Handshake response
 * @returns {{valid: boolean, reason?: string, needsSync?: boolean}}
 */
export function validateHandshakeResponse(response) {
  if (!response) {
    return { valid: false, reason: 'No response received' };
  }
  
  if (response.type !== 'HANDSHAKE_RESPONSE') {
    return { valid: false, reason: 'Invalid response type' };
  }
  
  const genesisBlock = genesis.getGenesisBlock();
  
  // Check if same chain
  if (response.chainId && genesisBlock && response.chainId !== genesisBlock.chainId) {
    return { valid: false, reason: 'Different chain ID' };
  }
  
  // Check if peer has longer/newer chain
  const metadata = chain.getChainMetadata();
  const needsSync = (
    response.chainLength > metadata.length ||
    (response.chainLength === metadata.length && 
     response.lastUpdated > metadata.lastUpdated)
  );
  
  // Verify chain authenticity if peer has data
  if (response.chainHash && response.chainSignature && response.masterPubKey) {
    const isAuthentic = chain.verifyChainAuthenticity(
      response.chainHash,
      response.chainSignature,
      response.masterPubKey
    );
    
    if (!isAuthentic) {
      return { valid: false, reason: 'Invalid chain signature' };
    }
  }
  
  return { 
    valid: true, 
    needsSync,
    peerChainLength: response.chainLength,
    peerLastUpdated: response.lastUpdated
  };
}

/**
 * Perform handshake with peer
 * @param {string} peerAddress - Peer address
 * @param {string} peerId - This peer's ID
 * @param {number} p2pPort - This peer's P2P port
 * @returns {Promise<{success: boolean, response?: Object, needsSync?: boolean, reason?: string}>}
 */
export async function performHandshake(peerAddress, peerId, p2pPort = null) {
  try {
    logger.debug('Performing handshake', { peer: peerAddress });
    
    const response = await sendHandshake(peerAddress, peerId, p2pPort);
    const validation = validateHandshakeResponse(response);
    
    if (!validation.valid) {
      logger.warn('Handshake validation failed', { 
        peer: peerAddress,
        reason: validation.reason 
      });
      return { 
        success: false, 
        reason: validation.reason 
      };
    }
    
    logger.info('Handshake successful', { 
      peer: peerAddress,
      needsSync: validation.needsSync
    });
    
    return {
      success: true,
      response,
      needsSync: validation.needsSync,
      peerChainLength: validation.peerChainLength,
      peerLastUpdated: validation.peerLastUpdated
    };
  } catch (error) {
    logger.warn('Handshake failed', { 
      peer: peerAddress,
      error: error.message 
    });
    return { 
      success: false, 
      reason: error.message 
    };
  }
}

/**
 * Handshake with multiple peers
 * @param {string[]} peerAddresses - Array of peer addresses
 * @param {string} peerId - This peer's ID
 * @param {number} p2pPort - This peer's P2P port
 * @returns {Promise<Object[]>} Array of handshake results
 */
export async function handshakeWithPeers(peerAddresses, peerId, p2pPort = null) {
  logger.info('Initiating handshakes', { count: peerAddresses.length });
  
  const promises = peerAddresses.map(address => 
    performHandshake(address, peerId, p2pPort)
  );
  
  const results = await Promise.allSettled(promises);
  
  const handshakeResults = results.map(r => {
    if (r.status === 'fulfilled' && r.value.success) {
      return r.value;
    }
    return { success: false, reason: r.reason || 'Unknown error' };
  });
  
  const successCount = handshakeResults.filter(r => r.success).length;
  
  logger.info('Handshakes completed', { 
    total: peerAddresses.length,
    successful: successCount
  });
  
  return handshakeResults;
}

export default {
  createHandshakeMessage,
  sendHandshake,
  handleHandshake,
  validateHandshakeResponse,
  performHandshake,
  handshakeWithPeers
};
