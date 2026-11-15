import { describe, expect, it } from 'vitest';
import { addDays, atMinutes, baseline, circMean, clearSleep, currentState, findSleepSessions, fmtDuration, getPlanNights, getSleepView, key, logSleep, needsFocusConfirmation, parseWhen, planDays, recentAvg, resolveDates, shiftToward, signedDiff, startSleepPlan, stopSleepPlan, toMin, wrap } from '../src';
import { defaultSettings, type SleepData } from '../src/contracts';
import cases from './fixtures/golden-cases.json';
import { legacy, texts, type WidgetNode } from './legacy-harness';

const empty = (): SleepData => ({wakes: {}, beds: {}, plan: null});
const epochDates = (dates: Date[] | null) => dates?.map(Number) ?? null;
const epochs = (sessions: {s: Date; e: Date}[]) => sessions.map(({s, e}) => ({s: +s, e: +e}));

describe('sleep golden parity: actual extracted functions', () => {
  it('circular helpers, durations, midnight means and rounding', () => {
    const old = legacy('Time Blindness + Sleep', new Date(2026, 10, 15), defaultSettings);
    for (const n of [-3000, -1440, -720.5, -1, 0, 0.5, 60, 1439, 1440, 3000]) {
      expect(wrap(n)).toBe(old.call('wrap', n));
      expect(fmtDuration(n)).toBe(old.call('fmtDuration', n));
      for (const to of [0, 720, 1439]) expect(signedDiff(n, to)).toBe(old.call('signedDiff', n, to));
    }
    for (const list of [[], [1439, 1], [1380, 60], [480], [480, 500, 520], [0, 720], [0, 360, 720, 1080]]) expect(circMean(list)).toBe(old.call('circMean', list));
    expect(circMean([1439, 1])).toBe(0);
    expect(toMin('23:59')).toBe(old.call('toMin', '23:59'));
  });

  for (const instant of cases.localInstants) it(`parsing/resolution at ${instant}`, () => {
    const now = new Date(instant), old = legacy('Time Blindness + Sleep', now, defaultSettings);
    for (const input of [...cases.timeInputs, now, new Date(NaN)]) {
      const expected = old.call<ReturnType<typeof parseWhen>>('parseWhen', input), result = parseWhen(input, now);
      expect(result?.hasDay ?? null).toBe(expected?.hasDay ?? null);
      expect(result ? +result.date : null).toBe(expected ? +expected.date : null);
    }
    for (const list of [[], ['invalid'], ['23:00', '07:00'], ['23:45', '00:15', '07:12'], ['22:00', '06:00', '22:00', '06:00'], ['2026-03-08T01:00:00', '2026-03-08T06:00:00'], ['2026-11-15T00:00:00Z', '07:00']]) expect(epochDates(resolveDates(list, now))).toEqual(epochDates(old.call('resolveDates', list, now)));
    for (const m of [-60, 0, 90, 150, 1440, 1500]) expect(+atMinutes(now, m)).toBe(+old.call<Date>('atMinutes', now, m));
  });

  it('averages select last logged keys, baseline estimates bed, plans take shortest circular route', () => {
    const settings = structuredClone(defaultSettings), now = new Date(2026, 10, 15);
    for (const averageDays of [1, 3, 7]) {
      settings.sleep.averageDays = averageDays;
      const old = legacy('Time Blindness + Sleep', now, settings);
      const data = empty();
      expect(baseline(data, settings)).toBe(old.call('baseline', data));
      for (let i = 0; i < 12; i++) data.wakes[key(addDays(now, -i))] = wrap(480 + i * 10);
      expect(recentAvg(data.wakes, averageDays)).toEqual(old.call('recentAvg', data.wakes));
      expect(baseline(data, settings)).toEqual(old.call('baseline', data));
      data.beds = {'2026-11-14': 1430, '2026-11-15': 10};
      expect(baseline(data, settings)).toEqual(old.call('baseline', data));
      for (const st of [{wake: 600, bed: 120}, {wake: 480, bed: 0}, {wake: 1380, bed: 420}, {wake: 0, bed: 720}]) {
        expect(planDays(st, settings)).toBe(old.call('planDays', st));
        for (let k = 0; k <= 60; k++) expect(shiftToward(st.wake, 480, k, settings.sleep.stepMinutes)).toBe(old.call('shiftToward', st.wake, 480, k));
      }
    }
  });

  for (const instant of cases.localInstants) it(`current state and actual rendered sleep view ${instant}`, async () => {
    const now = new Date(instant), settings = structuredClone(defaultSettings);
    const logged = empty();
    logged.wakes[key(now)] = 480;
    logged.wakes[key(addDays(now, -1))] = 540;
    const stale = empty(); stale.wakes[key(addDays(now, -5))] = 600;
    const plan = {wakes: {}, beds: {}, plan: {start: key(addDays(now, -2)), wake: 600, bed: 120}};
    const nearWakePlan = {wakes: {}, beds: {}, plan: {start: key(now), wake: 480, bed: 490}};
    for (const data of [empty(), logged, stale, plan, nearWakePlan]) {
      const old = legacy('Time Blindness + Sleep', now, settings, data);
      const before = structuredClone(data), result = getSleepView(data, now, settings);
      expect(currentState(data, now, settings)).toEqual(old.call('currentState', data, now));
      const widget = await old.call<Promise<WidgetNode>>('createWidget');
      const rendered = texts(widget);
      const clock = (date: Date) => `${date.getHours() % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
      expect(rendered).toContain(result.status);
      expect(rendered).toContain(`Bed ${clock(result.bed)}`);
      expect(rendered).toContain(`${result.asleep ? 'Wake' : 'Woke'} ${clock(result.wake)}${result.logged ? '' : ' (est)'}`);
      if (result.phase) expect(rendered).toContain(result.phase);
      expect(widget.children[1].children[0].backgroundColor?.hex).toBe(result.color);
      expect(widget.children[1].children[0].size?.width).toBe(Math.max(1, (320 - 24) * result.progress));
      expect(+result.bed - +result.wake).toBeGreaterThanOrEqual(3600000);
      expect(data).toEqual(before);
    }
  });

  it('custom targets, sleep/awake hours, step and averaging settings match legacy', async () => {
    const now = new Date(2026, 2, 29, 22, 30), settings = structuredClone(defaultSettings);
    settings.sleep = {...settings.sleep, targetWake: '06:30', targetBed: '22:45', awakeHours: 15, sleepHours: 9, stepMinutes: 30, averageDays: 2, routineMinutes: 90, noPhoneMinutes: 30};
    const data: SleepData = {wakes: {'2026-03-27': 600, '2026-03-28': 540, '2026-03-29': 480}, beds: {}, plan: {start: '2026-03-28', wake: 540, bed: 60}};
    const old = legacy('Time Blindness + Sleep', now, settings, data), view = getSleepView(data, now, settings);
    expect(baseline(data, settings)).toEqual(old.call('baseline', data));
    expect(planDays(data.plan!, settings)).toBe(old.call('planDays', data.plan));
    expect(currentState(data, now, settings)).toEqual(old.call('currentState', data, now));
    expect(texts(await old.call<Promise<WidgetNode>>('createWidget'))).toContain(view.status);
    const nights = getPlanNights(data, now, settings);
    for (const night of nights) {
      expect(night.wake).toBe(old.call('shiftToward', data.plan!.wake, 390, night.night));
      expect(night.bed).toBe(old.call('shiftToward', data.plan!.bed, 1365, night.night));
    }
  });

  it('explicitly preserves legacy clock-reset when resolving prior time-only days', () => {
    const now = new Date(2026, 10, 15, 8);
    const dates = resolveDates(['23:00', '07:00'], now)!;
    expect(dates[0]).toEqual(new Date(2026, 10, 14));
    expect(dates[1]).toEqual(new Date(2026, 10, 15, 7));
  });

  it('merges gaps <=2h, includes exactly 3h, sorts, ignores invalid pairs and keeps inputs intact', () => {
    const now = new Date(2026, 10, 15), old = legacy('Time Blindness + Sleep', now, defaultSettings);
    for (const offsets of [[], [[0, 179]], [[0, 180]], [[0, 60], [180, 240]], [[0, 60], [181, 240]], [[100, 400], [0, 200], [30, 90]], [[0, -1], [0, 0]], [[0, 60], [180, 200], [320, 400]]]) {
      const starts = offsets.map(([s]) => new Date(+now + s * 60000)), ends = offsets.map(([, e]) => new Date(+now + e * 60000));
      const before = epochDates(starts), result = findSleepSessions(starts, ends);
      expect(epochs(result)).toEqual(epochs(old.call('findSleepSessions', starts, ends)));
      expect(epochDates(starts)).toEqual(before);
      if (result.length) { result[0].s.setFullYear(2000); expect(epochDates(starts)).toEqual(before); }
    }
    const starts = [new Date('2026-03-08T00:00:00'), new Date('2026-10-25T00:00:00')];
    const ends = [new Date('2026-03-08T04:00:00'), new Date('2026-10-25T04:00:00')];
    expect(epochs(findSleepSessions(starts, ends))).toEqual(epochs(old.call('findSleepSessions', starts, ends)));
    expect(findSleepSessions(starts, [])).toEqual([]);
  });
});

describe('sleep immutable operations and phases', () => {
  it('attributes before-noon beds to previous evening, including midnight and DST', () => {
    for (const instant of cases.localInstants) for (const entry of ['wake', 'bed'] as const) {
      const now = new Date(instant), data = empty();
      const oldData = structuredClone(data), old = legacy('Time Blindness + Sleep', now, defaultSettings);
      old.call(entry === 'wake' ? 'logWake' : 'logBed', oldData, now);
      expect(logSleep(data, entry, now)).toEqual(oldData);
      expect(data).toEqual(empty());
    }
  });

  it('starts/restarts plan from current circular averages, previews, stops and clears', () => {
    const data: SleepData = {wakes: {'2026-11-14': 590, '2026-11-15': 610}, beds: {'2026-11-14': 120}, plan: null};
    const now = new Date(2026, 10, 15, 12), settings = structuredClone(defaultSettings);
    const preview = getPlanNights(data, now, settings);
    expect(preview).toHaveLength(8);
    expect(preview.some(n => n.current)).toBe(false);
    const plan = startSleepPlan(data, now, settings);
    expect(plan.plan).toEqual({start: '2026-11-15', wake: 600, bed: 120});
    expect(getPlanNights(plan, now, settings)[0]).toEqual({night: 1, wake: 585, bed: 105, current: true});
    expect(getPlanNights(plan, addDays(now, 2), settings)[2].current).toBe(true);
    expect(getPlanNights(plan, addDays(now, 20), settings).some(n => n.current)).toBe(false);
    expect(stopSleepPlan(plan)).toEqual(data);
    expect(clearSleep()).toEqual(empty());
    expect(data.plan).toBeNull();
    expect(plan.plan).not.toBeNull();
    expect(() => startSleepPlan(empty(), now, settings)).toThrow('wake');
    expect(getPlanNights(empty(), now, settings)).toEqual([]);
    const onTarget = {wakes: {'2026-11-15': 480}, beds: {'2026-11-14': 0}, plan: null};
    expect(getPlanNights(onTarget, now, settings)).toEqual([]);
  });

  it('stale cutoff, before estimated wake, phase/color boundaries and no-phone confirmation', () => {
    const settings = structuredClone(defaultSettings), data = logSleep(empty(), 'wake', new Date(2026, 10, 15, 8));
    expect(currentState(data, new Date(2026, 10, 16, 5, 59), settings).logged).toBe(true);
    expect(currentState(data, new Date(2026, 10, 16, 6), settings).logged).toBe(false);
    expect(getSleepView(empty(), new Date(2026, 10, 15, 7), settings).status).toBe('Wake in 1h');
    for (const [hour, minute, color, phase] of [[21, 59, settings.appearance.green, null], [22, 0, settings.appearance.yellow, 'Night routine • bed prep'], [23, 0, settings.appearance.yellow, 'No phone time'], [0, 0, settings.appearance.red, null]] as const) {
      const now = new Date(2026, 10, hour === 0 ? 16 : 15, hour, minute), view = getSleepView(data, now, settings);
      expect(view.color).toBe(color); expect(view.phase).toBe(phase);
      expect(needsFocusConfirmation(data, now, settings)).toBe(phase === 'No phone time');
    }
    const future = logSleep(empty(), 'wake', new Date(2026, 10, 16, 8));
    expect(currentState(future, new Date(2026, 10, 15, 12), settings).logged).toBe(false);
  });
});
