import type { ChecklistItem, ChecklistMonth } from './types';

export type ChecklistField = 'checked_funded' | 'checked_paid' | 'checked_amount';

export const CHECKLIST_FIELDS: { key: ChecklistField; label: string }[] = [
  { key: 'checked_funded', label: '이체' },
  { key: 'checked_paid', label: '납부' },
  { key: 'checked_amount', label: '금액' },
];

export function currentPeriod(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${y}년 ${m}월`;
}

/** Recompute counts after toggling a box locally (mirrors the server's rules). */
export function summarize(items: ChecklistItem[]): Pick<ChecklistMonth, 'total' | 'completed' | 'in_progress' | 'pending'> {
  const completed = items.filter((i) => i.done).length;
  const pending = items.filter((i) => !(i.checked_funded || i.checked_paid || i.checked_amount)).length;
  return { total: items.length, completed, pending, in_progress: items.length - completed - pending };
}

export function withToggle(item: ChecklistItem, field: ChecklistField, value: boolean): ChecklistItem {
  const next = { ...item, [field]: value };
  return { ...next, done: next.checked_funded && next.checked_paid && next.checked_amount };
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole days from today until the due date (negative = already past). */
export function daysUntil(dueIso: string, now = new Date()): number {
  const [y, m, d] = dueIso.split('-').map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - startOfDay(now)) / 86400000);
}
