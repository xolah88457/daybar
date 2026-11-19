'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getUpdateStore } from '../lib/updates';
import type { UpdaterClient } from '../lib/updates';
import { Progress, Section } from './primitives';

const megabytes = (bytes: number) => (bytes / 1_048_576).toFixed(1);

export function UpdatesPanel({
  updater,
  busy,
  hasUnsavedChanges,
  confirm
}: {
  updater: UpdaterClient;
  busy: boolean;
  hasUnsavedChanges: () => boolean;
  confirm: (message: string) => Promise<boolean>;
}) {
  // The state machine lives outside this component so a download keeps its
  // progress, and Restart stays available, while Settings is not on screen.
  const store = getUpdateStore(updater);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState
  );
  const [version, setVersion] = useState<string | null>(null);
  const working =
    state.kind === 'checking' ||
    state.kind === 'downloading' ||
    state.kind === 'restarting';
  useEffect(() => {
    let alive = true;
    // Reads the local app version only; no network.
    updater
      .version()
      .then((v) => alive && setVersion(v))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [updater]);
  const canRestart =
    state.kind === 'ready' ||
    (state.kind === 'error' && state.retry === 'restart');
  const restart = async () => {
    if (!canRestart || busy) return;
    if (
      hasUnsavedChanges() &&
      !(await confirm(
        'You have unsaved changes in Settings. Restarting will discard them. Restart now?'
      ))
    )
      return;
    await store.restart();
  };
  const percent =
    state.kind === 'downloading' && state.progress?.total
      ? Math.min(1, state.progress.downloaded / state.progress.total)
      : null;
  const info = 'info' in state ? state.info : undefined;
  const released =
    info?.date && !Number.isNaN(Date.parse(info.date))
      ? new Date(info.date).toLocaleDateString([], { dateStyle: 'medium' })
      : '';
  return (
    <Section
      title="Updates"
      collapsible
      aside={<span className="tag">ONLY WHEN YOU ASK</span>}
    >
      <div className="updates">
        <p className="muted">
          {version ? `Version ${version}` : 'Version unknown'}
        </p>
        {!updater.supported ? (
          <p className="caption">
            Updates are available in the desktop app. This browser demo never
            checks for them.
          </p>
        ) : (
          <>
            <p className="update-status" role="status" aria-live="polite">
              {state.kind === 'checking' && 'Checking for updates…'}
              {state.kind === 'current' &&
                `You’re up to date${version ? ` (v${version})` : ''}.`}
              {state.kind === 'downloading' &&
                `Downloading Daybar ${state.info.version}…`}
              {state.kind === 'ready' &&
                `Daybar ${state.info.version} is ready. Restart to finish updating.`}
              {state.kind === 'restarting' && 'Restarting…'}
            </p>
            {state.kind === 'error' && (
              <div className="notice error" role="alert">
                <strong>Update did not finish.</strong>
                <p>{state.message}</p>
              </div>
            )}
            {info && state.kind !== 'error' && (
              <div className="release">
                <strong>
                  Daybar {info.version}
                  {released && ` · ${released}`}
                </strong>
                {info.notes.trim() && (
                  <pre
                    className="release-notes"
                    tabIndex={0}
                    aria-label="Release notes"
                  >
                    {info.notes.trim()}
                  </pre>
                )}
              </div>
            )}
            {state.kind === 'downloading' && (
              <div className="update-progress">
                {percent !== null ? (
                  <>
                    <Progress
                      value={percent}
                      color="var(--green)"
                      label="Download progress"
                    />
                    <small>{Math.round(percent * 100)}%</small>
                  </>
                ) : (
                  <small>
                    {state.progress
                      ? `${megabytes(state.progress.downloaded)} MB downloaded…`
                      : 'Starting download…'}
                  </small>
                )}
              </div>
            )}
            {(state.kind === 'ready' || state.kind === 'restarting') && (
              <p className="caption">
                Your data is saved on disk, and a running focus timer keeps its
                time through the restart.
              </p>
            )}
            <div className="button-row">
              {canRestart || state.kind === 'restarting' ? (
                <button
                  className="primary"
                  disabled={busy || state.kind === 'restarting'}
                  onClick={() => void restart()}
                >
                  Restart now
                </button>
              ) : (
                <button disabled={working} onClick={() => void store.check()}>
                  {state.kind === 'error' ? 'Try again' : 'Check for updates'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
