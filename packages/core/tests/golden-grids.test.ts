import { describe, expect, it } from 'vitest';
import { addDays, blend, dayColor, daysBetween, doneOn, getCountdown, getHabitGrid, getHabitStats, key, normalizeLog, parseKey, startOfDay } from '../src';
import { defaultSettings, type DailyLog } from '../src/contracts';
import cases from './fixtures/golden-cases.json';
import { gridColors, legacy, texts, type WidgetNode } from './legacy-harness';

const colors = (cells: ReturnType<typeof getCountdown>['cells']) => cells.map(c => c ? {color: c.color, opacity: c.opacity} : null);

describe('golden: actual extracted countdown and habit functions', () => {
  for (const instant of cases.localInstants) it(`calendar and countdown ${instant}`, () => {
    const now = new Date(instant), settings = structuredClone(defaultSettings);
    settings.countdown = {startDate: key(addDays(now, -9)), endDate: key(addDays(now, 6)), title: 'test'};
    const old = legacy('Days Left', now, settings), result = getCountdown(settings, now);
    for (const offset of [-31, -1, 0, 1, 31]) {
      expect(addDays(now, offset)).toEqual(old.call('addDays', now, offset));
      expect(daysBetween(addDays(now, offset), now)).toBe(old.call('daysBetween', addDays(now, offset), now));
    }
    expect(startOfDay(now)).toEqual(old.call('startOfDay', now));
    expect(parseKey(key(now))).toEqual(old.call('parseKey', key(now)));
    const widget = old.call<WidgetNode>('createWidget');
    expect(colors(result.cells)).toEqual(gridColors(widget));
    expect(texts(widget)).toContain(`${result.daysLeft} days left`);
    expect(texts(widget)).toContain(`${result.percent}% done  •  Day ${result.elapsed}/${result.total}  •  ${result.weeksLeft} weeks left`);
    expect(result.cells.slice(0, 3).map(c => c?.date)).toEqual([0, 7, 14].map(i => key(addDays(parseKey(settings.countdown.startDate), i))));
    expect(result.cells.filter(c => c === null)).toHaveLength(5);
  });

  for (const instant of cases.localInstants) for (const fixed of [false, true]) it(`habit stats/grid ${instant} fixed=${fixed}`, async () => {
    const now = new Date(instant), settings = structuredClone(defaultSettings);
    settings.habits.startDate = key(addDays(now, -12));
    settings.habits.endDate = fixed ? key(addDays(now, 4)) : '';
    const log: DailyLog = {};
    for (let i = -15; i <= 5; i++) log[key(addDays(now, i))] = [...settings.habits.tasks.slice(0, (i + 15) % 5), 'Archived'];
    for (const minimum of [1, 2, 4]) {
      settings.habits.dayCompleteMin = minimum;
      const old = legacy('Daily Log', now, settings, log), stats = getHabitStats(log, settings, now);
      const expected = old.call<Record<string, unknown>>('getStats', log);
      for (const name of ['elapsed', 'total', 'completedDays', 'missedDays', 'todayDone', 'daysLeft'] as const) expect(stats[name]).toEqual(expected[name]);
      expect(doneOn(log, key(now), settings.habits.tasks)).toEqual(old.call('doneOn', log, key(now)));
      const widget = await old.call<Promise<WidgetNode>>('createWidget');
      const grid = getHabitGrid(log, settings, now, 330);
      expect(colors(grid.cells)).toEqual(gridColors(widget));
      expect(grid.cellSize).toBe(widget.children[0].children[0].size?.width);
      expect(texts(widget).some(t => t.includes(`${stats.percent}%`))).toBe(true);
      if (!fixed) expect(grid.cells.at(-1)?.date).toBe(key(now));
    }
  });

  it('normalizes actual legacy array loader without sharing task arrays', () => {
    const settings = structuredClone(defaultSettings), input = ['2026-11-14', '2026-11-15'];
    const old = legacy('Daily Log', new Date(2026, 10, 15), settings, input);
    const normalized = normalizeLog(input, settings.habits.tasks);
    expect(normalized).toEqual(old.call('loadLog'));
    normalized[input[0]].push('new');
    expect(normalized[input[1]]).toEqual(settings.habits.tasks);
    const log = {'2026-11-15': ['Archived', 'Coursework']};
    expect(normalizeLog(log, settings.habits.tasks)).toEqual(log);
    expect(normalizeLog(log, settings.habits.tasks)).not.toBe(log);
  });

  it('matches all partial color counts, interpolation rounding, and empty stats', () => {
    for (let total = 1; total <= 12; total++) {
      const settings = structuredClone(defaultSettings);
      settings.habits.tasks = Array.from({length: total}, (_, i) => `Task ${i}`);
      const old = legacy('Daily Log', new Date(2026, 10, 15), settings);
      for (let n = 1; n <= total + 1; n++) expect(dayColor(n, settings)).toBe(old.call('dayColor', n));
      for (const t of [0, 0.1, 0.333, 0.5, 0.9, 1]) expect(blend('#ff5c5c', '#f2cc60', t)).toBe(old.call('blend', '#ff5c5c', '#f2cc60', t));
    }
    for (const date of ['2026-01-01', '2026-10-30', '2028-01-01']) {
      const now = parseKey(date), old = legacy('Daily Log', now, defaultSettings);
      const expected = old.call<Record<string, number>>('getStats', {});
      expect(getHabitStats({}, defaultSettings, now).elapsed).toBe(expected.elapsed);
    }
  });

  it('retains legacy percent behavior before/after countdown including DST fractions', () => {
    const settings = structuredClone(defaultSettings);
    settings.countdown.startDate = '2026-11-01'; settings.countdown.endDate = '2026-11-02';
    for (const instant of ['2026-10-31T12:00:00', '2026-11-01T23:59:59', '2026-11-02T23:59:59', '2026-11-03T00:00:00', '2027-01-01T12:00:00']) {
      const now = new Date(instant), result = getCountdown(settings, now);
      const old = legacy('Days Left', now, settings).call<WidgetNode>('createWidget');
      expect(colors(result.cells)).toEqual(gridColors(old));
      expect(texts(old)).toContain(`${result.percent}% done  •  Day ${result.elapsed}/${result.total}  •  ${result.weeksLeft} weeks left`);
    }
  });
});
