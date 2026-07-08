export function formatCurrency(amount: string | number, currency = 'KRW'): string {
  const num = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(num)) return String(amount);
  try {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(num);
  } catch {
    return `${num.toLocaleString('ko-KR')} ${currency}`;
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR');
}

/**
 * Keep only digits and a single decimal point from raw user input, so the
 * stored value stays a plain numeric string (e.g. "1234000" or "1234.5").
 */
export function sanitizeAmountInput(text: string): string {
  const cleaned = text.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

/**
 * Format a raw numeric string with thousands separators for display, while
 * preserving what the user is typing (including a trailing decimal point).
 */
export function formatAmountInput(raw: string): string {
  if (!raw) return '';
  const hasDot = raw.includes('.');
  const [intRaw, ...decParts] = raw.split('.');
  const intStripped = intRaw.replace(/^0+(?=\d)/, '') || '0';
  const intFormatted = intStripped.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return hasDot ? `${intFormatted}.${decParts.join('')}` : intFormatted;
}
