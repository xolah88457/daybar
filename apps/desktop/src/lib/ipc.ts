import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DaybarClient, Snapshot, MutationResult } from '@daybar/core/contracts';
export const tauriClient: DaybarClient = {
  snapshot: () => invoke<Snapshot>('get_snapshot'),
  mutate: operation => invoke<MutationResult>('mutate', { operation }),
  setPreferences: preferences => invoke<Snapshot>('set_preferences', { preferences }),
  resolveConflict: (file, action) => invoke<Snapshot>('resolve_conflict', { file, action }),
  subscribe: onChange => listen('daybar://changed', onChange)
};
