/**
 * @param {number | string | undefined | null} value
 * @param {number} [digits]
 * @returns {string}
 */
export function formatTokenAmount(value, digits = 6) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) {
    return '0';
  }
  const safeMaxDigits = Math.max(0, Number.isFinite(digits) ? Math.floor(digits) : 6);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: safeMaxDigits,
  }).format(n);
}

/**
 * @param {string | undefined | null} address
 * @returns {string}
 */
export function shortAddress(address) {
  if (!address) {
    return '—';
  }
  const trimmed = String(address);
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-6)}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function explainError(value) {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  return 'Unexpected error';
}

/**
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
