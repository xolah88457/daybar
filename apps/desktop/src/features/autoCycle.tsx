'use client';
import { useState } from 'react';
import styles from './autoCycle.module.css';
import type { FeatureConfigProps } from './types';

export function Config({ value, save, busy }: FeatureConfigProps<'autoCycle'>) {
  const [draft, setDraft] = useState(String(value.longBreakEvery));
  const every = Number(draft);
  const valid = Number.isInteger(every) && every >= 2 && every <= 12;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save({ ...value, longBreakEvery: every });
      }}
    >
      <div className={styles.row}>
        <label className="field">
          Long break every (sessions)
          <input
            type="number"
            min="2"
            max="12"
            step="1"
            value={draft}
            aria-invalid={!valid}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button disabled={busy || !valid || every === value.longBreakEvery}>Save</button>
      </div>
      <p className="muted">
        When a focus session runs to its end, a break starts by itself: the first
        long-break length from Settings → Focus on every {valid ? every : 'Nth'}{' '}
        completed session today, otherwise the first break length. A session you
        stop early starts no break, and a finished break never starts focus.
      </p>
      {!valid && (
        <p className="form-error" role="alert">
          Enter a whole number from 2 to 12.
        </p>
      )}
    </form>
  );
}
