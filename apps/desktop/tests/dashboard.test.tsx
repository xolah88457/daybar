import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    setPreferences: vi.fn(async (preferences) => {
      snapshot = { ...structuredClone(snapshot), preferences };
      return structuredClone(snapshot);
    }),
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

function dayKey(offset: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return key(date);
}

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const addEventListener = vi.fn(
    (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }
  );
  const removeEventListener = vi.fn(
    (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }
  );
  const mql = {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener,
    removeEventListener
  };
  const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => mql)
  });
  return {
    mql,
    change(next: boolean) {
      mql.matches = next;
      for (const listener of [...listeners])
        listener({ matches: next } as MediaQueryListEvent);
    },
    listenerCount: () => listeners.size,
    restore() {
      if (descriptor) Object.defineProperty(window, 'matchMedia', descriptor);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  };
}

describe('dashboard operations and failures', () => {
  it('combines modules, sends single checkbox operations and applies live updates', async () => {
    const mock = mockClient();
    const { unmount } = render(<Dashboard client={mock.client} />);
    const task = await screen.findByRole('checkbox', { name: /Read a chapter/ });
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
        task: 'Read a chapter',
        done: true
      })
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    const next = fixture();
    next.dailyLog[key(new Date())] = ['Sketch a scene'];
    await mock.update(next);
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: /Sketch a scene/ })
      ).toBeChecked()
    );
    expect(
      screen.getByRole('checkbox', { name: /Read a chapter/ })
    ).not.toBeChecked();
    unmount();
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
  });
  it('persists a day/night toggle through setPreferences and applies the returned snapshot', async () => {
    const mock = mockClient();
    render(<Dashboard client={mock.client} />);
    await screen.findByRole('checkbox', { name: /Read a chapter/ });
    const shell = document.querySelector('.app-shell') as HTMLElement;
    expect(shell).toHaveAttribute('data-theme', 'night');
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to day appearance' })
    );
    await waitFor(() =>
      expect(mock.client.setPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ themeMode: 'day' })
      )
    );
    await waitFor(() => expect(shell).toHaveAttribute('data-theme', 'day'));
    expect(shell.getAttribute('style') ?? '').not.toContain('--background');
    expect(shell.getAttribute('style') ?? '').toContain('--cellSize');
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to night appearance' })
    );
    await waitFor(() =>
      expect(mock.client.setPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ themeMode: 'night' })
      )
    );
    await waitFor(() => expect(shell).toHaveAttribute('data-theme', 'night'));
  });
  it('saves Auto appearance from Settings and follows the current system theme', async () => {
    const media = mockMatchMedia(false);
    try {
      const mock = mockClient();
      render(<Dashboard client={mock.client} />);
      await screen.findByRole('checkbox', { name: /Read a chapter/ });
      navigate('Settings');
      fireEvent.change(
        await screen.findByRole('combobox', { name: 'Appearance' }),
        { target: { value: 'auto' } }
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Save Mac preferences ↗' })
      );
      await waitFor(() =>
        expect(mock.client.setPreferences).toHaveBeenCalledWith(
          expect.objectContaining({ themeMode: 'auto' })
        )
      );
      const shell = document.querySelector('.app-shell') as HTMLElement;
      await waitFor(() => expect(shell).toHaveAttribute('data-theme', 'auto'));
      expect(shell).toHaveAttribute('data-system-theme', 'day');
      expect(shell.getAttribute('style') ?? '').not.toContain('--background');
      expect(
        screen.getByRole('button', { name: 'Switch to night appearance' })
      ).toBeInTheDocument();
    } finally {
      media.restore();
    }
  });
  it('updates Auto mode on a system appearance change and cleans up its media listener', async () => {
    const media = mockMatchMedia(true);
    try {
      const initial = fixture();
      initial.preferences.themeMode = 'auto';
      const mock = mockClient(initial);
      const { unmount } = render(<Dashboard client={mock.client} />);
      await screen.findByRole('checkbox', { name: /Read a chapter/ });
      const shell = document.querySelector('.app-shell') as HTMLElement;
      expect(shell).toHaveAttribute('data-system-theme', 'night');
      expect(
        screen.getByRole('button', { name: 'Switch to day appearance' })
      ).toBeInTheDocument();
      expect(media.mql.addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function)
      );
      const listener = media.mql.addEventListener.mock.calls[0][1];
      act(() => media.change(false));
      await waitFor(() =>
        expect(shell).toHaveAttribute('data-system-theme', 'day')
      );
      expect(
        screen.getByRole('button', { name: 'Switch to night appearance' })
      ).toBeInTheDocument();
      expect(shell.getAttribute('style') ?? '').not.toContain('--background');
      fireEvent.click(
        screen.getByRole('button', { name: 'Switch to night appearance' })
      );
      await waitFor(() =>
        expect(mock.client.setPreferences).toHaveBeenCalledWith(
          expect.objectContaining({ themeMode: 'night' })
        )
      );
      unmount();
      expect(media.mql.removeEventListener).toHaveBeenCalledWith(
        'change',
        listener
      );
      expect(media.listenerCount()).toBe(0);
    } finally {
      media.restore();
    }
  });
  it('keeps core heatmap colors and opacity distinctions in day mode', async () => {
    const initial = fixture();
    initial.preferences.themeMode = 'day';
    initial.dailyLog[dayKey(0)] = [
      'Read a chapter',
      'Sketch a scene',
      'Take a walk',
      'Water the plants'
    ];
    initial.dailyLog[dayKey(1)] = ['Read a chapter'];
    initial.dailyLog[dayKey(2)] = ['Read a chapter', 'Sketch a scene'];
    const mock = mockClient(initial);
    render(<Dashboard client={mock.client} />);
    await screen.findByRole('checkbox', { name: /Read a chapter/ });
    navigate('Habits');
    const full = await screen.findByRole('button', {
      name: `${dayKey(0)}: 4 tasks done`
    });
    const partial = screen.getByRole('button', {
      name: `${dayKey(1)}: 1 tasks done`
    });
    const empty = screen.getByRole('button', {
      name: `${dayKey(3)}: 0 tasks done`
    });
    expect(full).toHaveStyle({ background: '#18764b' });
    expect(partial).toHaveStyle({ background: '#b43737' });
    expect(empty).toHaveStyle({ background: '#202820' });
    expect(Number(full.style.opacity)).toBe(1);
    expect(Number(partial.style.opacity)).toBeCloseTo(0.475);
    expect(Number(empty.style.opacity)).toBeCloseTo(0.05);
    expect(Number(partial.style.opacity)).toBeGreaterThan(
      Number(empty.style.opacity)
    );
    expect(Number(full.style.opacity)).toBeGreaterThan(
      Number(partial.style.opacity)
    );
  });
  it('saves shared settings from Day with the raw appearance, not the day projection', async () => {
    const initial = fixture();
    initial.preferences.themeMode = 'day';
    const mock = mockClient(initial);
    render(<Dashboard client={mock.client} />);
    await screen.findByRole('checkbox', { name: /Read a chapter/ });
    navigate('Settings');
    fireEvent.click(screen.getByText('Focus', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText(/Block Minutes/), {
      target: { value: '30' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save shared settings ↗' })
    );
    await waitFor(() => expect(mock.client.mutate).toHaveBeenCalled());
    const operation = vi.mocked(mock.client.mutate).mock.calls[0][0];
    expect(operation).toMatchObject({ kind: 'save_settings' });
    if (operation.kind === 'save_settings') {
      expect(operation.settings.appearance).toMatchObject({
        background: '#0d1117',
        text: '#ffffff',
        green: '#39d353',
        blue: '#58a6ff',
        red: '#ff5c5c',
        orange: '#ff9f43',
        yellow: '#f2cc60'
      });
    }
    expect(mock.client.setPreferences).not.toHaveBeenCalled();
  });
  it('does not override core heatmap opacity in the day CSS palette', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/app/globals.css'),
      'utf8'
    );
    expect(css).not.toMatch(
      /\.app-shell\[data-theme='day'\][^{}]*\.square[^{}]*\{[^}]*opacity\s*:\s*1\s*!important/s
    );
    expect(css).not.toMatch(
      /\.app-shell\[data-theme='auto'\][^{}]*\.square[^{}]*\{[^}]*opacity\s*:\s*1\s*!important/s
    );
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
      await screen.findByRole('checkbox', { name: /Read a chapter/ })
    );
    expect(
      screen.getByRole('checkbox', { name: /Sketch a scene/ })
    ).toBeDisabled();
    await act(async () =>
      reject(new Error('Atomic write failed. Original file kept.'))
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Original file kept.'
    );
    expect(
      screen.getByRole('checkbox', { name: /Read a chapter/ })
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /Sketch a scene/ })
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
      await screen.findByRole('checkbox', { name: /Read a chapter/ })
    );
    const phone = fixture();
    phone.dailyLog[key(new Date())] = ['Sketch a scene'];
    await mock.update(phone);
    const olderResponse = fixture();
    olderResponse.dailyLog[key(new Date())] = ['Read a chapter'];
    await act(async () => finish({ snapshot: olderResponse }));
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: /Sketch a scene/ })
      ).toBeChecked()
    );
    expect(
      screen.getByRole('checkbox', { name: /Read a chapter/ })
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
    const wake = new Date(Date.now() - 60 * 60000);
    initial.sleep.wakes[key(wake)] = wake.getHours() * 60 + wake.getMinutes();
    initial.settings.sleep.noPhoneMinutes = 1440;
    const mock = mockClient(initial);
    render(<Dashboard client={mock.client} />);
    await screen.findByRole('checkbox', { name: /Read a chapter/ });
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
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    const browserConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Data folder path' }), {
      target: { value: '/disposable-confirm-test' }
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /This is my real shared data/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand this connects real data/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Mac preferences ↗' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not confirm this action: Native dialogs are unavailable.'
    );
    expect(browserConfirm).not.toHaveBeenCalled();
    expect(mock.client.setPreferences).not.toHaveBeenCalled();
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
  it('supports bare and modified 1–6 navigation without hijacking typing or dialogs', async () => {
    const mock = mockClient();
    render(<Dashboard client={mock.client} />);
    await screen.findByRole('checkbox', { name: /Read a chapter/ });
    const modules = ['Today', 'Countdown', 'Habits', 'Focus', 'Sleep', 'Settings'];
    for (const [index, name] of modules.entries()) {
      fireEvent.keyDown(window, { key: String(index + 1) });
      expect(
        screen.getByRole('heading', { level: 1, name: name === 'Today' ? 'Here & now.' : name })
      ).toBeInTheDocument();
    }
    fireEvent.keyDown(window, { key: '4', ctrlKey: true });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Focus' })
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '3', metaKey: true });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Habits' })
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '4' });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Focus' })
    ).toBeInTheDocument();
    const input = screen.getByRole('spinbutton', {
      name: 'Custom focus minutes'
    });
    fireEvent.keyDown(input, { key: '1' });
    fireEvent.keyDown(window, { key: '2', repeat: true });
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const editorChild = document.createElement('span');
    editor.append(editorChild);
    document.body.append(editor);
    fireEvent.keyDown(editorChild, { key: '1' });
    editor.remove();
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    fireEvent.keyDown(textarea, { key: '2' });
    textarea.remove();
    const select = document.createElement('select');
    document.body.append(select);
    fireEvent.keyDown(select, { key: '3' });
    select.remove();
    const textbox = document.createElement('div');
    textbox.setAttribute('role', 'textbox');
    document.body.append(textbox);
    fireEvent.keyDown(textbox, { key: '5' });
    textbox.remove();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Focus' })
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '2', altKey: true });
    fireEvent.keyDown(window, { key: '3', shiftKey: true });
    fireEvent.keyDown(window, { key: '5', isComposing: true });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Focus' })
    ).toBeInTheDocument();
    const dialog = document.createElement('dialog');
    dialog.open = true;
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: '2' });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Focus' })
    ).toBeInTheDocument();
    dialog.remove();
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
      await screen.findByRole('checkbox', { name: /Read a chapter/ })
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
    await screen.findByRole('checkbox', { name: /Read a chapter/ });
    unmount();
    await act(async () => finishSubscribe(mock.unsubscribe));
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
  });
});
