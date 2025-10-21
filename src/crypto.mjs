import crypto from 'crypto';
import { promisify } from 'util';
import { nanoid } from 'nanoid';

const generateKeyPair = promisify(crypto.generateKeyPair);
const randomBytes = promisify(crypto.randomBytes);

/**
 * Hash data using SHA-512
 * @param {string|Buffer} data - Data to hash
 * @returns {string} Hex encoded hash
 */
export function sha512(data) {
  return crypto.createHash('sha512').update(data).digest('hex');
}

/**
 * Generate Ed25519 keypair
 * @returns {Promise<{publicKey: string, privateKey: string}>}
 */
export async function generateEd25519KeyPair() {
  const { publicKey, privateKey } = await generateKeyPair('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return { publicKey, privateKey };
}

/**
 * Derive public key from Ed25519 private key
 * @param {string} privateKey - PEM formatted private key
 * @returns {string} PEM formatted public key
 */
export function derivePublicKeyFromPrivate(privateKey) {
  const keyObject = crypto.createPrivateKey(privateKey);
  const publicKey = crypto.createPublicKey(keyObject);
  return publicKey.export({ type: 'spki', format: 'pem' });
}

/**
 * Sign data with Ed25519 private key
 * @param {string|Buffer} data - Data to sign
 * @param {string} privateKey - PEM formatted private key
 * @returns {string} Base64 encoded signature
 */
export function signEd25519(data, privateKey) {
  const signature = crypto.sign(null, Buffer.from(data), privateKey);
  return signature.toString('base64');
}

/**
 * Verify Ed25519 signature
 * @param {string|Buffer} data - Original data
 * @param {string} signature - Base64 encoded signature
 * @param {string} publicKey - PEM formatted public key
 * @returns {boolean} True if signature is valid
 */
export function verifyEd25519(data, signature, publicKey) {
  try {
    return crypto.verify(
      null,
      Buffer.from(data),
      publicKey,
      Buffer.from(signature, 'base64')
    );
  } catch (error) {
    return false;
  }
}

/**
 * Encrypt data using AES-256-GCM
 * @param {string|Buffer} data - Data to encrypt
 * @param {Buffer} key - 32 byte encryption key
 * @returns {{encrypted: string, iv: string, authTag: string}}
 */
export function encryptAES256GCM(data, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(typeof data === 'string' ? data : data.toString(), 'utf8'),
    cipher.final()
  ]);
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64')
  };
}

/**
 * Decrypt data using AES-256-GCM
 * @param {string} encrypted - Base64 encoded encrypted data
 * @param {Buffer} key - 32 byte encryption key
 * @param {string} iv - Base64 encoded IV
 * @param {string} authTag - Base64 encoded auth tag
 * @returns {string} Decrypted data
 */
export function decryptAES256GCM(encrypted, key, iv, authTag) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64')
  );
  
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final()
  ]);
  
  return decrypted.toString('utf8');
}

/**
 * Generate a random AES-256 key
 * @returns {Promise<Buffer>} 32 byte key
 */
export async function generateAES256Key() {
  return await randomBytes(32);
}

/**
 * Derive a key from a password using PBKDF2
 * @param {string} password - Password to derive from
 * @param {string} salt - Salt (should be unique per user)
 * @returns {Promise<Buffer>} 32 byte derived key
 */
export async function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 32, 'sha512', (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Encrypt each field separately in a data object
 * @param {Object} data - Object with fields to encrypt
 * @param {Buffer} key - Encryption key
 * @returns {Object} Object with encrypted fields
 */
export function encryptFields(data, key) {
  const encrypted = {};
  for (const [field, value] of Object.entries(data)) {
    if (value !== null && value !== undefined && value !== '') {
      encrypted[field] = encryptAES256GCM(JSON.stringify(value), key);
    }
  }
  return encrypted;
}

/**
 * Decrypt specific fields from encrypted data
 * @param {Object} encryptedData - Object with encrypted fields
 * @param {Buffer} key - Decryption key
 * @param {string[]} fields - Fields to decrypt
 * @returns {Object} Object with decrypted fields
 */
export function decryptFields(encryptedData, key, fields) {
  const decrypted = {};
  for (const field of fields) {
    if (encryptedData[field]) {
      const { encrypted, iv, authTag } = encryptedData[field];
      const decryptedValue = decryptAES256GCM(encrypted, key, iv, authTag);
      decrypted[field] = JSON.parse(decryptedValue);
    }
  }
  return decrypted;
}

/**
 * Generate random token ID using nanoid
 * @param {number} length - Length of token (default 21, nanoid standard)
 * @returns {string} Random token ID
 */
export function generateTokenId(length = 21) {
  return nanoid(length);
}
