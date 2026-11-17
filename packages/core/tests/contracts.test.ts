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
  it('rejects a NUL byte in a Focus Shortcut name, as the native side does', () => {
    const preferences = {dataFolder:'', realData:false, launchAtLogin:false, hideDock:false, globalShortcut:''};
    const withShortcuts = (focusShortcuts: object) => preferencesSchema.safeParse({...preferences, features: {focusShortcuts}}).success;
    expect(withShortcuts({ enabled: true, onStart: 'Work On', onEnd: '' })).toBe(true);
    expect(withShortcuts({ enabled: true, onStart: 'Work\u0000On' })).toBe(false);
    expect(withShortcuts({ enabled: true, onEnd: '\u0000' })).toBe(false);
  });
  it('defaults theme and tray preferences and rejects unsupported enum values', () => {
    const preferences = {dataFolder:'', realData:false, launchAtLogin:false, hideDock:false, globalShortcut:''};
    expect(preferencesSchema.parse(preferences)).toMatchObject({themeMode:'night', trayDisplay:'auto'});
    for (const themeMode of ['day', 'night', 'auto']) expect(preferencesSchema.parse({...preferences, themeMode}).themeMode).toBe(themeMode);
    for (const trayDisplay of ['auto', 'focusMinutes', 'focusHours', 'focusBlocks', 'activeTimer', 'bedtime', 'nextTask', 'countdown']) expect(preferencesSchema.parse({...preferences, trayDisplay}).trayDisplay).toBe(trayDisplay);
    expect(preferencesSchema.safeParse({...preferences, themeMode:'system'}).success).toBe(false);
    expect(preferencesSchema.safeParse({...preferences, trayDisplay:'future'}).success).toBe(false);
  });
  it('accepts legacy phone data', () => {
    expect(dailyLogSchema.parse(['2026-11-15'])).toEqual(['2026-11-15']);
    expect(focusDataSchema.parse({ state: null, days: { '2026-11-15': { minutes: 36, count: 1 } } }).sessions).toBeUndefined();
  });
});
