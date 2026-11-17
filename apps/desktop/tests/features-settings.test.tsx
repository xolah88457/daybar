import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

describe('Settings → Features', () => {
  it('lists every feature with an accessible switch and its description', () => {
    render(<SettingsPanel {...props()} />);
    const switches = within(section()).getAllByRole('switch');
    expect(switches).toHaveLength(17);
    for (const group of ['Modules', 'Deadline Radar', 'Time awareness', 'Focus', 'Review & extras'])
      expect(within(section()).getByRole('group', { name: group })).toBeInTheDocument();
    expect(toggle('Focus')).toBeChecked();
    expect(toggle('Hourly chime')).not.toBeChecked();
    expect(toggle('Hourly chime')).toHaveAccessibleDescription(/gentle notification on the hour/);
    expect(toggle('Deadline Radar')).toHaveAccessibleDescription(/Calendars & Reminders/);
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
  it('disables Room before an event while Deadline Radar is off and explains why', async () => {
    const p = props();
    const { rerender } = render(<SettingsPanel {...p} />);
    expect(toggle('Room before an event')).toBeDisabled();
    expect(toggle('Room before an event')).toHaveAccessibleDescription(/Turn on Deadline Radar first/);
    fireEvent.click(toggle('Room before an event'));
    expect(p.savePreferences).not.toHaveBeenCalled();
    const on = fixture();
    on.preferences.features.radar.enabled = true;
    rerender(<SettingsPanel {...props(on)} />);
    expect(toggle('Room before an event')).toBeEnabled();
  });
  it('disables the Focus extras while Focus is off and explains why', async () => {
    const off = fixture();
    off.preferences.features.focus = false;
    const p = props(off);
    const { rerender } = render(<SettingsPanel {...p} />);
    for (const name of ['Auto-cycle sessions', 'Focus shortcuts', 'Away detection']) {
      expect(toggle(name)).toBeDisabled();
      expect(toggle(name)).toHaveAccessibleDescription(/Turn on Focus first/);
      fireEvent.click(toggle(name));
    }
    expect(p.savePreferences).not.toHaveBeenCalled();
    rerender(<SettingsPanel {...props()} />);
    for (const name of ['Auto-cycle sessions', 'Focus shortcuts', 'Away detection']) {
      expect(toggle(name)).toBeEnabled();
      expect(toggle(name)).toHaveAccessibleDescription(/Works together with Focus/);
    }
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
    expect(screen.getByText('Today / Countdown / Focus / Sleep / Settings')).toBeInTheDocument();
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
