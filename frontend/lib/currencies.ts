export interface CurrencyOption {
  code: string;
  label: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: 'KRW', label: '원 (KRW)' },
  { code: 'USD', label: '달러 (USD)' },
  { code: 'EUR', label: '유로 (EUR)' },
  { code: 'JPY', label: '엔 (JPY)' },
  { code: 'CNY', label: '위안 (CNY)' },
  { code: 'GBP', label: '파운드 (GBP)' },
  { code: 'AUD', label: '호주 달러 (AUD)' },
  { code: 'CAD', label: '캐나다 달러 (CAD)' },
  { code: 'HKD', label: '홍콩 달러 (HKD)' },
  { code: 'SGD', label: '싱가포르 달러 (SGD)' },
  { code: 'THB', label: '바트 (THB)' },
  { code: 'VND', label: '동 (VND)' },
];

/** currency code -> rate_to_base (how many base units one unit of `currency` is worth). */
export type RateMap = Record<string, number>;

export function ratesToMap(rates: { currency: string; rate_to_base: string }[]): RateMap {
  const map: RateMap = {};
  for (const r of rates) map[r.currency.toUpperCase()] = Number(r.rate_to_base);
  return map;
}

/** Convert an amount in `currency` into the ledger base currency. */
export function convertToBase(
  amount: number,
  currency: string,
  base: string,
  rates: RateMap,
): number {
  const cur = currency.toUpperCase();
  if (cur === base.toUpperCase()) return amount;
  const rate = rates[cur];
  return rate ? amount * rate : amount;
}
