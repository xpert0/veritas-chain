export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

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

export function evaluateCondition(value, condition) {
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
    case '==': return String(val) === String(cmp);
    case '!=': return String(val) !== String(cmp);
    default: return false;
  }
}

export function isValidDate(str) {
  const date = new Date(str);
  return date instanceof Date && !isNaN(date);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getCurrentTimestamp() {
  return Math.floor(Date.now() / 1000);
}

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

export function isLocalIP(ip) {
  return ip.startsWith('192.168.') || 
         ip.startsWith('10.') || 
         ip.startsWith('172.16.') ||
         ip === '127.0.0.1' ||
         ip === 'localhost';
}

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
