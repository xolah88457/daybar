import { describe, expect, it } from 'vitest';
import { defaultFeatures } from '@daybar/core/contracts';
import { createDemoClient } from '../src/lib/demo';

describe('browser demo client and features', () => {
  it('starts with the default features and round-trips changes', async () => {
    const client = createDemoClient();
    const before = await client.snapshot();
    expect(before.preferences.features).toEqual(defaultFeatures);
    const features = {
      ...before.preferences.features,
      sleep: false,
      checkIns: { ...before.preferences.features.checkIns, enabled: true, eveningTime: '' },
      extraCountdowns: {
        enabled: true,
        items: [{ id: 'trip', title: 'Trip', startDate: '2026-01-01', endDate: '2026-02-01' }]
      }
    };
    const saved = await client.setPreferences({ ...before.preferences, features });
    expect(saved.preferences.features).toEqual(features);
    expect((await client.snapshot()).preferences.features).toEqual(features);
  });
  it('rejects invalid features and leaves memory untouched', async () => {
    const client = createDemoClient();
    const { preferences } = await client.snapshot();
    const bad = { ...preferences, features: { ...preferences.features, radar: { ...preferences.features.radar, daysAhead: 0 } } };
    await expect(client.setPreferences(bad)).rejects.toThrow();
    expect((await client.snapshot()).preferences.features).toEqual(defaultFeatures);
  });
});
