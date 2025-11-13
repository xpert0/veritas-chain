# Signature Validation System

This document describes the cryptographic signature validation system implemented in Veritas-Chain.

## Overview

The signature validation system ensures that all sensitive operations (identity registration, updates) are authorized by multiple registered authorities. This prevents unauthorized modifications and provides a secure, decentralized governance model.

**Key Principle**: Signatures are of the actual data being submitted, making them specific to each operation and preventing replay attacks by design.

## Security Model

### Why No Signature Storage?

Unlike traditional approaches that store used signatures, this implementation prevents replay attacks through a more elegant method:

- **Data-Specific Signatures**: Each signature is of the actual data being registered/updated
- **Unique Data**: Since each registration/update has different data, signatures are inherently unique
- **Cryptographic Binding**: A signature for one data object cannot be used for another

This approach is cryptographically sound and eliminates the need for signature tracking infrastructure.

## Generating Keypairs and Signatures

### 1. Generate Ed25519 Keypair

```javascript
import crypto from 'crypto';
import { promisify } from 'util';

const generateKeyPair = promisify(crypto.generateKeyPair);

// Generate a new Ed25519 keypair
const { publicKey, privateKey } = await generateKeyPair('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

console.log('Public Key:\n', publicKey);
console.log('Private Key:\n', privateKey);
```

### 2. Sign Data

```javascript
import crypto from 'crypto';

// Data to sign (must be a string)
const data = JSON.stringify({
  name: "John Doe",
  dob: "1990-05-15",
  address: "123 Main St",
  bloodGroup: "O+"
});

// Sign with Ed25519 private key
const signature = crypto.sign(null, Buffer.from(data), privateKey);
const signatureBase64 = signature.toString('base64');

console.log('Signature:', signatureBase64);
```

### 3. Verify Signature

```javascript
import crypto from 'crypto';

// Verify signature
const isValid = crypto.verify(
  null,
  Buffer.from(data),
  publicKey,
  Buffer.from(signatureBase64, 'base64')
);

console.log('Signature valid:', isValid);
```

## API Endpoints

### POST /api/register

Registers a new identity block on the chain.

**Request Format:**
```json
{
  "data": {
    "name": "John Doe",
    "dob": "1990-05-15",
    "address": "123 Main St",
    "bloodGroup": "O+"
  },
  "registrarPrivateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "signatures": [
    "base64-encoded-signature-1",
    "base64-encoded-signature-2"
  ],
  "parentKeys": [
    "-----BEGIN PRIVATE KEY-----\nparent1-private-key\n-----END PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----\nparent2-private-key\n-----END PRIVATE KEY-----"
  ]
}
```

**How It Works:**
1. One registrar provides their private key (automatically counted as 1 signature)
2. Additional registrars sign the `data` object and provide their signatures
3. Each signature in the `signatures` array must be a signature of `JSON.stringify(data)`
4. Total signatures = 1 (from registrarPrivateKey) + signatures.length
5. Must meet the requirement in `config.json` → `consensus.requiredSignatures.registration`

**Example Workflow:**
```javascript
// Registrar 1 (submitting the request)
const registrar1PrivateKey = "-----BEGIN PRIVATE KEY-----\n...";

// Registrar 2 creates a signature
const data = { name: "John Doe", dob: "1990-05-15", ... };
const dataString = JSON.stringify(data);
const sig2 = crypto.sign(null, Buffer.from(dataString), registrar2PrivateKey);
const signature2 = sig2.toString('base64');

// Registrar 3 creates a signature
const sig3 = crypto.sign(null, Buffer.from(dataString), registrar3PrivateKey);
const signature3 = sig3.toString('base64');

// Submit registration
const request = {
  data: data,
  registrarPrivateKey: registrar1PrivateKey,
  signatures: [signature2, signature3],
  parentKeys: [parent1PrivateKey, parent2PrivateKey]
};
```

**Validation:**
1. Total signatures must meet configured requirement (default: 2)
2. Each signature must be from an authorized registrar (in KeyRegistry)
3. Signatures are verified against the exact `data` being submitted
4. At least one parent private key must be provided
5. No duplicate registrar signatures allowed

### POST /api/update

Updates an existing identity block.

**Request Format:**
```json
{
  "blockHash": "block-hash-to-update",
  "newData": {
    "address": "456 New Street"
  },
  "encryptionKey": "base64-encoded-encryption-key",
  "ownerPrivateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "registrarPrivateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "signatures": [
    "base64-encoded-signature-1",
    "base64-encoded-signature-2"
  ]
}
```

**How It Works:**
1. One registrar provides their private key (automatically counted as 1 signature)
2. Additional registrars sign the `newData` object and provide their signatures
3. Each signature in the `signatures` array must be a signature of `JSON.stringify(newData)`
4. Total signatures = 1 (from registrarPrivateKey) + signatures.length
5. Must meet the requirement in `config.json` → `consensus.requiredSignatures.update`

**Example Workflow:**
```javascript
// Registrar 1 (submitting the request)
const registrar1PrivateKey = "-----BEGIN PRIVATE KEY-----\n...";

// Registrar 2 creates a signature of newData
const newData = { address: "456 New Street" };
const newDataString = JSON.stringify(newData);
const sig2 = crypto.sign(null, Buffer.from(newDataString), registrar2PrivateKey);
const signature2 = sig2.toString('base64');

// Registrar 3 creates a signature
const sig3 = crypto.sign(null, Buffer.from(newDataString), registrar3PrivateKey);
const signature3 = sig3.toString('base64');

// Registrar 4 creates a signature
const sig4 = crypto.sign(null, Buffer.from(newDataString), registrar4PrivateKey);
const signature4 = sig4.toString('base64');

// Submit update
const request = {
  blockHash: "abc123...",
  newData: newData,
  encryptionKey: "base64-key",
  ownerPrivateKey: ownerPrivateKey,
  registrarPrivateKey: registrar1PrivateKey,
  signatures: [signature2, signature3, signature4]
};
```

**Validation:**
1. Total signatures must meet configured requirement (default: 3 for updates)
2. Each signature must be from an authorized registrar
3. Signatures are verified against the exact `newData` being submitted
4. Owner must provide valid private key matching the block
5. No duplicate registrar signatures allowed

## Configuration

The `config.json` file specifies signature requirements:

```json
{
  "consensus": {
    "KeyRegistry": [
      "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
    ],
    "requiredSignatures": {
      "registration": 2,
      "update": 3
    }
  }
}
```

- `registration`: Total number of registrar signatures required to register new identity
- `update`: Total number of registrar signatures required to update identity data

**Note**: The total includes the one submitting (via `registrarPrivateKey`) plus additional signatures.

## Security Features

### 1. Data-Specific Signatures

**Problem Prevented:** Signature replay attacks

**Solution:**
- Each signature is of the specific data being registered/updated
- A signature for registration data A cannot be used for registration data B
- A signature for update X cannot be used for update Y
- No need to track used signatures

### 2. Multi-Signature Consensus

**Problem Prevented:** Single point of failure, rogue registrar

**Solution:**
- Operations require approval from multiple authorized registrars
- Configurable threshold (2 for registration, 3 for updates by default)
- No single registrar can act alone

### 3. Cryptographic Verification

Each request is validated:
1. Extract public key from the provided registrar private key
2. Verify the registrar is in the authorized KeyRegistry
3. For each additional signature:
   - Try to verify against all KeyRegistry public keys
   - Match signature to its registrar
   - Ensure no duplicate registrars
4. All signatures must cryptographically verify against the exact data

### 4. Parent Key Validation

For identity registration:
- At least one parent private key required (both preferred)
- Ensures genetic lineage tracking
- Prevents orphan identities

## Complete Example

### Registering a New Identity

```javascript
import crypto from 'crypto';
import http from 'http';

// Step 1: Prepare the identity data
const identityData = {
  name: "Alice Smith",
  dob: "2020-01-15",
  address: "123 Hospital Road",
  bloodGroup: "A+",
  fatherName: "Bob Smith",
  motherName: "Carol Smith"
};

const dataString = JSON.stringify(identityData);

// Step 2: Registrar 1 has their private key
const registrar1PrivateKey = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----";

// Step 3: Registrar 2 signs the data
const registrar2PrivateKey = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----";
const sig2 = crypto.sign(null, Buffer.from(dataString), registrar2PrivateKey);
const signature2 = sig2.toString('base64');

// Step 4: Parent keys
const fatherPrivateKey = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----";
const motherPrivateKey = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----";

// Step 5: Make the API request
const requestData = JSON.stringify({
  data: identityData,
  registrarPrivateKey: registrar1PrivateKey,
  signatures: [signature2],
  parentKeys: [fatherPrivateKey, motherPrivateKey]
});

const options = {
  hostname: 'localhost',
  port: 8081,
  path: '/api/register',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': requestData.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    const response = JSON.parse(body);
    console.log('Registration response:', response);
    // Response includes: blockHash, ownerPublicKey, ownerPrivateKey, encryptionKey
  });
});

req.write(requestData);
req.end();
```

### Updating an Identity

```javascript
import crypto from 'crypto';
import http from 'http';

// Step 1: Prepare the update data
const updateData = {
  address: "456 New Home Lane"
};

const updateString = JSON.stringify(updateData);

// Step 2: Registrar 1 has their private key
const registrar1PrivateKey = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----";

// Step 3: Registrar 2 signs the newData
const registrar2PrivateKey = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----";
const sig2 = crypto.sign(null, Buffer.from(updateString), registrar2PrivateKey);
const signature2 = sig2.toString('base64');

// Step 4: Registrar 3 signs the newData
const registrar3PrivateKey = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----";
const sig3 = crypto.sign(null, Buffer.from(updateString), registrar3PrivateKey);
const signature3 = sig3.toString('base64');

// Step 5: Make the API request
const requestData = JSON.stringify({
  blockHash: "previous-block-hash",
  newData: updateData,
  encryptionKey: "base64-encryption-key",
  ownerPrivateKey: "owner-private-key",
  registrarPrivateKey: registrar1PrivateKey,
  signatures: [signature2, signature3]
});

const options = {
  hostname: 'localhost',
  port: 8081,
  path: '/api/update',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': requestData.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    const response = JSON.parse(body);
    console.log('Update response:', response);
    // Response includes: success, blockHash
  });
});

req.write(requestData);
req.end();
```

## Migration from Previous Version

### Old Format (Deprecated)
```json
{
  "data": {...},
  "registrarSignatures": [
    {"signature": "...", "registrarPrivateKey": "..."},
    {"signature": "...", "registrarPrivateKey": "..."}
  ],
  "parentKeys": [...]
}
```

### New Format (Current)
```json
{
  "data": {...},
  "registrarPrivateKey": "...",
  "signatures": ["...", "..."],
  "parentKeys": [...]
}
```

**Key Changes:**
1. One registrar provides private key directly
2. Other registrars provide only their signatures
3. Signatures are of the actual data, not arbitrary
4. No signature storage needed - replay prevention is inherent

## Summary

This implementation provides:
- ✅ **Replay Attack Prevention**: Data-specific signatures make replay impossible
- ✅ **Multi-Signature Security**: Requires consensus from multiple registrars
- ✅ **Simplified Architecture**: No signature tracking infrastructure needed
- ✅ **Cryptographic Soundness**: Based on Ed25519 digital signatures
- ✅ **Clear API**: Straightforward request/response format
- ✅ **Complete Examples**: Full code samples for integration

The system is production-ready and provides enterprise-grade security for decentralized identity management.

Updates an existing identity block.

**Request Format:**
```json
{
  "blockHash": "block-hash-to-update",
