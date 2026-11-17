import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Features } from '@daybar/core/contracts';
import { SettingsPanel } from '../src/components/settings';
import { Config as CheckIns } from '../src/features/checkIns';
import { Config as HourlyChime } from '../src/features/hourlyChime';
import { Config as MovementNudges } from '../src/features/movementNudges';
import { Config as StreakSaver } from '../src/features/streakSaver';
import type { ConfigFeatureId, FeatureConfigProps } from '../src/features/types';
import { demoUpdater } from '../src/lib/updates';
import { fixture } from './fixtures';

function setup<K extends ConfigFeatureId>(id: K, patch: Partial<Features[K]> = {}, saved = true, features?: Features) {
  const snapshot = fixture();
  const all = features ?? snapshot.preferences.features;
  const value = { ...all[id], enabled: true, ...patch } as Features[K];
  const save = vi.fn<(next: Features[K]) => Promise<boolean>>(async () => saved);
  const props: FeatureConfigProps<K> = { id, value, features: { ...all, [id]: value }, snapshot, busy: false, save };
  return { props, save };
}
const field = (name: RegExp | string) => screen.getByLabelText(name) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const preview = () => screen.getByTestId('next-preview').textContent ?? '';

describe('Hourly chime config', () => {
  it('saves quiet hours and the sound switch, keeping the rest of the config', async () => {
    const { props, save } = setup('hourlyChime');
    render(<HourlyChime {...props} />);
    expect(saveButton()).toBeDisabled();
    expect(field('Quiet from')).toHaveValue('22:00');
    fireEvent.change(field('Quiet from'), { target: { value: '23:30' } });
    fireEvent.change(field('Quiet until'), { target: { value: '07:00' } });
    fireEvent.click(field('Play a sound'));
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ enabled: true, quietStart: '23:30', quietEnd: '07:00', sound: false });
  });
  it('previews the next chime on the hour and follows unsaved quiet hours', () => {
    const { props } = setup('hourlyChime', { quietStart: '00:00', quietEnd: '00:00' });
    render(<HourlyChime {...props} />);
    expect(preview()).toMatch(/^Next: \d{1,2}:00 (am|pm)$/);
  });
  it('rejects an empty quiet time without saving', () => {
    const { props, save } = setup('hourlyChime');
    render(<HourlyChime {...props} />);
    fireEvent.change(field('Quiet from'), { target: { value: '' } });
    fireEvent.click(saveButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Quiet hours need a start and an end time.');
    expect(save).not.toHaveBeenCalled();
  });
  it('keeps the edits and says so when the save fails, and disables Save while busy', async () => {
    const { props, save } = setup('hourlyChime', {}, false);
    const { rerender } = render(<HourlyChime {...props} />);
    fireEvent.change(field('Quiet until'), { target: { value: '09:00' } });
    fireEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(field('Quiet until')).toHaveValue('09:00');
    expect(save).toHaveBeenCalledTimes(1);
    rerender(<HourlyChime {...props} busy />);
    expect(saveButton()).toBeDisabled();
  });
});

describe('Check-ins config', () => {
  it('saves new times, and an empty time turns a check-in off', async () => {
    const { props, save } = setup('checkIns');
    render(<CheckIns {...props} />);
    expect(field('Morning check-in time')).toHaveValue('08:00');
    fireEvent.change(field('Morning check-in time'), { target: { value: '07:15' } });
    fireEvent.click(field('Evening check-in'));
    expect(field('Evening check-in time')).toBeDisabled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledWith({ enabled: true, morningTime: '07:15', eveningTime: '' }));
  });
  it('turning a check-in back on restores a sensible time', () => {
    const { props } = setup('checkIns', { eveningTime: '' });
    render(<CheckIns {...props} />);
    expect(field('Evening check-in')).not.toBeChecked();
    fireEvent.click(field('Evening check-in'));
    expect(field('Evening check-in time')).toHaveValue('20:00');
  });
  it('previews the soonest check-in, or says both are off', () => {
    const { props } = setup('checkIns');
    render(<CheckIns {...props} />);
    expect(preview()).toMatch(/^Next: .*\d:00 (am|pm) \((plan|review) your day\)$/);
    fireEvent.click(field('Morning check-in'));
    fireEvent.click(field('Evening check-in'));
    expect(preview()).toBe('Next: not scheduled (both check-ins are off)');
  });
  it('explains that the evening check-in needs Habits', () => {
    const snapshot = fixture();
    const features = { ...snapshot.preferences.features, habits: false };
    const { props } = setup('checkIns', {}, true, features);
    render(<CheckIns {...props} />);
    expect(screen.getByText(/Needs the Habits module/)).toBeInTheDocument();
  });
});

describe('Streak saver config', () => {
  it('saves minutes before bed within 0 to 720', async () => {
    const { props, save } = setup('streakSaver');
    render(<StreakSaver {...props} />);
    expect(field('Minutes before bed')).toHaveValue(90);
    expect(field('Minutes before bed')).toHaveAttribute('min', '0');
    expect(field('Minutes before bed')).toHaveAttribute('max', '720');
    fireEvent.change(field('Minutes before bed'), { target: { value: '45' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledWith({ enabled: true, minutesBeforeBed: 45 }));
  });
  it.each(['721', '-1', '1.5', ''])('refuses %j', (bad) => {
    const { props, save } = setup('streakSaver');
    render(<StreakSaver {...props} />);
    fireEvent.change(field('Minutes before bed'), { target: { value: bad } });
    fireEvent.click(saveButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Minutes before bed must be a whole number from 0 to 720.');
    expect(save).not.toHaveBeenCalled();
  });
  it('accepts the limits', async () => {
    const { props, save } = setup('streakSaver');
    render(<StreakSaver {...props} />);
    fireEvent.change(field('Minutes before bed'), { target: { value: '720' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledWith({ enabled: true, minutesBeforeBed: 720 }));
  });
  it('previews tonight’s time or explains why there is none', () => {
    const { props } = setup('streakSaver', { minutesBeforeBed: 0 });
    const { rerender } = render(<StreakSaver {...props} />);
    expect(preview()).toMatch(/^Next: .*(am|pm)( if today’s tasks are unfinished)?$|^Next: not scheduled tonight$/);
    rerender(<StreakSaver {...props} features={{ ...props.features, habits: false }} />);
    expect(preview()).toBe('Next: not scheduled (turn on the Habits module)');
  });
});

describe('Movement nudges config', () => {
  it('saves the interval and the active window', async () => {
    const { props, save } = setup('movementNudges');
    render(<MovementNudges {...props} />);
    fireEvent.change(field('Every (minutes)'), { target: { value: '30' } });
    fireEvent.change(field('Active from'), { target: { value: '08:30' } });
    fireEvent.change(field('Active until'), { target: { value: '17:00' } });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ enabled: true, intervalMinutes: 30, activeStart: '08:30', activeEnd: '17:00' })
    );
  });
  it.each(['9', '241', '12.5', ''])('refuses an interval of %j', (bad) => {
    const { props, save } = setup('movementNudges');
    render(<MovementNudges {...props} />);
    fireEvent.change(field('Every (minutes)'), { target: { value: bad } });
    fireEvent.click(saveButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Interval must be a whole number from 10 to 240.');
    expect(save).not.toHaveBeenCalled();
  });
  it('previews the next slot, and nothing for an empty window', () => {
    const { props } = setup('movementNudges');
    render(<MovementNudges {...props} />);
    expect(preview()).toMatch(/^Next: (tomorrow |[A-Z][a-z]{2} )?\d{1,2}:\d{2} (am|pm)$/);
    fireEvent.change(field('Active until'), { target: { value: '09:00' } });
    expect(preview()).toBe('Next: not scheduled');
  });
});

describe('inside Settings', () => {
  it('shows each config under its switch and saves through savePreferences', async () => {
    const snapshot = fixture();
    snapshot.preferences.features.hourlyChime.enabled = true;
    snapshot.preferences.features.streakSaver.enabled = true;
    const savePreferences = vi.fn(async () => true);
    render(
      <SettingsPanel
        snapshot={snapshot}
        now={new Date(2026, 10, 15, 12)}
        busy={false}
        run={vi.fn(async () => true)}
        confirm={vi.fn(async () => true)}
        savePreferences={savePreferences}
        updater={demoUpdater}
      />
    );
    const form = screen.getByRole('form', { name: 'Hourly chime settings' });
    expect(screen.getByRole('form', { name: 'Streak saver settings' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Movement nudge settings' })).toBeNull();
    fireEvent.change(within(form).getByLabelText('Quiet until'), { target: { value: '06:00' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savePreferences).toHaveBeenCalledTimes(1));
    const [saved] = savePreferences.mock.calls[0] as unknown as [typeof snapshot.preferences];
    expect(saved.features.hourlyChime).toEqual({ enabled: true, quietStart: '22:00', quietEnd: '06:00', sound: true });
    expect(saved.features.streakSaver).toEqual(snapshot.preferences.features.streakSaver);
  });
});
