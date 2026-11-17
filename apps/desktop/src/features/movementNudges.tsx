'use client';
// Feature: movementNudges. Settings panel only; nudges are scheduled in Rust (features/nudges.rs).
import { describeNext, nextMovementNudge, parseClock } from '@daybar/core';
import { NotifyForm, NumberField, rangeError, TimeField, useConfigDraft } from './notifyForm';
import type { FeatureConfigProps } from './types';

export function Config({ value, save, busy }: FeatureConfigProps<'movementNudges'>) {
  const { draft, set, dirty, error, submit } = useConfigDraft(value, save, (d) => {
    if (parseClock(d.activeStart) === null || parseClock(d.activeEnd) === null)
      return 'Active hours need a start and an end time.';
    return rangeError('Interval', d.intervalMinutes, 10, 240);
  });
  const now = new Date();
  const valid = rangeError('', draft.intervalMinutes, 10, 240) === null;
  const next = valid ? nextMovementNudge(now, draft) : null;
  return (
    <NotifyForm
      label="Movement nudge settings"
      dirty={dirty}
      busy={busy}
      error={error}
      preview={describeNext(next, now)}
      onSubmit={submit}
    >
      <NumberField
        label="Every (minutes)"
        value={draft.intervalMinutes}
        min={10}
        max={240}
        onChange={(intervalMinutes) => set({ intervalMinutes })}
        hint="10 to 240. Counted from the start of your active hours."
      />
      <TimeField label="Active from" value={draft.activeStart} onChange={(activeStart) => set({ activeStart })} />
      <TimeField
        label="Active until"
        value={draft.activeEnd}
        onChange={(activeEnd) => set({ activeEnd })}
        hint="Skipped during a focus timer and your night routine."
      />
    </NotifyForm>
  );
}
