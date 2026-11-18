'use client';
// Feature: exportHistory. Two buttons under the switch. In the desktop app the Rust command
// `export_history` writes a new folder in Downloads and returns its path; in the browser demo (no
// filesystem) the same files are built here and offered as ordinary downloads.
import { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import styles from './exportHistory.module.css';
import { csvFiles, jsonFile } from './exportHistory.format';
import type { ExportFile } from './exportHistory.format';
import type { FeatureConfigProps } from './types';

type Format = 'csv' | 'json';
type Result = { kind: 'saved'; text: string; path?: string } | { kind: 'error'; text: string };

// The same test the dashboard and lib/confirm.ts use to tell the native app from the demo.
const isDemo = () => !(isTauri() || '__TAURI_INTERNALS__' in window);

function download(file: ExportFile) {
  const url = URL.createObjectURL(new Blob([file.text], { type: `${file.type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Config({ snapshot, busy }: FeatureConfigProps<'exportHistory'>) {
  const [working, setWorking] = useState<Format | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (format: Format) => {
    setWorking(format);
    setResult(null);
    try {
      if (isDemo()) {
        const now = new Date();
        const files = format === 'csv' ? csvFiles(snapshot, now) : [jsonFile(snapshot, now)];
        files.forEach(download);
        setResult({
          kind: 'saved',
          text: `Browser demo: downloaded ${files.map((f) => f.name).join(', ')}.`
        });
      } else {
        const path = await invoke<string>('export_history', { format });
        setResult({ kind: 'saved', text: 'Exported to', path });
      }
    } catch (e) {
      setResult({
        kind: 'error',
        text: typeof e === 'string' ? e : e instanceof Error ? e.message : 'The export failed. Nothing was changed.'
      });
    } finally {
      setWorking(null);
    }
  };
  const disabled = busy || working !== null;

  return (
    <div>
      <p className={styles.help}>
        Saves a copy of your history to a new folder in Downloads called <code>Daybar export</code>{' '}
        and the date. <strong>CSV</strong> writes <code>focus-sessions.csv</code>,{' '}
        <code>focus-days.csv</code>, <code>habits.csv</code> and <code>sleep.csv</code>;{' '}
        <strong>JSON</strong> writes one <code>daybar-export.json</code> with your settings, habits,
        focus and sleep. Your data files are only read, never changed.
      </p>
      <div className={styles.actions}>
        <button type="button" disabled={disabled} onClick={() => void run('csv')}>
          {working === 'csv' ? 'Exporting…' : 'Export CSV'}
        </button>
        <button type="button" disabled={disabled} onClick={() => void run('json')}>
          {working === 'json' ? 'Exporting…' : 'Export JSON'}
        </button>
      </div>
      <div role="status">
        {result?.kind === 'saved' && (
          <p className={styles.result}>
            <strong>Done.</strong> {result.text}
            {result.path && <span className={styles.path}>{result.path}</span>}
          </p>
        )}
      </div>
      {result?.kind === 'error' && (
        <p className={styles.error} role="alert">
          {result.text}
        </p>
      )}
    </div>
  );
}
