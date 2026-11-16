import pkg from '../../package.json';

export interface UpdateInfo {
  version: string;
  notes: string;
  date: string | null;
}
export interface UpdateProgress {
  downloaded: number;
  /** Total size in bytes, or null when the server did not report one. */
  total: number | null;
}
/**
 * The only way UI code reaches the updater. Nothing here runs, loads a plugin
 * or touches the network until a method is called, and the UI calls
 * check() only after the user asks.
 */
export interface UpdaterClient {
  /** False where updates cannot be installed (browser demo). */
  readonly supported: boolean;
  version(): Promise<string>;
  check(): Promise<UpdateInfo | null>;
  downloadAndInstall(
    onProgress: (progress: UpdateProgress) => void
  ): Promise<void>;
  restart(): Promise<void>;
}

type PluginUpdate = import('@tauri-apps/plugin-updater').Update;
let pending: PluginUpdate | null = null;
// True from the start of check() or downloadAndInstall() until it settles.
// Closing the pending Update or starting a second download mid-flight would
// race the first one, so the adapter refuses instead of trusting the UI.
let inFlight = false;
async function exclusive<T>(run: () => Promise<T>): Promise<T> {
  if (inFlight) throw new Error('An update is already in progress.');
  inFlight = true;
  try {
    return await run();
  } finally {
    inFlight = false;
  }
}

// Plugins are imported lazily so the web bundle, tests and demo never load them.
export const tauriUpdater: UpdaterClient = {
  supported: true,
  async version() {
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  },
  check: () =>
    exclusive(async () => {
      const { check } = await import('@tauri-apps/plugin-updater');
      const previous = pending;
      pending = null;
      await previous?.close().catch(() => undefined);
      const update = await check();
      if (!update) return null;
      pending = update;
      return {
        version: update.version,
        notes: update.body ?? '',
        date: update.date ?? null
      };
    }),
  downloadAndInstall: (onProgress) =>
    exclusive(async () => {
      const update = pending;
      if (!update) throw new Error('No update has been checked yet.');
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? null;
          onProgress({ downloaded, total });
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          onProgress({ downloaded, total });
        }
      });
    }),
  async restart() {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  }
};

const unavailable = () =>
  Promise.reject(new Error('Updates are only available in the desktop app.'));
// Browser/demo: shows the build's version, never touches the network.
export const demoUpdater: UpdaterClient = {
  supported: false,
  version: () => Promise.resolve(pkg.version),
  check: unavailable,
  downloadAndInstall: unavailable,
  restart: unavailable
};

const ONLINE =
  'Could not check for updates. Make sure you are online, then try again.';
const GENERIC = 'Could not check for updates. Try again in a moment.';
const rawMessage = (error: unknown) =>
  typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : String(error);
/**
 * Turns a failed check() into a plain-language message. Matches the error
 * strings of tauri-plugin-updater 2.14 (Tauri sends them as plain strings),
 * case-insensitively, and falls back to a generic message.
 */
export function friendlyCheckError(error: unknown): string {
  const text = rawMessage(error).toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));
  if (has('valid release json', 'releasenotfound', 'release not found'))
    return 'No published update was found.';
  if (
    has(
      'none of the fallback platforms',
      'targetsnotfound',
      'targetnotfound',
      'was not found in the response `platforms`'
    )
  )
    return 'There’s no update published for this Mac.';
  if (
    has(
      'error sending request',
      'failed to fetch',
      'network',
      'offline',
      'dns',
      'connect',
      'timed out',
      'timeout'
    )
  )
    return ONLINE;
  return GENERIC;
}

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'downloading'; info: UpdateInfo; progress: UpdateProgress | null }
  | { kind: 'ready'; info: UpdateInfo }
  | { kind: 'restarting'; info: UpdateInfo }
  | {
      kind: 'error';
      message: string;
      info?: UpdateInfo;
      /** What the single retry button should do. */
      retry: 'check' | 'restart';
    };

export interface UpdateStore {
  subscribe(listener: () => void): () => void;
  getState(): UpdateState;
  /** Checks, then downloads and installs. Ignored while one is in flight. */
  check(): Promise<void>;
  /** Relaunches after an install. Only from ready or a failed restart. */
  restart(): Promise<void>;
}

export function createUpdateStore(updater: UpdaterClient): UpdateStore {
  let state: UpdateState = { kind: 'idle' };
  const listeners = new Set<() => void>();
  const set = (next: UpdateState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  const inFlight = () =>
    state.kind === 'checking' ||
    state.kind === 'downloading' ||
    state.kind === 'restarting';
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,
    async check() {
      if (inFlight()) return;
      set({ kind: 'checking' });
      let info: UpdateInfo | null;
      try {
        info = await updater.check();
      } catch (error) {
        console.error('Update check failed', error);
        set({
          kind: 'error',
          message: friendlyCheckError(error),
          retry: 'check'
        });
        return;
      }
      if (!info) {
        set({ kind: 'current' });
        return;
      }
      set({ kind: 'downloading', info, progress: null });
      try {
        await updater.downloadAndInstall((progress) => {
          if (state.kind === 'downloading') set({ ...state, progress });
        });
        set({ kind: 'ready', info });
      } catch (error) {
        console.error('Update download or install failed', error);
        set({
          kind: 'error',
          info,
          retry: 'check',
          message: `Could not download or install Daybar ${info.version}. Nothing was changed; try again in a moment.`
        });
      }
    },
    async restart() {
      const from = state;
      const info = 'info' in from ? from.info : undefined;
      if (
        !info ||
        !(
          from.kind === 'ready' ||
          (from.kind === 'error' && from.retry === 'restart')
        )
      )
        return;
      set({ kind: 'restarting', info });
      try {
        await updater.restart();
      } catch (error) {
        console.error('Restart failed', error);
        set({
          kind: 'error',
          info,
          retry: 'restart',
          message: `Daybar ${info.version} is installed, but it could not restart itself. Try Restart now again, or quit and reopen Daybar to finish updating.`
        });
      }
    }
  };
}

// One store per adapter, created on first use and kept for the life of the
// page, so progress survives leaving and returning to Settings.
const stores = new WeakMap<UpdaterClient, UpdateStore>();
export function getUpdateStore(updater: UpdaterClient): UpdateStore {
  let store = stores.get(updater);
  if (!store) {
    store = createUpdateStore(updater);
    stores.set(updater, store);
  }
  return store;
}
