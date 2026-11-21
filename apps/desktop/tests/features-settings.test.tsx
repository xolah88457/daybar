import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultFeatures } from '@daybar/core/contracts';
import { SettingsPanel } from '../src/components/settings';
import { demoUpdater } from '../src/lib/updates';
import { fixture } from './fixtures';

function props(snapshot = fixture()) {
  return {
    snapshot,
    now: new Date(2026, 10, 15, 12),
    busy: false,
    run: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
    savePreferences: vi.fn(async () => true),
    updater: demoUpdater
  };
}
const section = () => screen.getByRole('heading', { name: 'Features' }).closest('section') as HTMLElement;
const toggle = (name: string | RegExp) => within(section()).getByRole('switch', { name });
const group = (name: string) => within(section()).getByRole('group', { name });
const row = (id: string) => section().querySelector(`[data-feature="${id}"]`) as HTMLElement;

describe('Settings → Features', () => {
  it('lists the features in five closed sections, with switches only where there is a choice', () => {
    render(<SettingsPanel {...props()} />);
    const switches = within(section()).getAllByRole('switch');
    expect(switches).toHaveLength(12);
    for (const name of ['Pages', 'Deadline Radar', 'Reminders', 'Focus sessions', 'Tools']) {
      expect(group(name).tagName).toBe('DETAILS');
      expect(group(name)).not.toHaveAttribute('open');
    }
    // Built in: listed, with no switch.
    expect(within(group('Tools')).queryAllByRole('switch')).toHaveLength(0);
    for (const name of ['Export history', 'Command palette', 'Extra countdowns'])
      expect(within(group('Tools')).getByText(name)).toBeInTheDocument();
    expect(within(group('Pages')).getAllByRole('switch')).toHaveLength(5);
    expect(toggle('Insights')).toHaveAccessibleDescription(/patterns/);
    expect(toggle('Focus')).toBeChecked();
    expect(toggle('Hourly chime')).not.toBeChecked();
    expect(toggle('Hourly chime')).toHaveAccessibleDescription(/gentle notification on the hour/);
    expect(toggle('Deadline Radar')).toHaveAccessibleDescription(/Calendars & Reminders/);
  });
  it('starts with the useful features on and counts them in each section', () => {
    const s = fixture();
    s.preferences.features = structuredClone(defaultFeatures);
    render(<SettingsPanel {...props(s)} />);
    const count = (name: string) => group(name).querySelector('.feature-group-count')?.textContent;
    expect(count('Pages')).toBe('5 of 5 on');
    expect(count('Deadline Radar')).toBe('1 of 1 on');
    expect(count('Reminders')).toBe('2 of 4 on');
    expect(count('Focus sessions')).toBe('1 of 2 on');
    expect(count('Tools')).toBeUndefined();
    expect(toggle('Hourly chime')).not.toBeChecked();
    expect(toggle('Movement nudges')).not.toBeChecked();
    expect(toggle('Auto-cycle sessions')).not.toBeChecked();
    // A feature's options sit behind their own closed disclosure.
    const options = within(row('checkIns')).getByText('Options').closest('details')!;
    expect(options).not.toHaveAttribute('open');
    expect(within(options).getAllByLabelText(/Morning/).length).toBeGreaterThan(0);
  });
  it('says a module switch hides it and keeps its data', () => {
    render(<SettingsPanel {...props()} />);
    expect(toggle('Sleep')).toHaveAccessibleDescription(/hides it.*Your data is kept/);
  });
  it('saves a module switch through savePreferences without touching other preferences', async () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    fireEvent.click(toggle('Focus'));
    await waitFor(() => expect(p.savePreferences).toHaveBeenCalledTimes(1));
    const saved = (p.savePreferences.mock.calls[0] as unknown as [ReturnType<typeof fixture>['preferences']])[0];
    expect(saved).toEqual({
      ...p.snapshot.preferences,
      features: { ...p.snapshot.preferences.features, focus: false }
    });
    expect(p.run).not.toHaveBeenCalled(); // shared settings are never written
  });
  it('turning a feature on keeps its saved configuration', async () => {
    const s = fixture();
    s.preferences.features.hourlyChime.quietStart = '23:00';
    const p = props(s);
    render(<SettingsPanel {...p} />);
    fireEvent.click(toggle('Hourly chime'));
    await waitFor(() => expect(p.savePreferences).toHaveBeenCalled());
    const saved = (p.savePreferences.mock.calls[0] as unknown as [typeof s.preferences])[0];
    expect(saved.features.hourlyChime).toEqual({ ...s.preferences.features.hourlyChime, enabled: true });
    expect(saved.features.hourlyChime.quietStart).toBe('23:00');
  });
  it('shows Room before an event as part of Deadline Radar, with no switch of its own', async () => {
    const { rerender } = render(<SettingsPanel {...props()} />);
    expect(within(row('roomBeforeEvent')).queryByRole('switch')).toBeNull();
    expect(row('roomBeforeEvent')).toHaveTextContent(/Comes with Deadline Radar, which is off/);
    const on = fixture();
    on.preferences.features.radar.enabled = true;
    rerender(<SettingsPanel {...props(on)} />);
    expect(row('roomBeforeEvent')).toHaveTextContent(/Comes with Deadline Radar\./);
  });
  it('disables the Focus extras while Focus is off and explains why', async () => {
    const off = fixture();
    off.preferences.features.focus = false;
    const p = props(off);
    const { rerender } = render(<SettingsPanel {...p} />);
    for (const name of ['Auto-cycle sessions', 'Away detection']) {
      expect(toggle(name)).toBeDisabled();
      expect(toggle(name)).toHaveAccessibleDescription(/Turn on Focus first/);
      fireEvent.click(toggle(name));
    }
    expect(p.savePreferences).not.toHaveBeenCalled();
    // Focus shortcuts is built in: no switch, and no Shortcut fields while Focus is off.
    expect(row('focusShortcuts')).toHaveTextContent(/Comes with Focus, which is off/);
    expect(within(row('focusShortcuts')).queryByRole('textbox')).toBeNull();
    rerender(<SettingsPanel {...props()} />);
    for (const name of ['Auto-cycle sessions', 'Away detection']) {
      expect(toggle(name)).toBeEnabled();
      expect(toggle(name)).toHaveAccessibleDescription(/Works together with Focus/);
    }
    expect(within(row('focusShortcuts')).getAllByRole('textbox').length).toBeGreaterThan(0);
  });
  it('lets a blocked switch that is already on be turned off', async () => {
    const s = fixture();
    s.preferences.features.focus = false;
    s.preferences.features.awayDetection.enabled = true;
    const p = props(s);
    render(<SettingsPanel {...p} />);
    expect(toggle('Away detection')).toBeEnabled();
    fireEvent.click(toggle('Away detection'));
    await waitFor(() => expect(p.savePreferences).toHaveBeenCalledTimes(1));
  });
  it('disables the switches while a save is in flight', () => {
    render(<SettingsPanel {...props()} busy />);
    for (const s of within(section()).getAllByRole('switch')) expect(s).toBeDisabled();
  });
  it('lists the keyboard shortcuts for the visible views only', () => {
    const s = fixture();
    s.preferences.features.habits = false;
    render(<SettingsPanel {...props(s)} />);
    expect(screen.getByText('Today / Countdown / Focus / Sleep / Overview / Settings')).toBeInTheDocument();
  });
  it('keeps unsaved Mac-preference edits when a feature is switched', async () => {
    const { rerender } = render(<SettingsPanel {...props()} />);
    fireEvent.change(screen.getByPlaceholderText('CommandOrControl+Shift+F'), { target: { value: 'Alt+F' } });
    const next = fixture();
    next.preferences.features.focus = false;
    const q = props(next);
    rerender(<SettingsPanel {...q} />);
    expect(screen.getByPlaceholderText('CommandOrControl+Shift+F')).toHaveValue('Alt+F');
    fireEvent.click(screen.getByRole('button', { name: 'Save Mac preferences ↗' }));
    await waitFor(() =>
      expect(q.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ globalShortcut: 'Alt+F', features: next.preferences.features })
      )
    );
  });
});
