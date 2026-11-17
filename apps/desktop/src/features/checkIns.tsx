'use client';
// Feature: checkIns. Settings panel only; the notifications are scheduled in Rust (features/checkins.rs).
import { describeNext, formatClock, nextCheckIn, parseClock } from '@daybar/core';
import { NotifyForm, TimeField, useConfigDraft } from './notifyForm';
import type { FeatureConfigProps } from './types';

const defaults = { morningTime: '08:00', eveningTime: '20:00' } as const;

export function Config({ value, save, busy, features }: FeatureConfigProps<'checkIns'>) {
  const { draft, set, dirty, error, submit } = useConfigDraft(value, save, (d) =>
    [d.morningTime, d.eveningTime].some((t) => t !== '' && parseClock(t) === null)
      ? 'Check-in times need a valid time, or turn the check-in off.'
      : null
  );
  const now = new Date();
  const next = nextCheckIn(now, draft);
  const preview = next
    ? `${describeNext(next.at, now)} (${next.kind === 'morning' ? 'plan your day' : 'review your day'})`
    : 'Next: not scheduled (both check-ins are off)';
  const row = (key: 'morningTime' | 'eveningTime', label: string, hint: string) => (
    <div className="field">
      <label className="toggle">
        <input
          type="checkbox"
          checked={draft[key] !== ''}
          onChange={(e) => set({ [key]: e.target.checked ? defaults[key] : '' } as Partial<typeof draft>)}
        />
        {label}
      </label>
      <TimeField
        label={`${label} time`}
        value={draft[key]}
        disabled={draft[key] === ''}
        onChange={(time) => set({ [key]: time } as Partial<typeof draft>)}
        hint={draft[key] === '' ? 'Off' : `${formatClock(draft[key])}. ${hint}`}
      />
    </div>
  );
  return (
    <NotifyForm label="Check-in settings" dirty={dirty} busy={busy} error={error} preview={preview} onSubmit={submit}>
      {row('morningTime', 'Morning check-in', 'Plan your day: tasks for today and days left.')}
      {row(
        'eveningTime',
        'Evening check-in',
        features.habits ? 'Only sent while tasks are left.' : 'Needs the Habits module, which is off.'
      )}
    </NotifyForm>
  );
}
