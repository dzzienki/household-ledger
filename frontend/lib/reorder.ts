import { api } from './api';

/** Copy of `list` with the item at `index` moved one step; null if it can't move. */
export function moveItem<T>(list: T[], index: number, delta: -1 | 1): T[] | null {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return null;
  const next = list.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Persist the order of the rules currently on screen (shared by checklist + recurring). */
export function saveOrder(ledgerId: string, recurringIds: string[]): Promise<void> {
  return api(`/api/ledgers/${ledgerId}/checklist/order`, { method: 'PUT', body: { recurring_ids: recurringIds } });
}

/** Drop the manual order; lists go back to due-date order. */
export function resetOrder(ledgerId: string): Promise<void> {
  return api(`/api/ledgers/${ledgerId}/checklist/order`, { method: 'DELETE' });
}
