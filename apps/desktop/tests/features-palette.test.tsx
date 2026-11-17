import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaybarClient, Snapshot } from '@daybar/core/contracts';
import { Dashboard } from '../src/components/dashboard';
import { buildCommands, filterCommands } from '../src/features/commandPalette';
import type { PaletteCommand } from '../src/features/commandPalette';
import { fixture } from './fixtures';

function client(snapshot: Snapshot) {
  const c: DaybarClient = {
    snapshot: vi.fn(async () => structuredClone(snapshot)),
    mutate: vi.fn(async () => ({ snapshot })),
    setPreferences: vi.fn(async () => snapshot),
    resolveConflict: vi.fn(async () => snapshot),
    subscribe: vi.fn(async () => () => undefined)
  };
  return c;
}
function enabled(patch?: (s: Snapshot) => void) {
  const s = fixture();
  s.preferences.features.commandPalette.enabled = true;
  patch?.(s);
  return s;
}
const open = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
const palette = () => screen.getByRole('dialog', { name: 'Command palette' });
const search = () => screen.getByRole('combobox', { name: 'Search commands' });
const rows = () => within(screen.getByRole('listbox', { name: 'Commands' })).getAllByRole('option');
const options = () => within(screen.getByRole('listbox', { name: 'Commands' })).getAllByRole('option').map((o) => o.textContent ?? '');
async function ready(snapshot: Snapshot) {
  const c = client(snapshot);
  render(<Dashboard client={c} />);
  await waitFor(() => expect(screen.queryByText('Opening your day…')).toBeNull());
  await act(async () => undefined); // let the overlay's keyboard listener attach
  return c;
}

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true));
});

describe('command palette', () => {
  it('opens on Ctrl+K or Cmd+K, focuses the search box and toggles closed', async () => {
    await ready(enabled());
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    expect(palette()).toBeInTheDocument();
    expect(search()).toHaveFocus();
    open();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'K', metaKey: true });
    expect(palette()).toBeInTheDocument();
  });
  it('does nothing while the feature is off', async () => {
    await ready(fixture());
    open();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('ignores a plain k, Shift+Ctrl+K and a key held down', async () => {
    await ready(enabled());
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, altKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, repeat: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('opens from inside a text field and puts focus back there on Escape', async () => {
    await ready(enabled());
    fireEvent.keyDown(window, { key: '6' }); // Settings
    const field = await screen.findByPlaceholderText('CommandOrControl+Shift+F');
    field.focus();
    fireEvent.keyDown(field, { key: 'k', ctrlKey: true });
    expect(palette()).toBeInTheDocument();
    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(field).toHaveFocus();
  });
  it('lists views, focus, habits, sleep, theme and updates, and filters them', async () => {
    await ready(enabled());
    open();
    const all = options();
    for (const text of [
      'Go to Today', 'Go to Habits', 'Go to Focus', 'Go to Sleep', 'Go to Settings', 'Start focus · 25 min', 'Start focus · 50 min',
      'Toggle habit · Read a chapter', 'Toggle habit · Water the plants', 'Log wake now', 'Log bed now', 'Switch to day appearance', 'Check for updates'
    ])
      expect(all.some((o) => o.startsWith(text)), text).toBe(true);
    fireEvent.change(search(), { target: { value: 'bed' } });
    expect(options()[0]).toMatch(/^Log bed now/);
    fireEvent.change(search(), { target: { value: 'zzzz' } });
    expect(screen.getByText('No matching commands.')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('moves with the arrow keys and runs the highlighted command with Enter', async () => {
    const c = await ready(enabled());
    open();
    fireEvent.change(search(), { target: { value: 'log' } });
    expect(options().map((o) => o.replace(/Sleep$/, ''))).toEqual(['Log wake now', 'Log bed now']);
    expect(search()).toHaveAttribute('aria-activedescendant', rows()[0].id);
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    expect(rows()[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(search(), { key: 'ArrowDown' }); // wraps
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(search(), { key: 'ArrowUp' }); // wraps back
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(c.mutate).toHaveBeenCalledTimes(1));
    expect(c.mutate).toHaveBeenCalledWith({ kind: 'log_sleep', entry: 'bed', timestamp: expect.any(Number) });
  });
  it('runs a command by clicking it', async () => {
    const c = await ready(enabled());
    open();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Commands' })).getByRole('option', { name: /Log wake now/ }));
    await waitFor(() => expect(c.mutate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'log_sleep', entry: 'wake' })));
  });
  it('navigates to a view and to Settings for updates', async () => {
    await ready(enabled());
    open();
    fireEvent.change(search(), { target: { value: 'go to habits' } });
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Habits' })).toBeInTheDocument();
    open();
    fireEvent.change(search(), { target: { value: 'updates' } });
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });
  it('starts a focus session through the existing confirmation path', async () => {
    const c = await ready(enabled());
    open();
    fireEvent.change(search(), { target: { value: '50' } });
    fireEvent.keyDown(search(), { key: 'Enter' });
    await waitFor(() => expect(c.mutate).toHaveBeenCalledWith({ kind: 'start_timer', timerType: 'focus', minutes: 50 }));
  });
  it('does not start focus when the no-phone confirmation is declined', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const s = enabled((x) => {
      x.settings.sleep.noPhoneMinutes = 1440; // always inside no-phone time while awake
      x.sleep.wakes[new Date().toISOString().slice(0, 10)] = 0;
    });
    const c = await ready(s);
    open();
    fireEvent.change(search(), { target: { value: 'start focus 25' } });
    fireEvent.keyDown(search(), { key: 'Enter' });
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(c.mutate).not.toHaveBeenCalled();
  });
  it('skips the no-phone confirmation when the Sleep module is off', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const s = enabled((x) => {
      x.settings.sleep.noPhoneMinutes = 1440;
      x.sleep.wakes[new Date().toISOString().slice(0, 10)] = 0;
      x.preferences.features.sleep = false;
    });
    const c = await ready(s);
    open();
    fireEvent.change(search(), { target: { value: 'start focus 25' } });
    fireEvent.keyDown(search(), { key: 'Enter' });
    await waitFor(() => expect(c.mutate).toHaveBeenCalledWith({ kind: 'start_timer', timerType: 'focus', minutes: 25 }));
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it('offers Stop timer instead of Start focus while a timer runs', async () => {
    const start = Date.now() - 60000;
    const s = enabled((x) => {
      x.focus.state = { type: 'focus', minutes: 25, start, end: start + 25 * 60000 };
    });
    const c = await ready(s);
    open();
    const all = options();
    expect(all.some((o) => o.startsWith('Stop timer'))).toBe(true);
    expect(all.some((o) => o.startsWith('Start focus'))).toBe(false);
    fireEvent.change(search(), { target: { value: 'stop' } });
    fireEvent.keyDown(search(), { key: 'Enter' });
    await waitFor(() => expect(c.mutate).toHaveBeenCalledWith({ kind: 'stop_timer' }));
  });
  it('toggles today’s habit tasks, showing whether each is done', async () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const s = enabled((x) => {
      x.dailyLog[date] = ['Take a walk'];
    });
    const c = await ready(s);
    open();
    fireEvent.change(search(), { target: { value: 'walk' } });
    expect(options()[0]).toMatch(/Toggle habit · Take a walkDone today/);
    fireEvent.keyDown(search(), { key: 'Enter' });
    await waitFor(() => expect(c.mutate).toHaveBeenCalledWith({ kind: 'set_task', date, task: 'Take a walk', done: false }));
  });
  it('toggles the day and night appearance through savePreferences', async () => {
    const c = await ready(enabled());
    open();
    fireEvent.change(search(), { target: { value: 'appearance' } });
    fireEvent.keyDown(search(), { key: 'Enter' });
    await waitFor(() => expect(c.setPreferences).toHaveBeenCalledWith(expect.objectContaining({ themeMode: 'day' })));
  });
  it('hides actions that belong to switched-off modules', async () => {
    const s = enabled((x) => {
      x.preferences.features.sleep = false;
      x.preferences.features.focus = false;
      x.preferences.features.habits = false;
    });
    await ready(s);
    open();
    const all = options().join('\n');
    expect(all).not.toMatch(/Log wake|Log bed|Go to Sleep|Start focus|Stop timer|Go to Focus|Toggle habit|Go to Habits/);
    expect(all).toMatch(/Go to Today/);
    expect(all).toMatch(/Go to Countdown/);
    expect(all).toMatch(/Check for updates/);
  });
  it('is an accessible modal dialog that traps Tab', async () => {
    await ready(enabled());
    open();
    expect(palette()).toHaveAttribute('aria-modal', 'true');
    const close = screen.getByRole('button', { name: 'Close command palette' });
    expect(search()).toHaveFocus();
    fireEvent.keyDown(search(), { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(search()).toHaveFocus();
    fireEvent.keyDown(search(), { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('closes from the backdrop and announces the result count', async () => {
    await ready(enabled());
    open();
    expect(within(palette()).getByRole('status')).toHaveTextContent(/\d+ commands/);
    fireEvent.change(search(), { target: { value: 'log wake' } });
    expect(within(palette()).getByRole('status')).toHaveTextContent('1 command');
    const backdrop = palette().previousElementSibling as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('does not clash with the number-key shortcuts or text typed into the search box', async () => {
    await ready(enabled());
    open();
    fireEvent.keyDown(search(), { key: '4' }); // typing a digit must not switch views
    expect(screen.getByRole('heading', { level: 1, name: 'Here & now.' })).toBeInTheDocument();
    fireEvent.change(search(), { target: { value: '4' } });
    expect(search()).toHaveValue('4');
    fireEvent.keyDown(search(), { key: 'Escape' });
    fireEvent.keyDown(window, { key: '4' }); // with the palette closed they work again
    expect(await screen.findByRole('heading', { level: 1, name: 'Focus' })).toBeInTheDocument();
  });
  it('lets an open confirmation dialog keep the keyboard', async () => {
    await ready(enabled());
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    open();
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    dialog.remove();
  });
  it('disables writes while the data has problems', async () => {
    const s = enabled((x) => {
      x.issues = [{ file: 'focus-timer.json', message: 'broken' }];
    });
    const c = await ready(s);
    open();
    expect(within(screen.getByRole('listbox', { name: 'Commands' })).getByRole('option', { name: /Log wake now/ })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Commands' })).getByRole('option', { name: /Log wake now/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // not run, still open
    expect(c.mutate).not.toHaveBeenCalled();
    await act(async () => undefined);
  });
});

describe('filterCommands', () => {
  const cmd = (title: string, extra: Partial<PaletteCommand> = {}): PaletteCommand => ({
    id: title, title, group: 'Test', run: () => undefined, ...extra
  });
  const list = [cmd('Go to Habits'), cmd('Toggle habit · Read a chapter', { group: 'Habits' }), cmd('Log wake now', { keywords: 'morning' }), cmd('Check for updates')];
  const titles = (q: string) => filterCommands(list, q).map((c) => c.title);
  it('returns everything, in order, for an empty query', () => {
    expect(titles('')).toEqual(list.map((c) => c.title));
    expect(titles('   ')).toEqual(list.map((c) => c.title));
  });
  it('matches case-insensitively on any word, in any order', () => {
    expect(titles('HABITS')[0]).toBe('Go to Habits');
    expect(titles('chapter read')).toEqual(['Toggle habit · Read a chapter']);
  });
  it('ranks word starts above the middle of a word and titles above keywords', () => {
    expect(titles('hab')).toEqual(['Go to Habits', 'Toggle habit · Read a chapter']);
    expect(titles('morning')).toEqual(['Log wake now']);
  });
  it('is forgiving: letters in order still match a title', () => {
    expect(titles('cfu')).toEqual(['Check for updates']);
    expect(titles('xyz')).toEqual([]);
  });
});

describe('buildCommands', () => {
  it('lists one start command per configured focus length', () => {
    const s = enabled((x) => {
      x.settings.focus.focusOptions = [15, 45, 90];
    });
    const cmds = buildCommands(
      { snapshot: s, now: new Date(2026, 10, 15, 12), busy: false, run: vi.fn(), confirm: vi.fn(), navigate: vi.fn(), savePreferences: vi.fn() },
      true
    );
    expect(cmds.filter((c) => c.id.startsWith('focus:start')).map((c) => c.title)).toEqual([
      'Start focus · 15 min', 'Start focus · 45 min', 'Start focus · 90 min'
    ]);
  });
});
