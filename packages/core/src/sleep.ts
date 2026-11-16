import { sleepDataSchema, type Settings, type SleepData } from './contracts';
import { addDays, daysBetween, finite, key, parseKey, startOfDay, validDate } from './dates';

export function wrap(m: number): number { finite(m); return ((Math.round(m) % 1440) + 1440) % 1440; }
export function signedDiff(from: number, to: number): number {
  finite(from); finite(to);
  return ((((to - from + 720) % 1440) + 1440) % 1440) - 720;
}
export function circMean(list: number[]): number | null {
  if (!list.length) return null;
  let s = 0, c = 0;
  for (const m of list) { finite(m); const a = m / 1440 * 2 * Math.PI; s += Math.sin(a); c += Math.cos(a); }
  return wrap(Math.atan2(s, c) / (2 * Math.PI) * 1440);
}
export function toMin(hhmm: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) throw new RangeError('Invalid HH:MM');
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
export function atMinutes(day: Date, m: number): Date {
  validDate(day); finite(m);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
}
export function fmtDuration(mins: number): string {
  finite(mins); mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h === 0 ? `${m}m` : m ? `${h}h ${m}m` : `${h}h`;
}
export function parseWhen(v: unknown, now: Date = new Date()): {date: Date; hasDay: boolean} | null {
  validDate(now);
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : { date: new Date(v), hasDay: true };
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  if (!s) return null;
  const direct = new Date(s.replace(/\s+at\s+/i, ' '));
  if (!Number.isNaN(direct.getTime()) && /\d{4}|\d{1,2}\/\d{1,2}/.test(s)) return { date: direct, hasDay: true };
  const t = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?\.?[Mm]?/);
  if (!t) return null;
  let h = +t[1];
  const ap = t[3]?.toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || +t[2] > 59) return null;
  const d = new Date(now);
  d.setHours(h, +t[2], 0, 0);
  return { date: d, hasDay: false };
}
export function resolveDates(strs: string[], now: Date): Date[] | null {
  validDate(now);
  const parsed = strs.map(s => parseWhen(s, now));
  if (!parsed.length || parsed.some(p => !p)) return null;
  const out: Date[] = new Array(parsed.length);
  let ref = new Date(now.getTime() + 60000);
  for (let i = parsed.length - 1; i >= 0; i--) {
    const p = parsed[i]!;
    let d = p.date;
    // Legacy addDays resets the clock when rolling a time-only entry backwards.
    if (!p.hasDay) while (d > ref) d = addDays(d, -1);
    out[i] = d; ref = d;
  }
  return out;
}
export function findSleepSessions(starts: Date[], ends: Date[]): {s: Date; e: Date}[] {
  starts.forEach(validDate); ends.forEach(validDate);
  const segs: {s: Date; e: Date}[] = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) if (ends[i] > starts[i]) segs.push({ s: new Date(starts[i]), e: new Date(ends[i]) });
  segs.sort((a, b) => a.s.getTime() - b.s.getTime());
  const sessions: {s: Date; e: Date}[] = [];
  let cur: {s: Date; e: Date} | null = null;
  for (const seg of segs) {
    if (cur && seg.s.getTime() - cur.e.getTime() <= 2 * 3600000) { if (seg.e > cur.e) cur.e = seg.e; }
    else { cur = { ...seg }; sessions.push(cur); }
  }
  return sessions.filter(x => x.e.getTime() - x.s.getTime() >= 3 * 3600000);
}
export function recentAvg(map: Record<string, number>, averageDays: number): {mean: number | null; n: number} {
  if (!Number.isInteger(averageDays) || averageDays < 1) throw new RangeError('Invalid average window');
  const keys = Object.keys(map).sort().slice(-averageDays);
  return { mean: circMean(keys.map(k => map[k])), n: keys.length };
}
export function baseline(data: SleepData, settings: Settings) {
  const w = recentAvg(data.wakes, settings.sleep.averageDays), b = recentAvg(data.beds, settings.sleep.averageDays);
  if (w.mean === null) return null;
  const bedEst = b.mean === null;
  return { wake: w.mean, bed: bedEst ? wrap(w.mean - settings.sleep.sleepHours * 60) : b.mean!, nWake: w.n, nBed: b.n, bedEst };
}
export function shiftToward(start: number, target: number, k: number, stepMinutes: number): number {
  finite(k); finite(stepMinutes);
  if (k < 0 || stepMinutes <= 0) throw new RangeError('Invalid plan step');
  const d = signedDiff(start, target);
  return wrap(start + Math.sign(d) * Math.min(Math.abs(d), stepMinutes * k));
}
function targets(settings: Settings) {
  const wake = toMin(settings.sleep.targetWake);
  return { wake, bed: settings.sleep.targetBed ? toMin(settings.sleep.targetBed) : wrap(wake - settings.sleep.sleepHours * 60) };
}
export function planDays(st: {wake: number; bed: number}, settings: Settings): number {
  const t = targets(settings);
  return Math.ceil(Math.max(Math.abs(signedDiff(st.wake, t.wake)), Math.abs(signedDiff(st.bed, t.bed))) / settings.sleep.stepMinutes);
}
export function currentState(data: SleepData, now: Date, settings: Settings): {wake: Date; logged: boolean; asleep: boolean} {
  validDate(now);
  let best: Date | null = null;
  for (const k of Object.keys(data.wakes).sort().slice(-3)) {
    const d = atMinutes(parseKey(k), data.wakes[k]);
    if (d <= now && (now.getTime() - d.getTime()) / 3600000 < settings.sleep.awakeHours + 6 && (!best || d > best)) best = d;
  }
  if (best) return { wake: best, logged: true, asleep: false };
  const today = startOfDay(now), t = targets(settings);
  let estMin = t.wake;
  if (data.plan) estMin = shiftToward(data.plan.wake, t.wake, Math.max(0, daysBetween(today, parseKey(data.plan.start))), settings.sleep.stepMinutes);
  else estMin = baseline(data, settings)?.wake ?? estMin;
  const wake = atMinutes(today, estMin);
  return { wake, logged: false, asleep: now < wake };
}
export function getSleepView(data: SleepData, now: Date, settings: Settings) {
  const st = currentState(data, now, settings), s = settings.sleep, a = settings.appearance;
  let bed = new Date(st.wake.getTime() + s.awakeHours * 3600000), planIndex: number | null = null;
  if (data.plan) {
    planIndex = Math.max(0, daysBetween(st.wake, parseKey(data.plan.start)));
    const goal = shiftToward(data.plan.bed, targets(settings).bed, planIndex + 1, s.stepMinutes);
    let offset = 0;
    bed = atMinutes(startOfDay(st.wake), goal);
    while (bed.getTime() - st.wake.getTime() < 3600000) bed = atMinutes(addDays(st.wake, ++offset), goal);
  }
  const elapsedMinutes = (now.getTime() - st.wake.getTime()) / 60000, leftMinutes = (bed.getTime() - now.getTime()) / 60000;
  const progress = st.asleep ? 0 : Math.min(1, Math.max(0, elapsedMinutes / Math.max(1, (bed.getTime() - st.wake.getTime()) / 60000)));
  const color = st.asleep ? a.text : leftMinutes <= 0 ? a.red : leftMinutes <= 120 ? a.yellow : a.green;
  const phase = !st.asleep && leftMinutes > 0 ? leftMinutes <= s.noPhoneMinutes ? 'No phone time' : leftMinutes <= s.routineMinutes ? 'Night routine • bed prep' : null : null;
  const status = st.asleep ? `Wake in ${fmtDuration((st.wake.getTime() - now.getTime()) / 60000)}` : leftMinutes <= 0 ? `Past bedtime by ${fmtDuration(-leftMinutes)}` : `${fmtDuration(leftMinutes)} until bed`;
  return { ...st, bed, elapsedMinutes, leftMinutes, progress, color, phase, status, planIndex };
}
export function getPlanNights(data: SleepData, now: Date, settings: Settings) {
  validDate(now);
  const start = data.plan ?? baseline(data, settings);
  if (!start) return [];
  const t = targets(settings), current = data.plan ? Math.max(0, daysBetween(now, parseKey(data.plan.start))) + 1 : -1;
  return Array.from({length: planDays(start, settings)}, (_, i) => ({ night: i + 1,
    wake: shiftToward(start.wake, t.wake, i + 1, settings.sleep.stepMinutes),
    bed: shiftToward(start.bed, t.bed, i + 1, settings.sleep.stepMinutes), current: i + 1 === current }));
}
export function logSleep(data: SleepData, entry: 'wake' | 'bed', date: Date): SleepData {
  validDate(date);
  if (entry !== 'wake' && entry !== 'bed') throw new RangeError('Invalid sleep entry');
  const out = sleepDataSchema.parse(data);
  const day = entry === 'bed' && date.getHours() < 12 ? addDays(date, -1) : date;
  out[entry === 'wake' ? 'wakes' : 'beds'][key(day)] = date.getHours() * 60 + date.getMinutes();
  return out;
}
