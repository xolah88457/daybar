import type { Settings, SleepData } from './contracts';
import { getSleepView } from './sleep';

/**
 * Helpers for the notification features (hourly chime, check-ins, streak saver, movement nudges):
 * clock parsing and labels, and the "next time it fires" previews shown in Settings. The authoritative
 * schedule lives in Rust (`src-tauri/src/features`); these mirror its rules closely enough for a
 * preview and ignore running focus timers and the night routine.
 */

const DAY = 1440;
const STEP_MS = 15 * 60_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `"HH:MM"` to minutes after midnight, or `null` for anything else (including `""`). */
export function parseClock(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** `"15:00"` or 900 to `"3:00 pm"`; an empty or invalid value reads `"off"`. */
export function formatClock(value: string | number): string {
  const minutes = typeof value === 'number' ? value : parseClock(value);
  if (minutes === null || !Number.isFinite(minutes)) return 'off';
  const h = Math.floor(minutes / 60) % 24, m = Math.round(minutes) % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
/** A date's local time as `"3:00 pm"`. */
export function formatTime(d: Date): string {
  return formatClock(d.getHours() * 60 + d.getMinutes());
}
/** Whether `minute` lies in the half-open window `[start, end)`, which may wrap midnight; equal ends are empty. */
export function inWindow(minute: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
/** `"Next: 3:00 pm"`, `"Next: tomorrow 8:00 am"`, `"Next: Mon 8:00 am"` or `"Next: not scheduled"`. */
export function describeNext(at: Date | null, now: Date): string {
  if (!at) return 'Next: not scheduled';
  const day = (d: Date) => Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
  const apart = day(at) - day(now), time = formatTime(at);
  if (apart <= 0) return `Next: ${time}`;
  return `Next: ${apart === 1 ? 'tomorrow' : WEEKDAYS[at.getDay()]} ${time}`;
}
/** Local wall-clock time on `base`'s date plus `dayShift` days (a time in a DST gap moves forward). */
function wall(base: Date, dayShift: number, minutes: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayShift, 0, minutes);
}

/** The next whole local hour, outside quiet hours, strictly after `now`; one per real hour across DST. */
export function nextHourlyChime(now: Date, cfg: { quietStart: string; quietEnd: string }): Date | null {
  const qs = parseClock(cfg.quietStart), qe = parseClock(cfg.quietEnd);
  const first = (Math.floor(now.getTime() / STEP_MS) + 1) * STEP_MS;
  for (let k = 0; k <= 4 * 49; k++) {
    const t = new Date(first + k * STEP_MS);
    if (t.getMinutes() !== 0 || t.getSeconds() !== 0) continue;
    if (qs !== null && qe !== null && inWindow(t.getHours() * 60 + t.getMinutes(), qs, qe)) continue;
    return t;
  }
  return null;
}
/** The next movement slot: every interval from the window start, inside `[start, end)`, every day. */
export function nextMovementNudge(
  now: Date, cfg: { intervalMinutes: number; activeStart: string; activeEnd: string }
): Date | null {
  const start = parseClock(cfg.activeStart), end = parseClock(cfg.activeEnd);
  if (start === null || end === null || !(cfg.intervalMinutes > 0)) return null;
  const length = (end + DAY - start) % DAY;
  let best: Date | null = null;
  for (let shift = -1; shift <= 1; shift++) {
    for (let offset = 0; offset < length; offset += cfg.intervalMinutes) {
      const t = wall(now, shift, start + offset);
      if (t > now && (!best || t < best)) best = t;
    }
  }
  return best;
}
/** The soonest morning or evening check-in after `now`. */
export function nextCheckIn(
  now: Date, cfg: { morningTime: string; eveningTime: string }
): { kind: 'morning' | 'evening'; at: Date } | null {
  let best: { kind: 'morning' | 'evening'; at: Date } | null = null;
  for (const [kind, time] of [['morning', cfg.morningTime], ['evening', cfg.eveningTime]] as const) {
    const minutes = parseClock(time);
    if (minutes === null) continue;
    for (let shift = -1; shift <= 1; shift++) {
      const at = wall(now, shift, minutes);
      if (at > now && (!best || at < best.at)) best = { kind, at };
    }
  }
  return best;
}
/** Tonight's streak-saver time: bedtime minus the lead, or `null` once it has passed or no bedtime exists. */
export function nextStreakSaver(data: SleepData, settings: Settings, now: Date, minutesBeforeBed: number): Date | null {
  try {
    const at = new Date(getSleepView(data, now, settings).bed.getTime() - minutesBeforeBed * 60_000);
    return at > now ? at : null;
  } catch { return null; }
}
