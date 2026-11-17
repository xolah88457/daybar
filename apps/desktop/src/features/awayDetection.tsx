'use client';
import { useEffect, useState } from 'react';
import { featureEnabled } from '@daybar/core';
import type { Actions } from '../components/modules';
import { awayClient } from '../lib/focusIpc';
import type { AwayStatus } from '../lib/focusIpc';
import styles from './awayDetection.module.css';
import type { FeatureConfigProps } from './types';

export function Config({ value, save, busy }: FeatureConfigProps<'awayDetection'>) {
  const [draft, setDraft] = useState(String(value.idleMinutes));
  const minutes = Number(draft);
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 60;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save({ ...value, idleMinutes: minutes });
      }}
    >
      <div className={styles.row}>
        <label className="field">
          Away after (minutes)
          <input
            type="number"
            min="1"
            max="60"
            step="1"
            value={draft}
            aria-invalid={!valid}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button disabled={busy || !valid || minutes === value.idleMinutes}>Save</button>
      </div>
      <p className="muted">
        While a focus session runs, Daybar checks every half minute how long the
        keyboard and mouse have been untouched. Once that reaches this many
        minutes you get one notification and a banner on the Focus view, where
        you can keep going or stop the timer. Nothing is checked when no focus
        session is running.
      </p>
      {!valid && (
        <p className="form-error" role="alert">
          Enter a whole number of minutes from 1 to 60.
        </p>
      )}
    </form>
  );
}

/**
 * The away banner. Rendered by the Focus module (Today and the Focus view) so it sits right by the
 * timer; it shows nothing unless away detection is on and the Mac was idle during this session.
 */
export function AwayBanner({ snapshot, busy, run }: Actions) {
  const features = snapshot.preferences.features;
  const timer = snapshot.focus.state;
  const session =
    featureEnabled(features, 'awayDetection') && features.focus && timer?.type === 'focus'
      ? timer.start
      : null;
  const [status, setStatus] = useState<AwayStatus | null>(null);
  useEffect(() => {
    if (session === null) {
      setStatus(null);
      return;
    }
    let live = true;
    let stop: (() => void) | undefined;
    awayClient
      .status()
      .then((s) => live && setStatus(s))
      .catch(() => undefined);
    awayClient
      .subscribe((s) => live && setStatus(s))
      .then((unlisten) => (live ? (stop = unlisten) : unlisten()))
      .catch(() => undefined);
    return () => {
      live = false;
      stop?.();
    };
  }, [session]);
  if (session === null || !status?.away || status.session !== session) return null;
  return (
    <div className={`notice warning ${styles.banner}`} role="status">
      <p className={styles.text}>
        <strong>Still focusing?</strong> You&apos;ve been away {status.awayMinutes} min.
      </p>
      <div className={styles.actions}>
        <button
          disabled={busy}
          onClick={() =>
            void awayClient
              .dismiss(session)
              .then(setStatus)
              .catch(() => setStatus({ ...status, away: false }))
          }
        >
          Keep going
        </button>
        <button disabled={busy} onClick={() => void run({ kind: 'stop_timer' })}>
          Stop timer
        </button>
      </div>
    </div>
  );
}
