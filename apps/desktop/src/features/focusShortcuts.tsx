'use client';
import { useState } from 'react';
import { shortcutsClient } from '../lib/focusIpc';
import styles from './focusShortcuts.module.css';
import type { FeatureConfigProps } from './types';

type Which = 'onStart' | 'onEnd';
const fields: { key: Which; label: string; short: string }[] = [
  { key: 'onStart', label: 'Run when a focus session starts', short: 'start' },
  { key: 'onEnd', label: 'Run when a focus session ends', short: 'end' }
];

export function Config({ value, save, busy }: FeatureConfigProps<'focusShortcuts'>) {
  const [draft, setDraft] = useState({ onStart: value.onStart, onEnd: value.onEnd });
  const [result, setResult] = useState<{ key: Which; ok: boolean; text: string } | null>(
    null
  );
  const [testing, setTesting] = useState<Which | null>(null);
  // Compared trimmed, as saved, so a whitespace-padded draft is not "unsaved" once it has been saved.
  const changed = draft.onStart.trim() !== value.onStart || draft.onEnd.trim() !== value.onEnd;
  const test = async (key: Which) => {
    const name = draft[key].trim();
    setTesting(key);
    setResult(null);
    try {
      await shortcutsClient.run(name);
      setResult({ key, ok: true, text: `Ran “${name}”.` });
    } catch (e) {
      setResult({ key, ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(null);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ ...value, onStart: draft.onStart.trim(), onEnd: draft.onEnd.trim() });
      }}
    >
      {fields.map(({ key, label, short }) => (
        <div key={key}>
          <div className={styles.row}>
            <label className="field">
              {label}
              <input
                type="text"
                maxLength={120}
                placeholder="Shortcut name (optional)"
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
            <button
              type="button"
              disabled={busy || testing !== null || !draft[key].trim()}
              aria-label={`Test ${short} Shortcut`}
              onClick={() => void test(key)}
            >
              {testing === key ? 'Running…' : 'Test'}
            </button>
          </div>
          {result?.key === key && (
            <p
              className={result.ok ? 'muted' : 'form-error'}
              role={result.ok ? 'status' : 'alert'}
            >
              {result.text}
            </p>
          )}
        </div>
      ))}
      <p className="muted">
        Create a Shortcut in the Shortcuts app, e.g. one that turns on Do Not
        Disturb, then type its exact name here.
      </p>
      <button disabled={busy || !changed}>Save</button>
    </form>
  );
}
