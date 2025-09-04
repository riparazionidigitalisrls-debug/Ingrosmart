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
 * Main delivery function - OTTIMIZZATA PER 2 BACKUP ALTERNATI
 */
export async function deliver(buffer, timestamp) {
  const target = process.env.TARGET || 'fs';
  const catalogFilename = process.env.WP_DEST_FILE || 'ingrosmart_catalog.csv';
  
  // MODIFICA: Usa solo 2 file di backup che si alternano
  // Se siamo nei primi 30 minuti dell'ora usa backup_1, altrimenti backup_2
  const currentMinute = new Date().getMinutes();
  const backupSlot = currentMinute < 30 ? '1' : '2';
  const historyFilename = `ingrosmart_backup_${backupSlot}.csv`;
  
  logger.info(`Delivering to target: ${target}`);
  logger.info(`Using backup slot: ${backupSlot} (minute ${currentMinute})`);
  
  try {
    switch (target) {
      case 'wp':
        // Upload file principale (sempre sovrascritto)
        await uploadToWordPress(buffer, catalogFilename);
        
        // Upload file di backup (alterna tra backup_1 e backup_2)
        await uploadToWordPress(buffer, historyFilename);
        
        logger.info(`Files updated: ${catalogFilename} and ${historyFilename}`);
        break;
        
      case 's3':
        // Per S3 usa la stessa logica
        await uploadToS3(buffer, catalogFilename, false);
        await uploadToS3(buffer, historyFilename, true);
        break;
        
      case 'fs':
      default:
        // Per filesystem locale usa la stessa logica
        await saveToFileSystem(buffer, catalogFilename, false);
        await saveToFileSystem(buffer, historyFilename, true);
        break;
    }
    
    logger.info('Delivery completed successfully');
    logger.info(`Total files on server: 3 (main + 2 rotating backups)`);
  } catch (error) {
    logger.error('Delivery failed:', error);
    throw error;
  }
}

/**
 * Prune old history files - SEMPLIFICATA perché ora usiamo solo 2 backup
 */
export async function pruneHistory(target, keepCount) {
  // Non serve più fare pulizia perché usiamo solo 2 file di backup alternati
  logger.debug('History pruning not needed with rotating backup system');
  return;
}

/**
 * Funzioni di pulizia legacy (mantenute per compatibilità ma non usate)
 */
async function pruneLocalHistory(keepCount) {
  // Non più necessaria con il nuovo sistema
  logger.debug('Local pruning skipped - using rotating backups');
}

async function pruneS3History(keepCount) {
  // Non più necessaria con il nuovo sistema  
  logger.debug('S3 pruning skipped - using rotating backups');
}
