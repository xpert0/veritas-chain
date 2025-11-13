#!/usr/bin/env node

/**
 * Comprehensive test suite for Veritas-Chain API
 * Tests all endpoints with success and failure cases
 */

import http from 'http';

/**
 * Make HTTP request
 */
function request(method, path, data = null, expectError = false) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8081,
      path: `/api${path}`,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : {};
          if (expectError) {
            resolve({ statusCode: res.statusCode, ...json });
          } else if (res.statusCode >= 400) {
            reject({ statusCode: res.statusCode, ...json });
          } else {
            resolve(json);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

/**
 * Run comprehensive tests
 */
async function runTests() {
  console.log('\n===== Veritas-Chain Comprehensive Test Suite =====\n');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  try {
    // ===== GET /api/chain Tests =====
    console.log('=== GET /api/chain Tests ===\n');
    
    console.log('Test 1: GET /api/chain - Success case');
    try {
      const chainStatus = await request('GET', '/chain');
      if (chainStatus.chain && chainStatus.network && chainStatus.health) {
        console.log('✓ Chain status retrieved successfully');
        console.log(`  Chain ID: ${chainStatus.chain.chainId.substring(0, 40)}...`);
        console.log(`  Chain Length: ${chainStatus.chain.length}`);
        console.log(`  Active Peers: ${chainStatus.network.activePeers}`);
        testsPassed++;
      } else {
        console.log('✗ Invalid response structure');
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    // ===== POST /api/register Tests =====
    console.log('=== POST /api/register Tests ===\n');
    
    console.log('Test 2: POST /api/register - Missing all fields (400 expected)');
    try {
      const errorResult = await request('POST', '/register', {}, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected missing fields');
        console.log(`  Error: ${errorResult.error}`);
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 3: POST /api/register - Missing data field (400 expected)');
    try {
      const errorResult = await request('POST', '/register', {
        registrarPrivateKey: 'key',
        signatures: [],
        parentKeys: ['parent1']
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected missing data field');
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 4: POST /api/register - Empty parent keys (400 expected)');
    try {
      const errorResult = await request('POST', '/register', {
        data: { name: 'Test Person', dob: '2000-01-01' },
        registrarPrivateKey: 'key',
        signatures: [],
        parentKeys: []
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected empty parent keys');
        console.log(`  Error: ${errorResult.error}`);
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 5: POST /api/register - Invalid signature format (400 expected)');
    try {
      const errorResult = await request('POST', '/register', {
        data: { name: 'Test' },
        registrarPrivateKey: 'key',
        signatures: 'not-an-array',
        parentKeys: ['parent1']
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected non-array signatures');
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 6: POST /api/register - Insufficient signatures (403 expected)');
    try {
      const errorResult = await request('POST', '/register', {
        data: { name: 'Test', dob: '2000-01-01' },
        registrarPrivateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        signatures: [],
        parentKeys: ['parent1']
      }, true);
      if (errorResult.statusCode === 403) {
        console.log('✓ Correctly rejected insufficient signatures');
        console.log(`  Error: ${errorResult.error}`);
        testsPassed++;
      } else {
        console.log('✗ Expected 403 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 7: POST /api/register - Unauthorized registrar (400 expected for invalid key)');
    try {
      const errorResult = await request('POST', '/register', {
        data: { name: 'Test', dob: '2000-01-01' },
        registrarPrivateKey: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIFakeKeyThatDoesNotExist123456789012345678\n-----END PRIVATE KEY-----',
        signatures: ['sig1', 'sig2'],
        parentKeys: ['parent1']
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected invalid private key format (HTTP ' + errorResult.statusCode + ')');
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    // ===== POST /api/keyregister Tests =====
    console.log('=== POST /api/keyregister Tests ===\n');
    
    console.log('Test 8: POST /api/keyregister - Missing fields (400 expected)');
    try {
      const errorResult = await request('POST', '/keyregister', {}, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected missing fields');
        console.log(`  Error: ${errorResult.error}`);
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 9: POST /api/keyregister - Invalid signature format (400 expected)');
    try {
      const errorResult = await request('POST', '/keyregister', {
        newRegistrarPrivateKey: 'key',
        signatures: 'not-an-array'
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected non-array signatures');
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 10: POST /api/keyregister - Invalid private key format (400 expected)');
    try {
      const errorResult = await request('POST', '/keyregister', {
        newRegistrarPrivateKey: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIFakeKeyThatDoesNotExist123456789012345678\n-----END PRIVATE KEY-----',
        signatures: ['sig1', 'sig2', 'sig3']
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected invalid private key format');
        console.log(`  Error: ${errorResult.error}`);
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 11: POST /api/keyregister - Insufficient signatures (403 expected)');
    try {
      const errorResult = await request('POST', '/keyregister', {
        newRegistrarPrivateKey: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIAoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo=\n-----END PRIVATE KEY-----',
        signatures: []
      }, true);
      if (errorResult.statusCode === 403) {
        console.log('✓ Correctly rejected insufficient signatures');
        console.log(`  Error: ${errorResult.error}`);
        testsPassed++;
      } else {
        console.log('✗ Expected 403 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    // ===== POST /api/token Tests =====
    console.log('=== POST /api/token Tests ===\n');
    
    console.log('Test 12: POST /api/token - Missing fields (400 expected)');
    try {
      const errorResult = await request('POST', '/token', {}, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected missing fields');
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 13: POST /api/token - Invalid maxUses > 5 (400 expected)');
    try {
      const errorResult = await request('POST', '/token', {
        blockHash: 'fake-hash',
        ownerPrivateKey: 'key',
        permissions: ['dob'],
        maxUses: 10
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected maxUses > 5');
        console.log(`  Error: ${errorResult.error}`);
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 14: POST /api/token - Invalid maxUses < 1 (400 expected)');
    try {
      const errorResult = await request('POST', '/token', {
        blockHash: 'fake-hash',
        ownerPrivateKey: 'key',
        permissions: ['dob'],
        maxUses: 0
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected maxUses < 1');
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 15: POST /api/token - Non-existent block (404 expected)');
    try {
      const errorResult = await request('POST', '/token', {
        blockHash: 'non-existent-block-hash',
        ownerPrivateKey: 'key',
        permissions: ['dob'],
        maxUses: 3
      }, true);
      if (errorResult.statusCode === 404) {
        console.log('✓ Correctly rejected non-existent block');
        testsPassed++;
      } else {
        console.log('✗ Expected 404 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    // ===== POST /api/verify Tests =====
    console.log('=== POST /api/verify Tests ===\n');
    
    console.log('Test 16: POST /api/verify - Missing fields (400 expected)');
    try {
      const errorResult = await request('POST', '/verify', {}, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected missing fields');
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 17: POST /api/verify - Empty conditions array (400 expected)');
    try {
      const errorResult = await request('POST', '/verify', {
        blockHash: 'hash',
        tokenId: 'token',
        conditions: [],
        encryptionKey: 'key'
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected empty conditions');
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 18: POST /api/verify - Non-existent block (404 expected)');
    try {
      const errorResult = await request('POST', '/verify', {
        blockHash: 'non-existent-hash',
        tokenId: 'token',
        conditions: [{ field: 'dob', condition: '> 2000-01-01' }],
        encryptionKey: 'dGVzdGtleQ=='
      }, true);
      if (errorResult.statusCode === 404) {
        console.log('✓ Correctly rejected non-existent block');
        testsPassed++;
      } else {
        console.log('✗ Expected 404 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    // ===== POST /api/update Tests =====
    console.log('=== POST /api/update Tests ===\n');
    
    console.log('Test 19: POST /api/update - Missing fields (400 expected)');
    try {
      const errorResult = await request('POST', '/update', {}, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected missing fields');
        console.log(`  Error: ${errorResult.error}`);
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 20: POST /api/update - Invalid signature format (400 expected)');
    try {
      const errorResult = await request('POST', '/update', {
        blockHash: 'hash',
        newData: { address: 'New Address' },
        encryptionKey: 'key',
        ownerPrivateKey: 'key',
        registrarPrivateKey: 'key',
        signatures: 'not-an-array'
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected non-array signatures');
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 21: POST /api/update - Insufficient signatures (400 expected)');
    try {
      const errorResult = await request('POST', '/update', {
        blockHash: 'hash',
        newData: { address: 'New Address' },
        encryptionKey: 'key',
        ownerPrivateKey: 'key',
        registrarPrivateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        signatures: []
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected insufficient signatures');
        console.log(`  Error: ${errorResult.error}`);
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 22: POST /api/update - Non-existent block (404 expected)');
    try {
      const errorResult = await request('POST', '/update', {
        blockHash: 'non-existent-hash',
        newData: { address: 'New Address' },
        encryptionKey: 'key',
        ownerPrivateKey: 'key',
        registrarPrivateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        signatures: ['sig1', 'sig2', 'sig3']
      }, true);
      if (errorResult.statusCode === 404 || errorResult.statusCode === 403) {
        console.log('✓ Correctly rejected non-existent block or unauthorized (HTTP ' + errorResult.statusCode + ')');
        testsPassed++;
      } else {
        console.log('✗ Expected 404/403 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    // ===== POST /api/rotate Tests =====
    console.log('=== POST /api/rotate Tests ===\n');
    
    console.log('Test 23: POST /api/rotate - Missing fields (400 expected)');
    try {
      const errorResult = await request('POST', '/rotate', {}, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected missing fields');
        testsPassed++;
      } else {
        console.log('✗ Expected 400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    console.log('Test 24: POST /api/rotate - Non-existent block (404 expected)');
    try {
      const errorResult = await request('POST', '/rotate', {
        blockHash: 'non-existent-hash',
        oldPrivateKey: 'key',
        newPrivateKey: 'key',
        oldEncryptionKey: 'key'
      }, true);
      if (errorResult.statusCode === 404) {
        console.log('✓ Correctly rejected non-existent block');
        testsPassed++;
      } else {
        console.log('✗ Expected 404 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    // ===== Test Summary =====
    console.log('===== Test Summary =====');
    console.log(`Total Tests: ${testsPassed + testsFailed}`);
    console.log(`Passed: ${testsPassed}`);
    console.log(`Failed: ${testsFailed}`);
    console.log();
    
    if (testsFailed === 0) {
      console.log('✓ All Tests Passed!');
      console.log('\nComprehensive test coverage:');
      console.log('  ✓ GET /api/chain - Success cases');
      console.log('  ✓ POST /api/register - Missing fields, invalid formats, insufficient signatures, invalid keys (7 tests)');
      console.log('  ✓ POST /api/keyregister - Missing fields, invalid formats, invalid keys, insufficient signatures (4 tests)');
      console.log('  ✓ POST /api/token - Missing fields, invalid maxUses, non-existent blocks (4 tests)');
      console.log('  ✓ POST /api/verify - Missing fields, empty conditions, non-existent blocks (3 tests)');
      console.log('  ✓ POST /api/update - Missing fields, invalid formats, insufficient signatures, non-existent blocks (4 tests)');
      console.log('  ✓ POST /api/rotate - Missing fields, non-existent blocks (2 tests)');
      console.log('\nNote: Full integration tests with real signatures require valid keypairs.');
      console.log('See SIGNATURE_VALIDATION.md for signature generation examples.');
      process.exit(0);
    } else {
      console.log('✗ Some tests failed');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n✗ Test failed with error:', error);
    process.exit(1);
  }
}

// Run tests
console.log('Starting Veritas-Chain comprehensive test suite...\n');
runTests();
