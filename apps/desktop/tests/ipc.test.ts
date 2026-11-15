import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { tauriClient } from '../src/lib/ipc';
import { fixture } from './fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

describe('typed Tauri command adapter', () => {
  it('uses fixed command names, camelCase payloads, and returns backend snapshots', async () => {
    const snapshot = fixture();
    vi.mocked(invoke).mockResolvedValue(snapshot);
    expect(await tauriClient.snapshot()).toBe(snapshot);
    expect(invoke).toHaveBeenLastCalledWith('get_snapshot');
    const operation = {
      kind: 'set_task' as const,
      date: '2026-11-15',
      task: 'Coursework',
      done: true
    };
    await tauriClient.mutate(operation);
    expect(invoke).toHaveBeenLastCalledWith('mutate', { operation });
    await tauriClient.setPreferences(snapshot.preferences);
    expect(invoke).toHaveBeenLastCalledWith('set_preferences', {
      preferences: snapshot.preferences
    });
    await tauriClient.resolveConflict('focus-timer 2.json', 'merge');
    expect(invoke).toHaveBeenLastCalledWith('resolve_conflict', {
      file: 'focus-timer 2.json',
      action: 'merge'
    });
  });
  it('subscribes only to the shared change event and propagates errors', async () => {
    const stop = vi.fn();
    vi.mocked(listen).mockResolvedValue(stop);
    const callback = vi.fn();
    expect(await tauriClient.subscribe(callback)).toBe(stop);
    expect(listen).toHaveBeenCalledWith('daybar://changed', callback);
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Malformed file'));
    await expect(tauriClient.snapshot()).rejects.toThrow('Malformed file');
  });
});
