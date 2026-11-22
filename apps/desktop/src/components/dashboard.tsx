'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultFeatures } from '@daybar/core/contracts';
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
import { demoUpdater, tauriUpdater } from '../lib/updates';
import type { UpdaterClient } from '../lib/updates';
import {
  type Actions,
  confirmFocusStart,
  Countdown,
  DayProgress,
  Focus,
  Habits,
  Sleep
} from './modules';
import { featureOverlays, todayCards } from '../features/registry';
import { todayView, visibleViews } from '../features/views';
import { theme, layoutTheme, dayProjectedSettings } from './primitives';
import { SettingsPanel } from './settings';
import { Overview, SpacePage } from './spaces';
import { placeholderTasks, SetupWizard } from './setup';
import { device, isWindows } from '../lib/platform';

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Something went wrong. Your changes may not have been saved; refresh before trying again.';
}

export function Dashboard({
  client: suppliedClient,
  updater: suppliedUpdater
}: {
  client?: DaybarClient;
  updater?: UpdaterClient;
}) {
  const [client, setClient] = useState<DaybarClient | null>(null);
  const [updater, setUpdater] = useState<UpdaterClient | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [viewId, setViewId] = useState<string>(todayView.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [demo, setDemo] = useState(false);
  const [systemDark, setSystemDark] = useState(true);
  // The setup window opens by itself until it is finished or skipped, and from Settings on request.
  const [setupForced, setSetupForced] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const working = useRef(false);
  const pendingChange = useRef(false);
  const mounted = useRef(false);
  const current = useRef<Snapshot | null>(null);
  const request = useRef(0);
  const settled = useRef<number | null>(null);
  const main = useRef<HTMLElement>(null);
  const features = snapshot?.preferences.features ?? defaultFeatures;
  const spaces = snapshot?.spaces;
  const views = useMemo(() => visibleViews(features, spaces), [features, spaces]);
  // Number keys and the sidebar follow the visible views; a hidden view falls back to Today.
  const activeView = views.find((v) => v.id === viewId) ?? views[0];
  const view = activeView.id;
  const overlays = useMemo(() => featureOverlays(features), [features]);
  const viewsRef = useRef(views);
  viewsRef.current = views;
  useEffect(() => {
    if (activeView.id !== viewId) setViewId(activeView.id);
  }, [activeView.id, viewId]);
  useEffect(() => {
    const browser = !('__TAURI_INTERNALS__' in window);
    setDemo(!suppliedClient && browser);
    setClient(suppliedClient ?? (browser ? createDemoClient() : tauriClient));
    setUpdater(suppliedUpdater ?? (browser ? demoUpdater : tauriUpdater));
    setNow(new Date());
    const appearance = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (appearance) setSystemDark(appearance.matches);
    const updateAppearance = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    appearance?.addEventListener('change', updateAppearance);
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.clearInterval(tick);
      appearance?.removeEventListener('change', updateAppearance);
    };
  }, [suppliedClient, suppliedUpdater]);
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
  const confirm = useCallback(async (prompt: string) => {
    try {
      return await confirmAction(prompt);
    } catch (e) {
      if (mounted.current)
        setError(`Could not confirm this action: ${message(e)}`);
      return false;
    }
  }, []);
  const savePreferences = useCallback(
    async (preferences: Preferences) =>
      client
        ? perform(
            () => client.setPreferences(preferences),
            `${device()} preferences saved.`
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
        event.isComposing ||
        (target instanceof Element &&
          target.closest(
            'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'
          )) ||
        document.querySelector('dialog[open]')
      )
        return;
      const index = Number(event.key) - 1;
      const visible = viewsRef.current;
      const navigation =
        !event.altKey && !event.shiftKey && index >= 0 && index < visible.length;
      if (navigation) {
        event.preventDefault();
        setViewId(visible[index].id);
        main.current?.focus();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.shiftKey &&
        event.key === 'Enter'
      ) {
        const data = current.current;
        if (!data || working.current || data.issues.length) return;
        // Focus is switched off: the shortcut does nothing. Read the switch from the same snapshot
        // as the rest of this handler; a render-time ref can still hold the default (on) right after load.
        if (!data.preferences.features.focus) return;
        event.preventDefault();
        if (data.focus.state) void run({ kind: 'stop_timer' });
        else {
          if (
            !(await confirmFocusStart(
              getSleepView(data.sleep, new Date(), data.settings),
              data.settings.sleep.noPhoneMinutes,
              confirm,
              data.preferences.features.sleep
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
  }, [run, confirm]);
  const navigate = (next: string) => {
    setViewId(next);
    main.current?.focus();
  };
  const actions =
    snapshot && now
      ? {
          snapshot,
          now,
          busy: busy || snapshot.issues.length > 0,
          run,
          confirm
        }
      : null;
  const showSetup =
    !!actions &&
    !actions.snapshot.issues.length &&
    (setupForced || (!actions.snapshot.preferences.setupDone && !setupDismissed));
  const closeSetup = useCallback(() => {
    setSetupForced(false);
    setSetupDismissed(true);
  }, []);
  const clearDemo = async () => {
    if (await confirm('Clear the demo data and start from a blank day? It is only in this tab.')) {
      if (await run({ kind: 'reset_starter' })) setSetupForced(true);
    }
  };
  const themeMode = snapshot?.preferences.themeMode ?? 'night';
  const effectiveNight =
    themeMode === 'night' || (themeMode === 'auto' && systemDark);
  const nextTheme = effectiveNight ? 'day' : 'night';
  const moduleActions =
    actions && !effectiveNight
      ? {
          ...actions,
          snapshot: {
            ...actions.snapshot,
            settings: dayProjectedSettings(actions.snapshot.settings)
          }
        }
      : actions;
  const appearanceStyle = snapshot
    ? effectiveNight
      ? theme(snapshot.settings)
      : layoutTheme(snapshot.settings)
    : undefined;
  return (
    <div
      className="app-shell"
      data-theme={themeMode}
      data-system-theme={systemDark ? 'night' : 'day'}
      style={appearanceStyle}
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
          {views.map((v, i) => (
            <button
              key={v.id}
              aria-current={view === v.id ? 'page' : undefined}
              onClick={() => navigate(v.id)}
            >
              <span aria-hidden="true" style={v.color ? { color: v.color } : undefined}>
                {v.symbol}
              </span>
              {v.label}
              {i < 9 && <kbd>{i + 1}</kbd>}
            </button>
          ))}
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
              <span>/ {String(views.indexOf(activeView) + 1).padStart(2, '0')}</span>
            </p>
            <h1>{view === 'Today' ? 'Here & now.' : activeView.label}</h1>
            <p className="page-description">{activeView.description}</p>
          </div>
          <div className="head-actions">
            <button
              type="button"
              className="theme-toggle"
              aria-label={`Switch to ${nextTheme} appearance`}
              title="Toggle day/night appearance"
              onClick={() => {
                if (!snapshot) return;
                void savePreferences({
                  ...snapshot.preferences,
                  themeMode: nextTheme
                });
              }}
            >
              {effectiveNight ? '☼' : '☾'}
            </button>
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
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>◎ BROWSER DEMO</span> Sample data lives in memory and resets
            on reload. Your files are untouched.
            {snapshot && (
              <button type="button" disabled={busy} onClick={() => void clearDemo()}>
                Remove demo data
              </button>
            )}
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
            <strong>{isWindows() ? 'Sync conflict' : 'iCloud conflict'} · {conflict.file}</strong>
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
                    (await confirm(
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
                    (await confirm(
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
        {!actions || !moduleActions ? (
          <div className="loading" role="status">
            {error
              ? 'Data unavailable. Choose refresh to retry.'
              : 'Opening your day…'}
          </div>
        ) : (
          <>
            {view === 'Today' && !showSetup && placeholderTasks(actions.snapshot.settings) && (
              <div className="notice setup-nudge">
                <strong>Your task list still has the placeholder “First habit”.</strong>
                <p>A one-minute setup sets your tasks, a countdown and your spaces.</p>
                <div className="button-row">
                  <button className="primary" onClick={() => setSetupForced(true)}>
                    Set up Daybar →
                  </button>
                </div>
              </div>
            )}
            {view === 'Today' && <Today {...moduleActions} />}
            {view === 'Countdown' && <Countdown {...moduleActions} />}
            {view === 'Habits' && <Habits {...moduleActions} />}
            {view === 'Focus' && (
              <div className="reading-width">
                <Focus {...moduleActions} />
              </div>
            )}
            {view === 'Sleep' && (
              <div className="stack">
                <Sleep {...moduleActions} />
              </div>
            )}
            {view === 'Overview' && <Overview {...moduleActions} navigate={navigate} />}
            {activeView.space && (
              <SpacePage
                key={activeView.space}
                {...moduleActions}
                navigate={navigate}
                space={activeView.space}
              />
            )}
            {activeView.View && (
              <activeView.View
                {...moduleActions}
                savePreferences={savePreferences}
              />
            )}
            {view === 'Settings' && updater && (
              <div className="stack">
                <SettingsPanel
                  {...actions}
                  updater={updater}
                  busy={busy}
                  savePreferences={savePreferences}
                  openSetup={() => setSetupForced(true)}
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
                  : 'THIS MAC ONLY / NOT SYNCED'}{' '}
            <i />
          </span>
        </footer>
      </main>
      {showSetup && actions && (
        <SetupWizard
          {...actions}
          busy={busy}
          savePreferences={savePreferences}
          onClose={closeSetup}
        />
      )}
      {/* Shell-level overlays contributed by enabled features (see features/registry.ts). */}
      {actions &&
        overlays.map(({ id, Overlay }) => (
          <Overlay
            key={id}
            {...actions}
            navigate={navigate}
            savePreferences={savePreferences}
          />
        ))}
    </div>
  );
}

// Today's cards: the built-in modules that are on, then cards contributed by enabled features.
// With all four modules on they keep their designed positions, and feature cards go in a second
// grid underneath with the same columns, so an extra card never reshuffles the main layout. With
// a module off, everything reflows into one grid.
function Today(actions: Actions) {
  const features = actions.snapshot.preferences.features;
  const extra = todayCards(features);
  const anyModule =
    features.sleep || features.focus || features.habits || features.countdown;
  const allModules =
    features.sleep && features.focus && features.habits && features.countdown;
  const cards = extra.map(({ id, Card }) => (
    <div className="today-card" data-feature={id} key={id}>
      <Card {...actions} />
    </div>
  ));
  return (
    <>
      <div className={`dashboard-grid${allModules ? '' : ' flow'}`}>
        {features.sleep && (
          <div className="today-progress">
            <DayProgress {...actions} />
          </div>
        )}
        {features.focus && (
          <div className="today-focus">
            <Focus {...actions} />
          </div>
        )}
        {features.habits && (
          <div className="today-habits">
            <Habits {...actions} compact />
          </div>
        )}
        {features.countdown && (
          <div className="today-countdown">
            <Countdown {...actions} />
          </div>
        )}
        {!allModules && cards}
        {!anyModule && extra.length === 0 && (
          <p className="muted today-empty">
            Every module is switched off. Turn some back on in Settings → Features;
            your data is kept.
          </p>
        )}
      </div>
      {allModules && cards.length > 0 && (
        <div className="dashboard-grid flow today-extras">{cards}</div>
      )}
    </>
  );
}
