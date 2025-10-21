/**
 * Deep clone an object
 * @param {any} obj - Object to clone
 * @returns {any} Cloned object
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Calculate age from date of birth
 * @param {string} dob - Date of birth in ISO format
 * @returns {number} Age in years
 */
export function calculateAge(dob) {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

/**
 * Evaluate a condition against a value
 * @param {any} value - Value to check
 * @param {string} condition - Condition string (e.g., ">= 18", "< 2007-10-20")
 * @returns {boolean} Result of evaluation
 */
export function evaluateCondition(value, condition) {
  // Parse condition
  const operators = ['<=', '>=', '!=', '==', '<', '>'];
  let operator = null;
  let compareValue = null;
  
  for (const op of operators) {
    if (condition.includes(op)) {
      operator = op;
      compareValue = condition.split(op)[1].trim();
      break;
    }
  }
  
  if (!operator) {
    return false;
  }
  
  // Try to parse as number
  let val = value;
  let cmp = compareValue;
  
  if (!isNaN(value) && !isNaN(compareValue)) {
    val = Number(value);
    cmp = Number(compareValue);
  } else if (isValidDate(value) && isValidDate(compareValue)) {
    val = new Date(value).getTime();
    cmp = new Date(compareValue).getTime();
  }
  
  switch (operator) {
    case '>': return val > cmp;
    case '<': return val < cmp;
    case '>=': return val >= cmp;
    case '<=': return val <= cmp;
    case '==': return val == cmp;
    case '!=': return val != cmp;
    default: return false;
  }
}

/**
 * Check if string is a valid date
 * @param {string} str - String to check
 * @returns {boolean} True if valid date
 */
export function isValidDate(str) {
  const date = new Date(str);
  return date instanceof Date && !isNaN(date);
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get current timestamp in seconds
 * @returns {number} Current timestamp
 */
export function getCurrentTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Validate block structure
 * @param {Object} block - Block to validate
 * @returns {boolean} True if valid
 */
export function isValidBlockStructure(block) {
  return (
    block &&
    typeof block.hash === 'string' &&
    typeof block.encryptedData === 'object' &&
    typeof block.tokens === 'object' &&
    typeof block.metadata === 'object' &&
    (block.prevHash === null || typeof block.prevHash === 'string') &&
    typeof block.signature === 'string'
  );
}

/**
 * Check if IP is in local network
 * @param {string} ip - IP address
 * @returns {boolean} True if local
 */
export function isLocalIP(ip) {
  return ip.startsWith('192.168.') || 
         ip.startsWith('10.') || 
         ip.startsWith('172.16.') ||
         ip === '127.0.0.1' ||
         ip === 'localhost';
}

/**
 * Parse IP with port
 * @param {string} address - Address string
 * @returns {{ip: string, port: number}|null}
 */
export function parseAddress(address) {
  const parts = address.split(':');
  if (parts.length === 2) {
    return {
      ip: parts[0],
      port: parseInt(parts[1])
    };
  }
  return null;
}
