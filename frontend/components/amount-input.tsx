import { TextInput, type TextInputProps } from 'react-native';

import { formatAmountInput, sanitizeAmountInput } from '@/lib/format';

interface Props extends Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType'> {
  /** Raw numeric string, e.g. "1234000" or "1234.5". */
  value: string;
  /** Receives the sanitized raw numeric string (no separators). */
  onChangeText: (raw: string) => void;
}

/**
 * Numeric TextInput that shows thousands separators (1,234,000) while keeping
 * the stored value a plain numeric string, so callers can still use Number(value).
 */
export function AmountInput({ value, onChangeText, ...rest }: Props) {
  return (
    <TextInput
      {...rest}
      keyboardType="numeric"
      value={formatAmountInput(value)}
      onChangeText={(text) => onChangeText(sanitizeAmountInput(text))}
    />
  );
}
