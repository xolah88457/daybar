import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DaybarClient, Snapshot } from '@daybar/core/contracts';
import { key } from '@daybar/core';
import { Dashboard } from '../src/components/dashboard';
import { fixture } from './fixtures';

function mockClient(initial = fixture()) {
  let snapshot = structuredClone(initial);
  let changed: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const client: DaybarClient = {
    snapshot: vi.fn(async () => structuredClone(snapshot)),
    mutate: vi.fn(async (operation) => {
      if (operation.kind === 'set_task')
        snapshot.dailyLog[operation.date] = operation.done
          ? [operation.task]
          : [];
      return { snapshot: structuredClone(snapshot) };
    }),
    setPreferences: vi.fn(async (preferences) => ({
      ...structuredClone(snapshot),
      preferences
    })),
    resolveConflict: vi.fn(async () => structuredClone(snapshot)),
    subscribe: vi.fn(async (callback) => {
      changed = callback;
      return unsubscribe;
    })
  };
  return {
    client,
    unsubscribe,
    update: async (next: Snapshot) => {
      snapshot = next;
      await act(async () => changed?.());
    }
  };
}
const navigate = (name: string) =>
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Modules' })).getByRole(
      'button',
      { name: new RegExp(name) }
    )
  );

describe('dashboard operations and failures', () => {
  it('combines modules, sends single checkbox operations and applies live updates', async () => {
    const mock = mockClient();
    const { unmount } = render(<Dashboard client={mock.client} />);
    const task = await screen.findByRole('checkbox', { name: /Coursework/ });
    expect(
      screen.getByRole('heading', { name: /Time/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Countdown days' })
    ).toBeInTheDocument();
    fireEvent.click(task);
    await waitFor(() =>
      expect(mock.client.mutate).toHaveBeenCalledWith({
        kind: 'set_task',
        date: key(new Date()),
        task: 'Coursework',
        done: true
      })
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    const next = fixture();
    next.dailyLog[key(new Date())] = ['Live Trading'];
    await mock.update(next);
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: /Live Trading/ })
      ).toBeChecked()
    );
    expect(
      screen.getByRole('checkbox', { name: /Coursework/ })
    ).not.toBeChecked();
    unmount();
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
  });
  it('disables mutation controls while saving and surfaces backend errors without optimistic data loss', async () => {
    const mock = mockClient();
    let reject: (reason: Error) => void = () => {};
    vi.mocked(mock.client.mutate).mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    render(<Dashboard client={mock.client} />);
    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Coursework/ })
    );
    expect(
      screen.getByRole('checkbox', { name: /Live Trading/ })
    ).toBeDisabled();
    await act(async () =>
      reject(new Error('Atomic write failed. Original file kept.'))
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Original file kept.'
    );
    expect(
      screen.getByRole('checkbox', { name: /Coursework/ })
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /Live Trading/ })
    ).toBeEnabled();
  });
  it('reloads a queued phone edit after a mutation instead of replacing it with an older response', async () => {
    const mock = mockClient();
    let finish: (result: { snapshot: Snapshot }) => void = () => {};
    vi.mocked(mock.client.mutate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(<Dashboard client={mock.client} />);
    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Coursework/ })
    );
    const phone = fixture();
    phone.dailyLog[key(new Date())] = ['Live Trading'];
    await mock.update(phone);
    const olderResponse = fixture();
    olderResponse.dailyLog[key(new Date())] = ['Coursework'];
    await act(async () => finish({ snapshot: olderResponse }));
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: /Live Trading/ })
      ).toBeChecked()
    );
    expect(
      screen.getByRole('checkbox', { name: /Coursework/ })
    ).not.toBeChecked();
  });
  it('requires confirmation for merge/discard and sleep clear', async () => {
    const initial = fixture();
    initial.conflicts = [
      { file: 'focus-timer 2.json', canonical: 'focus-timer.json' }
    ];
    initial.sleep.wakes[key(new Date())] = 480;
    const mock = mockClient(initial);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Dashboard client={mock.client} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Discard copy…' })
    );
    expect(mock.client.resolveConflict).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Merge…' }));
    await waitFor(() =>
      expect(mock.client.resolveConflict).toHaveBeenCalledWith(
        'focus-timer 2.json',
        'merge'
      )
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Merge…' })).toBeEnabled()
    );
    navigate('Sleep');
    confirm.mockReturnValue(false);
    fireEvent.click(
      screen.getByRole('button', { name: /Clear all sleep data/ })
    );
    expect(mock.client.mutate).not.toHaveBeenCalledWith({
      kind: 'clear_sleep'
    });
    confirm.mockReturnValue(true);
    fireEvent.click(
      screen.getByRole('button', { name: /Clear all sleep data/ })
    );
    await waitFor(() =>
      expect(mock.client.mutate).toHaveBeenCalledWith({ kind: 'clear_sleep' })
    );
  });
  it('surfaces native confirmation failures and keeps destructive settings unchanged', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {}
    });
    const showModal = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      'showModal'
    );
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value: () => {
          throw new Error('Native dialogs are unavailable.');
        }
      },
      close: {
        configurable: true,
        value: () => {}
      }
    });
    const initial = fixture();
    const currentTime = new Date();
    initial.sleep.wakes[key(currentTime)] =
      currentTime.getHours() * 60 + currentTime.getMinutes() - 60;
    initial.settings.sleep.noPhoneMinutes = 1440;
    const mock = mockClient(initial);
    render(<Dashboard client={mock.client} />);
    await screen.findByRole('checkbox', { name: /Coursework/ });
    navigate('Focus');
    fireEvent.click(screen.getByRole('button', { name: '25 min ↗' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not confirm this action: Native dialogs are unavailable.'
    );
    expect(mock.client.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    navigate('Settings');
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive…' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not confirm this action: Native dialogs are unavailable.'
    );
    expect(mock.client.mutate).not.toHaveBeenCalled();
    if (showModal)
      Object.defineProperty(
        HTMLDialogElement.prototype,
        'showModal',
        showModal
      );
    else delete (HTMLDialogElement.prototype as { showModal?: unknown }).showModal;
    delete (HTMLDialogElement.prototype as { close?: unknown }).close;
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });
  it('never hijacks typing, but navigates and starts focus with window shortcuts', async () => {
    const mock = mockClient();
    render(<Dashboard client={mock.client} />);
    await screen.findByRole('checkbox', { name: /Coursework/ });
    fireEvent.keyDown(window, { key: '4', ctrlKey: true });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Focus' })
    ).toBeInTheDocument();
    const input = screen.getByRole('spinbutton', {
      name: 'Custom focus minutes'
    });
    fireEvent.keyDown(input, { key: '1', ctrlKey: true });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Focus' })
    ).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, shiftKey: true });
    expect(mock.client.mutate).not.toHaveBeenCalled();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, shiftKey: true });
    await waitFor(() =>
      expect(mock.client.mutate).toHaveBeenCalledWith({
        kind: 'start_timer',
        timerType: 'focus',
        minutes: 25
      })
    );
  });
  it('shows file problems without enabling data writes', async () => {
    const initial = fixture();
    initial.issues = [
      {
        file: 'sleep-data.json',
        message: 'Unknown schema version. Not overwritten.'
      }
    ];
    const mock = mockClient(initial);
    render(<Dashboard client={mock.client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unknown schema version'
    );
    expect(
      await screen.findByRole('checkbox', { name: /Coursework/ })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '25 min ↗' })).toBeDisabled();
    navigate('Settings');
    expect(
      screen.getByRole('button', { name: 'Save shared settings ↗' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Save Mac preferences ↗' })
    ).toBeEnabled();
  });
  it('settles an expired timer on load once and shows whole-minute early-stop outcomes', async () => {
    const initial = fixture();
    const end = Date.now() - 1000;
    initial.focus.state = {
      type: 'focus',
      minutes: 25,
      start: end - 25 * 60000,
      end
    };
    const mock = mockClient(initial);
    vi.mocked(mock.client.mutate).mockImplementation(async (operation) => {
      const snapshot = structuredClone(initial);
      snapshot.focus.state = null;
      return {
        snapshot,
        ...(operation.kind === 'stop_timer' ? { creditedMinutes: 0 } : {})
      };
    });
    render(<Dashboard client={mock.client} />);
    await waitFor(() =>
      expect(mock.client.mutate).toHaveBeenCalledWith({ kind: 'settle_timer' })
    );
    expect(mock.client.mutate).toHaveBeenCalledTimes(1);
    const next = fixture();
    next.focus.state = {
      type: 'focus',
      minutes: 25,
      start: Date.now(),
      end: Date.now() + 25 * 60000
    };
    await mock.update(next);
    fireEvent.click(
      await screen.findByRole('button', { name: /Stop & count whole minutes/ })
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Less than a minute, so nothing was counted.'
    );
  });
  it('recovers an initial snapshot error on refresh and cleans a late subscription', async () => {
    const mock = mockClient();
    vi.mocked(mock.client.snapshot).mockRejectedValueOnce(
      new Error('Folder unavailable')
    );
    let finishSubscribe: (stop: () => void) => void = () => {};
    vi.mocked(mock.client.subscribe).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSubscribe = resolve;
        })
    );
    const { unmount } = render(<Dashboard client={mock.client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Folder unavailable'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
    await screen.findByRole('checkbox', { name: /Coursework/ });
    unmount();
    await act(async () => finishSubscribe(mock.unsubscribe));
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
  });
});
