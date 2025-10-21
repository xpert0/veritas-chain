# 🔗 Veritas-Chain

> **A Zero-Knowledge Identity Chain** — Decentralized, authenticated, privacy-preserving identity ledger with autonomous P2P consensus.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![ESM Only](https://img.shields.io/badge/module-ESM-yellow)](https://nodejs.org/api/esm.html)

---

## 🌟 Overview

**Veritas-Chain** is a blockchain implementation designed specifically for **decentralized identity management** with zero-knowledge verification capabilities. Built with vanilla ESM Node.js and zero external dependencies for core functionality, it provides:

- 🔐 **Zero-Knowledge Verification** — Prove conditions without revealing data
- 🪙 **Permission Tokens** — Fine-grained, field-level access control
- 🧬 **APoC Consensus** — Autonomous Proof of Continuity (no mining, no validators)
- 🌐 **Full P2P Mesh** — Automatic peer discovery and synchronization
- 🛡️ **Cryptographic Security** — Ed25519, AES-256-GCM, SHA-512
- 🔄 **Self-Healing** — Automatic sync and recovery from network partitions
- 📜 **Lifecycle Management** — From birth registration to key rotation to pruning

---

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [API Documentation](#-api-documentation)
- [Configuration](#-configuration)
- [Security](#-security)
- [Testing](#-testing)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

### Core Blockchain Features
- **Deterministic Consensus (APoC)** — No mining, no leader election
- **Master Key Authentication** — Chain authenticity verified via genesis master key
- **Block Integrity** — SHA-512 hashing with Ed25519 signatures
- **Immutable Genesis** — Root of trust anchored in genesis block

### Privacy & Security
- **Field-Level Encryption** — Each identity field encrypted separately (AES-256-GCM)
- **Zero-Knowledge Proofs** — Verify conditions without revealing data
- **Token-Based Permissions** — Cryptographically signed access tokens
- **Multi-Signature Support** — Configurable signature thresholds for operations
- **Master Key Concealment** — Encrypted and obfuscated storage with random injection

### Networking
- **Full P2P Mesh** — Every peer connects to every peer
- **CIDR Subnet Scanning** — Configurable local network discovery
- **DNS TXT Discovery** — Global peer discovery via DNS
- **Instant Propagation** — Real-time event broadcasting
- **Automatic Sync** — Self-healing from offline/partition scenarios
- **Cross-Platform** — Works on Linux, macOS, and Windows

### Identity Management
- **Lifecycle Stages** — Genesis → Guardian → Self → Expired
- **Key Rotation** — Up to 5 rotations with automatic stage transitions
- **Parent Key Validation** — Required parent keys for registration
- **Registrar Authorization** — Hot-checked against config.json KeyRegistry
- **Death Registration** — Multi-signature with grace period and pruning

---

## 🏗️ Architecture

### Consensus: APoC (Autonomous Proof of Continuity)

Veritas-Chain uses **APoC**, a unique consensus mechanism where:
- No mining or proof-of-work required
- State is purely deterministic based on validation rules
- All nodes apply identical logic and converge on the same chain
- Genesis master key ensures chain authenticity
- Longest valid authenticated chain wins

### Block Structure

```javascript
{
  hash: "SHA-512 hash",
  encryptedData: "Base64(AES-256-GCM encrypted JSON)",
  tokens: {
    "<tokenId>": {
      permissions: ["field1", "field2"],
      remainingUses: 5,
      issuedAt: 1234567890,
      signature: "Ed25519 signature"
    }
  },
  metadata: {
    createdAt: 1234567890,
    updatedAt: 1234567890,
    ownerPubKey: "Ed25519 public key",
    lifecycleStage: "genesis|guardian|self|expired",
    rotationsLeft: 5
  },
  prevHash: "previous block hash or null",
  signature: "Ed25519 block signature"
}
```

### Cryptography Stack

| Layer | Algorithm | Purpose |
|-------|-----------|---------|
| Hashing | SHA-512 | Block integrity, chain hash |
| Symmetric | AES-256-GCM | Field-level data encryption |
| Asymmetric | Ed25519 | Signatures, keypairs, master key |
| Token IDs | nanoid | Cryptographically secure URL-safe IDs |

---

## 📦 Installation

### Prerequisites

- **Node.js** >= 18.0.0 (ESM support required)
- **npm** or **yarn**

### Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/xpert0/veritas-chain.git
   cd veritas-chain
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure the node:**
   Edit `config.json` to set:
   - Network settings (ports, CIDR, DNS)
   - Consensus parameters (KeyRegistry)
   - Storage paths
   - Protocol parameters

4. **Create master key (first peer only):**
   ```bash
   cp master_key.json.example master_key.json
   # Edit master_key.json with your master keypair
   # Note: After network has 2+ peers, this file can be safely deleted
   ```

---

## 🚀 Quick Start

### Start the Node

```bash
node index.mjs
```

The node will:
1. Load or create genesis block
2. Discover peers (local subnet + DNS)
3. Sync with existing peers
4. Start HTTP API server (default: port 8081)
5. Begin P2P gossip

### Example: Register an Identity

**Linux/Mac:**
```bash
curl -X POST http://localhost:8081/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "name": "John Doe",
      "dob": "1990-05-15",
      "address": "123 Main St",
      "bloodGroup": "O+"
    },
    "registrarPrivateKey": "-----BEGIN PRIVATE KEY-----\n...",
    "parentKeys": ["parent1_pubkey", "parent2_pubkey"]
  }'
```

**Windows (PowerShell):**
```powershell
Invoke-RestMethod -Uri http://localhost:8081/api/register `
  -Method POST `
  -ContentType "application/json" `
  -Body '{
    "data": {
      "name": "John Doe",
      "dob": "1990-05-15"
    },
    "registrarPrivateKey": "...",
    "parentKeys": ["..."]
  }'
```

### Example: Zero-Knowledge Verification

```bash
curl -X POST http://localhost:8081/api/verify \
  -H "Content-Type: application/json" \
  -d '{
    "blockHash": "<block_hash>",
    "tokenId": "<token_id>",
    "conditions": [
      {"field": "dob", "condition": "<= 2007-10-20"},
      {"field": "bloodGroup", "condition": "== O+"}
    ],
    "encryptionKey": "<encryption_key>"
  }'
```

Response:
```json
{
  "success": true,
  "results": [
    {"field": "dob", "condition": "<= 2007-10-20", "result": true},
    {"field": "bloodGroup", "condition": "== O+", "result": true}
  ],
  "allPassed": true
}
```

---

## 📚 API Documentation

Complete API documentation with examples is available at:

```
http://localhost:8081/docs
```

### Quick Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chain` | GET | Get chain status and network info |
| `/api/register` | POST | Register new identity (requires registrar auth) |
| `/api/token` | POST | Issue permission token (max 5 uses) |
| `/api/verify` | POST | Zero-knowledge verification |
| `/api/update` | POST | Update identity data |
| `/api/rotate` | POST | Rotate encryption keys |

---

## ⚙️ Configuration

### config.json Structure

```json
{
  "network": {
    "port": 8081,
    "p2pPort": 9091,
    "cidr": "192.168.1.0/24",
    "dnsTxtRecord": "peer1.example.com, peer2.example.com"
  },
  "storage": {
    "path": "./zkic_chain_data",
    "snapshotIntervalSeconds": 300
  },
  "consensus": {
    "KeyRegistry": [
      "-----BEGIN PUBLIC KEY-----\n..."
    ]
  },
  "protocol": {
    "internalSegmentSize": 2,
    "internalOffsetBounds": 16
  }
}
```

### Key Configuration Options

- **network.cidr**: CIDR notation for local peer discovery (e.g., "10.0.0.0/8")
- **consensus.KeyRegistry**: Authorized registrar public keys
- **protocol.internalSegmentSize**: Master key concealment injection size (DO NOT MODIFY)
- **protocol.internalOffsetBounds**: Master key concealment interval (DO NOT MODIFY)

---

## 🔒 Security

### Threat Model

Veritas-Chain is designed to protect against:
- ✅ Unauthorized data access (field-level encryption)
- ✅ Chain forgery (master key signature)
- ✅ Data tampering (SHA-512 + Ed25519)
- ✅ Privacy leakage (zero-knowledge proofs)
- ✅ Sybil attacks (genesis key authorization)

### Security Features

1. **Master Key Concealment**
   - Encrypted with AES-256-GCM
   - Random character injection (configurable via protocol params)
   - Appears as random network handshake token
   - Different on each peer to prevent identification

2. **Field-Level Encryption**
   - Each identity field encrypted separately
   - Only authorized fields decrypted during verification
   - AES-256-GCM with authentication tags

3. **Multi-Signature Requirements**
   - Registration: Registrar + parent keys required
   - Updates: Configurable threshold
   - Death registration: Multiple genesis signers

4. **Token Security**
   - Ed25519 signed by owner
   - Max 5 uses enforced
   - Decremented atomically
   - Cannot be forged or reused beyond limit

---

## 🧪 Testing

### Run Test Suite

```bash
# Start the node first
node index.mjs &

# Run comprehensive tests
node test.mjs
```

### Test Coverage

The test suite covers:
- ✅ Chain status retrieval
- ✅ Identity registration (success & auth failures)
- ✅ Token issuance (success & invalid maxUses)
- ✅ Zero-knowledge verification (success & unauthorized fields)
- ✅ Multiple condition verification
- ✅ Identity updates
- ✅ Token usage tracking
- ✅ Key rotation
- ✅ Error cases (401, 403)

### Manual Testing

```bash
# Get chain status
curl http://localhost:8081/api/chain

# Health check
curl http://localhost:8081/health
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Use ESM syntax (import/export)
- Follow existing code style
- Add tests for new features
- Update documentation
- No external dependencies for core functionality

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Inspired by the principles of zero-knowledge cryptography
- Built on the foundation of blockchain decentralization
- Designed for real-world identity management needs

---

## 📞 Contact

- **Project Repository**: [github.com/xpert0/veritas-chain](https://github.com/xpert0/veritas-chain)
- **Issues**: [GitHub Issues](https://github.com/xpert0/veritas-chain/issues)

---

## 🗺️ Roadmap

- [ ] Post-quantum cryptography support
- [ ] Multi-region mesh deployment
- [ ] GraphQL API
- [ ] Block explorer UI
- [ ] Mobile SDK
- [ ] Hardware security module (HSM) integration

---

<p align="center">
  <strong>Built with ❤️ for a privacy-preserving future</strong>
</p>
