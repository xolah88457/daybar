import { describe, expect, it } from 'vitest';
import { addDays, blend, getCountdown, getHabitGrid, getHabitStats, key, normalizeLog, parseKey } from '../src';
import { defaultSettings, type DailyLog } from '../src/contracts';
import { gridColors, legacy, type WidgetNode } from './legacy-harness';

const now = new Date(2026, 10, 15, 12);
const settings = () => {
  const s = structuredClone(defaultSettings);
  s.habits.startDate = '2026-11-10'; s.habits.tasks = ['A', 'B']; s.habits.dayCompleteMin = 2;
  return s;
};

describe('habit additions and immutable history', () => {
  it('counts only active tasks, current/longest streaks, and per-task percentage rates', () => {
    const s = settings(), log: DailyLog = {};
    for (const day of [10, 11, 13, 14]) log[`2026-11-${day}`] = ['A', 'B', 'Archived'];
    log['2026-11-12'] = ['A'];
    log['2026-11-09'] = ['A', 'B']; log['2026-11-16'] = ['A', 'B'];
    const before = structuredClone(log), stats = getHabitStats(log, s, now);
    expect(stats).toEqual({elapsed: 6, total: null, completedDays: 4, missedDays: 2, todayDone: 0, daysLeft: null,
      percent: 67, currentStreak: 2, longestStreak: 2, taskRates: {A: 5 / 6 * 100, B: 4 / 6 * 100}});
    log['2026-11-15'] = ['A', 'B'];
    expect(getHabitStats(log, s, now).currentStreak).toBe(3);
    expect(getHabitStats(log, s, now).longestStreak).toBe(3);
    expect(getHabitStats({...before, '2026-11-16': []}, s, addDays(now, 1)).currentStreak).toBe(0);
    expect(getHabitStats({}, s, new Date(2026, 10, 1)).taskRates).toEqual({A: 0, B: 0});
    expect(before['2026-11-15']).toBeUndefined();
  });

  it('fixed-range totals/streaks exclude outside dates, including after the range', () => {
    const s = settings(); s.habits.endDate = '2026-11-12';
    const log = normalizeLog(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'], s.habits.tasks);
    const stats = getHabitStats(log, s, now);
    expect(stats.elapsed).toBe(3); expect(stats.completedDays).toBe(3);
    expect(stats.total).toBe(3); expect(stats.percent).toBe(100);
    expect(stats.daysLeft).toBe(0); expect(stats.currentStreak).toBe(3);
    expect(stats.taskRates).toEqual({A: 100, B: 100});
  });

  it('completions of tasks no longer configured are not counted', () => {
    const log = {'2026-11-15': ['A', 'B', 'Old'], '2026-11-14': ['Old']};
    const s = settings(); s.habits.tasks = ['A'];
    expect(getHabitStats(log, s, now).todayDone).toBe(1);
  });

  it('legacy-array migration also matches real legacy heatmap and stats', async () => {
    const s = settings(), raw = ['2026-11-10', '2026-11-14', '2026-11-15'];
    const old = legacy('Daily Log', now, s, raw), log = normalizeLog(raw, s.habits.tasks);
    expect(getHabitStats(log, s, now).completedDays).toBe(old.call<{completedDays: number}>('getStats', old.call('loadLog')).completedDays);
    const widget = await old.call<Promise<WidgetNode>>('createWidget');
    expect(getHabitGrid(log, s, now, 330).cells.map(c => c ? {color: c.color, opacity: c.opacity} : null)).toEqual(gridColors(widget));
  });

  it('grid width, rolling placement and fixed blank padding', () => {
    const s = settings();
    for (const width of [1, 3, 100, 330, 800]) {
      const grid = getHabitGrid({}, s, now, width);
      expect(grid.columns).toBeGreaterThanOrEqual(1);
      expect(grid.cellSize).toBeGreaterThan(0);
      expect(grid.columns * grid.cellSize + (grid.columns - 1) * s.appearance.gap).toBeCloseTo(width);
      expect(grid.cells.at(-1)?.date).toBe(key(now));
      expect(grid.cells[0]?.date).toBe(key(addDays(now, -(grid.columns * 7 - 1))));
    }
    s.appearance.cellSize = 3; s.appearance.gap = 10;
    for (const width of [1, 10, 10.01, 20]) expect(getHabitGrid({}, s, now, width).cellSize).toBeGreaterThan(0);
    s.habits.endDate = s.habits.startDate;
    const grid = getHabitGrid({}, s, now, 100);
    expect(grid.columns).toBe(1); expect(grid.cells.slice(1)).toEqual(Array(6).fill(null));
    s.countdown.startDate = s.countdown.endDate = '2026-11-15';
    expect(getCountdown(s, now).cells.filter(Boolean)).toHaveLength(1);
    expect(getCountdown(s, now).percent).toBe(50);
    expect(() => getHabitGrid({}, s, now, 0)).toThrow();
    expect(() => blend('#fff', '#ffffff', 0.5)).toThrow();
    expect(() => blend('#000000', '#ffffff', 2)).toThrow();
    expect(() => normalizeLog(['2026-02-30'], s.habits.tasks)).toThrow();
    expect(() => parseKey('2026-02-30')).toThrow();
  });
});
