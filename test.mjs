#!/usr/bin/env node

/**
 * Basic API format validation test script for Veritas-Chain
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
 * Run tests
 */
async function runTests() {
  console.log('\n===== Veritas-Chain API Format Validation Tests =====\n');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  try {
    // Test 1: Get chain status
    console.log('Test 1: GET /api/chain...');
    const chainStatus = await request('GET', '/chain');
    console.log('✓ Chain API working');
    testsPassed++;
    console.log();
    
    // Test 2: Missing fields
    console.log('Test 2: POST /api/register - Missing fields (400 expected)...');
    try {
      const errorResult = await request('POST', '/register', {}, true);
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
    
    // Test 3: Empty parent keys
    console.log('Test 3: POST /api/register - Empty parent keys (400 expected)...');
    try {
      const errorResult = await request('POST', '/register', {
        data: { name: 'Test' },
        registrarPrivateKey: 'key',
        signatures: [],
        parentKeys: []
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected empty parent keys');
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
    
    // Test 4: Invalid signature format
    console.log('Test 4: POST /api/register - Invalid signature format (400 expected)...');
    try {
      const errorResult = await request('POST', '/register', {
        data: { name: 'Test' },
        registrarPrivateKey: 'key',
        signatures: 'not-an-array',
        parentKeys: ['parent1']
      }, true);
      if (errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected invalid signature format');
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
    
    // Test 5: Insufficient signatures
    console.log('Test 5: POST /api/register - Insufficient signatures (403 expected)...');
    try {
      const errorResult = await request('POST', '/register', {
        data: { name: 'Test', dob: '2000-01-01' },
        registrarPrivateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        signatures: [],
        parentKeys: ['parent1']
      }, true);
      if (errorResult.statusCode === 403 || errorResult.statusCode === 400) {
        console.log('✓ Correctly rejected insufficient signatures (HTTP ' + errorResult.statusCode + ')');
        testsPassed++;
      } else {
        console.log('✗ Expected 403/400 but got', errorResult.statusCode);
        testsFailed++;
      }
    } catch (err) {
      console.log('✗ Test failed:', err.message);
      testsFailed++;
    }
    console.log();
    
    // Test 6: Update with missing fields
    console.log('Test 6: POST /api/update - Missing fields (400 expected)...');
    try {
      const errorResult = await request('POST', '/update', {}, true);
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
    
    // Summary
    console.log('===== Test Summary =====');
    console.log(`Total Tests: ${testsPassed + testsFailed}`);
    console.log(`Passed: ${testsPassed}`);
    console.log(`Failed: ${testsFailed}`);
    console.log();
    
    if (testsFailed === 0) {
      console.log('✓ All API Format Validation Tests Passed!');
      console.log('\nNote: These tests validate API format and error handling.');
      console.log('For full integration tests with real signatures, see SIGNATURE_VALIDATION.md');
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
console.log('Starting Veritas-Chain API format validation tests...\n');
runTests();
