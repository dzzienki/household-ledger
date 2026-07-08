import type { RecurrenceFrequency } from './types';

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** Days that exist in every month, so a monthly rule never skips a month. */
export const SAFE_MONTH_DAYS = 28;

/** Max selectable day for a given month (Feb capped at 28 to dodge leap years). */
export function monthMaxDay(month: number): number {
  if (month === 2) return 28;
  return [1, 3, 5, 7, 8, 10, 12].includes(month) ? 31 : 30;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface Schedule {
  weekday: number; // 0 (Sun) – 6 (Sat), used for weekly
  day: number; // 1 – 31, used for monthly / yearly
  month: number; // 1 – 12, used for yearly
}

/** First occurrence (today or the next matching date) for the chosen schedule. */
export function computeStartDate(frequency: RecurrenceFrequency, s: Schedule): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (frequency === 'daily') return toISO(today);

  if (frequency === 'weekly') {
    const d = new Date(today);
    const diff = (s.weekday - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
    return toISO(d);
  }

  if (frequency === 'monthly') {
    let d = new Date(today.getFullYear(), today.getMonth(), s.day);
    if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, s.day);
    return toISO(d);
  }

  // yearly
  let d = new Date(today.getFullYear(), s.month - 1, s.day);
  if (d < today) d = new Date(today.getFullYear() + 1, s.month - 1, s.day);
  return toISO(d);
}

/** Recover the picker state from a stored start_date (for editing). */
export function scheduleFromDate(startISO: string | null): Schedule {
  const today = new Date();
  const d = startISO ? new Date(`${startISO}T00:00:00`) : today;
  return {
    weekday: d.getDay(),
    day: Math.min(d.getDate(), SAFE_MONTH_DAYS),
    month: d.getMonth() + 1,
  };
}

/** Human-readable pattern like "매월 15일" derived from the anchor date. */
export function describeSchedule(frequency: RecurrenceFrequency, startISO: string): string {
  const d = new Date(`${startISO}T00:00:00`);
  switch (frequency) {
    case 'daily':
      return '매일';
    case 'weekly':
      return `매주 ${WEEKDAYS[d.getDay()]}요일`;
    case 'monthly':
      return `매월 ${d.getDate()}일`;
    case 'yearly':
      return `매년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
    default:
      return '';
  }
}
