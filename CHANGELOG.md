# Changelog

## [Unreleased] - 2025-11-14

### Fixed
- **Peer Discovery**: Fixed bootstrap order - P2P server now starts before peer discovery to ensure handshake responses can be received
- **Peer Syncing**: Fixed missing genesis import in `peer-sync.mjs` that caused runtime errors when peers tried to sync
- **Peer Discovery**: Peers discovered after bootstrap now properly handshake and sync (not just during initial bootstrap)
- **Bootstrap Order**: Restructured bootstrap sequence to check peers before creating new genesis block
  - Order: Load stored chain → **Start P2P server** → Discover peers → Sync → Create genesis only if no chain and no peers
- **Handshake Sync**: Fixed peer sync to properly receive and save genesis block from other peers
- **Logger**: Added LOG_LEVEL environment variable support (ERROR, WARN, INFO, DEBUG)
- **Duplicate Discovery**: Eliminated duplicate peer discovery calls during bootstrap

### Added
- `periodicDiscoveryAndConnect()` function for continuous peer discovery and connection
- Environment variable `LOG_LEVEL` for controlling log verbosity

### Changed
- `handleSyncRequest()` now includes genesis block in sync response
- `applySyncData()` properly initializes chain when receiving genesis from peer
- `updateChainHash()` handles null private key when only public key available (from peer sync)
- Bootstrap process restructured for correct peer sync order

### Technical Details

#### Peer Syncing Flow
When a new peer joins the network:
1. Discovers existing peers via subnet scan or DNS
2. Performs handshake with each peer
3. Receives genesis block and chain data from peers
4. Verifies genesis block authenticity
5. Initializes chain with peer's genesis (if no local genesis exists)
6. Syncs full chain from best peer (longest valid chain)
7. Saves genesis and chain to storage

#### Bootstrap Order
```
1. Load configuration
2. Initialize storage
3. Load stored chain (if exists)
4. Initialize network
5. **Start P2P server (crucial: must start before peer discovery)**
6. Discover peers and handshake
7. Sync with peers (if found)
8. Create new genesis (only if no stored chain AND no peers)
9. Verify chain integrity
10. Start periodic discovery and gossip
11. Start auto snapshots
12. Start HTTP API
```

#### Periodic Discovery
After bootstrap, the node continues to discover new peers every 30 seconds:
- Discovers new peers via subnet scan and DNS
- Filters out already connected peers
- Performs handshake with new peers
- Syncs if new peers have longer/newer chain
- Updates active peer list

#### Logger Usage
```bash
# Default (INFO level)
node index.mjs

# Debug logging
LOG_LEVEL=DEBUG node index.mjs

# Error only
LOG_LEVEL=ERROR node index.mjs

# Available levels: ERROR, WARN, INFO, DEBUG
```

### Migration Guide
No migration needed - changes are backward compatible. Existing nodes will continue to work normally.

### Security
- No new vulnerabilities introduced
- Private master keys are never shared between peers
- Only public keys used for verification when syncing from peers
- Chain authenticity verified using genesis block signatures
