import net from 'net';
import * as logger from './logger.mjs';
import * as genesis from './genesis.mjs';
import * as chain from './chain.mjs';
import { getCurrentTimestamp } from './utils.mjs';

export function createHandshakeMessage(peerId) {
  const genesisBlock = genesis.getGenesisBlock();
  const metadata = chain.getChainMetadata();
  return {
    type: 'HANDSHAKE',
    peerId,
    chainId: genesisBlock?.chainId || null,
    chainLength: metadata.length+1,
    chainHash: metadata.chainHash,
    chainSignature: metadata.chainSignature,
    masterPubKey: metadata.masterPubKey,
    lastUpdated: metadata.lastUpdated,
    timestamp: getCurrentTimestamp()
  };
}

export async function sendHandshake(peerAddress, peerId) {
  return new Promise((resolve, reject) => {
    const [host, port] = peerAddress.split(':');
    const client = new net.Socket();
    let responseData = '';
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Handshake timeout'));
    }, 5000);
    client.connect(parseInt(port), host, () => {
      const message = createHandshakeMessage(peerId);
      client.write(JSON.stringify(message) + '\n');
    });
    client.on('data', (data) => {
      responseData += data.toString();
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

export function handleHandshake(message, peerId) {
  if (message.type !== 'HANDSHAKE') {
    throw new Error('Invalid message type');
  }
  logger.debug('Handshake received', { 
    from: message.peerId,
    chainLength: message.chainLength 
  });
  const response = createHandshakeMessage(peerId);
  response.type = 'HANDSHAKE_RESPONSE';
  return response;
}

export function validateHandshakeResponse(response) {
  if (!response) {
    return { valid: false, reason: 'No response received' };
  }
  if (response.type !== 'HANDSHAKE_RESPONSE') {
    return { valid: false, reason: 'Invalid response type' };
  }
  const genesisBlock = genesis.getGenesisBlock();
  if (response.chainId && genesisBlock && response.chainId !== genesisBlock.chainId) {
    return { valid: false, reason: 'Different chain ID' };
  }
  const metadata = chain.getChainMetadata();
  // const needsSync = (
  //   response.chainLength > metadata.length ||
  //   (response.chainLength === metadata.length && 
  //    response.lastUpdated > metadata.lastUpdated)
  // );
  const needsSync = (response.chainLength > metadata.length || true);
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

export async function performHandshake(peerAddress, peerId) {
  try {
    logger.debug('Performing handshake', { peer: peerAddress });
    const response = await sendHandshake(peerAddress, peerId);
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

export async function handshakeWithPeers(peerAddresses, peerId) {
  logger.info('Initiating handshakes', { count: peerAddresses.length });
  const promises = peerAddresses.map(address => 
    performHandshake(address, peerId)
  );
  const results = await Promise.allSettled(promises);
  const successfulHandshakes = results
    .filter(r => r.status === 'fulfilled' && r.value.success)
    .map(r => r.value);
  logger.info('Handshakes completed', { 
    total: peerAddresses.length,
    successful: successfulHandshakes.length
  });
  return successfulHandshakes;
}

export default {
  createHandshakeMessage,
  sendHandshake,
  handleHandshake,
  validateHandshakeResponse,
  performHandshake,
  handshakeWithPeers
};
