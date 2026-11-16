'use client';
import { useEffect, useRef, useState } from 'react';
import type { UpdateInfo, UpdateProgress, UpdaterClient } from '../lib/updates';
import { Progress, Section } from './primitives';

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'downloading'; info: UpdateInfo; progress: UpdateProgress | null }
  | { kind: 'ready'; info: UpdateInfo }
  | { kind: 'restarting'; info: UpdateInfo }
  | { kind: 'error'; message: string; info?: UpdateInfo };

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
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [version, setVersion] = useState<string | null>(null);
  const alive = useRef(true);
  const working =
    state.kind === 'checking' ||
    state.kind === 'downloading' ||
    state.kind === 'restarting';
  useEffect(() => {
    alive.current = true;
    // Reads the local app version only; no network.
    updater
      .version()
      .then((v) => alive.current && setVersion(v))
      .catch(() => undefined);
    return () => {
      alive.current = false;
    };
  }, [updater]);
  const update = (next: State) => {
    if (alive.current) setState(next);
  };
  const check = async () => {
    if (working) return;
    update({ kind: 'checking' });
    let info: UpdateInfo | null;
    try {
      info = await updater.check();
    } catch {
      update({
        kind: 'error',
        message:
          'Could not check for updates. Make sure you are online, then try again.'
      });
      return;
    }
    if (!info) {
      update({ kind: 'current' });
      return;
    }
    update({ kind: 'downloading', info, progress: null });
    try {
      await updater.downloadAndInstall((progress) => {
        if (alive.current)
          setState((s) => (s.kind === 'downloading' ? { ...s, progress } : s));
      });
      update({ kind: 'ready', info });
    } catch {
      update({
        kind: 'error',
        info,
        message: `Could not download or install Daybar ${info.version}. Nothing was changed; try again in a moment.`
      });
    }
  };
  const restart = async () => {
    if (state.kind !== 'ready' || busy) return;
    const info = state.info;
    if (
      hasUnsavedChanges() &&
      !(await confirm(
        'You have unsaved changes in Settings. Restarting will discard them. Restart now?'
      ))
    )
      return;
    update({ kind: 'restarting', info });
    try {
      await updater.restart();
    } catch {
      update({
        kind: 'error',
        info,
        message: `Daybar ${info.version} is installed, but it could not restart itself. Quit and reopen Daybar to finish updating.`
      });
    }
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
              {state.kind === 'ready' || state.kind === 'restarting' ? (
                <button
                  className="primary"
                  disabled={busy || state.kind === 'restarting'}
                  onClick={() => void restart()}
                >
                  Restart now
                </button>
              ) : (
                <button disabled={working} onClick={() => void check()}>
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
