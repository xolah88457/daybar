import { dateKeySchema } from './contracts';

export function validDate(d: Date): void {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) throw new RangeError('Invalid date');
}
export function finite(n: number): void {
  if (!Number.isFinite(n)) throw new RangeError('Expected a finite number');
}
export function key(d: Date): string {
  validDate(d);
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseKey(s: string): Date {
  dateKeySchema.parse(s);
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function startOfDay(d: Date): Date {
  validDate(d);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d: Date, n: number): Date {
  validDate(d);
  if (!Number.isInteger(n)) throw new RangeError('Expected whole calendar days');
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);
}
