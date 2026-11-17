import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Typed adapters for the Focus extras (away detection, Shortcuts). Like ipc.ts, these are the only
// places the frontend talks to Rust for them; in a plain browser (demo) they do nothing.
const native = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** What Rust knows about away detection for the running focus timer. */
export type AwayStatus = {
  /** Start of the focus timer the status is about, or null when none is watched. */
  session: number | null;
  /** True once the Mac has been idle long enough, until dismissed or the session ends. */
  away: boolean;
  awayMinutes: number;
};

export const awayClient = {
  status: async (): Promise<AwayStatus | null> =>
    native() ? invoke<AwayStatus>('away_status') : null,
  dismiss: (session: number) => invoke<AwayStatus>('away_dismiss', { session }),
  subscribe: (onStatus: (status: AwayStatus) => void) =>
    listen<AwayStatus>('daybar://away', (event) => onStatus(event.payload))
};

export const shortcutsClient = {
  /** Runs one macOS Shortcut by name; rejects with a readable message if it fails. */
  run: (name: string): Promise<void> =>
    native()
      ? invoke<void>('run_focus_shortcut', { name })
      : Promise.reject(new Error('Shortcuts only run in the Daybar Mac app.'))
};
