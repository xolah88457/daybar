import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  builtInFeatureIds,
  currentFeaturesVersion,
  defaultFeatures,
  featureEnabled,
  featureRequires,
  featureIds,
  featureSwitch,
  featuresSchema,
  preferencesSchema,
  setFeatureSwitch
} from '../src';

const base = { dataFolder: '', realData: false, launchAtLogin: false, hideDock: false, globalShortcut: '' };
const item = { id: 'trip', title: 'Trip', startDate: '2026-01-01', endDate: '2026-02-01' };

describe('preferences.features schema', () => {
  it('defaults: the useful features on; frequent alerts and auto-cycle off', () => {
    expect(defaultFeatures).toMatchObject({ countdown: true, habits: true, focus: true, sleep: true });
    const off = ['hourlyChime', 'movementNudges', 'autoCycle'];
    for (const id of featureIds) {
      expect(featureSwitch(defaultFeatures, id)).toBe(!off.includes(id));
      // The stored flag agrees with the switch, so older apps reading the file see the same thing.
      const value = defaultFeatures[id];
      expect(typeof value === 'boolean' ? value : value.enabled).toBe(!off.includes(id));
    }
    expect(defaultFeatures.radar).toEqual({
      enabled: true, calendars: [], reminderLists: [], includeReminders: true, daysAhead: 60,
      overdueDaysBack: 14, keywords: [], dueAlerts: true, alertTime: '09:00'
    });
    expect(defaultFeatures.hourlyChime).toEqual({ enabled: false, quietStart: '22:00', quietEnd: '08:00', sound: true });
    expect(defaultFeatures.checkIns).toEqual({ enabled: true, morningTime: '08:00', eveningTime: '20:00' });
    expect(defaultFeatures.streakSaver.minutesBeforeBed).toBe(90);
    expect(defaultFeatures.autoCycle.longBreakEvery).toBe(4);
    expect(defaultFeatures.focusShortcuts).toEqual({ enabled: true, onStart: '', onEnd: '' });
    expect(defaultFeatures.awayDetection.idleMinutes).toBe(5);
    expect(defaultFeatures.movementNudges).toEqual({ enabled: false, intervalMinutes: 50, activeStart: '09:00', activeEnd: '18:00' });
    expect(defaultFeatures.extraCountdowns).toEqual({ enabled: true, items: [] });
    expect(Object.keys(defaultFeatures).sort()).toEqual([...featureIds].sort());
  });
  it('parses old preferences without a features key and fills partial objects from defaults', () => {
    expect(preferencesSchema.parse(base).features).toEqual(defaultFeatures);
    expect(preferencesSchema.parse(base).featuresVersion).toBe(currentFeaturesVersion);
    const parsed = preferencesSchema.parse({ ...base, features: { focus: false, radar: { enabled: true, daysAhead: 30 } } });
    expect(parsed.features.focus).toBe(false);
    expect(parsed.features.sleep).toBe(true);
    expect(parsed.features.radar).toEqual({ ...defaultFeatures.radar, enabled: true, daysAhead: 30 });
    expect(parsed.features.hourlyChime).toEqual(defaultFeatures.hourlyChime);
  });
  it('round-trips through JSON unchanged', () => {
    const features = featuresSchema.parse({ checkIns: { enabled: true, eveningTime: '' }, extraCountdowns: { enabled: true, items: [item] } });
    expect(featuresSchema.parse(JSON.parse(JSON.stringify(features)))).toEqual(features);
  });
  it.each([
    ['radar.daysAhead low', { radar: { daysAhead: 0 } }],
    ['radar.daysAhead high', { radar: { daysAhead: 366 } }],
    ['radar.daysAhead fraction', { radar: { daysAhead: 1.5 } }],
    ['radar.overdueDaysBack', { radar: { overdueDaysBack: 91 } }],
    ['radar.overdueDaysBack negative', { radar: { overdueDaysBack: -1 } }],
    ['radar.alertTime', { radar: { alertTime: '9:00' } }],
    ['radar.keywords blank', { radar: { keywords: ['  '] } }],
    ['hourlyChime.quietStart', { hourlyChime: { quietStart: '24:00' } }],
    ['checkIns.morningTime', { checkIns: { morningTime: '08:60' } }],
    ['streakSaver.minutesBeforeBed', { streakSaver: { minutesBeforeBed: 721 } }],
    ['autoCycle.longBreakEvery low', { autoCycle: { longBreakEvery: 1 } }],
    ['autoCycle.longBreakEvery high', { autoCycle: { longBreakEvery: 13 } }],
    ['focusShortcuts.onStart length', { focusShortcuts: { onStart: 'x'.repeat(121) } }],
    ['awayDetection.idleMinutes', { awayDetection: { idleMinutes: 61 } }],
    ['movementNudges.intervalMinutes', { movementNudges: { intervalMinutes: 9 } }],
    ['movementNudges.activeEnd', { movementNudges: { activeEnd: 'late' } }],
    ['unknown feature key', { telepathy: { enabled: true } }],
    ['unknown nested key', { insights: { enabled: true, extra: 1 } }],
    ['non-boolean module', { focus: 'yes' }],
    ['extra countdown id', { extraCountdowns: { items: [{ ...item, id: 'a b' }] } }],
    ['extra countdown id length', { extraCountdowns: { items: [{ ...item, id: 'x'.repeat(41) }] } }],
    ['extra countdown dates reversed', { extraCountdowns: { items: [{ ...item, endDate: '2025-12-31' }] } }],
    ['extra countdown invalid date', { extraCountdowns: { items: [{ ...item, startDate: '2026-02-30' }] } }],
    ['extra countdown blank title', { extraCountdowns: { items: [{ ...item, title: '   ' }] } }],
    ['extra countdown duplicates', { extraCountdowns: { items: [item, item] } }],
    ['extra countdown count', { extraCountdowns: { items: Array.from({ length: 13 }, (_, i) => ({ ...item, id: `c${i}` })) } }]
  ])('rejects %s', (_name, features) => {
    expect(preferencesSchema.safeParse({ ...base, features }).success).toBe(false);
  });
  it('accepts the documented boundaries and trims countdown titles', () => {
    const features = featuresSchema.parse({
      radar: { daysAhead: 365, overdueDaysBack: 0 }, checkIns: { morningTime: '', eveningTime: '' },
      streakSaver: { minutesBeforeBed: 720 }, autoCycle: { longBreakEvery: 12 }, awayDetection: { idleMinutes: 1 },
      movementNudges: { intervalMinutes: 240 }, focusShortcuts: { onStart: 'x'.repeat(120) },
      extraCountdowns: { items: Array.from({ length: 12 }, (_, i) => ({ ...item, id: `c${i}`, title: '  Trip  ' })) }
    });
    expect(features.extraCountdowns.items).toHaveLength(12);
    expect(features.extraCountdowns.items[0].title).toBe('Trip');
  });
  it('keeps the generated JSON schema in sync (run pnpm schemas)', () => {
    const file = new URL('../src/contracts/schemas/preferences.schema.json', import.meta.url);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(z.toJSONSchema(preferencesSchema))));
  });
});

describe('feature helpers', () => {
  it('built-in features are always switched on, whatever their stored flag says', () => {
    const allOff = Object.fromEntries(
      featureIds.map((id) => [id, typeof defaultFeatures[id] === 'boolean' ? false : { ...(defaultFeatures[id] as object), enabled: false }])
    );
    const parsed = featuresSchema.parse(allOff);
    for (const id of featureIds) {
      expect(featureSwitch(parsed, id)).toBe((builtInFeatureIds as readonly string[]).includes(id));
    }
    // Still subject to what they require.
    expect(featureEnabled(parsed, 'roomBeforeEvent')).toBe(false);
    expect(featureEnabled(parsed, 'focusShortcuts')).toBe(false);
    expect(featureEnabled(parsed, 'commandPalette')).toBe(true);
  });
  it('the Focus extras need the Focus module', () => {
    for (const id of ['autoCycle', 'focusShortcuts', 'awayDetection'] as const) {
      expect(featureRequires[id]).toBe('focus');
      const on = setFeatureSwitch(defaultFeatures, id, true);
      expect(featureEnabled(on, id)).toBe(true);
      const off = setFeatureSwitch(on, 'focus', false);
      expect(featureSwitch(off, id)).toBe(true); // the saved choice survives
      expect(featureEnabled(off, id)).toBe(false);
    }
  });
  it('room before an event needs Deadline Radar; switching keeps configuration', () => {
    const on = setFeatureSwitch(setFeatureSwitch(defaultFeatures, 'radar', false), 'hourlyChime', true);
    expect(featureSwitch(on, 'roomBeforeEvent')).toBe(true);
    expect(featureEnabled(on, 'roomBeforeEvent')).toBe(false);
    const withRadar = setFeatureSwitch(on, 'radar', true);
    expect(featureEnabled(withRadar, 'roomBeforeEvent')).toBe(true);
    const tuned = { ...withRadar, radar: { ...withRadar.radar, daysAhead: 10 } };
    expect(setFeatureSwitch(tuned, 'radar', false).radar).toEqual({ ...tuned.radar, enabled: false });
    expect(setFeatureSwitch(defaultFeatures, 'focus', false).focus).toBe(false);
    expect(featureEnabled(setFeatureSwitch(defaultFeatures, 'focus', false), 'focus')).toBe(false);
  });
});
