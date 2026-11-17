import type { DailyLog, FocusData, Settings, SleepData } from './contracts';
import { addDays, key, parseKey, startOfDay, validDate } from './dates';
import { getHabitStats, doneOn } from './habits';
import { circMean, signedDiff, wrap } from './sleep';

// Weekly insights. Everything here works on calendar dates (local date keys moved with `addDays`),
// never on millisecond offsets, so a 23- or 25-hour day around a DST change cannot shift a bucket.

/** Length of one review window, in days. */
export const INSIGHT_DAYS = 7;
/** How far back the sleep-to-focus comparison looks. A week alone is too short to split in two. */
export const SLEEP_FOCUS_LOOKBACK_DAYS = 56;
/** Days needed on each side (earlier / later bedtime) before the comparison is shown. */
export const SLEEP_FOCUS_MIN_PER_SIDE = 4;

export interface InsightsInput {
  settings: Settings;
  dailyLog: DailyLog;
  focus: FocusData;
  sleep: SleepData;
}

export interface FocusInsightDay { date: string; minutes: number }
export interface FocusInsights {
  /** Oldest first, always {@link INSIGHT_DAYS} entries ending today. Days without a record are 0. */
  days: FocusInsightDay[];
  /** The 7 days before `days`, aligned day for day (index i is the day 7 before `days[i]`). */
  previousDays: FocusInsightDay[];
  total: number;
  previousTotal: number;
  /** `total - previousTotal`, in minutes. */
  change: number;
  /** Relative change, rounded to a whole percent; null when there was no focus the week before. */
  changePercent: number | null;
  averagePerDay: number;
  /** The busiest day this week, or null when there was no focus at all. */
  bestDay: FocusInsightDay | null;
}

export interface HabitInsightDay {
  date: string;
  /** Active tasks done that day. */
  done: number;
  /** Active tasks in total. */
  total: number;
  /** done / total, 0..1. */
  fraction: number;
  /** The day counts as complete under `habits.dayCompleteMin` (the same rule as the Habits view). */
  complete: boolean;
  /** False for days before the habit start date or after its end date; they do not affect the rate. */
  tracked: boolean;
}
export interface HabitInsights {
  days: HabitInsightDay[];
  completedDays: number;
  trackedDays: number;
  /** completedDays / trackedDays (0..1); null when no day of the week is tracked. */
  rate: number | null;
  previousCompletedDays: number;
  previousTrackedDays: number;
  previousRate: number | null;
  /** Change of `rate` in percentage points, or null when either week has no tracked days. */
  rateChange: number | null;
  currentStreak: number;
  bestStreak: number;
}

export interface SleepMetric {
  /** Circular mean as a minute of the day, or null with no entries. */
  mean: number | null;
  /** Consistency: standard deviation in minutes around the mean; null with fewer than 2 entries. */
  spread: number | null;
  samples: number;
  previousMean: number | null;
  /** Signed minutes the mean moved since the previous week (positive = later); null if unknown. */
  shift: number | null;
}
export interface SleepInsights { wake: SleepMetric; bed: SleepMetric }

export interface SleepFocusSide {
  /** Days in this group. */
  days: number;
  /** Average focus minutes on those days; null with no days. */
  averageMinutes: number | null;
}
export interface SleepFocusInsight {
  /** True once both sides have at least {@link SLEEP_FOCUS_MIN_PER_SIDE} days. */
  enough: boolean;
  minPerSide: number;
  lookbackDays: number;
  /** The usual bedtime that splits the groups (median), as a minute of the day; null with no data. */
  usualBed: number | null;
  /** Focus the day after going to bed earlier than usual. */
  early: SleepFocusSide;
  /** Focus the day after going to bed later than usual. */
  late: SleepFocusSide;
  /** `early.averageMinutes - late.averageMinutes`; only set when `enough`. */
  difference: number | null;
}

export interface WeeklyInsights {
  range: { start: string; end: string; previousStart: string; previousEnd: string };
  focus: FocusInsights;
  habits: HabitInsights;
  sleep: SleepInsights;
  sleepFocus: SleepFocusInsight;
}

/** The `count` date keys ending `endOffset` days before today, oldest first. */
function window(today: Date, count: number, endOffset: number): string[] {
  return Array.from({ length: count }, (_, i) => key(addDays(today, -(endOffset + count - 1 - i))));
}

/**
 * Standard deviation, in minutes, of clock times around their circular mean. Deviations are taken
 * the short way round the clock, so 23:50 and 00:10 are 20 minutes apart, not 1420. Null when
 * there are fewer than two times.
 */
export function circSpread(minutes: number[]): number | null {
  if (minutes.length < 2) return null;
  const mean = circMean(minutes);
  if (mean === null) return null;
  const variance = minutes.reduce((sum, m) => sum + signedDiff(mean, m) ** 2, 0) / minutes.length;
  return Math.sqrt(variance);
}

/** "±18 min" for a consistency figure; an em dash when unknown. */
export function formatSpread(minutes: number | null): string {
  return minutes === null ? '—' : `±${Math.round(minutes)} min`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function focusMinutes(focus: FocusData, date: string): number {
  return focus.days[date]?.minutes ?? 0;
}

function focusInsights(input: InsightsInput, days: string[], previous: string[]): FocusInsights {
  const make = (dates: string[]) => dates.map(date => ({ date, minutes: focusMinutes(input.focus, date) }));
  const current = make(days), before = make(previous);
  const total = current.reduce((s, d) => s + d.minutes, 0);
  const previousTotal = before.reduce((s, d) => s + d.minutes, 0);
  let bestDay: FocusInsightDay | null = null;
  for (const d of current) if (d.minutes > 0 && (!bestDay || d.minutes > bestDay.minutes)) bestDay = d;
  return {
    days: current, previousDays: before, total, previousTotal, change: total - previousTotal,
    changePercent: previousTotal > 0 ? Math.round((total - previousTotal) / previousTotal * 100) : null,
    averagePerDay: total / days.length, bestDay
  };
}

function habitDays(input: InsightsInput, dates: string[]): HabitInsightDay[] {
  const h = input.settings.habits, total = h.tasks.length;
  return dates.map(date => {
    const done = doneOn(input.dailyLog, date, h.tasks).length;
    const tracked = date >= h.startDate && (!h.endDate || date <= h.endDate);
    return { date, done, total, fraction: total ? Math.min(1, done / total) : 0, complete: done >= h.dayCompleteMin, tracked };
  });
}
function tally(days: HabitInsightDay[]) {
  const tracked = days.filter(d => d.tracked);
  const completed = tracked.filter(d => d.complete).length;
  return { completed, tracked: tracked.length, rate: tracked.length ? completed / tracked.length : null };
}

function habitInsights(input: InsightsInput, now: Date, days: string[], previous: string[]): HabitInsights {
  const current = habitDays(input, days), before = tally(habitDays(input, previous)), now7 = tally(current);
  const stats = getHabitStats(input.dailyLog, input.settings, now);
  return {
    days: current, completedDays: now7.completed, trackedDays: now7.tracked, rate: now7.rate,
    previousCompletedDays: before.completed, previousTrackedDays: before.tracked, previousRate: before.rate,
    rateChange: now7.rate !== null && before.rate !== null ? Math.round((now7.rate - before.rate) * 100) : null,
    currentStreak: stats.currentStreak, bestStreak: stats.longestStreak
  };
}

function sleepMetric(map: Record<string, number>, days: string[], previous: string[]): SleepMetric {
  const pick = (dates: string[]) => dates.flatMap(d => (map[d] === undefined ? [] : [map[d]]));
  const now = pick(days), before = pick(previous);
  const mean = circMean(now), previousMean = circMean(before);
  return {
    mean, spread: circSpread(now), samples: now.length, previousMean,
    shift: mean !== null && previousMean !== null ? signedDiff(previousMean, mean) : null
  };
}

/** Bedtimes as minutes since 18:00 so that 23:00 < 00:30 < 02:00 can be compared on one line. */
const eveningOffset = (m: number) => wrap(m - 18 * 60);

function sleepFocusInsight(input: InsightsInput, today: Date): SleepFocusInsight {
  const todayKey = key(today);
  const lookback = window(today, SLEEP_FOCUS_LOOKBACK_DAYS, 0);
  // A bedtime logged for evening D is followed by day D+1. Only complete days (before today) count.
  const pairs = lookback.flatMap(date => {
    const bed = input.sleep.beds[date];
    const next = key(addDays(parseKey(date), 1));
    return bed === undefined || next >= todayKey ? [] : [{ bed: eveningOffset(bed), minutes: focusMinutes(input.focus, next) }];
  });
  const base = { minPerSide: SLEEP_FOCUS_MIN_PER_SIDE, lookbackDays: SLEEP_FOCUS_LOOKBACK_DAYS };
  if (!pairs.length) {
    const empty = { days: 0, averageMinutes: null };
    return { ...base, enough: false, usualBed: null, early: empty, late: empty, difference: null };
  }
  const usual = median(pairs.map(p => p.bed));
  const side = (group: typeof pairs): SleepFocusSide => ({
    days: group.length,
    averageMinutes: group.length ? group.reduce((s, p) => s + p.minutes, 0) / group.length : null
  });
  const early = side(pairs.filter(p => p.bed < usual)), late = side(pairs.filter(p => p.bed > usual));
  const enough = early.days >= SLEEP_FOCUS_MIN_PER_SIDE && late.days >= SLEEP_FOCUS_MIN_PER_SIDE;
  return {
    ...base, enough, usualBed: wrap(usual + 18 * 60), early, late,
    difference: enough ? early.averageMinutes! - late.averageMinutes! : null
  };
}

/**
 * The week in review: the last 7 calendar days (today included) against the 7 before them. Pure and
 * synchronous; callers decide which sections to show for the modules that are switched on.
 */
export function getWeeklyInsights(input: InsightsInput, now: Date): WeeklyInsights {
  validDate(now);
  const today = startOfDay(now);
  const days = window(today, INSIGHT_DAYS, 0), previous = window(today, INSIGHT_DAYS, INSIGHT_DAYS);
  return {
    range: { start: days[0], end: days[INSIGHT_DAYS - 1], previousStart: previous[0], previousEnd: previous[INSIGHT_DAYS - 1] },
    focus: focusInsights(input, days, previous),
    habits: habitInsights(input, now, days, previous),
    sleep: { wake: sleepMetric(input.sleep.wakes, days, previous), bed: sleepMetric(input.sleep.beds, days, previous) },
    sleepFocus: sleepFocusInsight(input, today)
  };
}
