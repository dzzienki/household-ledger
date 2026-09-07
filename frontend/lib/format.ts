export const ZERO_DECIMAL_CURRENCIES = new Set(['KRW', 'JPY', 'VND']);

export function isZeroDecimalCurrency(currency = 'KRW'): boolean {
  return ZERO_DECIMAL_CURRENCIES.has((currency || 'KRW').toUpperCase());
}

export function formatCurrency(amount: string | number, currency = 'KRW'): string {
  const num = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(num)) return String(amount);
  const isZeroDec = isZeroDecimalCurrency(currency);
  try {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency,
      maximumFractionDigits: isZeroDec ? 0 : 2,
    }).format(num);
  } catch {
    const formattedNum = isZeroDec
      ? Math.round(num).toLocaleString('ko-KR')
      : num.toLocaleString('ko-KR');
    return `${formattedNum} ${currency}`;
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR');
}

/**
 * Keep only digits (and a single decimal point if allowed) from raw user input,
 * so the stored value stays a plain numeric string.
 * For KRW (and zero-decimal currencies), decimals are completely disallowed (1원 단위).
 */
export function sanitizeAmountInput(text: string, allowDecimals = false): string {
  if (!allowDecimals) {
    return text.split('.')[0].replace(/[^\d]/g, '');
  }
  const cleaned = text.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

/**
 * Format a raw numeric string with thousands separators for display.
 * If allowDecimals is false (default for KRW), any fractional part (.00, .5) is stripped,
 * formatting strictly in 3-digit comma groups (,000) at 1-unit granularity.
 */
export function formatAmountInput(raw: string | number | null | undefined, allowDecimals = false): string {
  if (raw === null || raw === undefined) return '';
  const str = String(raw).trim();
  if (!str) return '';

  if (!allowDecimals) {
    const intDigits = str.split('.')[0].replace(/[^\d]/g, '');
    if (!intDigits) return '';
    const intStripped = intDigits.replace(/^0+(?=\d)/, '');
    return intStripped.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  const hasDot = str.includes('.');
  const [intPart, ...decParts] = str.split('.');
  const intDigits = intPart.replace(/[^\d]/g, '');
  const intStripped = intDigits.replace(/^0+(?=\d)/, '') || (intDigits === '0' ? '0' : '');
  const intFormatted = intStripped.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decClean = decParts.join('').replace(/[^\d]/g, '');
  return hasDot ? `${intFormatted}.${decClean}` : intFormatted;
}
