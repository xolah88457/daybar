import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DaybarClient, Snapshot } from '@daybar/core/contracts';
import { Dashboard } from '../src/components/dashboard';
import { createDemoClient } from '../src/lib/demo';
import { View, clockAt } from '../src/features/insights';
import { fixture } from './fixtures';

const now = new Date(2026, 10, 15, 12);

async function demo(): Promise<Snapshot> {
  const snapshot = await createDemoClient(undefined, () => now).snapshot();
  snapshot.preferences.features.insights.enabled = true;
  return snapshot;
}
function props(snapshot: Snapshot) {
  return { snapshot, now, busy: false, run: vi.fn(async () => true), confirm: vi.fn(async () => true), savePreferences: vi.fn(async () => true) };
}
const section = (name: string) => screen.getByRole('heading', { name }).closest('section') as HTMLElement;

describe('Insights view in the demo', () => {
  it('shows the week in review with focus, habits and sleep sections', async () => {
    render(<View {...props(await demo())} />);
    expect(
      screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Nov 9 – Nov 15, compared with Nov 2 – Nov 8')
    ).toBeInTheDocument();
    for (const name of ['Focus', 'Habits', 'Sleep rhythm', 'Sleep and focus'])
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
  });
  it('summarises the focus chart for assistive technology', async () => {
    render(<View {...props(await demo())} />);
    const chart = screen.getByRole('img', { name: /Focus minutes per day over the last 7 days/ });
    expect(chart).toHaveAccessibleName(/Sun 85/);
    expect(chart).toHaveAccessibleName(/Total 85 minutes; the previous 7 days totalled 0/);
    expect(within(section('Focus')).getByText('1h 25m')).toBeInTheDocument();
    expect(within(section('Focus')).getByText(/▲ 1h 25m vs previous 7 days/)).toBeInTheDocument();
  });
  it('reports habit completion per day, the rate and both streaks', async () => {
    render(<View {...props(await demo())} />);
    const days = screen.getByRole('img', { name: /Habit completion per day over the last 7 days/ });
    expect(days).toHaveAccessibleName(/Sun 1 of 4/);
    const habits = within(section('Habits'));
    expect(habits.getByText('Completion rate').nextElementSibling).toHaveTextContent(/%/);
    expect(habits.getByText('Current streak')).toBeInTheDocument();
    expect(habits.getByText('Best streak')).toBeInTheDocument();
  });
  it('shows average wake and bed times with their consistency as plus or minus minutes', async () => {
    render(<View {...props(await demo())} />);
    const sleep = within(section('Sleep rhythm'));
    expect(sleep.getByText('Average wake')).toBeInTheDocument();
    expect(sleep.getByText('Average bed')).toBeInTheDocument();
    expect(sleep.getAllByText(/Consistency ±\d+ min/)).toHaveLength(2);
  });
  it('shows the stored clock time on a spring-forward day (02:30 stays 02:30)', () => {
    expect(clockAt(null)).toBe('—');
    expect(clockAt(150)).toMatch(/^0?2:30/);
    expect(clockAt(23 * 60 + 5)).toMatch(/^11:05/);
    const springForward = new Date(2026, 2, 8, 12); // 2026-03-08: DST starts in America/Toronto
    const s = fixture();
    s.preferences.features.insights.enabled = true;
    for (let i = 0; i < 14; i++) {
      const d = new Date(2026, 2, 8 - i);
      s.sleep.wakes[`2026-03-${String(d.getDate()).padStart(2, '0')}`] = 150;
    }
    render(<View {...props(s)} now={springForward} />);
    expect(within(section('Sleep rhythm')).getByText('Average wake').nextElementSibling).toHaveTextContent(/^0?2:30/);
  });
  it('says there is not enough data for the sleep and focus relation', async () => {
    render(<View {...props(await demo())} />);
    expect(within(section('Sleep and focus')).getByText('Not enough data yet')).toBeInTheDocument();
  });
  it('shows the comparison once there are four days on each side', async () => {
    const s = await demo();
    for (let i = 3; i < 11; i++) {
      const evening = new Date(2026, 10, 15 - i);
      const date = `2026-11-${String(evening.getDate()).padStart(2, '0')}`;
      const next = `2026-11-${String(evening.getDate() + 1).padStart(2, '0')}`;
      s.sleep.beds[date] = i % 2 ? 22 * 60 : 60;
      s.focus.days[next] = { count: 0, minutes: i % 2 ? 100 : 20 };
    }
    render(<View {...props(s)} />);
    const rel = within(section('Sleep and focus'));
    expect(rel.queryByText('Not enough data yet')).toBeNull();
    expect(rel.getByText('After an earlier bedtime')).toBeInTheDocument();
    expect(rel.getByText(/Your usual bedtime is/)).toBeInTheDocument();
  });
  it('omits sections for modules that are switched off', async () => {
    const s = await demo();
    s.preferences.features.sleep = false;
    const { rerender } = render(<View {...props(s)} />);
    expect(screen.queryByRole('heading', { name: 'Sleep rhythm' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sleep and focus' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Focus' })).toBeInTheDocument();
    s.preferences.features.focus = false;
    rerender(<View {...props(s)} />);
    expect(screen.queryByRole('heading', { name: 'Focus' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Habits' })).toBeInTheDocument();
    s.preferences.features.habits = false;
    rerender(<View {...props(s)} />);
    expect(screen.getByText(/Every module is switched off/)).toBeInTheDocument();
  });
  it('handles a brand-new empty install', () => {
    const s = fixture();
    s.preferences.features.insights.enabled = true;
    render(<View {...props(s)} />);
    expect(screen.getByText('No focus in either week')).toBeInTheDocument();
    expect(screen.getByText('No wake or bed times logged in the last 7 days.')).toBeInTheDocument();
    expect(screen.getByText('Not enough data yet')).toBeInTheDocument();
  });
});

describe('Insights in the dashboard', () => {
  it('adds an Insights page to the sidebar once the feature is on', async () => {
    const s = await demo();
    const client: DaybarClient = {
      snapshot: vi.fn(async () => structuredClone(s)),
      mutate: vi.fn(async () => ({ snapshot: s })),
      setPreferences: vi.fn(async () => s),
      resolveConflict: vi.fn(async () => s),
      subscribe: vi.fn(async () => () => undefined)
    };
    render(<Dashboard client={client} />);
    const nav = within(await screen.findByRole('navigation', { name: 'Modules' }));
    fireEvent.click(nav.getByRole('button', { name: /Insights/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Insights' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sleep rhythm' })).toBeInTheDocument();
  });
});
