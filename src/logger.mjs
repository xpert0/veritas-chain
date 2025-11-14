const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// Initialize log level from environment variable or default to INFO
const envLogLevel = process.env.LOG_LEVEL?.toUpperCase();
let currentLevel = LOG_LEVELS[envLogLevel] !== undefined ? LOG_LEVELS[envLogLevel] : LOG_LEVELS.INFO;

/**
 * Set logging level
 * @param {string} level - Log level (ERROR, WARN, INFO, DEBUG)
 */
export function setLogLevel(level) {
  if (LOG_LEVELS[level] !== undefined) {
    currentLevel = LOG_LEVELS[level];
  }
}

/**
 * Format timestamp
 * @returns {string} Formatted timestamp
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Log error message
 * @param {string} message - Message to log
 * @param {any} data - Additional data
 */
export function error(message, data = null) {
  if (currentLevel >= LOG_LEVELS.ERROR) {
    console.error(`[${getTimestamp()}] [ERROR]`, message, data || '');
  }
}

/**
 * Log warning message
 * @param {string} message - Message to log
 * @param {any} data - Additional data
 */
export function warn(message, data = null) {
  if (currentLevel >= LOG_LEVELS.WARN) {
    console.warn(`[${getTimestamp()}] [WARN]`, message, data || '');
  }
}

/**
 * Log info message
 * @param {string} message - Message to log
 * @param {any} data - Additional data
 */
export function info(message, data = null) {
  if (currentLevel >= LOG_LEVELS.INFO) {
    console.log(`[${getTimestamp()}] [INFO]`, message, data || '');
  }
}

/**
 * Log debug message
 * @param {string} message - Message to log
 * @param {any} data - Additional data
 */
export function debug(message, data = null) {
  if (currentLevel >= LOG_LEVELS.DEBUG) {
    console.log(`[${getTimestamp()}] [DEBUG]`, message, data || '');
  }
}

export default { error, warn, info, debug, setLogLevel };
