import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DaybarClient, Snapshot } from '@daybar/core/contracts';
import { Dashboard } from '../src/components/dashboard';
import { visibleViews } from '../src/features/views';
import { featureRegistry } from '../src/features/registry';
import { fixture } from './fixtures';

function mockClient(initial: Snapshot) {
  let snapshot = structuredClone(initial);
  let changed: (() => void) | undefined;
  const client: DaybarClient = {
    snapshot: vi.fn(async () => structuredClone(snapshot)),
    mutate: vi.fn(async () => ({ snapshot: structuredClone(snapshot) })),
    setPreferences: vi.fn(async (preferences) => {
      snapshot = { ...structuredClone(snapshot), preferences };
      return structuredClone(snapshot);
    }),
    resolveConflict: vi.fn(async () => structuredClone(snapshot)),
    subscribe: vi.fn(async (callback) => {
      changed = callback;
      return () => undefined;
    })
  };
  return { client, update: async (next: Snapshot) => { snapshot = next; await act(async () => changed?.()); } };
}
function withOff(...off: ('countdown' | 'habits' | 'focus' | 'sleep')[]) {
  const s = fixture();
  for (const id of off) s.preferences.features[id] = false;
  return s;
}
const nav = () => within(screen.getByRole('navigation', { name: 'Modules' }));
const navNames = () => nav().getAllByRole('button').map((b) => b.textContent);
const h1 = () => screen.getByRole('heading', { level: 1 });

describe('module toggles in the dashboard', () => {
  it('shows every view with the default features and no Deadline Radar placeholder', async () => {
    const { container } = render(<Dashboard client={mockClient(fixture()).client} />);
    await screen.findByRole('checkbox', { name: /Read a chapter/ });
    expect(navNames()).toEqual(['◫Today1', '▦Countdown2', '✓Habits3', '◷Focus4', '☾Sleep5', '⚙Settings6']);
    expect(screen.queryByText('SOON')).toBeNull();
    expect(screen.queryByText(/Deadline Radar/)).toBeNull();
    for (const card of ['progress', 'focus', 'habits', 'countdown'])
      expect(container.querySelector(`.today-${card}`)).not.toBeNull();
    // Zero change: the Today grid keeps its explicit card positions.
    expect(container.querySelector('.dashboard-grid')).not.toHaveClass('flow');
  });
  it('removes the sidebar items of modules that are off and numbers the rest in order', async () => {
    render(<Dashboard client={mockClient(withOff('habits', 'sleep')).client} />);
    await screen.findByRole('heading', { level: 1, name: 'Here & now.' });
    expect(navNames()).toEqual(['◫Today1', '▦Countdown2', '◷Focus3', '⚙Settings4']);
    fireEvent.keyDown(window, { key: '3' });
    expect(h1()).toHaveTextContent('Focus');
    fireEvent.keyDown(window, { key: '4' });
    expect(h1()).toHaveTextContent('Settings');
    fireEvent.keyDown(window, { key: '5' });
    expect(h1()).toHaveTextContent('Settings');
    fireEvent.keyDown(window, { key: '2', ctrlKey: true });
    expect(h1()).toHaveTextContent('Countdown');
  });
  it('hides the Today cards of modules that are off', async () => {
    const { container } = render(<Dashboard client={mockClient(withOff('focus', 'countdown')).client} />);
    await screen.findByRole('heading', { level: 1, name: 'Here & now.' });
    expect(container.querySelector('.today-focus')).toBeNull();
    expect(container.querySelector('.today-countdown')).toBeNull();
    expect(container.querySelector('.today-habits')).not.toBeNull();
    expect(container.querySelector('.today-progress')).not.toBeNull();
    expect(container.querySelector('.dashboard-grid')).toHaveClass('flow');
  });
  it('explains an empty Today when every module is off', async () => {
    render(<Dashboard client={mockClient(withOff('countdown', 'habits', 'focus', 'sleep')).client} />);
    expect(await screen.findByText(/Every module is switched off/)).toBeInTheDocument();
    expect(navNames()).toEqual(['◫Today1', '⚙Settings2']);
  });
  it('goes back to Today when the current view is switched off', async () => {
    const mock = mockClient(fixture());
    render(<Dashboard client={mock.client} />);
    await screen.findByRole('checkbox', { name: /Read a chapter/ });
    fireEvent.keyDown(window, { key: '4' });
    expect(h1()).toHaveTextContent('Focus');
    await mock.update(withOff('focus'));
    await waitFor(() => expect(h1()).toHaveTextContent('Here & now.'));
    expect(nav().queryByRole('button', { name: /Focus/ })).toBeNull();
    // Turning it back on does not strand the page on a stale view.
    await mock.update(fixture());
    expect(h1()).toHaveTextContent('Here & now.');
    expect(nav().getByRole('button', { name: /Focus/ })).toBeInTheDocument();
  });
  it('ignores the focus keyboard shortcut while Focus is off', async () => {
    const mock = mockClient(withOff('focus'));
    render(<Dashboard client={mock.client} />);
    await screen.findByRole('heading', { level: 1, name: 'Here & now.' });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, shiftKey: true });
    await act(async () => undefined);
    expect(mock.client.mutate).not.toHaveBeenCalled();
  });
});

describe('view and registry seams', () => {
  it('lists features in registry order, with modules on by default and nothing extra', () => {
    expect(visibleViews(fixture().preferences.features).map((v) => v.id)).toEqual([
      'Today', 'Countdown', 'Habits', 'Focus', 'Sleep', 'Settings'
    ]);
    const ids = featureRegistry.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(featureRegistry.filter((f) => f.isModule).map((f) => f.id)).toEqual(['countdown', 'habits', 'focus', 'sleep']);
    expect(featureRegistry.find((f) => f.id === 'radar')?.permission).toBe('Calendars & Reminders');
    expect(featureRegistry.find((f) => f.id === 'roomBeforeEvent')?.requires).toBe('radar');
    // Deadline Radar owns a view, shown before Settings once it is on.
    const all = fixture().preferences.features;
    all.radar.enabled = true;
    expect(visibleViews(all).map((v) => v.id)).toEqual([
      'Today', 'Countdown', 'Habits', 'Focus', 'Sleep', 'radar', 'Settings'
    ]);
  });
});
