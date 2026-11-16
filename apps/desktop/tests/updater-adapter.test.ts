import { describe, expect, it, vi } from 'vitest';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { demoUpdater, tauriUpdater } from '../src/lib/updates';
import pkg from '../package.json';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));

describe('updater adapters', () => {
  it('does nothing until a method is called', () => {
    expect(check).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });
  it('maps the plugin update and download events to app types', async () => {
    vi.mocked(getVersion).mockResolvedValue('0.2.0');
    expect(await tauriUpdater.version()).toBe('0.2.0');
    const close = vi.fn(async () => {});
    const downloadAndInstall = vi.fn(
      async (onEvent: (e: unknown) => void) => {
        onEvent({ event: 'Started', data: { contentLength: 100 } });
        onEvent({ event: 'Progress', data: { chunkLength: 40 } });
        onEvent({ event: 'Progress', data: { chunkLength: 60 } });
        onEvent({ event: 'Finished' });
      }
    );
    vi.mocked(check).mockResolvedValue({
      version: '0.3.0',
      body: 'Notes',
      date: '2026-11-20T10:00:00Z',
      close,
      downloadAndInstall
    } as unknown as Awaited<ReturnType<typeof check>>);
    expect(await tauriUpdater.check()).toEqual({
      version: '0.3.0',
      notes: 'Notes',
      date: '2026-11-20T10:00:00Z'
    });
    const progress = vi.fn();
    await tauriUpdater.downloadAndInstall(progress);
    expect(progress.mock.calls.map(([p]) => p)).toEqual([
      { downloaded: 0, total: 100 },
      { downloaded: 40, total: 100 },
      { downloaded: 100, total: 100 }
    ]);
    // A later check releases the previous update's resource.
    vi.mocked(check).mockResolvedValue(null);
    expect(await tauriUpdater.check()).toBeNull();
    expect(close).toHaveBeenCalled();
    await expect(tauriUpdater.downloadAndInstall(progress)).rejects.toThrow(
      'No update has been checked yet.'
    );
  });
  it('refuses a second check or download while one is in flight', async () => {
    let finish!: () => void;
    const downloadAndInstall = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    const close = vi.fn(async () => {});
    vi.mocked(check).mockClear();
    vi.mocked(check).mockResolvedValue({
      version: '0.4.0',
      body: '',
      date: null,
      close,
      downloadAndInstall
    } as unknown as Awaited<ReturnType<typeof check>>);
    await tauriUpdater.check();
    const first = tauriUpdater.downloadAndInstall(vi.fn());
    await vi.waitFor(() => expect(downloadAndInstall).toHaveBeenCalled());
    await expect(tauriUpdater.check()).rejects.toThrow('already in progress');
    await expect(tauriUpdater.downloadAndInstall(vi.fn())).rejects.toThrow(
      'already in progress'
    );
    expect(check).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    finish();
    await first;
    // Settled: checking is allowed again.
    vi.mocked(check).mockResolvedValue(null);
    await expect(tauriUpdater.check()).resolves.toBeNull();
  });
  it('relaunches through the process plugin', async () => {
    await tauriUpdater.restart();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
  it('demo adapter reports the package version and refuses network actions', async () => {
    expect(demoUpdater.supported).toBe(false);
    expect(await demoUpdater.version()).toBe(pkg.version);
    const calls = vi.mocked(check).mock.calls.length;
    await expect(demoUpdater.check()).rejects.toThrow();
    expect(vi.mocked(check).mock.calls.length).toBe(calls);
  });
});
