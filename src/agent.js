#!/usr/bin/env node

import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { selectors } from './selectors.js';
import { deliver, pruneHistory } from './storage.js';
import { logger } from './logger.js';
import { sleep, withRetry, generateTimestamp, ensureCsv } from './utils.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const config = {
  baseUrl: process.env.INGRO_BASE_URL || 'https://www.ingrosmart.it',
  loginUrl: process.env.INGRO_LOGIN_URL || 'https://www.ingrosmart.it/customer/account/login/',
  exportUrl: process.env.INGRO_EXPORT_URL || 'https://www.ingrosmart.it/datacomcontroller/agent/productExport/',
  username: process.env.INGRO_USER,
  password: process.env.INGRO_PASS,
  target: process.env.TARGET || 'fs',
  keepHistory: parseInt(process.env.KEEP_HISTORY || '10'),
  screenshotOnError: process.env.LOG_LEVEL === 'debug'
};

// Validate configuration
if (!config.username || !config.password) {
  logger.error('Missing INGRO_USER or INGRO_PASS environment variables');
  process.exit(1);
}

/**
 * Click the first matching selector from a list
 */
async function clickFirst(page, selectorList, options = {}) {
  let attempted = [];
  for (const selector of selectorList) {
    try {
      const element = await page.locator(selector).first();
      const isVisible = await element.isVisible({ timeout: 1000 }).catch(() => false);
      if (isVisible) {
        await element.click(options);
        logger.debug(`Clicked selector: ${selector}`);
        return true;
      }
      attempted.push(selector);
    } catch (e) {
      attempted.push(selector);
      // Try next selector
      continue;
    }
  }
  logger.debug(`No clickable element found. Attempted selectors: ${attempted.length}`);
  return false;
}

/**
 * Fill the first matching input from a list
 */
async function fillFirst(page, selectorList, value) {
  for (const selector of selectorList) {
    try {
      const element = await page.locator(selector).first();
      const isVisible = await element.isVisible({ timeout: 1000 }).catch(() => false);
      if (isVisible) {
        await element.fill(value);
        logger.debug(`Filled selector: ${selector}`);
        return true;
      }
    } catch (e) {
      // Try next selector
      continue;
    }
  }
  return false;
}

/**
 * Perform login on IngroSmart
 */
async function login(page) {
  logger.info('Starting login process...');
  
  try {
    // Navigate to login page
    await page.goto(config.loginUrl, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Handle cookie consent if present
    const cookieAccepted = await clickFirst(page, selectors.cookieAccept);
    if (cookieAccepted) {
      logger.debug('Cookie consent accepted');
      await sleep(1000);
    }
    
    // Fill email
    const emailFilled = await fillFirst(page, selectors.email, config.username);
    if (!emailFilled) {
      throw new Error('Could not find email input field');
    }
    
    // Fill password
    const passwordFilled = await fillFirst(page, selectors.password, config.password);
    if (!passwordFilled) {
      throw new Error('Could not find password input field');
    }
    
    // Submit login form
    const submitClicked = await clickFirst(page, selectors.submit);
    if (!submitClicked) {
      // Try pressing Enter as fallback
      await page.keyboard.press('Enter');
      logger.debug('Submitted form with Enter key');
    }
    
    // Wait for navigation
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    
    // Verify login success - check multiple indicators
    const currentUrl = page.url();
    let isLoggedIn = false;
    
    // Check URL patterns that indicate successful login
    if (!currentUrl.includes('/login') && 
        (currentUrl.includes('/account') || 
         currentUrl.includes('/dashboard') ||
         currentUrl === config.baseUrl + '/')) {
      isLoggedIn = true;
    }
    
    // If URL check is inconclusive, check for account indicators
    if (!isLoggedIn) {
      for (const indicator of selectors.accountIndicators) {
        try {
          const element = await page.locator(indicator).first();
          if (await element.isVisible({ timeout: 1000 })) {
            isLoggedIn = true;
            logger.debug(`Found account indicator: ${indicator}`);
            break;
          }
        } catch (e) {
          // Continue checking other indicators
        }
      }
    }
    
    if (!isLoggedIn) {
      throw new Error('Login verification failed - still on login page or no account indicators found');
    }
    
    logger.info('Login successful');
    return true;
    
  } catch (error) {
    if (config.screenshotOnError) {
      const screenshotPath = path.join(__dirname, '..', 'screenshots', `login-error-${Date.now()}.png`);
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.debug(`Screenshot saved: ${screenshotPath}`);
    }
    throw error;
  }
}

/**
 * Download CSV from export URL
 */
async function downloadCsv(page) {
  logger.info('Downloading CSV...');
  
  try {
    // Use page.request to make authenticated request with cookies
    const response = await page.request.get(config.exportUrl, {
      timeout: 60000,
      maxRedirects: 3
    });
    
    const status = response.status();
    const contentType = response.headers()['content-type'] || '';
    const buffer = await response.body();
    
    logger.debug(`Response status: ${status}, Content-Type: ${contentType}`);
    
    if (status !== 200) {
      throw new Error(`HTTP ${status} received`);
    }
    
    // Check if we got HTML instead of CSV (session expired)
    if (!ensureCsv(buffer, contentType)) {
      throw new Error('Received HTML instead of CSV - session may have expired');
    }
    
    const bytes = buffer.length;
    logger.info(`CSV downloaded successfully: ${bytes} bytes`);
    
    return { buffer, contentType, bytes };
    
  } catch (error) {
    if (config.screenshotOnError) {
      const screenshotPath = path.join(__dirname, '..', 'screenshots', `download-error-${Date.now()}.png`);
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.debug(`Screenshot saved: ${screenshotPath}`);
    }
    throw error;
  }
}

/**
 * Main agent flow
 */
async function runAgent() {
  let browser;
  let context;
  let page;
  
  try {
    logger.info('Starting IngroSmart agent...');
    
    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process'
      ]
    });
    
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'it-IT'
    });
    
    page = await context.newPage();
    
    // Login with retry
    await withRetry(
      async () => await login(page),
      { retries: 2, baseDelayMs: 3000, taskName: 'Login' }
    );
    
    // Download CSV with retry (including re-login if needed)
    const downloadWithRelogin = async () => {
      try {
        return await downloadCsv(page);
      } catch (error) {
        if (error.message.includes('HTML instead of CSV')) {
          logger.warn('Session expired, attempting re-login...');
          await login(page);
          return await downloadCsv(page);
        }
        throw error;
      }
    };
    
    const { buffer, bytes } = await withRetry(
      downloadWithRelogin,
      { retries: 2, baseDelayMs: 2000, taskName: 'Download CSV' }
    );
    
    // Generate timestamp for historical file
    const timestamp = generateTimestamp();
    
    // Deliver to target (WP, S3, or FS)
    await deliver(buffer, timestamp);
    
    // Prune old history files
    await pruneHistory(config.target, config.keepHistory);
    
    logger.info('Agent completed successfully');
    
  } catch (error) {
    logger.error('Agent failed:', error);
    process.exit(1);
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// Run agent
runAgent();
