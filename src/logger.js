/**
 * Simple logger utility with configurable levels
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

function formatMessage(level, message, ...args) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  
  // Handle error objects
  const formattedArgs = args.map(arg => {
    if (arg instanceof Error) {
      return `${arg.message}${currentLevel === LOG_LEVELS.debug ? '\n' + arg.stack : ''}`;
    }
    if (typeof arg === 'object') {
      return JSON.stringify(arg, null, 2);
    }
    return arg;
  });
  
  return `${prefix} ${message} ${formattedArgs.join(' ')}`.trim();
}

export const logger = {
  debug: (message, ...args) => {
    if (currentLevel <= LOG_LEVELS.debug) {
      console.log(formatMessage('debug', message, ...args));
    }
  },
  
  info: (message, ...args) => {
    if (currentLevel <= LOG_LEVELS.info) {
      console.log(formatMessage('info', message, ...args));
    }
  },
  
  warn: (message, ...args) => {
    if (currentLevel <= LOG_LEVELS.warn) {
      console.warn(formatMessage('warn', message, ...args));
    }
  },
  
  error: (message, ...args) => {
    if (currentLevel <= LOG_LEVELS.error) {
      console.error(formatMessage('error', message, ...args));
    }
  }
};
