// Browser-demo twin of src-tauri/src/features/export.rs. The desktop app writes its files natively;
// the demo has no filesystem, so it formats the same files here and offers them as downloads.
// Keep the columns and escaping in step with the Rust side.
import { addDays, key, parseKey } from '@daybar/core';
import type { Snapshot } from '@daybar/core/contracts';

export interface ExportFile { name: string; type: string; text: string }

/** One CSV field per RFC 4180: quoted when it holds a comma, quote, CR or LF; `"` is doubled. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
export const csvRow = (fields: string[]): string => `${fields.map(csvField).join(',')}\r\n`;

const clock = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const isoUtc = (ms: number) => {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

export function focusSessionsCsv(s: Snapshot): string {
  let out = csvRow(['date', 'type', 'planned_minutes', 'credited_minutes', 'start_utc', 'end_utc', 'task']);
  const rows = Object.entries(s.focus.sessions ?? {})
    .map(([id, session]) => ({ start: Number(id), session }))
    .sort((a, b) => a.start - b.start);
  for (const { start, session: x } of rows)
    out += csvRow([x.date, x.type, String(x.minutes), String(x.creditedMinutes), isoUtc(start), isoUtc(x.end), x.task ?? '']);
  return out;
}
export function focusDaysCsv(s: Snapshot): string {
  let out = csvRow(['date', 'blocks', 'minutes']);
  for (const date of Object.keys(s.focus.days).sort())
    out += csvRow([date, String(s.focus.days[date].count), String(s.focus.days[date].minutes)]);
  return out;
}
/** Active tasks get a row for every day from the start date to today (or the end date); other tasks only where done. */
export function habitsCsv(s: Snapshot, today: Date): string {
  let out = csvRow(['date', 'task', 'done']);
  const h = s.settings.habits, tasks = h.tasks;
  const todayKey = key(today);
  const last = h.endDate && h.endDate < todayKey ? h.endDate : todayKey;
  const dates = new Set(Object.keys(s.dailyLog));
  for (let d = parseKey(h.startDate); key(d) <= last; d = addDays(d, 1)) dates.add(key(d));
  const inRange = (date: string) => date >= h.startDate && date <= last;
  const done = (date: string, task: string) => (s.dailyLog[date] ?? []).includes(task);
  for (const date of [...dates].sort()) {
    for (const task of tasks) if (inRange(date) || done(date, task)) out += csvRow([date, task, String(done(date, task))]);
    for (const task of new Set(s.dailyLog[date] ?? [])) if (!tasks.includes(task)) out += csvRow([date, task, 'true']);
  }
  return out;
}
export function sleepCsv(s: Snapshot): string {
  let out = csvRow(['date', 'wake', 'bed']);
  for (const date of [...new Set([...Object.keys(s.sleep.wakes), ...Object.keys(s.sleep.beds)])].sort()) {
    const wake = s.sleep.wakes[date], bed = s.sleep.beds[date];
    out += csvRow([date, wake === undefined ? '' : clock(wake), bed === undefined ? '' : clock(bed)]);
  }
  return out;
}
export function csvFiles(s: Snapshot, today: Date): ExportFile[] {
  const csv = (name: string, text: string) => ({ name, type: 'text/csv', text });
  return [
    csv('focus-sessions.csv', focusSessionsCsv(s)),
    csv('focus-days.csv', focusDaysCsv(s)),
    csv('habits.csv', habitsCsv(s, today)),
    csv('sleep.csv', sleepCsv(s))
  ];
}
export function jsonFile(s: Snapshot, now: Date): ExportFile {
  const dailyLog = Object.fromEntries(Object.entries(s.dailyLog).sort(([a], [b]) => (a < b ? -1 : 1)));
  const text = JSON.stringify(
    { app: 'Daybar', exportVersion: 1, exportedAt: isoUtc(now.getTime()), settings: s.settings, dailyLog, focus: s.focus, sleep: s.sleep },
    null,
    2
  );
  return { name: 'daybar-export.json', type: 'application/json', text: `${text}\n` };
}
