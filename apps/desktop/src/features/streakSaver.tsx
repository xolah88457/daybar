'use client';
// Feature: streakSaver. Settings panel only; the alert is scheduled in Rust (features/streak.rs).
import { describeNext, nextStreakSaver } from '@daybar/core';
import { NotifyForm, NumberField, rangeError, useConfigDraft } from './notifyForm';
import type { FeatureConfigProps } from './types';

export function Config({ value, save, busy, features, snapshot }: FeatureConfigProps<'streakSaver'>) {
  const { draft, set, dirty, error, submit } = useConfigDraft(value, save, (d) =>
    rangeError('Minutes before bed', d.minutesBeforeBed, 0, 720)
  );
  const now = new Date();
  const valid = rangeError('', draft.minutesBeforeBed, 0, 720) === null;
  const next = valid ? nextStreakSaver(snapshot.sleep, snapshot.settings, now, draft.minutesBeforeBed) : null;
  const preview = !features.habits
    ? 'Next: not scheduled (turn on the Habits module)'
    : next
      ? `${describeNext(next, now)} if today’s tasks are unfinished`
      : 'Next: not scheduled tonight';
  return (
    <NotifyForm label="Streak saver settings" dirty={dirty} busy={busy} error={error} preview={preview} onSubmit={submit}>
      <NumberField
        label="Minutes before bed"
        value={draft.minutesBeforeBed}
        min={0}
        max={720}
        onChange={(minutesBeforeBed) => set({ minutesBeforeBed })}
        hint="Uses your bedtime from the Sleep settings, even if the Sleep module is off. 0 to 720."
      />
    </NotifyForm>
  );
}
