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

export const preferencesSchema = z.object({
  dataFolder: z.string(), realData: z.boolean(), launchAtLogin: z.boolean(), hideDock: z.boolean(), globalShortcut: z.string(),
  themeMode: z.enum(['day', 'night', 'auto']).default('night'),
  trayDisplay: z.enum(['auto', 'focusMinutes', 'focusHours', 'focusBlocks', 'activeTimer', 'bedtime', 'nextTask', 'countdown']).default('auto')
}).strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export type Operation =
  | { kind: 'set_task'; date: string; task: string; done: boolean }
  | { kind: 'rename_task'; from: string; to: string }
  | { kind: 'archive_task'; task: string }
  | { kind: 'start_timer'; timerType: 'focus' | 'break'; minutes: number; task?: string }
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
