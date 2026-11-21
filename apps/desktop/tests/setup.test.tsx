import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '@daybar/core/contracts';
import type { Snapshot } from '@daybar/core/contracts';
import { Dashboard } from '../src/components/dashboard';
import { taskPlan } from '../src/components/setup';
import { createDemoClient } from '../src/lib/demo';
import { fixture } from './fixtures';

afterEach(() => vi.restoreAllMocks());

function blank(): Snapshot {
  const s = fixture();
  s.settings.habits.tasks = ['First habit'];
  s.settings.habits.startDate = s.settings.countdown.startDate;
  s.preferences.setupDone = false;
  return s;
}
const dialog = () => screen.getByRole('dialog');
const next = () => fireEvent.click(within(dialog()).getByRole('button', { name: /continue|Get started/ }));

describe('guided setup', () => {
  it('opens on a new install and walks through tasks, countdown, spaces and modules', async () => {
    const client = createDemoClient(blank());
    render(<Dashboard client={client} />);
    expect(await screen.findByRole('heading', { name: 'Welcome to Daybar.' })).toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: 'Remove sample data…' })).toBeNull();
    next();

    await screen.findByRole('heading', { name: 'Your daily tasks' });
    fireEvent.change(screen.getByLabelText('Task 1'), { target: { value: 'Read' } });
    fireEvent.change(screen.getByLabelText('Task 2'), { target: { value: 'Walk' } });
    next();
    await screen.findByRole('heading', { name: 'A countdown' });
    let snap = await client.snapshot();
    expect(snap.settings.habits.tasks).toEqual(['Read', 'Walk']);
    expect(snap.settings.habits.archivedTasks).toEqual([]);

    fireEvent.change(screen.getByLabelText('What are you counting down to?'), { target: { value: 'Launch' } });
    fireEvent.click(screen.getByRole('button', { name: '100 days' }));
    next();
    await screen.findByRole('heading', { name: 'Spaces for each part of life' });
    expect((await client.snapshot()).settings.countdown.title).toBe('Launch');

    fireEvent.click(screen.getByRole('button', { name: '+ Work' }));
    fireEvent.change(screen.getByLabelText('Other spaces (comma separated)'), { target: { value: 'Band, Work' } });
    next();
    await screen.findByRole('heading', { name: 'What to show' });
    snap = await client.snapshot();
    expect(snap.spaces.spaces.map((s) => s.name)).toEqual(['Work', 'Band']);

    fireEvent.click(screen.getByRole('checkbox', { name: /Sleep/ }));
    next();
    await screen.findByRole('heading', { name: 'You are set.' });
    expect((await client.snapshot()).preferences.features.sleep).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Start my day ↗' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await client.snapshot()).preferences.setupDone).toBe(true);
    expect(screen.getByRole('checkbox', { name: /Read/ })).toBeInTheDocument();
  });

  it('can be skipped, and Escape only closes it for now', async () => {
    const client = createDemoClient(blank());
    render(<Dashboard client={client} />);
    await screen.findByRole('heading', { name: 'Welcome to Daybar.' });
    await act(async () => undefined); // let the dialog's key listener attach
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await client.snapshot()).preferences.setupDone).toBe(false);
    // The placeholder task brings it back from Today.
    fireEvent.click(screen.getByRole('button', { name: 'Set up Daybar →' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Skip setup' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await client.snapshot()).preferences.setupDone).toBe(true);
  });

  it('offers to remove sample data, then starts blank', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const s = fixture();
    s.preferences.setupDone = false;
    s.dailyLog = { [s.settings.habits.startDate]: ['Read a chapter'] };
    const client = createDemoClient(s);
    render(<Dashboard client={client} />);
    await screen.findByRole('heading', { name: 'Welcome to Daybar.' });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove sample data…' }));
    await waitFor(() => expect(within(dialog()).queryByRole('button', { name: 'Remove sample data…' })).toBeNull());
    const snap = await client.snapshot();
    expect(snap.settings.habits.tasks).toEqual(['First habit']);
    expect(snap.dailyLog).toEqual({});
    next();
    expect(await screen.findByLabelText('Task 1')).toHaveValue('');
  });

  it('is reachable from Settings, which can also remove sample data', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const client = createDemoClient(fixture());
    render(<Dashboard client={client} />);
    await screen.findByRole('checkbox', { name: /Read a chapter/ });
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Modules' })).getByRole('button', { name: /Settings/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove sample data…' }));
    expect(await screen.findByRole('heading', { name: 'Welcome to Daybar.' })).toBeInTheDocument();
    expect((await client.snapshot()).settings.habits.tasks).toEqual(['First habit']);
    await act(async () => undefined);
  });
});

describe('taskPlan', () => {
  it('renames removed tasks into new ones and archives the rest, keeping thresholds', () => {
    const settings = structuredClone(defaultSettings);
    settings.habits.tasks = ['A', 'B', 'C'];
    settings.habits.focusThresholds = { A: 30, C: 10 };
    const plan = taskPlan(settings, ['X', 'B'], 'Mine', 5);
    expect(plan.renames).toEqual([{ from: 'A', to: 'X' }]);
    expect(plan.archived).toEqual(['C']);
    expect(plan.final.habits).toMatchObject({
      title: 'Mine', tasks: ['X', 'B'], archivedTasks: ['C'], dayCompleteMin: 2, focusThresholds: { X: 30 }
    });
  });
});
