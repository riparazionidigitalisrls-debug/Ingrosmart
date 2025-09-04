import { logger } from './logger.js';

/**
 * Sleep for specified milliseconds
 */
export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry(fn, options = {}) {
  const {
    retries = 2,
    baseDelayMs = 1500,
    maxDelayMs = 30000,
    taskName = 'Task'
  } = options;
  
  let lastError;
  
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      logger.debug(`${taskName}: Attempt ${attempt}/${retries + 1}`);
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt <= retries) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
        logger.warn(`${taskName} failed (attempt ${attempt}): ${error.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  
  logger.error(`${taskName} failed after ${retries + 1} attempts`);
  throw lastError;
}

/**
 * Generate timestamp in format YYYYMMDD-HHMMSS
 */
export function generateTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * Check if content is CSV and not HTML
 */
export function ensureCsv(buffer, contentType = '') {
  // Check content type header
  const validTypes = ['text/csv', 'application/csv', 'application/octet-stream', 'application/x-csv'];
  const lowerContentType = contentType.toLowerCase();
  
  // If content type suggests HTML, it's definitely not CSV
  if (lowerContentType.includes('text/html') || lowerContentType.includes('application/xhtml')) {
    logger.debug('Content-Type indicates HTML');
    return false;
  }
  
  // Check more bytes for better detection (up to 2048)
  const sampleSize = Math.min(buffer.length, 2048);
  const sample = buffer.slice(0, sampleSize).toString('utf-8').toLowerCase().trim();
  
  // Check for HTML markers
  const htmlMarkers = ['<!doctype', '<html', '<head', '<body', '<meta', '<title', '<script', '<div'];
  for (const marker of htmlMarkers) {
    if (sample.includes(marker)) {
      logger.debug(`HTML marker found: ${marker}`);
      return false;
    }
  }
  
  // Check for CSV-like structure (should have delimiters)
  const hasDelimiters = sample.includes(',') || sample.includes(';') || sample.includes('\t') || sample.includes('|');
  const hasNewlines = sample.includes('\n') || sample.includes('\r');
  
  if (!hasDelimiters && buffer.length > 100) {
    logger.debug('No CSV delimiters found in sample');
    return false;
  }
  
  // If we have a valid CSV content type, trust it
  if (validTypes.some(type => lowerContentType.includes(type))) {
    return true;
  }
  
  // Otherwise, check if it looks like CSV data
  return hasDelimiters || hasNewlines || buffer.length < 100;
}
