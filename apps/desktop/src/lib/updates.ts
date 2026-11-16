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

// Plugins are imported lazily so the web bundle, tests and demo never load them.
export const tauriUpdater: UpdaterClient = {
  supported: true,
  async version() {
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  },
  async check() {
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
  },
  async downloadAndInstall(onProgress) {
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
  },
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
