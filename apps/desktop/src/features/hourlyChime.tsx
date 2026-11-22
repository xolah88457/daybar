'use client';
// Feature: hourlyChime. Settings panel only; the chime itself is scheduled in Rust (features/chime.rs).
import { describeNext, nextHourlyChime, parseClock } from '@daybar/core';
import { NotifyForm, TimeField, useConfigDraft } from './notifyForm';
import type { FeatureConfigProps } from './types';
import { osName } from '../lib/platform';

export function Config({ value, save, busy }: FeatureConfigProps<'hourlyChime'>) {
  const { draft, set, dirty, error, submit } = useConfigDraft(value, save, (d) =>
    parseClock(d.quietStart) === null || parseClock(d.quietEnd) === null
      ? 'Quiet hours need a start and an end time.'
      : null
  );
  const now = new Date();
  const next = nextHourlyChime(now, draft);
  return (
    <NotifyForm
      label="Hourly chime settings"
      dirty={dirty}
      busy={busy}
      error={error}
      preview={describeNext(next, now)}
      onSubmit={submit}
    >
      <TimeField
        label="Quiet from"
        value={draft.quietStart}
        onChange={(quietStart) => set({ quietStart })}
        hint="No chime from this time…"
      />
      <TimeField
        label="Quiet until"
        value={draft.quietEnd}
        onChange={(quietEnd) => set({ quietEnd })}
        hint="…until this one. It may run past midnight."
      />
      <label className="toggle">
        <input type="checkbox" checked={draft.sound} onChange={(e) => set({ sound: e.target.checked })} />
        Play a sound
      </label>
      <small className="field">
        Off sends the notification without asking for a sound. {osName()} decides the rest, so a chime can still be
        audible if Daybar’s notification settings allow it.
      </small>
    </NotifyForm>
  );
}
