import { describe, expect, it } from 'vitest';
import {
  addDays, circSpread, formatSpread, getWeeklyInsights, INSIGHT_DAYS, key, startOfDay,
  type InsightsInput
} from '../src';
import { defaultSettings } from '../src/contracts';

const now = new Date(2026, 10, 15, 12); // Sun 15 Nov 2026 noon, local time
const day = (offset: number, from: Date = now) => key(addDays(from, offset));

function input(patch: Partial<InsightsInput> = {}): InsightsInput {
  const settings = structuredClone(defaultSettings);
  settings.habits.startDate = '2026-01-01';
  settings.habits.tasks = ['A', 'B'];
  settings.habits.dayCompleteMin = 2;
  return { settings, dailyLog: {}, focus: { state: null, days: {} }, sleep: { wakes: {}, beds: {}, plan: null }, ...patch };
}
const focusDays = (entries: Record<string, number>) =>
  ({ state: null, days: Object.fromEntries(Object.entries(entries).map(([d, minutes]) => [d, { count: 0, minutes }])) });

describe('windows', () => {
  it('covers the last 7 days including today, and the 7 before', () => {
    const r = getWeeklyInsights(input(), now);
    expect(r.range).toEqual({ start: '2026-11-09', end: '2026-11-15', previousStart: '2026-11-02', previousEnd: '2026-11-08' });
    expect(r.focus.days.map(d => d.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    expect(r.focus.previousDays).toHaveLength(INSIGHT_DAYS);
    expect(r.habits.days).toHaveLength(INSIGHT_DAYS);
  });
  it('is the same at any time of day, including just after midnight and just before', () => {
    const base = getWeeklyInsights(input(), now);
    for (const t of [new Date(2026, 10, 15, 0, 0, 0), new Date(2026, 10, 15, 0, 30), new Date(2026, 10, 15, 23, 59, 59)])
      expect(getWeeklyInsights(input(), t).range).toEqual(base.range);
  });
  it('does not mutate its input', () => {
    const data = input({ focus: focusDays({ '2026-11-15': 30 }), dailyLog: { '2026-11-15': ['A'] } });
    const before = structuredClone(data);
    getWeeklyInsights(data, now);
    expect(data).toEqual(before);
  });
  it('rejects an invalid date', () => {
    expect(() => getWeeklyInsights(input(), new Date(NaN))).toThrow(RangeError);
  });
});

describe('daylight-saving safety', () => {
  // Toronto springs forward 8 Mar and falls back 1 Nov 2026; London 29 Mar and 25 Oct. In whichever
  // zone the suite runs, every window around those dates must still be 7 distinct, consecutive days.
  const nights = [
    new Date(2026, 2, 8, 23, 30), new Date(2026, 2, 9, 0, 30), new Date(2026, 2, 14, 12), new Date(2026, 2, 29, 0, 30),
    new Date(2026, 2, 31, 12), new Date(2026, 9, 25, 1, 30), new Date(2026, 9, 31, 23, 30),
    new Date(2026, 10, 1, 0, 30), new Date(2026, 10, 1, 1, 30), new Date(2026, 10, 7, 12)
  ];
  it.each(nights.map(d => [d.toString(), d] as const))('builds 14 consecutive local days ending %s', (_, at) => {
    const r = getWeeklyInsights(input(), at);
    const all = [...r.focus.previousDays, ...r.focus.days].map(d => d.date);
    expect(new Set(all).size).toBe(14);
    expect(all[13]).toBe(key(at));
    for (let i = 1; i < 14; i++) {
      const a = all[i - 1].split('-').map(Number), b = all[i].split('-').map(Number);
      expect(new Date(b[0], b[1] - 1, b[2]).getTime() - new Date(a[0], a[1] - 1, a[2]).getTime())
        .toBeGreaterThanOrEqual(23 * 3600000);
      expect(key(addDays(new Date(a[0], a[1] - 1, a[2]), 1))).toBe(all[i]);
    }
  });
  it('buckets focus on the right day across a clock change', () => {
    const at = new Date(2026, 10, 3, 12); // the week of the 1 Nov fall-back
    const data = input({ focus: focusDays({ '2026-10-31': 10, '2026-11-01': 20, '2026-11-02': 30, '2026-10-25': 5 }) });
    const r = getWeeklyInsights(data, at);
    expect(r.focus.days.map(d => [d.date, d.minutes])).toEqual([
      ['2026-10-28', 0], ['2026-10-29', 0], ['2026-10-30', 0], ['2026-10-31', 10], ['2026-11-01', 20], ['2026-11-02', 30], ['2026-11-03', 0]
    ]);
    expect(r.range.previousStart).toBe('2026-10-21');
    expect(r.focus.previousTotal).toBe(5); // 25 Oct falls in the previous window
  });
  it('pairs a bedtime with the next calendar day over a 25-hour day', () => {
    const at = new Date(2026, 10, 3, 12);
    const beds: Record<string, number> = {};
    const days: Record<string, number> = {};
    // Evening 31 Oct -> day 1 Nov (25 hours long in Toronto/London-style fall-back zones).
    for (let i = 0; i < 12; i++) {
      const d = day(-i - 3, at);
      beds[d] = i % 2 ? 22 * 60 : 1 * 60;
      days[key(addDays(new Date(d + 'T00:00:00'), 1))] = i % 2 ? 100 : 20;
    }
    const r = getWeeklyInsights(input({ sleep: { wakes: {}, beds, plan: null }, focus: focusDays(days) }), at);
    expect(r.sleepFocus.early.averageMinutes).toBe(100);
    expect(r.sleepFocus.late.averageMinutes).toBe(20);
  });
});

describe('focus', () => {
  it('totals, compares with the previous week, and finds the best day', () => {
    const entries: Record<string, number> = {
      '2026-11-09': 25, '2026-11-11': 50, '2026-11-15': 75, // this week: 150
      '2026-11-02': 40, '2026-11-08': 60,                   // previous: 100
      '2026-11-01': 999                                      // older: ignored
    };
    const f = getWeeklyInsights(input({ focus: focusDays(entries) }), now).focus;
    expect(f.days.map(d => d.minutes)).toEqual([25, 0, 50, 0, 0, 0, 75]);
    expect(f.previousDays.map(d => d.minutes)).toEqual([40, 0, 0, 0, 0, 0, 60]);
    expect(f).toMatchObject({ total: 150, previousTotal: 100, change: 50, changePercent: 50, bestDay: { date: '2026-11-15', minutes: 75 } });
    expect(f.averagePerDay).toBeCloseTo(150 / 7);
  });
  it('reports a drop as a negative change', () => {
    const f = getWeeklyInsights(input({ focus: focusDays({ '2026-11-15': 30, '2026-11-05': 120 }) }), now).focus;
    expect(f.change).toBe(-90);
    expect(f.changePercent).toBe(-75);
  });
  it('has no percentage without a previous week, and no best day without focus', () => {
    const f = getWeeklyInsights(input({ focus: focusDays({ '2026-11-15': 30 }) }), now).focus;
    expect(f.changePercent).toBeNull();
    expect(f.change).toBe(30);
    const none = getWeeklyInsights(input(), now).focus;
    expect(none).toMatchObject({ total: 0, change: 0, changePercent: null, bestDay: null, averagePerDay: 0 });
  });
  it('treats missing days as zero and ignores future days', () => {
    const f = getWeeklyInsights(input({ focus: focusDays({ '2026-11-16': 500 }) }), now).focus;
    expect(f.total).toBe(0);
  });
});

describe('habits', () => {
  it('applies the existing completion rule per day', () => {
    const log = { '2026-11-09': ['A', 'B'], '2026-11-10': ['A'], '2026-11-11': ['A', 'B', 'Gone'], '2026-11-15': ['B', 'A'] };
    const h = getWeeklyInsights(input({ dailyLog: log }), now).habits;
    expect(h.days.map(d => d.done)).toEqual([2, 1, 2, 0, 0, 0, 2]);
    expect(h.days.map(d => d.complete)).toEqual([true, false, true, false, false, false, true]);
    expect(h.days[1]).toMatchObject({ total: 2, fraction: 0.5 });
    expect(h.completedDays).toBe(3);
    expect(h.trackedDays).toBe(7);
    expect(h.rate).toBeCloseTo(3 / 7);
  });
  it('honours a different dayCompleteMin', () => {
    const data = input({ dailyLog: { '2026-11-10': ['A'], '2026-11-11': ['A'] } });
    data.settings.habits.dayCompleteMin = 1;
    expect(getWeeklyInsights(data, now).habits.completedDays).toBe(2);
  });
  it('compares with the previous week in percentage points', () => {
    const log: Record<string, string[]> = {};
    for (const d of ['2026-11-02', '2026-11-03']) log[d] = ['A', 'B'];
    for (const d of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']) log[d] = ['A', 'B'];
    const h = getWeeklyInsights(input({ dailyLog: log }), now).habits;
    expect(h.previousCompletedDays).toBe(2);
    expect(h.rateChange).toBe(Math.round((4 / 7 - 2 / 7) * 100));
  });
  it('reports current and best streak as the Habits view does', () => {
    const log: Record<string, string[]> = {};
    for (const d of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']) log[d] = ['A', 'B']; // best: 5
    for (const d of ['2026-11-13', '2026-11-14']) log[d] = ['A', 'B'];
    const h = getWeeklyInsights(input({ dailyLog: log }), now).habits;
    expect(h.bestStreak).toBe(5);
    expect(h.currentStreak).toBe(2); // today is unfinished but does not break yesterday's streak
    log['2026-11-15'] = ['A', 'B'];
    expect(getWeeklyInsights(input({ dailyLog: log }), now).habits.currentStreak).toBe(3);
  });
  it('leaves days outside the habit dates out of the rate', () => {
    const data = input({ dailyLog: { '2026-11-12': ['A', 'B'] } });
    data.settings.habits.startDate = '2026-11-12';
    const h = getWeeklyInsights(data, now).habits;
    expect(h.days.map(d => d.tracked)).toEqual([false, false, false, true, true, true, true]);
    expect(h.trackedDays).toBe(4);
    expect(h.rate).toBe(1 / 4);
    expect(h.previousRate).toBeNull();
    expect(h.rateChange).toBeNull();
    data.settings.habits.startDate = '2026-12-01';
    expect(getWeeklyInsights(data, now).habits).toMatchObject({ trackedDays: 0, rate: null, currentStreak: 0, bestStreak: 0 });
  });
  it('stops counting after the habit end date', () => {
    const data = input();
    data.settings.habits.endDate = '2026-11-11';
    expect(getWeeklyInsights(data, now).habits.days.map(d => d.tracked)).toEqual([true, true, true, false, false, false, false]);
  });
});

describe('circSpread and formatSpread', () => {
  it('is the standard deviation around the circular mean', () => {
    expect(circSpread([480, 480, 480])).toBe(0);
    expect(circSpread([470, 490])).toBeCloseTo(10);
    expect(circSpread([450, 510])).toBeCloseTo(30);
  });
  it('measures across midnight the short way round', () => {
    expect(circSpread([1430, 10])).toBeCloseTo(10); // 23:50 and 00:10 are 20 minutes apart
    expect(circSpread([1425, 1435, 5, 15])).toBeCloseTo(Math.sqrt((15 ** 2 + 5 ** 2) / 2));
  });
  it('needs two entries', () => {
    expect(circSpread([])).toBeNull();
    expect(circSpread([600])).toBeNull();
  });
  it('formats as plus-or-minus minutes', () => {
    expect(formatSpread(18)).toBe('±18 min');
    expect(formatSpread(17.6)).toBe('±18 min');
    expect(formatSpread(0)).toBe('±0 min');
    expect(formatSpread(null)).toBe('—');
  });
});

describe('sleep', () => {
  const sleep = (wakes: Record<string, number>, beds: Record<string, number>) => ({ wakes, beds, plan: null });
  it('averages wake and bed times for the week with their spread', () => {
    const wakes = { '2026-11-09': 450, '2026-11-10': 480, '2026-11-11': 510 };
    const beds = { '2026-11-09': 1380, '2026-11-10': 1380 };
    const s = getWeeklyInsights(input({ sleep: sleep(wakes, beds) }), now).sleep;
    expect(s.wake).toMatchObject({ mean: 480, samples: 3 });
    expect(s.wake.spread).toBeCloseTo(Math.sqrt((900 + 0 + 900) / 3));
    expect(s.bed).toMatchObject({ mean: 1380, samples: 2, spread: 0 });
  });
  it('averages bedtimes that straddle midnight', () => {
    const beds = { '2026-11-09': 1425, '2026-11-10': 15 }; // 23:45 and 00:15
    const s = getWeeklyInsights(input({ sleep: sleep({}, beds) }), now).sleep.bed;
    expect(s.mean).toBe(0);
    expect(s.spread).toBeCloseTo(15);
  });
  it('shifts against the previous week', () => {
    const wakes = { '2026-11-10': 480, '2026-11-03': 450 };
    const beds = { '2026-11-10': 30, '2026-11-03': 1430 }; // 00:30 vs 23:50: 40 minutes later
    const s = getWeeklyInsights(input({ sleep: sleep(wakes, beds) }), now).sleep;
    expect(s.wake).toMatchObject({ previousMean: 450, shift: 30 });
    expect(s.bed.shift).toBe(40);
    expect(getWeeklyInsights(input({ sleep: sleep({ '2026-11-10': 450, '2026-11-03': 480 }, {}) }), now).sleep.wake.shift).toBe(-30);
  });
  it('ignores entries outside the week and is empty without data', () => {
    const none = getWeeklyInsights(input(), now).sleep;
    expect(none.wake).toEqual({ mean: null, spread: null, samples: 0, previousMean: null, shift: null });
    const old = getWeeklyInsights(input({ sleep: sleep({ '2026-10-01': 400 }, {}) }), now).sleep.wake;
    expect(old.samples).toBe(0);
  });
  it('has no spread from a single entry', () => {
    const s = getWeeklyInsights(input({ sleep: sleep({ '2026-11-14': 500 }, {}) }), now).sleep.wake;
    expect(s).toMatchObject({ mean: 500, spread: null, samples: 1 });
  });
});

describe('sleep to focus', () => {
  /** `n` evenings ending the day before yesterday, each with a bedtime and the next day's focus. */
  function nights(spec: { bed: number; focus: number }[]) {
    const beds: Record<string, number> = {}, days: Record<string, number> = {};
    spec.forEach((s, i) => {
      const evening = day(-(i + 3));
      beds[evening] = s.bed;
      days[day(1, new Date(evening + 'T12:00:00'))] = s.focus;
    });
    return input({ sleep: { wakes: {}, beds, plan: null }, focus: focusDays(days) });
  }
  const early = (focus: number) => ({ bed: 22 * 60 + 30, focus });

  it('compares focus after earlier and later bedtimes than usual', () => {
    const spec = [
      ...[60, 80, 100, 120].map(f => ({ bed: 22 * 60 + 30, focus: f })),
      ...[10, 20, 30, 40].map(f => ({ bed: 60, focus: f })) // 01:00
    ];
    const r = getWeeklyInsights(nights(spec), now).sleepFocus;
    expect(r.enough).toBe(true);
    expect(r.early).toEqual({ days: 4, averageMinutes: 90 });
    expect(r.late).toEqual({ days: 4, averageMinutes: 25 });
    expect(r.difference).toBe(65);
    expect(r.usualBed).toBe(23 * 60 + 45); // median of 22:30 and 01:00 is 23:45
  });
  it('treats after-midnight bedtimes as later than evening ones', () => {
    const spec = [
      ...[50, 50, 50, 50].map(focus => ({ bed: 23 * 60, focus })),
      ...[50, 50, 50, 50].map(focus => ({ bed: 30, focus })) // 00:30 must sort after 23:00
    ];
    const r = getWeeklyInsights(nights(spec), now).sleepFocus;
    expect(r.early.days).toBe(4);
    expect(r.late.days).toBe(4);
  });
  it('says there is not enough data below 4 days on either side', () => {
    const spec = [
      ...[100, 100, 100, 100, 100].map(focus => ({ bed: 22 * 60, focus })),
      ...[10, 10, 10].map(focus => ({ bed: 60, focus }))
    ];
    const r = getWeeklyInsights(nights(spec), now).sleepFocus;
    expect(r.enough).toBe(false);
    expect(r.difference).toBeNull();
    expect(r.late.days).toBe(3);
    expect(getWeeklyInsights(nights([early(1)]), now).sleepFocus.enough).toBe(false);
  });
  it('needs data at all', () => {
    expect(getWeeklyInsights(input(), now).sleepFocus).toMatchObject({
      enough: false, usualBed: null, early: { days: 0, averageMinutes: null }, late: { days: 0, averageMinutes: null }, difference: null
    });
  });
  it('leaves out bedtimes equal to the usual one and days that are not over yet', () => {
    const data = nights([...[1, 2, 3, 4].map(focus => ({ bed: 22 * 60, focus })), ...[1, 2, 3, 4].map(focus => ({ bed: 60, focus })), { bed: 23 * 60, focus: 999 }]);
    data.sleep.beds[day(-1)] = 1; // bedtime last night: its "next day" is today, still in progress
    data.sleep.beds[day(0)] = 1;
    data.focus.days[day(0)] = { count: 0, minutes: 5000 };
    const r = getWeeklyInsights(data, now).sleepFocus;
    expect(r.early.days + r.late.days).toBeLessThanOrEqual(8);
    expect(r.early.averageMinutes).toBe(2.5);
    expect(r.late.averageMinutes).toBe(2.5);
  });
  it('only looks back eight weeks', () => {
    const beds: Record<string, number> = {}, days: Record<string, number> = {};
    for (let i = 60; i < 80; i++) { beds[day(-i)] = i % 2 ? 22 * 60 : 60; days[day(-i + 1)] = 10; }
    const r = getWeeklyInsights(input({ sleep: { wakes: {}, beds, plan: null }, focus: focusDays(days) }), now).sleepFocus;
    expect(r.early.days + r.late.days).toBe(0);
  });
  it('keeps the same answer wherever in the day it is asked', () => {
    const data = nights([...[1, 2, 3, 4].map(focus => ({ bed: 22 * 60, focus })), ...[5, 6, 7, 8].map(focus => ({ bed: 60, focus }))]);
    const a = getWeeklyInsights(data, new Date(2026, 10, 15, 0, 5)).sleepFocus;
    const b = getWeeklyInsights(data, new Date(2026, 10, 15, 23, 55)).sleepFocus;
    expect(a).toEqual(b);
    expect(startOfDay(new Date(2026, 10, 15, 23, 55)).getDate()).toBe(15);
  });
});
