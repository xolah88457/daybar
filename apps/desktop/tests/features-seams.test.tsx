import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DaybarClient, Snapshot } from '@daybar/core/contracts';
import { Dashboard } from '../src/components/dashboard';
import { fixture } from './fixtures';

// A feature agent adds `View`, `TodayCard` and `Config` to its own file; the registry picks them up.
vi.mock('../src/features/radar', () => ({
  Config: ({ value }: { value: { daysAhead: number } }) => <p>Radar config sees {value.daysAhead} days</p>,
  View: () => <p>Radar page body</p>,
  TodayCard: () => <section>Radar today card</section>
}));

function client(snapshot: Snapshot): DaybarClient {
  return {
    snapshot: vi.fn(async () => structuredClone(snapshot)),
    mutate: vi.fn(async () => ({ snapshot })),
    setPreferences: vi.fn(async () => snapshot),
    resolveConflict: vi.fn(async () => snapshot),
    subscribe: vi.fn(async () => () => undefined)
  };
}
const nav = () => within(screen.getByRole('navigation', { name: 'Modules' }));

describe('feature-contributed views, Today cards and config', () => {
  it('adds nothing while the feature is off', async () => {
    render(<Dashboard client={client(fixture())} />);
    await screen.findByRole('heading', { level: 1, name: 'Here & now.' });
    expect(nav().queryByRole('button', { name: /Deadline Radar/ })).toBeNull();
    expect(screen.queryByText('Radar today card')).toBeNull();
  });
  it('shows the view before Settings, a Today card, and a Config under the switch once on', async () => {
    const s = fixture();
    s.preferences.features.radar.enabled = true;
    s.preferences.features.radar.daysAhead = 21;
    render(<Dashboard client={client(s)} />);
    expect(await screen.findByText('Radar today card')).toBeInTheDocument();
    const names = nav().getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['◫Today1', '▦Countdown2', '✓Habits3', '◷Focus4', '☾Sleep5', '▤Overview6', '⌖Deadline Radar7', '⚙Settings8']);
    fireEvent.keyDown(window, { key: '7' });
    expect(screen.getByRole('heading', { level: 1, name: 'Deadline Radar' })).toBeInTheDocument();
    expect(screen.getByText('Radar page body')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '8' });
    expect(await screen.findByText('Radar config sees 21 days')).toBeInTheDocument();
  });
  it('hides the view again when its feature needs something that is off', async () => {
    const s = fixture();
    s.preferences.features.roomBeforeEvent.enabled = true; // radar itself stays off
    render(<Dashboard client={client(s)} />);
    await screen.findByRole('heading', { level: 1, name: 'Here & now.' });
    expect(nav().queryByRole('button', { name: /Deadline Radar/ })).toBeNull();
  });
});
