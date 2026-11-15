import { defaultSettings } from '@daybar/core/contracts';
import type { Snapshot } from '@daybar/core/contracts';

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
      trayDisplay: 'auto'
    },
    issues: [],
    conflicts: []
  };
}
