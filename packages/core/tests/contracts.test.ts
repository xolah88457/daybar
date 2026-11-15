import { describe, expect, it } from 'vitest';
import { settingsSchema, defaultSettings, dateKeySchema, focusDataSchema, dailyLogSchema, preferencesSchema } from '../src/contracts';
describe('shared contracts', () => {
  it('defaults missing settings without accepting an unknown version', () => {
    expect(settingsSchema.parse({ focus: { blockMinutes: 50 } }).habits).toEqual(defaultSettings.habits);
    expect(settingsSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
    expect(settingsSchema.safeParse({ unknown: true }).success).toBe(false);
    expect(defaultSettings.countdown).toEqual({startDate:'2026-10-01', endDate:'2027-07-01', title:'Community Garden Opening'});
    expect(defaultSettings.habits).toMatchObject({startDate:'2026-11-01', logId:'Daily_Tasks', tasks:['Read a chapter','Sketch a scene','Take a walk','Water the plants']});
  });
  it('rejects invalid dates, timer credit and inverted ranges', () => {
    expect(dateKeySchema.safeParse('2026-02-30').success).toBe(false);
    expect(settingsSchema.safeParse({ countdown: { startDate: '2027-01-01', endDate: '2026-01-01' } }).success).toBe(false);
    expect(focusDataSchema.safeParse({ state: null, days: {}, sessions: { '1': { type: 'focus', minutes: 25, creditedMinutes: 26, end: 2, date: '2026-11-15' } } }).success).toBe(false);
  });
  it('defaults theme mode to night and rejects unsupported values', () => {
    const preferences = {dataFolder:'', realData:false, launchAtLogin:false, hideDock:false, globalShortcut:''};
    expect(preferencesSchema.parse(preferences).themeMode).toBe('night');
    for (const themeMode of ['day', 'night', 'auto']) expect(preferencesSchema.parse({...preferences, themeMode}).themeMode).toBe(themeMode);
    expect(preferencesSchema.safeParse({...preferences, themeMode:'system'}).success).toBe(false);
  });
  it('accepts legacy phone data', () => {
    expect(dailyLogSchema.parse(['2026-11-15'])).toEqual(['2026-11-15']);
    expect(focusDataSchema.parse({ state: null, days: { '2026-11-15': { minutes: 36, count: 1 } } }).sessions).toBeUndefined();
  });
});
