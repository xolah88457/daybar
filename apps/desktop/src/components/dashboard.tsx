'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSleepView } from '@daybar/core';
import type {
  DaybarClient,
  MutationResult,
  Operation,
  Preferences,
  Snapshot
} from '@daybar/core/contracts';
import { confirmAction } from '../lib/confirm';
import { createDemoClient } from '../lib/demo';
import { tauriClient } from '../lib/ipc';
import { Countdown, DayProgress, Focus, Habits, Sleep } from './modules';
import { theme } from './primitives';
import { SettingsPanel } from './settings';

const views = [
  'Today',
  'Countdown',
  'Habits',
  'Focus',
  'Sleep',
  'Settings'
] as const;
type View = (typeof views)[number];
const symbols = ['◫', '▦', '✓', '◷', '☾', '⚙'];
const descriptions: Record<View, string> = {
  Today: 'A little more room in your day.',
  Countdown: 'The big picture, one square at a time.',
  Habits: 'Small things. Done consistently.',
  Focus: 'Give one thing your full attention.',
  Sleep: 'Find a rhythm you can return to.',
  Settings: 'Your rhythm. Your rules.'
};
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Something went wrong. Your changes may not have been saved; refresh before trying again.';
}

export function Dashboard({
  client: suppliedClient
}: {
  client?: DaybarClient;
}) {
  const [client, setClient] = useState<DaybarClient | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [view, setView] = useState<View>('Today');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [demo, setDemo] = useState(false);
  const working = useRef(false);
  const pendingChange = useRef(false);
  const mounted = useRef(false);
  const current = useRef<Snapshot | null>(null);
  const request = useRef(0);
  const settled = useRef<number | null>(null);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const browser = !('__TAURI_INTERNALS__' in window);
    setDemo(!suppliedClient && browser);
    setClient(suppliedClient ?? (browser ? createDemoClient() : tauriClient));
    setNow(new Date());
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, [suppliedClient]);
  const accept = useCallback((data: Snapshot) => {
    current.current = data;
    setSnapshot(data);
  }, []);
  const refresh = useCallback(
    async (clearError = true) => {
      if (!client) return;
      const id = ++request.current;
      try {
        const data = await client.snapshot();
        if (mounted.current && id === request.current) {
          accept(data);
          if (clearError) setError('');
        }
      } catch (e) {
        if (mounted.current && id === request.current) setError(message(e));
      }
    },
    [client, accept]
  );
  useEffect(() => {
    if (!client) return;
    mounted.current = true;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    // Register before loading so an edit during the initial read cannot be missed.
    void client
      .subscribe(() => {
        if (!disposed) {
          if (working.current) pendingChange.current = true;
          else void refresh(false);
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch((e) => {
        if (!disposed) setError(`Live updates unavailable: ${message(e)}`);
      });
    void refresh();
    return () => {
      disposed = true;
      mounted.current = false;
      ++request.current;
      unsubscribe?.();
    };
  }, [client, refresh]);
  const perform = useCallback(
    async (
      work: () => Promise<Snapshot | MutationResult>,
      success?: string
    ) => {
      if (working.current) return false;
      working.current = true;
      ++request.current;
      setBusy(true);
      setError('');
      setNotice('');
      const wasFocus = current.current?.focus.state?.type === 'focus';
      try {
        const result = await work();
        if (mounted.current) {
          ++request.current;
          accept('snapshot' in result ? result.snapshot : result);
          const credit =
            'creditedMinutes' in result ? result.creditedMinutes : undefined;
          setNotice(
            credit !== undefined && wasFocus
              ? credit > 0
                ? `Counted ${credit} whole minute${credit === 1 ? '' : 's'} of focus.`
                : 'Less than a minute, so nothing was counted.'
              : ('message' in result && result.message) || success || 'Saved.'
          );
        }
        return true;
      } catch (e) {
        if (mounted.current) setError(message(e));
        return false;
      } finally {
        working.current = false;
        if (mounted.current) {
          setBusy(false);
          if (pendingChange.current) {
            pendingChange.current = false;
            void refresh(false);
          }
        }
      }
    },
    [accept, refresh]
  );
  const run = useCallback(
    async (operation: Operation) =>
      client ? perform(() => client.mutate(operation)) : false,
    [client, perform]
  );
  const savePreferences = useCallback(
    async (preferences: Preferences) =>
      client
        ? perform(
            () => client.setPreferences(preferences),
            'Mac preferences saved.'
          )
        : false,
    [client, perform]
  );
  useEffect(() => {
    const state = snapshot?.focus.state;
    if (
      !state ||
      !now ||
      busy ||
      snapshot.issues.length ||
      now.getTime() < state.end ||
      settled.current === state.start
    )
      return;
    settled.current = state.start;
    void run({ kind: 'settle_timer' });
  }, [snapshot, now, busy, run]);
  useEffect(() => {
    const keydown = async (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        event.repeat ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        (target instanceof Element &&
          target.closest(
            'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'
          ))
      )
        return;
      const index = Number(event.key) - 1;
      if (!event.shiftKey && index >= 0 && index < views.length) {
        event.preventDefault();
        setView(views[index]);
        main.current?.focus();
      }
      if (event.shiftKey && event.key === 'Enter') {
        const data = current.current;
        if (!data || working.current || data.issues.length) return;
        event.preventDefault();
        if (data.focus.state) void run({ kind: 'stop_timer' });
        else {
          const sleep = getSleepView(data.sleep, new Date(), data.settings);
          if (
            !sleep.asleep &&
            sleep.leftMinutes > 0 &&
            sleep.leftMinutes <= data.settings.sleep.noPhoneMinutes &&
            !(await confirmAction(
              'It is no-phone time. Start a focus session anyway?'
            ))
          )
            return;
          void run({
            kind: 'start_timer',
            timerType: 'focus',
            minutes: data.settings.focus.focusOptions[0]
          });
        }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [run]);
  const navigate = (next: View) => {
    setView(next);
    main.current?.focus();
  };
  const actions =
    snapshot && now
      ? { snapshot, now, busy: busy || snapshot.issues.length > 0, run }
      : null;
  return (
    <div
      className="app-shell"
      style={snapshot ? theme(snapshot.settings) : undefined}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="wordmark">
          <span className="brand-grid" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} />
            ))}
          </span>
          <span>
            daybar<small>A DAY, WELL SPENT.</small>
          </span>
        </div>
        <nav aria-label="Modules">
          {views.map((name, i) => (
            <button
              key={name}
              aria-current={view === name ? 'page' : undefined}
              onClick={() => navigate(name)}
            >
              <span aria-hidden="true">{symbols[i]}</span>
              {name}
              <kbd>{i + 1}</kbd>
            </button>
          ))}
          <button
            className="radar"
            disabled
            title="Coming later via a native EventKit helper"
          >
            <span aria-hidden="true">⌖</span>Deadline Radar<small>SOON</small>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="connection">
            <i />
            {demo ? 'IN-MEMORY DEMO' : 'LOCAL FIRST'}
          </div>
          <p>
            {demo
              ? 'Try everything. Nothing leaves this tab.'
              : 'Shared files. No cloud account. No telemetry.'}
          </p>
          <span className="edition">DAYBAR / 01</span>
        </div>
      </aside>
      <main
        id="main"
        ref={main}
        tabIndex={-1}
        className="workspace"
        aria-busy={busy}
      >
        <header className="page-head">
          <div>
            <p className="eyebrow">
              YOUR TIME, MADE VISIBLE{' '}
              <span>/ {String(views.indexOf(view) + 1).padStart(2, '0')}</span>
            </p>
            <h1>{view === 'Today' ? 'Here & now.' : view}</h1>
            <p className="page-description">{descriptions[view]}</p>
          </div>
          <div className="date-stamp">
            {now ? (
              <>
                <span>
                  {now
                    .toLocaleDateString([], { weekday: 'short' })
                    .toUpperCase()}
                </span>
                <strong>{now.getDate()}</strong>
                <span>
                  {now
                    .toLocaleDateString([], { month: 'short', year: 'numeric' })
                    .toUpperCase()}
                </span>
              </>
            ) : (
              '—'
            )}
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>◎ BROWSER DEMO</span> Sample data lives in memory and resets
            on reload. Your files are untouched.
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            <strong>Could not complete that.</strong>
            <p>{error}</p>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() => {
                  settled.current = null;
                  void refresh();
                }}
              >
                Refresh data
              </button>
              <button onClick={() => setError('')}>Dismiss</button>
            </div>
          </div>
        )}
        {notice && (
          <div className="save-notice" role="status">
            {notice}
            <button aria-label="Dismiss status" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        {snapshot?.issues.map((issue) => (
          <div
            className="notice error"
            role="alert"
            key={`${issue.file}-${issue.message}`}
          >
            <strong>{issue.file}</strong>
            <p>{issue.message}</p>
            <span className="caption">
              Writes are paused. Repair the source file or select another folder
              in Settings, then refresh.
            </span>
          </div>
        ))}
        {snapshot?.conflicts.map((conflict) => (
          <div className="notice warning" key={conflict.file}>
            <strong>iCloud conflict · {conflict.file}</strong>
            <p>
              Canonical: {conflict.canonical}. Review the files before choosing.
              Nothing is silently discarded.
            </p>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={async () => {
                  if (
                    client &&
                    (await confirmAction(
                      `Merge “${conflict.file}” into “${conflict.canonical}”? Conflicting values may require manual repair; only a successful merge resolves the copy.`
                    ))
                  )
                    void perform(
                      () => client.resolveConflict(conflict.file, 'merge'),
                      'Conflict merged.'
                    );
                }}
              >
                Merge…
              </button>
              <button
                className="subtle-danger"
                disabled={busy}
                onClick={async () => {
                  if (
                    client &&
                    (await confirmAction(
                      `Permanently discard conflict copy “${conflict.file}”? Keep “${conflict.canonical}” unchanged. This cannot be undone.`
                    ))
                  )
                    void perform(
                      () => client.resolveConflict(conflict.file, 'discard'),
                      'Conflict copy discarded.'
                    );
                }}
              >
                Discard copy…
              </button>
            </div>
          </div>
        ))}
        {!actions ? (
          <div className="loading" role="status">
            {error
              ? 'Data unavailable. Choose refresh to retry.'
              : 'Opening your day…'}
          </div>
        ) : (
          <>
            {view === 'Today' && (
              <div className="dashboard-grid">
                <div className="today-progress">
                  <DayProgress {...actions} />
                </div>
                <div className="today-focus">
                  <Focus {...actions} />
                </div>
                <div className="today-habits">
                  <Habits {...actions} compact />
                </div>
                <div className="today-countdown">
                  <Countdown {...actions} />
                </div>
              </div>
            )}
            {view === 'Countdown' && <Countdown {...actions} />}
            {view === 'Habits' && <Habits {...actions} />}
            {view === 'Focus' && (
              <div className="reading-width">
                <Focus {...actions} />
              </div>
            )}
            {view === 'Sleep' && (
              <div className="stack">
                <Sleep {...actions} />
              </div>
            )}
            {view === 'Settings' && (
              <div className="stack">
                <SettingsPanel
                  {...actions}
                  busy={busy}
                  savePreferences={savePreferences}
                />
              </div>
            )}
          </>
        )}
        <footer className="page-footer">
          <span>SMALL SQUARES. BIG PICTURE.</span>
          <span>
            {busy
              ? 'Saving…'
              : demo
                ? 'MEMORY ONLY / NO SYNC'
                : snapshot?.preferences.realData
                  ? 'REAL SHARED FOLDER'
                  : 'SANDBOX DATA'}{' '}
            <i />
          </span>
        </footer>
      </main>
    </div>
  );
}
