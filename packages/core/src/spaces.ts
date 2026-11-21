import { SUBTASK_SEPARATOR, type DailyLog, type FocusData, type Settings, type Space, type SpacesFile, type SubtaskMap, type Snapshot } from './contracts';
import { addDays, key, parseKey, startOfDay, daysBetween } from './dates';
import { doneOn, getHabitStats } from './habits';

/** Id the main space (the shared settings and its log) uses in summaries and focus totals. */
export const MAIN_SPACE = 'main';
export const spaceColors = ['#58a6ff', '#ff9f43', '#39d353', '#f2cc60', '#ff5c5c', '#b392f0', '#56d4dd'];

export function subtaskEntry(task: string, subtask: string): string {
  return task + SUBTASK_SEPARATOR + subtask;
}

/** Subtask definitions for a space (`undefined` or MAIN_SPACE = the main space). */
export function subtaskMap(spaces: SpacesFile, space?: string): SubtaskMap {
  if (!space || space === MAIN_SPACE) return spaces.main.subtasks;
  return spaces.spaces.find(s => s.id === space)?.subtasks ?? {};
}

/** Settings as a space sees them: its own task list and first countdown, everything else shared. */
export function spaceSettings(settings: Settings, space: Space): Settings {
  const first = space.countdowns[0];
  return {
    ...settings,
    countdown: first ? { title: first.title, startDate: first.startDate, endDate: first.endDate } : settings.countdown,
    habits: { ...space.habits, focusThresholds: {} }
  };
}

export function spaceLog(snapshot: Pick<Snapshot, 'spaceLogs'>, space: string): DailyLog {
  return snapshot.spaceLogs[space] ?? {};
}

/** Subtasks of `task` done on `date`, in definition order. */
export function subtasksDone(log: DailyLog, date: string, task: string, subtasks: string[]): string[] {
  const entries = new Set(log[date] ?? []);
  return subtasks.filter(sub => entries.has(subtaskEntry(task, sub)));
}

function withDay(log: DailyLog, date: string, update: (entries: Set<string>) => void): DailyLog {
  const entries = new Set(log[date] ?? []);
  update(entries);
  const next = { ...log };
  if (entries.size) next[date] = [...entries];
  else delete next[date];
  return next;
}

/**
 * Ticks or unticks a task. A task with subtasks takes them along, so ticking it ticks all of them
 * and unticking it clears them. Mirrors `set_task` in the Rust store.
 */
export function toggleTask(log: DailyLog, date: string, task: string, done: boolean, subtasks: string[] = []): DailyLog {
  return withDay(log, date, entries => {
    for (const name of [task, ...subtasks.map(sub => subtaskEntry(task, sub))]) {
      if (done) entries.add(name); else entries.delete(name);
    }
  });
}

/** Ticks or unticks one subtask; the parent is done exactly when every subtask is. */
export function toggleSubtask(log: DailyLog, date: string, task: string, subtask: string, done: boolean, subtasks: string[]): DailyLog {
  if (!subtasks.includes(subtask)) throw new Error('Unknown subtask.');
  return withDay(log, date, entries => {
    const entry = subtaskEntry(task, subtask);
    if (done) entries.add(entry); else entries.delete(entry);
    if (subtasks.every(sub => entries.has(subtaskEntry(task, sub)))) entries.add(task);
    else entries.delete(task);
  });
}

/** Renames a task in a log, its subtask entries included. */
export function renameInLog(log: DailyLog, from: string, to: string): DailyLog {
  const prefix = from + SUBTASK_SEPARATOR;
  return Object.fromEntries(Object.entries(log).map(([day, entries]) => [day, [...new Set(entries.map(e =>
    e === from ? to : e.startsWith(prefix) ? to + SUBTASK_SEPARATOR + e.slice(prefix.length) : e))]]));
}

/** A new space with a unique id and log id and one starter task. */
export function newSpace(spaces: SpacesFile, name: string, today: string, color?: string): Space {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'space';
  const taken = new Set([MAIN_SPACE, ...spaces.spaces.map(s => s.id)]);
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  const logs = new Set(spaces.spaces.map(s => s.habits.logId));
  let logId = 'Space_' + id.replace(/-/g, '_'), m = 2;
  while (logs.has(logId)) logId = `Space_${id.replace(/-/g, '_')}_${m++}`;
  return {
    id, name: name.trim(), color: color ?? spaceColors[(spaces.spaces.length + 1) % spaceColors.length],
    habits: { title: `${name.trim()} tasks`.slice(0, 120), logId, startDate: today, endDate: '', tasks: ['First task'], archivedTasks: [], dayCompleteMin: 1 },
    subtasks: {}, countdowns: []
  };
}

/** Credited focus minutes per space between two date keys (inclusive). Unmapped sessions are the main space's. */
export function focusBySpace(focus: FocusData, spaces: SpacesFile, from: string, to: string): Record<string, number> {
  const totals: Record<string, number> = { [MAIN_SPACE]: 0 };
  for (const s of spaces.spaces) totals[s.id] = 0;
  const known = new Set(Object.keys(totals));
  for (const [date, day] of Object.entries(focus.baseline ?? {}))
    if (date >= from && date <= to) totals[MAIN_SPACE] += day.minutes;
  if (!focus.sessions) {
    for (const [date, day] of Object.entries(focus.days))
      if (date >= from && date <= to) totals[MAIN_SPACE] += day.minutes;
    return totals;
  }
  for (const [id, session] of Object.entries(focus.sessions)) {
    if (session.type !== 'focus' || session.date < from || session.date > to) continue;
    const space = spaces.focus[id]?.space;
    totals[space && known.has(space) ? space : MAIN_SPACE] += session.creditedMinutes;
  }
  return totals;
}

/** The space a running timer belongs to, if any. */
export function runningSpace(focus: FocusData, spaces: SpacesFile): string {
  const state = focus.state;
  if (!state) return MAIN_SPACE;
  const space = spaces.focus[String(state.start)]?.space;
  return space && spaces.spaces.some(s => s.id === space) ? space : MAIN_SPACE;
}

export interface SpaceSummary {
  id: string; name: string; color: string; title: string;
  tasks: number; todayDone: number; subtasksTotal: number; subtasksDone: number;
  currentStreak: number; percent: number; focusToday: number; focusWeek: number;
  /** Nearest countdown that has not ended: title and days left. */
  countdown: { title: string; daysLeft: number; percent: number } | null;
  running: boolean;
}

function nearestCountdown(items: { title: string; startDate: string; endDate: string }[], now: Date) {
  const today = startOfDay(now);
  const open = items
    .map(c => {
      const start = parseKey(c.startDate), end = parseKey(c.endDate);
      const total = daysBetween(end, start) + 1;
      const elapsed = Math.min(total, Math.max(0, daysBetween(today, start) + 1));
      return { title: c.title, daysLeft: Math.max(0, daysBetween(end, today)), percent: Math.round(elapsed / total * 100), end: c.endDate };
    })
    .filter(c => c.end >= key(today))
    .sort((a, b) => a.end.localeCompare(b.end));
  return open[0] ? { title: open[0].title, daysLeft: open[0].daysLeft, percent: open[0].percent } : null;
}

/** One row per space, main first, for the Overview page. */
export function spaceSummaries(snapshot: Snapshot, now: Date): SpaceSummary[] {
  const today = key(now), weekStart = key(addDays(now, -6));
  const focusToday = focusBySpace(snapshot.focus, snapshot.spaces, today, today);
  const focusWeek = focusBySpace(snapshot.focus, snapshot.spaces, weekStart, today);
  const running = snapshot.focus.state?.type === 'focus' ? runningSpace(snapshot.focus, snapshot.spaces) : null;
  const row = (id: string, name: string, color: string, settings: Settings, log: DailyLog, subtasks: SubtaskMap,
    countdowns: { title: string; startDate: string; endDate: string }[]): SpaceSummary => {
    const stats = getHabitStats(log, settings, now);
    let subtasksTotal = 0, subDone = 0;
    for (const task of settings.habits.tasks) {
      const subs = subtasks[task] ?? [];
      subtasksTotal += subs.length;
      subDone += subtasksDone(log, today, task, subs).length;
    }
    return {
      id, name, color, title: settings.habits.title, tasks: settings.habits.tasks.length,
      todayDone: doneOn(log, today, settings.habits.tasks).length, subtasksTotal, subtasksDone: subDone,
      currentStreak: stats.currentStreak, percent: stats.percent,
      focusToday: focusToday[id] ?? 0, focusWeek: focusWeek[id] ?? 0,
      countdown: nearestCountdown(countdowns, now), running: running === id
    };
  };
  const features = snapshot.preferences.features;
  const mainCountdowns = [
    ...(features.countdown ? [snapshot.settings.countdown] : []),
    ...features.extraCountdowns.items
  ];
  return [
    row(MAIN_SPACE, snapshot.spaces.main.name, snapshot.spaces.main.color, snapshot.settings, snapshot.dailyLog, snapshot.spaces.main.subtasks, mainCountdowns),
    ...snapshot.spaces.spaces.map(space => row(space.id, space.name, space.color, spaceSettings(snapshot.settings, space),
      spaceLog(snapshot, space.id), space.subtasks, space.countdowns))
  ];
}

/** The spaces file with `task`'s subtasks replaced (an empty list removes them). */
export function withSubtasks(spaces: SpacesFile, space: string | undefined, task: string, subtasks: string[]): SpacesFile {
  const next = structuredClone(spaces);
  const map = !space || space === MAIN_SPACE ? next.main.subtasks : next.spaces.find(s => s.id === space)?.subtasks;
  if (!map) throw new Error('That space no longer exists.');
  if (subtasks.length) map[task] = subtasks;
  else delete map[task];
  return next;
}
