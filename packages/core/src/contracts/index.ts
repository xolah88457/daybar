import { z } from 'zod';

export const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}, 'Invalid calendar date');
const minutesOfDay = z.number().int().min(0).max(1439);
const epoch = z.number().int().nonnegative();
const positive = z.number().int().min(1).max(240);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const name = z.string().trim().min(1).max(120);
const opacity = z.number().min(0).max(1);
export const dailyLogSchema = z.union([z.record(dateKeySchema, z.array(name)), z.array(dateKeySchema)]);
export type DailyLog = Record<string, string[]>;
const timerStateSchema = z.object({
  type: z.enum(['focus', 'break']), minutes: positive, start: epoch, end: epoch, task: name.optional()
}).strict().refine(s => s.end - s.start === s.minutes * 60000, 'Timer duration must match planned minutes');
const focusDaySchema = z.object({ count: z.number().int().min(0).max(0xffffffff), minutes: z.number().int().min(0).max(0xffffffff) }).strict();
const sessionSchema = z.object({
  type: z.enum(['focus', 'break']), minutes: positive, creditedMinutes: z.number().int().nonnegative().max(240),
  end: epoch, date: dateKeySchema, task: name.optional()
}).strict().refine(s => s.creditedMinutes <= s.minutes && (s.type === 'focus' || s.creditedMinutes === 0), 'Invalid session credit');
export const focusDataSchema = z.object({
  state: timerStateSchema.nullable(), days: z.record(dateKeySchema, focusDaySchema),
  sessions: z.record(z.string().regex(/^(?:0|[1-9]\d*)$/).refine(id => Number.isSafeInteger(Number(id)), 'Session key out of range'), sessionSchema).optional(),
  baseline: z.record(dateKeySchema, focusDaySchema).optional()
}).strict().superRefine((data, ctx) => {
  if (data.sessions === undefined) {
    if (data.baseline && [...new Set([...Object.keys(data.days), ...Object.keys(data.baseline)])].some(date =>
      (data.days[date]?.minutes ?? 0) !== (data.baseline?.[date]?.minutes ?? 0))) {
      ctx.addIssue({ code: 'custom', path: ['baseline'], message: 'Baseline disagrees with legacy days; manual recovery needed' });
    }
    return;
  }
  const totals = new Map(Object.entries(data.baseline ?? {}).map(([date, day]) => [date, day.minutes]));
  for (const [id, session] of Object.entries(data.sessions)) {
    const elapsed = session.end - Number(id);
    const dateOffset = Math.abs(Date.parse(`${session.date}T00:00:00Z`) / 86400000 - Math.floor(session.end / 86400000));
    if (elapsed < 0 || elapsed > session.minutes * 60000 || session.creditedMinutes * 60000 > elapsed || dateOffset > 1) {
      ctx.addIssue({ code: 'custom', path: ['sessions', id], message: 'Invalid session timestamps, credit or date' });
    }
    if (session.type === 'focus') totals.set(session.date, (totals.get(session.date) ?? 0) + session.creditedMinutes);
  }
  for (const [date, day] of Object.entries(data.days)) {
    // Never turn unexplained history into an empty or smaller ledger-derived total.
    if (day.minutes > (totals.get(date) ?? 0)) ctx.addIssue({ code: 'custom', path: ['days', date], message: 'Untracked focus minutes; preserve/recover the legacy baseline before editing' });
  }
  if ([...totals.values()].some(minutes => minutes > 0xffffffff)) ctx.addIssue({ code: 'custom', path: ['sessions'], message: 'Focus total overflow' });
});
const sleepPlanSchema = z.object({ start: dateKeySchema, wake: minutesOfDay, bed: minutesOfDay }).strict();
export const sleepDataSchema = z.object({
  wakes: z.record(dateKeySchema, minutesOfDay), beds: z.record(dateKeySchema, minutesOfDay), plan: sleepPlanSchema.nullable()
}).strict();

const countdownSettingsSchema = z.object({
  startDate: dateKeySchema.default('2026-10-01'), endDate: dateKeySchema.default('2027-07-01'), title: name.default('Community Garden Opening')
}).strict();
const habitSettingsSchema = z.object({
  startDate: dateKeySchema.default('2026-11-01'), endDate: z.union([dateKeySchema, z.literal('')]).default(''),
  title: name.default('Daily Tasks'), logId: z.string().regex(/^[a-zA-Z0-9_]+$/).default('Daily_Tasks'),
  tasks: z.array(name).min(1).refine(xs => new Set(xs).size === xs.length, 'Duplicate tasks').default(['Read a chapter', 'Sketch a scene', 'Take a walk', 'Water the plants']),
  archivedTasks: z.array(name).default([]), dayCompleteMin: z.number().int().min(1).default(1),
  focusThresholds: z.record(name, z.number().int().min(1).max(1440)).default({})
}).strict();
const focusSettingsSchema = z.object({
  title: name.default('Focus'), focusOptions: z.array(positive).min(1).default([25,50]),
  breakOptions: z.array(positive).min(1).default([5,10]), longBreakOptions: z.array(positive).min(1).default([15,30]),
  blockMinutes: positive.default(25), alerts: z.boolean().default(true)
}).strict();
const sleepSettingsSchema = z.object({
  title: name.default('Time'), awakeHours: z.number().min(1).max(24).default(16), sleepHours: z.number().min(1).max(24).default(8),
  targetWake: clock.default('08:00'), targetBed: z.union([clock, z.literal('')]).default(''),
  stepMinutes: positive.default(15), averageDays: z.number().int().min(1).max(365).default(7),
  bedtimeAlerts: z.boolean().default(true), routineMinutes: z.number().int().min(0).max(1440).default(120),
  noPhoneMinutes: z.number().int().min(0).max(1440).default(60)
}).strict();
const appearanceSchema = z.object({
  background: color.default('#0d1117'), text: color.default('#ffffff'), green: color.default('#39d353'),
  blue: color.default('#58a6ff'), red: color.default('#ff5c5c'), orange: color.default('#ff9f43'), yellow: color.default('#f2cc60'),
  emptyOpacity: opacity.default(0.05), minDoneOpacity: opacity.default(0.3), futureOpacity: opacity.default(0.12),
  rows: z.literal(7).default(7), cellSize: z.number().min(3).max(30).default(10), gap: z.number().min(0).max(10).default(2), radius: z.number().min(0).max(10).default(2)
}).strict();
export const settingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  countdown: countdownSettingsSchema.default(() => countdownSettingsSchema.parse({})),
  habits: habitSettingsSchema.default(() => habitSettingsSchema.parse({})),
  focus: focusSettingsSchema.default(() => focusSettingsSchema.parse({})),
  sleep: sleepSettingsSchema.default(() => sleepSettingsSchema.parse({})),
  appearance: appearanceSchema.default(() => appearanceSchema.parse({}))
}).strict().superRefine((s, ctx) => {
  if (s.countdown.endDate < s.countdown.startDate || (s.habits.endDate && s.habits.endDate < s.habits.startDate)) ctx.addIssue({code:'custom',message:'End date precedes start date'});
  if (s.habits.dayCompleteMin > s.habits.tasks.length) ctx.addIssue({code:'custom',message:'Completion minimum exceeds task count'});
  if (s.sleep.noPhoneMinutes > s.sleep.routineMinutes) ctx.addIssue({code:'custom',message:'No-phone phase must follow routine'});
});
export const defaultSettings = settingsSchema.parse({});
export type Settings = z.infer<typeof settingsSchema>;
export type TimerState = z.infer<typeof timerStateSchema>;
export type FocusDay = z.infer<typeof focusDaySchema>;
export type FocusSession = z.infer<typeof sessionSchema>;
export type FocusData = z.infer<typeof focusDataSchema>;
export type SleepPlan = z.infer<typeof sleepPlanSchema>;
export type SleepData = z.infer<typeof sleepDataSchema>;

// App-local feature toggles and configuration. Mac-only: never part of the shared settings.json.
const clockOrOff = z.union([clock, z.literal('')]);
const flag = z.boolean().default(false);
// A feature that starts on (see docs/DECISIONS.md 012); `flag` features start off.
const on = z.boolean().default(true);
const nameList = z.array(name).max(100).default([]);
const toggleOnly = z.object({ enabled: on }).strict();
const radarSchema = z.object({
  enabled: on, calendars: nameList, reminderLists: nameList, includeReminders: z.boolean().default(true),
  daysAhead: z.number().int().min(1).max(365).default(60), overdueDaysBack: z.number().int().min(0).max(90).default(14),
  keywords: nameList, dueAlerts: on, alertTime: clock.default('09:00')
}).strict();
const hourlyChimeSchema = z.object({
  enabled: flag, quietStart: clock.default('22:00'), quietEnd: clock.default('08:00'), sound: z.boolean().default(true)
}).strict();
const checkInsSchema = z.object({
  enabled: on, morningTime: clockOrOff.default('08:00'), eveningTime: clockOrOff.default('20:00')
}).strict();
const streakSaverSchema = z.object({ enabled: on, minutesBeforeBed: z.number().int().min(0).max(720).default(90) }).strict();
const autoCycleSchema = z.object({ enabled: flag, longBreakEvery: z.number().int().min(2).max(12).default(4) }).strict();
// The native side refuses a NUL byte in a Shortcut name, so refuse it here too.
const shortcutName = z.string().max(120).refine((v) => !v.includes('\u0000'), 'A Shortcut name cannot contain a NUL character').default('');
const focusShortcutsSchema = z.object({ enabled: on, onStart: shortcutName, onEnd: shortcutName }).strict();
const awayDetectionSchema = z.object({ enabled: on, idleMinutes: z.number().int().min(1).max(60).default(5) }).strict();
const movementNudgesSchema = z.object({
  enabled: flag, intervalMinutes: z.number().int().min(10).max(240).default(50),
  activeStart: clock.default('09:00'), activeEnd: clock.default('18:00')
}).strict();
const extraCountdownSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), title: name, startDate: dateKeySchema, endDate: dateKeySchema
}).strict().refine(c => c.endDate >= c.startDate, 'End date precedes start date');
const extraCountdownsSchema = z.object({
  enabled: on,
  items: z.array(extraCountdownSchema).max(12).refine(xs => new Set(xs.map(x => x.id)).size === xs.length, 'Duplicate countdown IDs').default([])
}).strict();
export const featuresSchema = z.object({
  countdown: z.boolean().default(true), habits: z.boolean().default(true), focus: z.boolean().default(true), sleep: z.boolean().default(true),
  radar: radarSchema.default(() => radarSchema.parse({})), roomBeforeEvent: toggleOnly.default(() => toggleOnly.parse({})), hourlyChime: hourlyChimeSchema.default(() => hourlyChimeSchema.parse({})), checkIns: checkInsSchema.default(() => checkInsSchema.parse({})),
  streakSaver: streakSaverSchema.default(() => streakSaverSchema.parse({})), autoCycle: autoCycleSchema.default(() => autoCycleSchema.parse({})), focusShortcuts: focusShortcutsSchema.default(() => focusShortcutsSchema.parse({})),
  awayDetection: awayDetectionSchema.default(() => awayDetectionSchema.parse({})), movementNudges: movementNudgesSchema.default(() => movementNudgesSchema.parse({})), insights: toggleOnly.default(() => toggleOnly.parse({})),
  exportHistory: toggleOnly.default(() => toggleOnly.parse({})), commandPalette: toggleOnly.default(() => toggleOnly.parse({})), extraCountdowns: extraCountdownsSchema.default(() => extraCountdownsSchema.parse({}))
}).strict();
export const defaultFeatures = featuresSchema.parse({});
export type Features = z.infer<typeof featuresSchema>;
export type RadarConfig = Features['radar'];
export type RoomBeforeEventConfig = Features['roomBeforeEvent'];
export type HourlyChimeConfig = Features['hourlyChime'];
export type CheckInsConfig = Features['checkIns'];
export type StreakSaverConfig = Features['streakSaver'];
export type AutoCycleConfig = Features['autoCycle'];
export type FocusShortcutsConfig = Features['focusShortcuts'];
export type AwayDetectionConfig = Features['awayDetection'];
export type MovementNudgesConfig = Features['movementNudges'];
export type InsightsConfig = Features['insights'];
export type ExportHistoryConfig = Features['exportHistory'];
export type CommandPaletteConfig = Features['commandPalette'];
export type ExtraCountdownsConfig = Features['extraCountdowns'];
export type ExtraCountdown = ExtraCountdownsConfig['items'][number];

/** Bumped when feature defaults change; 2 = the useful features start on (0.3.1). */
export const currentFeaturesVersion = 2;
export const preferencesSchema = z.object({
  dataFolder: z.string(), realData: z.boolean(), launchAtLogin: z.boolean(), hideDock: z.boolean(), globalShortcut: z.string(),
  themeMode: z.enum(['day', 'night', 'auto']).default('night'),
  trayDisplay: z.enum(['auto', 'focusMinutes', 'focusHours', 'focusBlocks', 'activeTimer', 'bedtime', 'nextTask', 'countdown', 'nextDeadline']).default('auto'),
  features: featuresSchema.default(() => featuresSchema.parse({})),
  // Which feature defaults this file has been brought up to. The Mac app upgrades older files once.
  featuresVersion: z.number().int().min(0).default(currentFeaturesVersion),
  // False only for a brand-new install until the guided setup is finished or skipped; files
  // written before the setup existed load as done.
  setupDone: z.boolean().default(true)
}).strict();
export type Preferences = z.infer<typeof preferencesSchema>;
// Spaces (decision 015): extra task lists such as Work and Personal, each with its own history file
// `daily-log-<logId>.json`, countdowns and focus credit. Stored in `daybar-spaces.json` beside the
// shared files. The phone scripts never read it, so the phone keeps showing the main space.
/** Separates a task from its subtask in a daily-log entry: "Workout › Stretch". */
export const SUBTASK_SEPARATOR = ' \u203a ';
const spaceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
const logIdSchema = z.string().regex(/^[a-zA-Z0-9_]+$/).max(60);
const subtaskMapSchema = z.record(name, z.array(name).max(30)).default({}).superRefine((map, ctx) => {
  for (const [task, subs] of Object.entries(map)) {
    if (new Set(subs).size !== subs.length) ctx.addIssue({ code: 'custom', path: [task], message: 'Duplicate subtasks' });
    for (const sub of subs) if ((task + SUBTASK_SEPARATOR + sub).length > 120) ctx.addIssue({ code: 'custom', path: [task], message: 'Task and subtask together must be 120 characters or fewer' });
  }
});
const spaceHabitsSchema = z.object({
  title: name, logId: logIdSchema, startDate: dateKeySchema, endDate: z.union([dateKeySchema, z.literal('')]).default(''),
  tasks: z.array(name).min(1).max(50).refine(xs => new Set(xs).size === xs.length, 'Duplicate tasks'),
  archivedTasks: z.array(name).default([]), dayCompleteMin: z.number().int().min(1).default(1)
}).strict().refine(h => h.dayCompleteMin <= h.tasks.length, 'Completion minimum exceeds task count')
  .refine(h => !h.endDate || h.endDate >= h.startDate, 'End date precedes start date');
const spaceSchema = z.object({
  id: spaceIdSchema, name, color,
  habits: spaceHabitsSchema, subtasks: subtaskMapSchema,
  countdowns: z.array(extraCountdownSchema).max(12).refine(xs => new Set(xs.map(x => x.id)).size === xs.length, 'Duplicate countdown IDs').default([])
}).strict();
const spaceFocusSchema = z.object({ space: spaceIdSchema, task: name.optional() }).strict();
export const spacesFileSchema = z.object({
  version: z.literal(1).default(1),
  main: z.object({ name: name.default('Personal'), color: color.default('#58a6ff'), subtasks: subtaskMapSchema }).strict().default(() => ({ name: 'Personal', color: '#58a6ff', subtasks: {} })),
  spaces: z.array(spaceSchema).max(12).default([]).superRefine((xs, ctx) => {
    if (new Set(xs.map(x => x.id)).size !== xs.length) ctx.addIssue({ code: 'custom', message: 'Duplicate space IDs' });
    if (new Set(xs.map(x => x.habits.logId)).size !== xs.length) ctx.addIssue({ code: 'custom', message: 'Two spaces share a log ID' });
  }),
  // Which space a focus session (keyed by its start epoch, like the focus ledger) was started in.
  focus: z.record(z.string().regex(/^(?:0|[1-9]\d*)$/), spaceFocusSchema).default({})
}).strict();
export const defaultSpaces = spacesFileSchema.parse({});
export type SpacesFile = z.infer<typeof spacesFileSchema>;
export type Space = SpacesFile['spaces'][number];
export type SpaceHabits = Space['habits'];
export type SubtaskMap = Space['subtasks'];

export type Operation =
  | { kind: 'set_task'; date: string; task: string; done: boolean; space?: string }
  | { kind: 'set_subtask'; date: string; task: string; subtask: string; done: boolean; space?: string }
  | { kind: 'rename_task'; from: string; to: string; space?: string }
  | { kind: 'archive_task'; task: string; space?: string }
  | { kind: 'start_timer'; timerType: 'focus' | 'break'; minutes: number; task?: string; space?: string }
  | { kind: 'save_spaces'; spaces: SpacesFile }
  | { kind: 'reset_starter' }
  | { kind: 'stop_timer' }
  | { kind: 'settle_timer' }
  | { kind: 'log_sleep'; entry: 'wake' | 'bed'; timestamp: number }
  | { kind: 'start_plan' }
  | { kind: 'stop_plan' }
  | { kind: 'clear_sleep' }
  | { kind: 'save_settings'; settings: Settings };
export interface DataIssue { file: string; message: string }
export interface Conflict { file: string; canonical: string }
export interface Snapshot {
  settings: Settings; dailyLog: DailyLog; focus: FocusData; sleep: SleepData;
  spaces: SpacesFile; spaceLogs: Record<string, DailyLog>;
  preferences: Preferences; issues: DataIssue[]; conflicts: Conflict[];
}
export interface MutationResult { snapshot: Snapshot; creditedMinutes?: number; message?: string }
export interface DaybarClient {
  snapshot(): Promise<Snapshot>;
  mutate(operation: Operation): Promise<MutationResult>;
  setPreferences(preferences: Preferences): Promise<Snapshot>;
  resolveConflict(file: string, action: 'merge' | 'discard'): Promise<Snapshot>;
  subscribe(onChange: () => void): Promise<() => void>;
}
