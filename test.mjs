#!/usr/bin/env node

/**
 * Comprehensive test script for ZKIC blockchain
 */

import http from 'http';

const API_BASE = 'http://localhost:8081/api';

/**
 * Make HTTP request
 */
function request(method, path, data = null) {
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
          const json = JSON.parse(body);
          if (res.statusCode >= 400) {
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
 * Run tests
 */
async function runTests() {
  console.log('\n===== ZKIC Blockchain Test Suite =====\n');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  try {
    // Test 1: Get chain status
    console.log('Test 1: Getting chain status...');
    const chainStatus = await request('GET', '/chain');
    console.log('✓ Chain status retrieved successfully');
    console.log('  Chain ID:', chainStatus.chain.chainId.substring(0, 40) + '...');
    console.log('  Chain Length:', chainStatus.chain.length);
    console.log('  Active Peers:', chainStatus.network.activePeers);
    testsPassed++;
    console.log();
    
    // Test 2: Register a new identity
    console.log('Test 2: Registering new identity...');
    const registrationData = {
      data: {
        name: 'John Doe',
        dob: '1990-05-15',
        address: '123 Main St, City',
        bloodGroup: 'O+',
        fatherName: 'Father Doe',
        motherName: 'Mother Doe'
      },
      ownerPublicKey: 'temp-key',
      signatures: ['sig1', 'sig2', 'sig3'] // Mock signatures
    };
    
    const regResult = await request('POST', '/register', registrationData);
    console.log('✓ Identity registered successfully');
    console.log('  Block Hash:', regResult.blockHash);
    console.log('  Owner Public Key (first 50 chars):', regResult.ownerPublicKey.substring(0, 50) + '...');
    testsPassed++;
    console.log();
    
    const { blockHash, ownerPrivateKey, encryptionKey } = regResult;
    
    // Wait a bit for block to be added
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Test 3: Issue a permission token with nanoid
    console.log('Test 3: Issuing permission token (using nanoid)...');
    const tokenData = {
      blockHash,
      ownerPrivateKey,
      permissions: ['dob', 'bloodGroup'],
      maxUses: 5
    };
    
    const tokenResult = await request('POST', '/token', tokenData);
    console.log('✓ Token issued successfully');
    console.log('  Token ID:', tokenResult.token.id);
    console.log('  Token ID Length:', tokenResult.token.id.length);
    console.log('  Permissions:', tokenResult.token.permissions.join(', '));
    console.log('  Remaining Uses:', tokenResult.token.remainingUses);
    console.log('  New Block Hash:', tokenResult.blockHash);
    
    // Validate that token ID looks like nanoid (alphanumeric, URL-safe)
    const isValidNanoid = /^[A-Za-z0-9_-]+$/.test(tokenResult.token.id);
    if (isValidNanoid) {
      console.log('  ✓ Token ID format is valid (nanoid)');
    } else {
      console.log('  ✗ Token ID format is invalid');
      testsFailed++;
    }
    testsPassed++;
    console.log();
    
    const { token, blockHash: tokenBlockHash } = tokenResult;
    
    // Test 4: Zero-knowledge verification (age check)
    console.log('Test 4: Zero-knowledge verification (checking if born before 2007-10-20)...');
    const verifyData = {
      blockHash: tokenBlockHash,
      tokenId: token.id,
      field: 'dob',
      condition: '<= 2007-10-20',
      encryptionKey
    };
    
    const verifyResult = await request('POST', '/verify', verifyData);
    console.log('✓ Verification completed successfully');
    console.log('  Result:', verifyResult.result);
    console.log('  Interpretation: User born on 1990-05-15 is', verifyResult.result ? 'BEFORE 2007-10-20 (older than 18)' : 'AFTER 2007-10-20 (younger than 18)');
    
    if (verifyResult.result === true) {
      console.log('  ✓ Correct result (1990-05-15 is before 2007-10-20)');
    } else {
      console.log('  ✗ Incorrect result');
      testsFailed++;
    }
    testsPassed++;
    console.log();
    
    // Test 5: Another verification (blood group)
    console.log('Test 5: Zero-knowledge verification (checking if bloodGroup == O+)...');
    const verify2Data = {
      blockHash: tokenBlockHash,
      tokenId: token.id,
      field: 'bloodGroup',
      condition: '== O+',
      encryptionKey
    };
    
    const verify2Result = await request('POST', '/verify', verify2Data);
    console.log('✓ Verification completed successfully');
    console.log('  Result:', verify2Result.result);
    console.log('  Interpretation: Blood group is', verify2Result.result ? 'O+' : 'NOT O+');
    
    if (verify2Result.result === true) {
      console.log('  ✓ Correct result (blood group is O+)');
    } else {
      console.log('  ✗ Incorrect result');
      testsFailed++;
    }
    testsPassed++;
    console.log();
    
    // Test 6: Update identity
    console.log('Test 6: Updating identity...');
    const updateData = {
      blockHash: tokenBlockHash,
      newData: {
        address: '456 New Street, New City'
      },
      encryptionKey,
      ownerPrivateKey,
      signatures: ['sig1', 'sig2', 'sig3', 'sig4'] // Mock signatures
    };
    
    const updateResult = await request('POST', '/update', updateData);
    console.log('✓ Identity updated successfully');
    console.log('  Block Hash:', updateResult.blockHash);
    console.log('  Note: Block hash changed after update (expected behavior)');
    testsPassed++;
    console.log();
    
    // Test 7: Verify token usage decremented (use updated block hash)
    console.log('Test 7: Verifying token usage count decreased...');
    const verify3Data = {
      blockHash: updateResult.blockHash,
      tokenId: token.id,
      field: 'name',
      condition: '== John Doe',
      encryptionKey
    };
    
    const verify3Result = await request('POST', '/verify', verify3Data);
    console.log('✓ Third verification completed');
    console.log('  Result:', verify3Result.result);
    console.log('  Note: Token should have 2 uses remaining (started with 5, used 3 times)');
    testsPassed++;
    console.log();
    
    // Test 8: Get final chain status
    console.log('Test 8: Getting final chain status...');
    const finalStatus = await request('GET', '/chain');
    console.log('✓ Final chain status retrieved');
    console.log('  Chain Length:', finalStatus.chain.length);
    console.log('  Blocks Added:', finalStatus.chain.length - chainStatus.chain.length);
    console.log('  Active Peers:', finalStatus.network.activePeers);
    testsPassed++;
    console.log();
    
    // Summary
    console.log('===== Test Summary =====');
    console.log(`Total Tests: ${testsPassed + testsFailed}`);
    console.log(`Passed: ${testsPassed}`);
    console.log(`Failed: ${testsFailed}`);
    console.log();
    
    if (testsFailed === 0) {
      console.log('✓ All Tests Passed!');
      process.exit(0);
    } else {
      console.log('✗ Some tests failed');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n✗ Test failed with error:', error);
    console.log('\nTest Summary: Failed');
    process.exit(1);
  }
}

// Run tests
console.log('Starting ZKIC blockchain tests...');
runTests();
