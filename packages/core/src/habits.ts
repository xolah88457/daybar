import { dailyLogSchema, type DailyLog, type Settings } from './contracts';
import { addDays, daysBetween, finite, key, parseKey, startOfDay } from './dates';

export interface GridCell { date: string; color: string; opacity: number; count?: number }

export function blend(a: string, b: string, t: number): string {
  if (![a, b].every(c => /^#[\da-f]{6}$/i.test(c))) throw new RangeError('Invalid hex color');
  finite(t);
  if (t < 0 || t > 1) throw new RangeError('Blend must be between zero and one');
  return '#' + [1, 3, 5].map(i => {
    const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16);
    return Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  }).join('');
}
export function dayColor(n: number, settings: Settings): string {
  finite(n);
  const total = settings.habits.tasks.length, a = settings.appearance;
  if (n >= total) return a.green;
  const t = total === 2 ? 0.5 : (n - 1) / (total - 2);
  const colors = [a.red, a.orange, a.yellow];
  const pos = Math.min(2, Math.max(0, t * 2)), i = Math.min(1, Math.floor(pos));
  return blend(colors[i], colors[i + 1], pos - i);
}
export function normalizeLog(raw: DailyLog | string[], tasks: string[]): DailyLog {
  const parsed = dailyLogSchema.parse(raw);
  return Array.isArray(parsed) ? Object.fromEntries(parsed.map(d => [d, [...tasks]])) : parsed;
}
export function doneOn(log: DailyLog, date: string, tasks: string[]): string[] {
  return (log[date] || []).filter(t => tasks.includes(t));
}
export function getHabitStats(log: DailyLog, settings: Settings, now: Date) {
  const h = settings.habits, start = parseKey(h.startDate), end = h.endDate ? parseKey(h.endDate) : null;
  const today = startOfDay(now), total = end ? daysBetween(end, start) + 1 : null;
  let elapsed = Math.max(0, daysBetween(today, start) + 1);
  if (total !== null) elapsed = Math.min(elapsed, total);
  let completedDays = 0, longestStreak = 0, run = 0;
  const counts: Record<string, number> = Object.fromEntries(h.tasks.map(t => [t, 0]));
  for (let i = 0; i < elapsed; i++) {
    const done = doneOn(log, key(addDays(start, i)), h.tasks);
    for (const t of new Set(done)) counts[t]++;
    if (done.length >= h.dayCompleteMin) { completedDays++; run++; longestStreak = Math.max(longestStreak, run); }
    else run = 0;
  }
  // An unfinished today does not break yesterday's streak until the day is over.
  let currentStreak = run;
  if (elapsed > 0 && key(addDays(start, elapsed - 1)) === key(today) && doneOn(log, key(today), h.tasks).length < h.dayCompleteMin) {
    currentStreak = 0;
    for (let i = elapsed - 2; i >= 0 && doneOn(log, key(addDays(start, i)), h.tasks).length >= h.dayCompleteMin; i--) currentStreak++;
  }
  return {
    elapsed, total, completedDays, missedDays: Math.max(0, elapsed - completedDays),
    todayDone: doneOn(log, key(today), h.tasks).length,
    daysLeft: end ? Math.max(0, daysBetween(end, today)) : null,
    percent: elapsed > 0 ? Math.round(completedDays / elapsed * 100) : 0,
    currentStreak, longestStreak,
    taskRates: Object.fromEntries(h.tasks.map(t => [t, elapsed ? counts[t] / elapsed * 100 : 0]))
  };
}
export function getHabitGrid(log: DailyLog, settings: Settings, now: Date, width: number) {
  finite(width);
  if (width <= 0) throw new RangeError('Width must be positive');
  const h = settings.habits, a = settings.appearance, today = startOfDay(now);
  const start = parseKey(h.startDate), end = h.endDate ? parseKey(h.endDate) : null;
  // Width is the available content width: the UI owns outer padding.
  // Large configured gaps must not consume the entire width of a narrow rolling grid.
  const columns = end ? Math.ceil((daysBetween(end, start) + 1) / 7) : Math.max(1, Math.min(Math.round((width + a.gap) / (a.cellSize + a.gap)), a.gap ? Math.ceil(width / a.gap) : Infinity));
  const cellSize = end ? Math.max(3, Math.min(a.cellSize, Math.floor((width - (columns - 1) * a.gap) / columns))) : (width - (columns - 1) * a.gap) / columns;
  const gridStart = end ? start : addDays(today, -(columns * 7 - 1));
  const cells: (GridCell | null)[] = [];
  for (let row = 0; row < 7; row++) for (let col = 0; col < columns; col++) {
    const date = addDays(gridStart, col * 7 + row);
    if (end && date > end) { cells.push(null); continue; }
    const count = doneOn(log, key(date), h.tasks).length;
    cells.push({ date: key(date), count, color: count > 0 ? dayColor(count, settings) : a.text,
      opacity: count > 0 ? Math.min(1, a.minDoneOpacity + count / h.tasks.length * (1 - a.minDoneOpacity)) : date > today ? a.futureOpacity : a.emptyOpacity });
  }
  return { cells, columns, cellSize };
}
export function getCountdown(settings: Settings, now: Date) {
  const start = parseKey(settings.countdown.startDate), end = parseKey(settings.countdown.endDate);
  const today = startOfDay(now), fraction = (now.getTime() - today.getTime()) / 86400000, a = settings.appearance;
  const total = daysBetween(end, start) + 1;
  const elapsed = Math.min(total, Math.max(0, daysBetween(today, start) + 1));
  const daysLeft = Math.max(0, daysBetween(end, today)), columns = Math.ceil(total / 7);
  const cells: (GridCell | null)[] = [];
  for (let row = 0; row < 7; row++) for (let col = 0; col < columns; col++) {
    const date = addDays(start, col * 7 + row);
    if (date > end) { cells.push(null); continue; }
    const diff = daysBetween(date, today);
    cells.push({ date: key(date), color: diff < 0 ? a.green : a.text,
      opacity: diff < 0 ? 1 : diff === 0 ? a.emptyOpacity + fraction * (1 - a.emptyOpacity) : a.emptyOpacity });
  }
  return { total, elapsed, daysLeft, percent: Math.round(Math.min(1, Math.max(0, (elapsed - 1 + fraction) / total)) * 100), weeksLeft: Math.floor(daysLeft / 7), columns, cells };
}
