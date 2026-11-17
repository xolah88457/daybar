import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getSleepView } from '@daybar/core';
import type { Snapshot } from '@daybar/core/contracts';
import { confirmFocusStart, Focus } from '../src/components/modules';
import { AwayBanner, Config as AwayConfig } from '../src/features/awayDetection';
import { Config as AutoCycleConfig } from '../src/features/autoCycle';
import { Config as ShortcutsConfig } from '../src/features/focusShortcuts';
import { fixture } from './fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const now = new Date(2026, 10, 15, 23, 30);
const START = now.getTime() - 10 * 60_000;

function configProps<K extends 'autoCycle' | 'focusShortcuts' | 'awayDetection'>(
  id: K,
  patch: Partial<Snapshot['preferences']['features'][K]> = {}
) {
  const snapshot = fixture();
  const value = { ...snapshot.preferences.features[id], enabled: true, ...patch };
  return {
    id,
    value,
    features: snapshot.preferences.features,
    snapshot,
    busy: false,
    save: vi.fn(async () => true)
  };
}

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('Auto-cycle config', () => {
  it('saves a valid interval and refuses out-of-range values', () => {
    const p = configProps('autoCycle');
    render(<AutoCycleConfig {...p} />);
    const input = screen.getByLabelText(/Long break every/);
    expect(input).toHaveValue(4);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: '1' } });
    expect(screen.getByRole('alert')).toHaveTextContent('2 to 12');
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.click(save);
    expect(p.save).toHaveBeenCalledWith({ enabled: true, longBreakEvery: 3 });
  });
});

describe('Focus shortcuts config', () => {
  it('saves trimmed names, shows the help text and tests each Shortcut', async () => {
    const p = configProps('focusShortcuts');
    render(<ShortcutsConfig {...p} />);
    expect(
      screen.getByText(/Create a Shortcut in the Shortcuts app, e\.g\. one that turns on Do Not/)
    ).toHaveTextContent('then type its exact name here.');
    expect(screen.getByRole('button', { name: 'Test start Shortcut' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Run when a focus session starts/), {
      target: { value: '  Work On ' }
    });
    fireEvent.change(screen.getByLabelText(/Run when a focus session ends/), {
      target: { value: 'Work Off' }
    });
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Test start Shortcut' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Ran “Work On”.');
    expect(invoke).toHaveBeenCalledWith('run_focus_shortcut', { name: 'Work On' });
    vi.mocked(invoke).mockRejectedValueOnce('Shortcut “Work Off” failed: not found');
    fireEvent.click(screen.getByRole('button', { name: 'Test end Shortcut' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not found');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(p.save).toHaveBeenCalledWith({
      enabled: true,
      onStart: 'Work On',
      onEnd: 'Work Off'
    });
  });
});

describe('Away detection config', () => {
  it('saves a valid threshold and refuses out-of-range values', () => {
    const p = configProps('awayDetection');
    render(<AwayConfig {...p} />);
    const input = screen.getByLabelText(/Away after/);
    expect(input).toHaveValue(5);
    fireEvent.change(input, { target: { value: '61' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(p.save).toHaveBeenCalledWith({ enabled: true, idleMinutes: 10 });
  });
});

describe('Away banner', () => {
  function running(awayOn = true): Snapshot {
    const snapshot = fixture();
    snapshot.preferences.features.awayDetection.enabled = awayOn;
    snapshot.focus.state = { type: 'focus', minutes: 25, start: START, end: START + 25 * 60_000 };
    return snapshot;
  }
  function banner(snapshot: Snapshot, run = vi.fn(async () => true)) {
    render(
      <AwayBanner
        snapshot={snapshot}
        now={now}
        busy={false}
        run={run}
        confirm={vi.fn(async () => true)}
      />
    );
    return run;
  }
  const away = { session: START, away: true, awayMinutes: 7 };

  it('shows nothing until Rust reports the Mac was away during this session', async () => {
    vi.mocked(listen).mockResolvedValue(vi.fn());
    vi.mocked(invoke).mockResolvedValue({ session: START, away: false, awayMinutes: 0 });
    banner(running());
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('away_status'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers Keep going (dismiss) and Stop timer (the normal stop_timer)', async () => {
    let push: (status: typeof away) => void = () => undefined;
    vi.mocked(listen).mockImplementation(async (_event, handler) => {
      push = (payload) => (handler as (e: { payload: typeof away }) => void)({ payload });
      return vi.fn();
    });
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === 'away_dismiss' ? { ...away, away: false } : { ...away, away: false }
    );
    const run = banner(running());
    await waitFor(() => expect(listen).toHaveBeenCalledWith('daybar://away', expect.any(Function)));
    act(() => push(away));
    expect(await screen.findByRole('status')).toHaveTextContent(
      "Still focusing? You've been away 7 min."
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }));
    expect(run).toHaveBeenCalledWith({ kind: 'stop_timer' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep going' }));
    expect(invoke).toHaveBeenCalledWith('away_dismiss', { session: START });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('ignores another session, a break, and a switched-off feature', async () => {
    vi.mocked(listen).mockResolvedValue(vi.fn());
    vi.mocked(invoke).mockResolvedValue({ ...away, session: START - 1 });
    banner(running());
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
    vi.mocked(invoke).mockClear();
    const off = running(false);
    banner(off);
    const onBreak = running();
    onBreak.focus.state!.type = 'break';
    banner(onBreak);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('is rendered by the Focus module, next to the timer', async () => {
    vi.mocked(listen).mockResolvedValue(vi.fn());
    vi.mocked(invoke).mockResolvedValue(away);
    render(
      <Focus
        snapshot={running()}
        now={now}
        busy={false}
        run={vi.fn(async () => true)}
        confirm={vi.fn(async () => true)}
      />
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Still focusing?');
  });
});

describe('no-phone confirmation', () => {
  // 23:30 with a 23:35 bedtime plan: no-phone time while the Sleep module is on.
  function snapshot(): Snapshot {
    const s = fixture();
    s.sleep.plan = { start: '2026-11-15', wake: 8 * 60, bed: 23 * 60 + 35 };
    return s;
  }
  const view = (s: Snapshot) => getSleepView(s.sleep, now, s.settings);

  it('asks while the Sleep module is on', async () => {
    const s = snapshot();
    const confirm = vi.fn(async () => false);
    expect(view(s).leftMinutes).toBeLessThanOrEqual(s.settings.sleep.noPhoneMinutes);
    expect(await confirmFocusStart(view(s), s.settings.sleep.noPhoneMinutes, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('is skipped when the Sleep module is off', async () => {
    const s = snapshot();
    const confirm = vi.fn(async () => false);
    expect(await confirmFocusStart(view(s), s.settings.sleep.noPhoneMinutes, confirm, false)).toBe(
      true
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('the Focus start buttons skip it with Sleep off and still ask with Sleep on', async () => {
    for (const sleepOn of [false, true]) {
      const s = snapshot();
      s.preferences.features.sleep = sleepOn;
      const run = vi.fn(async () => true);
      const confirm = vi.fn(async () => true);
      const { unmount } = render(
        <Focus snapshot={s} now={now} busy={false} run={run} confirm={confirm} />
      );
      fireEvent.click(screen.getAllByRole('button', { name: /^25 min/ })[0]);
      await waitFor(() => expect(run).toHaveBeenCalled());
      expect(confirm).toHaveBeenCalledTimes(sleepOn ? 1 : 0);
      unmount();
    }
  });
});
