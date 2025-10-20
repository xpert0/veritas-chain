**ZKIC (Zero-Knowledge Identity Chain)** design — a fully decentralized, authenticated, zero-knowledge, self-healing identity ledger.

---

# 🪪 **Veritas-Chain** — Zero-Knowledge Identity Chain

> *A decentralized identity ledger with cryptographic verification, zero-knowledge selective disclosure, and autonomous P2P consensus.*

---

## 🧭 1. **Design Principles**

* 🔐 **User Sovereignty** — Only the user can decrypt their identity.
* 🧠 **Zero-Knowledge Verification** — Only requirement checks are revealed, not data.
* 🪙 **Cryptographic Determinism** — No mining, no manual validators; state is purely deterministic.
* 🧾 **Selective Field Encryption** — Each identity field encrypted separately.
* 🧭 **Self-Healing Mesh** — Offline peers resync to longest authentic chain automatically.
* 🛡 **Authenticated Chain State** — Master key ensures immutable chain authenticity.
* ⚡ **Full Mesh P2P** — Every peer connects to every peer → instant propagation.
* 🔐 **Strict Signature Policy** — Different thresholds for registration vs updates.
* 📜 **Genesis as Root of Trust** — Genesis block anchors master key and authority configuration.

---

## 🧰 2. **Project Structure**

```
ZKIC/
├── docs/                      # Auto-generated API and event docs
├── src/
│   ├── config.mjs             # Config loader + schema validation
│   ├── crypto.mjs             # AES encryption, SHA-512, Ed25519
│   ├── genesis.mjs            # Master key + genesis block handling
│   ├── block.mjs              # Minting, updating, pruning, rotation
│   ├── token.mjs              # Token issue & usage count
│   ├── verification.mjs       # ZK evaluation engine
│   ├── chain.mjs              # APoC logic, deterministic validation
│   ├── storage.mjs            # Locking, snapshotting, persistence
│   ├── network.mjs            # P2P full mesh + gossip + sync
│   ├── peer-discovery.mjs     # IP scan + DNS TXT resolution
│   ├── peer-handshake.mjs     # handshake auth
│   ├── peer-sync.mjs          # chain sync logic
│   ├── peer-gossip.mjs        # background gossip
│   ├── peer-broadcast.mjs     # event propagation
│   ├── utils.mjs              # shared helpers
│   └── logger.mjs
├── index.mjs                   # Entrypoint
├── config.json
└── package.json
```

---

## ⚙️ 3. **Configuration (config.json)**

Refer to config.json

---

## 🧱 4. **Block Structure**

```
Block {
  hash: string,
  encryptedData: Base64(Encrypted(JSON)),   // each field encrypted separately
  tokens: [
    <tokenId>: {
      permissions: [string],
      remainingUses: number,
      issuedAt: timestamp,
      signature: string
    },
  ],
  metadata: {
    createdAt: number,
    updatedAt: number,
    ownerPubKey: string,
    lifecycleStage: "genesis" | "guardian" | "self" | "expired",
    deathDate?: number,
    rotationsLeft: number
  },
  prevHash: string | null,
  signature: string
}
```

* `encryptedData` is stored as base64 of encrypted binary (AES-256-GCM).
* Individual fields can be decrypted by the chain **only if token permissions allow**.
* The full block can only be decrypted by the **user’s private key**.

---

## 🧾 5. **Genesis Block**

* First peer generates a **master keypair**:

  * `masterPubKey` burned into genesis.
  * Genesis signed with master private key.
* Contains:

  * Authorized genesis signer public keys
  * Signature policies
  * Network parameters
  * Master key for chain authenticity verification
* Immutable after creation.

---

## 🧠 6. **Master Key and Chain Authenticity**

* Each block added triggers:

  * Recalculation of global chain hash
  * Re-signing with master key (by the node that hosts genesis)
* On sync:

  * Nodes verify chain hash and signature against `masterPubKey`.
  * Only **authentic chain** is accepted.

✅ This is the **cryptographic trust anchor**.

---

## 🧬 7. **Encryption & Hashing**

| Layer                | Algorithm        | Purpose                                    |
| -------------------- | ---------------- | ------------------------------------------ |
| Hashing              | SHA-512          | Block integrity and chain hash             |
| Symmetric Encryption | AES-256-GCM      | Field-level data encryption                |
| Asymmetric Keys      | Ed25519          | User keypairs, genesis signers, master key |
| Chain Authenticity   | Ed25519 (master) | Chain hash signature                       |

---

## 🧑‍🍼 8. **Identity Lifecycle**

| Stage    | Keypair                | Trigger               | Action             |
| -------- | ---------------------- | --------------------- | ------------------ |
| Genesis  | Genesis Key (Hospital) | Newborn registration  | Block minted       |
| Guardian | Guardian Key           | At age 5              | Block re-encrypted |
| Self     | Personal Key           | At age 18             | Block re-encrypted |
| Expired  | None                   | Death + 3 years grace | Block pruned       |

---

## 🪙 9. **Token System**

* Token structure:

```json
{
  "id": "<nanoid>",
  "permissions": ["dob", "bloodGroup"],
  "remainingUses": 5,
  "issuedAt": 1739999999,
  "signature": "<owner sig>"
}
```

* Token remains valid until `remainingUses` hits zero.
* Chain checks:

  * Token signature against owner pubkey
  * Field permissions
  * Remaining uses
* Used for ZK field-level verification.

---

## 🧪 10. **Zero-Knowledge Verification Flow**

1. **User** generates token with `permissions=["dob"]`.
2. **Verifier** sends requirement:

   ```json
   { "token": "...", "field": "dob", "condition": "dob <= 2007-10-20" }
   ```
3. Chain:

   * Validates token
   * Decrypts only `dob` field
   * Evaluates condition
   * Returns:

     ```json
     { "result": true }
     ```

✅ User’s actual DOB is never revealed.

---

## 🧾 11. **API Endpoints**

| Endpoint             | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `POST /api/register` | Newborn registration, requires multiple genesis signatures |
| `POST /api/verify`   | Zero-knowledge verification                                |
| `POST /api/token`    | Issue permission token                                     |
| `POST /api/update`   | Update details / death registration (multi-signature)      |
| `GET  /api/chain`    | Chain health and metadata                                  |
| `POST /api/rotate`   | Key rotation (max 5 total)                                 |

✅ Implemented with **native `http` module**, no Express or heavy deps.

---

## 🧭 12. **Consensus — APoC (Autonomous Proof of Continuity)**

* No mining, no leader election.
* State determined by deterministic validation rules:

  * Block hash integrity
  * Signature verification
  * Lifecycle validity
  * Token policies
* All nodes apply the same logic → converge on same chain.
* Genesis/master key ensures authenticity.

---

## 🌐 13. **Networking & Peer Mesh**

### Discovery:

* **/24 subnet scan** (local mesh)
* **DNS TXT record** (`zkic.example.org`) for global mesh

### Handshake:

```
new_peer -> old_peers: { chainId, peerId }
old_peers -> new_peer: { chainId, chainLength, last_updated, chainHash, chainSignature, masterPubKey }
```

### Sync:

* If peer has longer/updated timestamp, authenticated chain:

  * Incremental block sync
  * Verify hash + master signature
  * Apply changes
* If equal or shorter:

  * No action
* If invalid signature:

  * Reject peer

### Full Mesh:

* Each peer connects to all discovered peers.
* Broadcast events in real-time.
* Rapid propagation and convergence.

---

## 🕸 14. **P2P Gossip**

* Periodic broadcast of:

  * `chainLength`
  * `chainHash`
  * timestamp
* Allows peers to detect longer chains and resync(only the diff, the additional blocks and the modified blocks) without manual intervention.

---

## 💾 15. **Storage**

* Stored at `storage.path`.
* Locked with `.zkic.lock` to prevent concurrent modification.
* Snapshot every `snapshotIntervalSeconds`.
* Authenticated on load via master signature.

### Offline Recovery:

* Peer loads local snapshot
* Checks peer mesh for longer chains
* Syncs if authentic one found
* Continues if none found

---

## 🔐 16. **Security Layers**

* ✅ Master key signs entire chain state
* ✅ Genesis signer threshold for registration/update
* ✅ Token-based fine-grained field access
* ✅ AES-256-GCM for confidentiality
* ✅ SHA-512 for chain integrity
* ✅ Storage locking against tampering
* ✅ Authenticity check before accepting chain sync
* ✅ No central authority required

---

## 🧭 17. **Automatic Pruning**

* Death registration requires multiple genesis signatures.
* Grace period (configurable).
* After expiry, block is pruned and event propagated to all peers.
* Chain hash updated and re-signed by master.

---

## 🧪 18. **Boot Sequence**

```
1. Lock storage path
2. Load local chain snapshot
3. Verify chain hash & master signature
4. Discover peers (IP + DNS)
5. Handshake with peers
6. Sync if valid longer chain exists
7. Establish full mesh
8. Start gossip loops
9. Start HTTP server
```

---

## 🧭 19. **Event Types**

* `NEW_BLOCK` — registration
* `UPDATE_BLOCK` — update/death
* `ROTATE_KEY` — key rotation
* `PRUNE_BLOCK` — prune after grace
* `TOKEN_ISSUED` — token event
* `CHAIN_STATE` — gossip

Each event signed and authenticated before propagation.

---

## 🧠 20. **Why This Works**

✅ **Decentralized** — no central validator, anyone can join.
✅ **Deterministic** — consensus comes from logic, not mining.
✅ **Authenticated** — only chains signed with master key are valid.
✅ **Privacy-Preserving** — no personal data leaks, only ZK responses.
✅ **Resilient** — offline peers rejoin and self-heal.
✅ **Tamper-Proof** — genesis anchors trust.
✅ **Lightweight** — minimal dependencies, native protocols.

---

## 📌 21. **Module Responsibility Map**

| Module             | Responsibility                             |
| ------------------ | ------------------------------------------ |
| `config.mjs`       | Central configuration loading & validation |
| `crypto.mjs`       | Hashing, encryption, signatures            |
| `genesis.mjs`      | Master key generation and genesis handling |
| `block.mjs`        | Block structure, encryption, lifecycle     |
| `token.mjs`        | Token creation, permission handling        |
| `verification.mjs` | ZK verification logic                      |
| `chain.mjs`        | Core APoC rules                            |
| `storage.mjs`      | Snapshotting & locking                     |
| `network.mjs`      | P2P backbone                               |
| `peer-*` modules   | Discovery, sync, gossip, handshake         |
| `index.mjs`        | Bootstrapping and orchestration            |

---

## 🛡 22. **Extensibility**

* ✅ Post-quantum ready: Master/identity keys can be swapped for PQC when needed.
* ✅ Multiple signature policies per event type.
* ✅ Support for multiple discovery modes (DNS, LAN, static).
* ✅ Configurable lifecycle and data template.
* ✅ Multi-region mesh deployment.

---

# ✅ Final Takeaway:

ZKIC is **not just another blockchain**. It’s a **deterministic, zero-knowledge, cryptographically authenticated, self-healing identity mesh** with no central authority.

* **Master key** anchors trust.
* **APoC** ensures consensus without mining.
* **Selective field encryption** guarantees privacy.
* **Full mesh networking** ensures speed and resilience.
* **Token system** allows fine-grained permissioning.
* **Automatic peer discovery + sync** keeps the network consistent.

---
