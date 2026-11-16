import { describe, expect, it } from 'vitest';
import { formatCountdown, getFocusBlocks, key, linkedTasks, normalizeFocus, roomForBlocks, settleFocus, startFocus, stopFocus } from '../src';
import { defaultSettings, focusDataSchema, type FocusData } from '../src/contracts';
import { legacy, type WidgetNode } from './legacy-harness';

const empty = (): FocusData => ({state: null, days: {}});
const start = new Date(2026, 10, 14, 23, 50);

describe('focus golden parity and ledger', () => {
  for (const minutes of [1, 25, 50, 240]) for (const elapsed of [0, 59999, 60000, 1499999, 1500000]) it(`legacy early stop ${minutes}m / ${elapsed}ms`, () => {
    const data = startFocus(empty(), 'focus', minutes, start, 25);
    const now = new Date(Math.min(start.getTime() + elapsed, data.state!.end - 1));
    const old = legacy('Focus Timer', now, defaultSettings), oldData = structuredClone(data);
    const expected = old.call<number>('stopTimer', oldData);
    const result = stopFocus(data, now, 25);
    expect(result.creditedMinutes).toBe(expected);
    expect(result.data.days).toEqual(oldData.days);
    expect(data.state).not.toBeNull();
    expect(Object.keys(result.data.sessions!)).toEqual([String(start.getTime())]);
  });

  it('matches actual legacy settlement on end day and keeps legacy baseline once', () => {
    const data: FocusData = {state: {type: 'focus', minutes: 50, start: +start, end: +start + 50 * 60000}, days: {[key(start)]: {minutes: 36, count: 1}}};
    const now = new Date(+start + 3 * 86400000), old = legacy('Focus Timer', now, defaultSettings);
    const oldData = structuredClone(data);
    old.call('settle', oldData);
    const result = settleFocus(data, now, 25);
    expect(result.days).toEqual(oldData.days);
    expect(result.baseline).toEqual(data.days);
    expect(settleFocus(result, now, 25)).toEqual(result);
    const replay = settleFocus({...result, state: data.state}, now, 25);
    expect(replay).toEqual(result);
    expect(stopFocus({...result, state: data.state}, now, 25).creditedMinutes).toBe(0);
    expect(focusDataSchema.safeParse(result).success).toBe(true);
  });

  it('adds partial sessions to blocks; immutable normalization and changed block size', () => {
    let data = empty();
    for (const [offset, duration] of [[0, 36], [60, 14]]) {
      const now = new Date(+start + offset * 60000);
      data = startFocus(data, 'focus', 50, now, 25);
      data = stopFocus(data, new Date(+now + duration * 60000), 25).data;
    }
    // First session crosses midnight; both credits belong to the stop date.
    expect(data.days['2026-11-15']).toEqual({minutes: 50, count: 2});
    const copy = structuredClone(data);
    expect(normalizeFocus(data, 50).days['2026-11-15'].count).toBe(1);
    expect(data).toEqual(copy);
    expect(() => normalizeFocus({state: null, days: {'2026-11-15': {minutes: 999, count: 99}}, sessions: {}}, 25)).toThrow('Untracked focus minutes');
  });

  it('records breaks/zero-minute stops and protects active/key collisions', () => {
    for (const type of ['focus', 'break'] as const) {
      const data = startFocus(empty(), type, 25, start, 25);
      const stop = stopFocus(data, new Date(+start + 59999), 25);
      expect(stop.creditedMinutes).toBe(0);
      expect(stop.data.days).toEqual({});
      expect(Object.values(stop.data.sessions!)[0].creditedMinutes).toBe(0);
      expect(() => startFocus(data, type, 25, start, 25)).toThrow('active');
      expect(() => startFocus(stop.data, type, 25, start, 25)).toThrow('already exists');
      if (type === 'break') expect(settleFocus(data, new Date(data.state!.end), 25).days).toEqual({});
    }
  });

  it('settles expired stop at end rather than next load date and auto-settles before starting', () => {
    const data = startFocus(empty(), 'focus', 25, start, 25), later = new Date(+start + 2 * 86400000);
    expect(stopFocus(data, later, 25).data).toEqual(settleFocus(data, later, 25));
    const next = startFocus(data, 'break', 5, later, 25);
    expect(next.days['2026-11-15'].minutes).toBe(25);
    expect(next.state?.type).toBe('break');
  });

  it('links tagged settled minutes only, with archived exclusion', () => {
    const settings = structuredClone(defaultSettings);
    settings.habits.tasks = ['Coursework', 'constructor'];
    settings.habits.focusThresholds = {Coursework: 25, constructor: 10};
    let data = startFocus(empty(), 'focus', 25, start, 25, 'Coursework');
    expect(linkedTasks(data, settings, '2026-11-15')).toEqual([]);
    data = settleFocus(data, new Date(+start + 25 * 60000), 25);
    expect(linkedTasks(data, settings, '2026-11-15')).toEqual(['Coursework']);
    const second = new Date(+start + 30 * 60000);
    data = settleFocus(startFocus(data, 'focus', 10, second, 25, 'constructor'), new Date(+second + 10 * 60000), 25);
    expect(Object.values(data.sessions!).map(s => s.task)).toEqual(['Coursework', 'constructor']);
    expect(linkedTasks(data, settings, '2026-11-15')).toEqual(['Coursework', 'constructor']);
    expect(linkedTasks(data, settings, '2026-11-14')).toEqual([]);
    settings.habits.tasks = [];
    expect(linkedTasks(data, settings, '2026-11-15')).toEqual([]);
    expect(Object.values(data.sessions!)[0].task).toBe('Coursework');
  });

  it('matches legacy block row, caps countdown at zero and computes room', () => {
    for (const minutes of [0, 24, 25, 36, 50, 1000]) {
      const data = {state: null, days: {[key(start)]: {minutes, count: 0}}};
      const widget = legacy('Focus Timer', start, defaultSettings).call<WidgetNode>('createWidget', data);
      const row = widget.children[2], blocks = getFocusBlocks(data.days[key(start)], defaultSettings, 330);
      expect(blocks.cells).toEqual(row.children.map(c => ({color: c.backgroundColor?.hex, opacity: c.backgroundColor?.opacity})));
      expect(blocks.cellSize).toBe(row.children[0].size?.width);
    }
    const state = startFocus(empty(), 'focus', 25, start, 25).state;
    for (const [offset, expected] of [[0, '25:00'], [1, '25:00'], [1000, '24:59'], [1500000, '0:00'], [9999999, '0:00']] as const) expect(formatCountdown(state, new Date(+start + offset))).toBe(expected);
    expect(formatCountdown(null, start)).toBe('0:00');
    expect([-1, 0, 24, 25, 99].map(n => roomForBlocks(n, 25))).toEqual([0, 0, 0, 1, 3]);
    const settings = structuredClone(defaultSettings);
    settings.appearance.cellSize = 3; settings.appearance.gap = 10;
    for (const width of [1, 10, 10.01, 20]) expect(getFocusBlocks(undefined, settings, width).cellSize).toBeGreaterThan(0);
  });
});
