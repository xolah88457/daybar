import { describe, expect, it } from 'vitest';
import { focusDataSchema, sleepDataSchema, type FocusData } from '../src/contracts';
import { normalizeFocus } from '../src';

const start = Date.UTC(2026, 10, 15, 12);
const date = '2026-11-15';
const valid = (): FocusData => ({
  state: null,
  days: { [date]: { count: 0, minutes: 2 } },
  sessions: { [start]: { type: 'focus', minutes: 25, creditedMinutes: 2, end: start + 120000, date } }
});

describe('cross-client focus integrity', () => {
  it.each([
    ['timer duration', (data: FocusData) => { data.state = { type: 'focus', minutes: 25, start, end: start + 1 }; }],
    ['leading-zero session alias', (data: FocusData) => { data.sessions = { [`0${start}`]: data.sessions![start] }; }],
    ['end before start', (data: FocusData) => { data.sessions![start].end = start - 1; }],
    ['end after planned duration', (data: FocusData) => { data.sessions![start].end = start + 25 * 60000 + 1; }],
    ['credit exceeds elapsed whole minutes', (data: FocusData) => { data.sessions![start].end = start + 119999; }],
    ['date beyond UTC one-day allowance', (data: FocusData) => { data.sessions![start].date = '2026-11-17'; }],
    ['unexplained days with empty ledger', (data: FocusData) => { data.sessions = {}; }],
    ['unexplained minutes beyond ledger', (data: FocusData) => { data.days[date].minutes = 3; }],
    ['disagreeing legacy baseline', (data: FocusData) => { delete data.sessions; data.baseline = { [date]: { count: 0, minutes: 1 } }; }],
    ['out-of-range stored totals', (data: FocusData) => { delete data.sessions; data.days[date].minutes = 0x100000000; }],
    ['derived total overflow', (data: FocusData) => { data.baseline = { [date]: { count: 0, minutes: 0xffffffff } }; }]
  ] as const)('rejects %s without modifying input', (_name, change) => {
    const data = valid();
    change(data);
    const before = structuredClone(data);
    expect(focusDataSchema.safeParse(data).success).toBe(false);
    expect(() => normalizeFocus(data, 25)).toThrow();
    expect(data).toEqual(before);
  });

  it('preserves a legacy baseline exactly once and allows explained ledgers without a baseline', () => {
    const legacy: FocusData = { state: null, days: { [date]: { count: 2, minutes: 50 } } };
    const upgraded = normalizeFocus(legacy, 25);
    expect(upgraded.baseline).toEqual(legacy.days);
    expect(normalizeFocus(upgraded, 25)).toEqual(upgraded);
    expect(normalizeFocus(valid(), 25).days[date].minutes).toBe(2);
  });

  it('regenerates a stale lower summary without losing ledger credit', () => {
    const data = valid();
    data.days = {};
    expect(normalizeFocus(data, 25).days[date]).toEqual({ count: 0, minutes: 2 });
  });

  it.each(['2026-11-14', date, '2026-11-16'])('allows a session written in another timezone on %s', recordedDate => {
    const data = valid();
    data.sessions![start].date = recordedDate;
    data.days = { [recordedDate]: { count: 0, minutes: 2 } };
    expect(focusDataSchema.safeParse(data).success).toBe(true);
  });

  it('requires nullable fields while rejecting null optional fields', () => {
    expect(focusDataSchema.safeParse({ days: {} }).success).toBe(false);
    expect(focusDataSchema.safeParse({ state: null, days: {} }).success).toBe(true);
    for (const key of ['sessions', 'baseline']) expect(focusDataSchema.safeParse({ state: null, days: {}, [key]: null }).success).toBe(false);
    expect(sleepDataSchema.safeParse({ wakes: {}, beds: {} }).success).toBe(false);
    expect(sleepDataSchema.safeParse({ wakes: {}, beds: {}, plan: null }).success).toBe(true);
  });
});
