import { featureIds, moduleFeatureIds } from '@daybar/core';
import { currentFeaturesVersion, defaultFeatures, defaultSettings } from '@daybar/core/contracts';
import type { Features, Snapshot } from '@daybar/core/contracts';

/**
 * Modules on, every other feature's stored switch off (the 0.3.0 defaults). Most tests start here
 * and turn on only the feature they are about; tests of the shipped defaults use `defaultFeatures`.
 * Built-in features ignore their stored switch, so they stay on.
 */
export function allOptionalOff(): Features {
  const f = structuredClone(defaultFeatures);
  for (const id of featureIds) {
    if ((moduleFeatureIds as readonly string[]).includes(id)) continue;
    const value = f[id];
    if (typeof value !== 'boolean') value.enabled = false;
  }
  f.radar.dueAlerts = false;
  return f;
}

export function fixture(): Snapshot {
  return {
    settings: structuredClone(defaultSettings),
    dailyLog: {},
    focus: { state: null, days: {} },
    sleep: { wakes: {}, beds: {}, plan: null },
    preferences: {
      dataFolder: '.dev-data',
      realData: false,
      launchAtLogin: false,
      hideDock: false,
      globalShortcut: '',
      themeMode: 'night',
      trayDisplay: 'auto',
      features: allOptionalOff(),
      featuresVersion: currentFeaturesVersion
    },
    issues: [],
    conflicts: []
  };
}
