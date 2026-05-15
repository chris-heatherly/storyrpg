const SENSITIVE_KEY_RE = /(api[_-]?key|token|secret|password|authorization|bearer)/i;
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-api03-[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bapikey-[A-Za-z0-9_-]{12,}\b/g,
];

function sanitizeString(value) {
  return SECRET_VALUE_PATTERNS.reduce(
    (next, pattern) => next.replace(pattern, '[redacted]'),
    value,
  );
}

function sanitizeJobState(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeJobState);

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      result[key] = typeof child === 'string' && child.trim() ? '[redacted]' : child;
    } else if (typeof child === 'string') {
      result[key] = sanitizeString(child);
    } else if (child && typeof child === 'object') {
      result[key] = sanitizeJobState(child);
    } else {
      result[key] = child;
    }
  }
  return result;
}

module.exports = {
  sanitizeJobState,
};
