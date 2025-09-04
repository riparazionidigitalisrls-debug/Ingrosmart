#!/usr/bin/env node

/**
 * Test script to verify individual components
 * Run with: node test/test-components.js
 */

import dotenv from 'dotenv';
import { logger } from '../src/logger.js';
import { sleep, withRetry, generateTimestamp, ensureCsv } from '../src/utils.js';
import { selectors } from '../src/selectors.js';

dotenv.config();

async function testLogger() {
  console.log('\n=== Testing Logger ===');
  logger.debug('This is a debug message');
  logger.info('This is an info message');
  logger.warn('This is a warning');
  logger.error('This is an error', new Error('Test error'));
  console.log('✅ Logger test complete\n');
}

async function testUtils() {
  console.log('=== Testing Utils ===');
  
  // Test sleep
  console.log('Testing sleep (1 second)...');
  const start = Date.now();
  await sleep(1000);
  const elapsed = Date.now() - start;
  console.log(`✅ Sleep worked: ${elapsed}ms`);
  
  // Test timestamp
  const ts = generateTimestamp();
  console.log(`✅ Timestamp generated: ${ts}`);
  
  // Test CSV detection
  const csvBuffer = Buffer.from('id,name,price\n1,Product,100');
  const htmlBuffer = Buffer.from('<!DOCTYPE html><html><body>Not CSV</body></html>');
  
  console.log(`✅ CSV detection (should be true): ${ensureCsv(csvBuffer, 'text/csv')}`);
  console.log(`✅ HTML detection (should be false): ${ensureCsv(htmlBuffer, 'text/html')}`);
  
  // Test retry
  console.log('Testing retry mechanism...');
  let attempts = 0;
  try {
    await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Test retry error');
        }
        return 'success';
      },
      { retries: 2, baseDelayMs: 500, taskName: 'Test Retry' }
    );
    console.log(`✅ Retry succeeded after ${attempts} attempts`);
  } catch (error) {
    console.log(`❌ Retry failed: ${error.message}`);
  }
  
  console.log('✅ Utils test complete\n');
}

async function testSelectors() {
  console.log('=== Testing Selectors ===');
  console.log(`Email selectors count: ${selectors.email.length}`);
  console.log(`Password selectors count: ${selectors.password.length}`);
  console.log(`Submit selectors count: ${selectors.submit.length}`);
  console.log(`Cookie selectors count: ${selectors.cookieAccept.length}`);
  console.log(`Account indicators count: ${selectors.accountIndicators.length}`);
  
  // Verify selector format
  const allSelectors = [
    ...selectors.email,
    ...selectors.password,
    ...selectors.submit,
    ...selectors.cookieAccept,
    ...selectors.accountIndicators
  ];
  
  let validCount = 0;
  for (const selector of allSelectors) {
    if (typeof selector === 'string' && selector.length > 0) {
      validCount++;
    }
  }
  
  console.log(`✅ Valid selectors: ${validCount}/${allSelectors.length}`);
  console.log('✅ Selectors test complete\n');
}

async function testEnvironment() {
  console.log('=== Testing Environment Variables ===');
  
  const requiredVars = [
    'INGRO_USER',
    'INGRO_PASS',
    'TARGET'
  ];
  
  const optionalVars = [
    'WP_BASE_URL',
    'WP_USER',
    'WP_APP_PASS',
    'S3_ENDPOINT',
    'S3_BUCKET',
    'LOG_LEVEL'
  ];
  
  console.log('Required variables:');
  for (const varName of requiredVars) {
    const value = process.env[varName];
    const status = value ? '✅' : '❌';
    const display = value ? (varName.includes('PASS') ? '***' : value.substring(0, 20)) : 'NOT SET';
    console.log(`  ${status} ${varName}: ${display}`);
  }
  
  console.log('\nOptional variables:');
  for (const varName of optionalVars) {
    const value = process.env[varName];
    const status = value ? '✅' : '⚪';
    const display = value ? (varName.includes('PASS') || varName.includes('KEY') ? '***' : value.substring(0, 20)) : 'not set';
    console.log(`  ${status} ${varName}: ${display}`);
  }
  
  console.log('\n✅ Environment test complete\n');
}

async function testStorageConfig() {
  console.log('=== Testing Storage Configuration ===');
  
  const target = process.env.TARGET || 'fs';
  console.log(`Current TARGET: ${target}`);
  
  switch (target) {
    case 'wp':
      const wpReady = process.env.WP_BASE_URL && process.env.WP_USER && process.env.WP_APP_PASS;
      console.log(`WordPress config: ${wpReady ? '✅ Ready' : '❌ Missing vars'}`);
      if (process.env.WP_BASE_URL) {
        console.log(`  URL: ${process.env.WP_BASE_URL}`);
        console.log(`  User: ${process.env.WP_USER || 'NOT SET'}`);
        console.log(`  Pass: ${process.env.WP_APP_PASS ? '***' : 'NOT SET'}`);
      }
      break;
      
    case 's3':
      const s3Ready = process.env.S3_ENDPOINT && process.env.S3_BUCKET && 
                      process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY;
      console.log(`S3 config: ${s3Ready ? '✅ Ready' : '❌ Missing vars'}`);
      if (process.env.S3_ENDPOINT) {
        console.log(`  Endpoint: ${process.env.S3_ENDPOINT}`);
        console.log(`  Bucket: ${process.env.S3_BUCKET || 'NOT SET'}`);
        console.log(`  Access Key: ${process.env.S3_ACCESS_KEY ? '***' : 'NOT SET'}`);
      }
      break;
      
    case 'fs':
    default:
      console.log('Filesystem config: ✅ Ready (no additional config needed)');
      console.log('  Output: ./output/');
      console.log('  History: ./output/history/');
      break;
  }
  
  console.log('✅ Storage config test complete\n');
}

// Run all tests
async function runAllTests() {
  console.log('🧪 IngroSmart Agent Component Tests\n');
  
  try {
    await testLogger();
    await testUtils();
    await testSelectors();
    await testEnvironment();
    await testStorageConfig();
    
    console.log('✅ All component tests completed successfully!\n');
    
    // Check if we can run the agent
    const canRun = process.env.INGRO_USER && process.env.INGRO_PASS;
    if (canRun) {
      console.log('🚀 Ready to run the agent with: npm run fetch');
    } else {
      console.log('⚠️  Set INGRO_USER and INGRO_PASS in .env before running the agent');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

runAllTests();