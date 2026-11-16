import { focusDataSchema, type FocusData, type FocusDay, type Settings, type TimerState } from './contracts';
import { finite, key, validDate } from './dates';

function checkBlock(blockMinutes: number): void {
  if (!Number.isInteger(blockMinutes) || blockMinutes < 1 || blockMinutes > 240) throw new RangeError('Invalid block length');
}
export function normalizeFocus(data: FocusData, blockMinutes: number): FocusData {
  checkBlock(blockMinutes);
  const out = focusDataSchema.parse(data);
  // Capture old totals exactly once; derived totals must never become a new baseline.
  if (out.sessions === undefined) { out.baseline ??= structuredClone(out.days); out.sessions = {}; }
  out.days = structuredClone(out.baseline ?? {});
  for (const s of Object.values(out.sessions)) {
    if (s.type !== 'focus' || s.creditedMinutes === 0) continue;
    const day = out.days[s.date] ?? { count: 0, minutes: 0 };
    day.minutes += s.creditedMinutes;
    out.days[s.date] = day;
  }
  for (const day of Object.values(out.days)) day.count = Math.floor(day.minutes / blockMinutes);
  return out;
}
function credit(data: FocusData, at: Date, creditedMinutes: number, blockMinutes: number): {data: FocusData; creditedMinutes: number} {
  const out = normalizeFocus(data, blockMinutes), s = out.state;
  if (!s) return { data: out, creditedMinutes: 0 };
  const id = String(s.start);
  let added = 0;
  if (!Object.hasOwn(out.sessions!, id)) {
    out.sessions![id] = { type: s.type, minutes: s.minutes, creditedMinutes, end: at.getTime(), date: key(at), ...(s.task ? { task: s.task } : {}) };
    added = creditedMinutes;
  }
  out.state = null;
  return { data: normalizeFocus(out, blockMinutes), creditedMinutes: added };
}
export function settleFocus(data: FocusData, now: Date, blockMinutes: number): FocusData {
  validDate(now);
  const out = normalizeFocus(data, blockMinutes), s = out.state;
  return s && now.getTime() >= s.end ? credit(out, new Date(s.end), s.type === 'focus' ? s.minutes : 0, blockMinutes).data : out;
}
export function startFocus(data: FocusData, type: 'focus' | 'break', minutes: number, now: Date, blockMinutes: number, task?: string): FocusData {
  validDate(now);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240 || !['focus', 'break'].includes(type)) throw new RangeError('Invalid timer');
  if (task !== undefined && (!task.trim() || task.length > 120)) throw new RangeError('Invalid task');
  const out = settleFocus(data, now, blockMinutes);
  if (out.state) throw new Error('Stop the active timer before starting another');
  if (Object.hasOwn(out.sessions!, String(now.getTime()))) throw new Error('A session already exists at this start time');
  out.state = { type, minutes, start: now.getTime(), end: now.getTime() + minutes * 60000, ...(task ? { task } : {}) };
  return focusDataSchema.parse(out);
}
export function stopFocus(data: FocusData, now: Date, blockMinutes: number): {data: FocusData; creditedMinutes: number} {
  validDate(now);
  const out = normalizeFocus(data, blockMinutes), s = out.state;
  if (!s) return { data: out, creditedMinutes: 0 };
  // Expired timers settle to their end date even if Stop is clicked on a later day.
  const at = now.getTime() >= s.end ? new Date(s.end) : now;
  const minutes = s.type === 'focus' ? Math.max(0, Math.min(s.minutes, Math.floor((at.getTime() - s.start) / 60000))) : 0;
  return credit(out, at, minutes, blockMinutes);
}
export function formatCountdown(state: TimerState | null, now: Date): string {
  validDate(now);
  const seconds = state ? Math.max(0, Math.ceil((state.end - now.getTime()) / 1000)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function roomForBlocks(leftMinutes: number, blockMinutes: number): number {
  finite(leftMinutes); checkBlock(blockMinutes);
  return Math.max(0, Math.floor(leftMinutes / blockMinutes));
}
export function linkedTasks(data: FocusData, settings: Settings, date: string): string[] {
  const minutes = new Map<string, number>();
  for (const s of Object.values(data.sessions ?? {})) {
    if (s.type === 'focus' && s.date === date && s.task) minutes.set(s.task, (minutes.get(s.task) ?? 0) + s.creditedMinutes);
  }
  return settings.habits.tasks.filter(t => settings.habits.focusThresholds[t] > 0 && (minutes.get(t) ?? 0) >= settings.habits.focusThresholds[t]);
}
export function getFocusBlocks(day: FocusDay | undefined, settings: Settings, width: number) {
  finite(width);
  if (width <= 0) throw new RangeError('Width must be positive');
  const a = settings.appearance;
  const columns = Math.max(1, Math.min(Math.round((width + a.gap) / (a.cellSize + a.gap)), a.gap ? Math.ceil(width / a.gap) : Infinity));
  const count = Math.floor((day?.minutes ?? 0) / settings.focus.blockMinutes);
  return { columns, cellSize: (width - (columns - 1) * a.gap) / columns,
    cells: Array.from({length: columns}, (_, i) => ({ color: i < count ? a.green : a.text, opacity: i < count ? 1 : a.futureOpacity })) };
}
