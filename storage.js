import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';
import FormData from 'form-data';
import { Readable } from 'stream';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Upload to WordPress via REST API
 */
async function uploadToWordPress(buffer, filename) {
  const wpConfig = {
    baseUrl: process.env.WP_BASE_URL,
    user: process.env.WP_USER,
    appPass: process.env.WP_APP_PASS,
    uploadPath: process.env.WP_UPLOAD_PATH || '/wp-content/uploads/ingrosmart/',
    destFile: process.env.WP_DEST_FILE || 'ingrosmart_catalog.csv'
  };
  
  if (!wpConfig.baseUrl || !wpConfig.user || !wpConfig.appPass) {
    throw new Error('Missing WordPress configuration (WP_BASE_URL, WP_USER, WP_APP_PASS)');
  }
  
  const form = new FormData();
  
  // Convert buffer to stream for form-data
  const stream = Readable.from(buffer);
  form.append('file', stream, {
    filename: filename,
    contentType: 'text/csv'
  });
  form.append('filename', filename);
  
  // Basic auth with Application Password
  // WP Application Passwords don't need username in the password field
  const auth = Buffer.from(`${wpConfig.user}:${wpConfig.appPass.replace(/\s/g, '')}`).toString('base64');
  
  try {
    const response = await axios.post(
      `${wpConfig.baseUrl}/wp-json/ingro/v1/upload`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Basic ${auth}`
        },
        maxBodyLength: Infinity,
        timeout: 60000
      }
    );
    
    if (response.data.ok) {
      logger.info(`WordPress upload successful: ${response.data.path} (${response.data.size} bytes)`);
      return response.data;
    } else {
      throw new Error(`WordPress upload failed: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    if (error.response) {
      throw new Error(`WordPress API error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * Upload to S3/B2
 */
async function uploadToS3(buffer, filename, isHistory = false) {
  const s3Config = {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET,
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    keyPrefix: process.env.S3_KEY_PREFIX || 'ingrosmart/ingrosmart_catalog.csv',
    keyPrefixHistory: process.env.S3_KEY_PREFIX_HISTORY || 'ingrosmart/history/'
  };
  
  if (!s3Config.endpoint || !s3Config.bucket || !s3Config.accessKey || !s3Config.secretKey) {
    throw new Error('Missing S3 configuration');
  }
  
  const client = new S3Client({
    endpoint: s3Config.endpoint,
    region: s3Config.region,
    credentials: {
      accessKeyId: s3Config.accessKey,
      secretAccessKey: s3Config.secretKey
    },
    // Only use forcePathStyle for S3-compatible services (not AWS)
    forcePathStyle: !s3Config.endpoint.includes('amazonaws.com')
  });
  
  const key = isHistory 
    ? `${s3Config.keyPrefixHistory}${filename}`
    : s3Config.keyPrefix;
  
  const command = new PutObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
    Body: buffer,
    ContentType: 'text/csv',
    ContentDisposition: `attachment; filename="${filename}"`
  });
  
  try {
    const response = await client.send(command);
    logger.info(`S3 upload successful: ${key} (${buffer.length} bytes)`);
    return response;
  } catch (error) {
    throw new Error(`S3 upload failed: ${error.message}`);
  }
}

/**
 * Save to local filesystem
 */
async function saveToFileSystem(buffer, filename, isHistory = false) {
  const outputDir = path.join(__dirname, '..', 'output');
  const historyDir = path.join(outputDir, 'history');
  
  // Create directories if they don't exist
  await fs.mkdir(historyDir, { recursive: true });
  
  const filePath = isHistory
    ? path.join(historyDir, filename)
    : path.join(outputDir, 'ingrosmart_catalog.csv');
  
  await fs.writeFile(filePath, buffer);
  logger.info(`File saved: ${filePath} (${buffer.length} bytes)`);
  
  return filePath;
}

/**
 * Main delivery function
 */
export async function deliver(buffer, timestamp) {
  const target = process.env.TARGET || 'fs';
  const historyFilename = `ingrosmart-${timestamp}.csv`;
  const catalogFilename = process.env.WP_DEST_FILE || 'ingrosmart_catalog.csv';
  
  logger.info(`Delivering to target: ${target}`);
  
  try {
    switch (target) {
      case 'wp':
        // Upload fixed file
        await uploadToWordPress(buffer, catalogFilename);
        // Upload historical file
        await uploadToWordPress(buffer, historyFilename);
        break;
        
      case 's3':
        // Upload fixed file
        await uploadToS3(buffer, catalogFilename, false);
        // Upload historical file
        await uploadToS3(buffer, historyFilename, true);
        break;
        
      case 'fs':
      default:
        // Save fixed file
        await saveToFileSystem(buffer, catalogFilename, false);
        // Save historical file
        await saveToFileSystem(buffer, historyFilename, true);
        break;
    }
    
    logger.info('Delivery completed successfully');
  } catch (error) {
    logger.error('Delivery failed:', error);
    throw error;
  }
}

/**
 * Prune old history files
 */
export async function pruneHistory(target, keepCount) {
  if (keepCount <= 0) return;
  
  logger.debug(`Pruning history, keeping last ${keepCount} files`);
  
  try {
    switch (target) {
      case 's3':
        await pruneS3History(keepCount);
        break;
        
      case 'fs':
        await pruneLocalHistory(keepCount);
        break;
        
      case 'wp':
        // WordPress pruning would need server-side implementation
        logger.debug('History pruning not implemented for WordPress target');
        break;
    }
  } catch (error) {
    logger.warn('History pruning failed:', error.message);
    // Don't fail the main process for pruning errors
  }
}

/**
 * Prune local filesystem history
 */
async function pruneLocalHistory(keepCount) {
  const historyDir = path.join(__dirname, '..', 'output', 'history');
  
  try {
    const files = await fs.readdir(historyDir);
    const csvFiles = files
      .filter(f => f.startsWith('ingrosmart-') && f.endsWith('.csv'))
      .sort()
      .reverse();
    
    if (csvFiles.length > keepCount) {
      const toDelete = csvFiles.slice(keepCount);
      
      for (const file of toDelete) {
        const filePath = path.join(historyDir, file);
        await fs.unlink(filePath);
        logger.debug(`Deleted old history file: ${file}`);
      }
      
      logger.info(`Pruned ${toDelete.length} old history files`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Prune S3 history
 */
async function pruneS3History(keepCount) {
  const s3Config = {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET,
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    keyPrefixHistory: process.env.S3_KEY_PREFIX_HISTORY || 'ingrosmart/history/'
  };
  
  if (!s3Config.endpoint || !s3Config.bucket) {
    return;
  }
  
  const client = new S3Client({
    endpoint: s3Config.endpoint,
    region: s3Config.region,
    credentials: {
      accessKeyId: s3Config.accessKey,
      secretAccessKey: s3Config.secretKey
    },
    // Only use forcePathStyle for S3-compatible services (not AWS)
    forcePathStyle: !s3Config.endpoint.includes('amazonaws.com')
  });
  
  // List objects in history prefix
  const listCommand = new ListObjectsV2Command({
    Bucket: s3Config.bucket,
    Prefix: s3Config.keyPrefixHistory,
    MaxKeys: 1000
  });
  
  const listResponse = await client.send(listCommand);
  
  if (!listResponse.Contents || listResponse.Contents.length <= keepCount) {
    return;
  }
  
  // Sort by LastModified descending
  const sorted = listResponse.Contents
    .filter(obj => obj.Key.includes('ingrosmart-') && obj.Key.endsWith('.csv'))
    .sort((a, b) => b.LastModified - a.LastModified);
  
  if (sorted.length <= keepCount) {
    return;
  }
  
  // Delete oldest files
  const toDelete = sorted.slice(keepCount);
  
  for (const obj of toDelete) {
    const deleteCommand = new DeleteObjectCommand({
      Bucket: s3Config.bucket,
      Key: obj.Key
    });
    
    await client.send(deleteCommand);
    logger.debug(`Deleted S3 history file: ${obj.Key}`);
  }
  
  logger.info(`Pruned ${toDelete.length} old S3 history files`);
}