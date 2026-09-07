import { TextInput, type TextInputProps } from 'react-native';

import { formatAmountInput, isZeroDecimalCurrency, sanitizeAmountInput } from '@/lib/format';

interface Props extends Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType'> {
  /** Raw numeric string or number, e.g. "1234000", "1234.5", 4500. */
  value: string | number | null | undefined;
  /** Receives the sanitized raw numeric string (no separators). */
  onChangeText: (raw: string) => void;
  /** Currency code (e.g. 'KRW', 'USD'). Defaults to 'KRW' (zero-decimals, 1-won units). */
  currency?: string;
  /** Explicitly override whether decimals are allowed. Defaults to !isZeroDecimalCurrency(currency). */
  allowDecimals?: boolean;
}

/**
 * Numeric TextInput that shows thousands separators (1,234,000) while keeping
 * the stored value a plain numeric string, so callers can still use Number(value).
 * For KRW (and zero-decimal currencies), decimals (.00) are automatically stripped.
 */
export function AmountInput({
  value,
  onChangeText,
  currency = 'KRW',
  allowDecimals,
  ...rest
}: Props) {
  const shouldAllowDecimals = allowDecimals !== undefined ? allowDecimals : !isZeroDecimalCurrency(currency);
  const rawStr = value !== null && value !== undefined ? String(value) : '';

  return (
    <TextInput
      {...rest}
      keyboardType={shouldAllowDecimals ? 'numeric' : 'number-pad'}
      value={formatAmountInput(rawStr, shouldAllowDecimals)}
      onChangeText={(text) => onChangeText(sanitizeAmountInput(text, shouldAllowDecimals))}
    />
  );
}
