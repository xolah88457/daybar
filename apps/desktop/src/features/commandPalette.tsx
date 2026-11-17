'use client';
// Feature: commandPalette. ⌘K (Ctrl+K off the Mac) opens a keyboard-driven list of actions. It is a
// shell-level `Overlay` (see features/types.ts), so it works from every view. While it is open its
// search box has focus, so the dashboard's number-key shortcuts (which ignore text inputs and open
// <dialog>s) cannot fire.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { doneOn, getSleepView, key } from '@daybar/core';
import { confirmFocusStart } from '../components/modules';
import styles from './commandPalette.module.css';
import type { FeatureOverlayProps } from './types';
import { visibleViews } from './views';

export interface PaletteCommand {
  id: string;
  title: string;
  group: string;
  /** Small right-hand note, such as the current state of a habit. */
  hint?: string;
  /** Extra words that should also match, beyond the title and group. */
  keywords?: string;
  disabled?: boolean;
  run: () => void | Promise<unknown>;
}

export function Config() {
  return (
    <p className={styles.note}>
      Press <kbd>{isMac() ? '⌘' : 'Ctrl'}</kbd> <kbd>K</kbd> anywhere to jump to a view, start a
      focus session, tick a habit, log sleep or change the appearance.
    </p>
  );
}

function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Every action available right now. Actions of a module that is switched off are left out. */
export function buildCommands(
  props: FeatureOverlayProps,
  systemDark: boolean
): PaletteCommand[] {
  const { snapshot, now, busy, run, confirm, navigate, savePreferences } = props;
  const { settings, preferences } = snapshot;
  const features = preferences.features;
  const out: PaletteCommand[] = [];

  for (const v of visibleViews(features))
    out.push({
      id: `go:${v.id}`,
      title: `Go to ${v.label}`,
      group: 'Navigate',
      keywords: `open show view page ${v.description}`,
      run: () => navigate(v.id)
    });

  if (features.focus) {
    const state = snapshot.focus.state;
    if (state) {
      out.push({
        id: 'focus:stop',
        title: 'Stop timer',
        group: 'Focus',
        hint: state.type === 'focus' ? 'Counts whole minutes' : 'Break',
        keywords: 'end cancel finish pause break session',
        disabled: busy,
        run: () => run({ kind: 'stop_timer' })
      });
    } else {
      for (const minutes of settings.focus.focusOptions)
        out.push({
          id: `focus:start:${minutes}`,
          title: `Start focus · ${minutes} min`,
          group: 'Focus',
          keywords: 'begin timer session pomodoro',
          disabled: busy,
          run: async () => {
            // Same no-phone-time check as the Focus view and the global shortcut.
            const view = getSleepView(snapshot.sleep, now, settings);
            if (!(await confirmFocusStart(view, settings.sleep.noPhoneMinutes, confirm))) return;
            await run({ kind: 'start_timer', timerType: 'focus', minutes });
          }
        });
    }
  }

  if (features.habits) {
    const today = key(now);
    const done = doneOn(snapshot.dailyLog, today, settings.habits.tasks);
    for (const task of settings.habits.tasks) {
      const isDone = done.includes(task);
      out.push({
        id: `habit:${task}`,
        title: `Toggle habit · ${task}`,
        group: 'Habits',
        hint: isDone ? 'Done today' : 'Not done today',
        keywords: 'task check tick complete undo',
        disabled: busy,
        run: () => run({ kind: 'set_task', date: today, task, done: !isDone })
      });
    }
  }

  if (features.sleep) {
    out.push(
      {
        id: 'sleep:wake',
        title: 'Log wake now',
        group: 'Sleep',
        keywords: 'woke up morning',
        disabled: busy,
        run: () => run({ kind: 'log_sleep', entry: 'wake', timestamp: now.getTime() })
      },
      {
        id: 'sleep:bed',
        title: 'Log bed now',
        group: 'Sleep',
        keywords: 'bedtime going to bed night',
        disabled: busy,
        run: () => run({ kind: 'log_sleep', entry: 'bed', timestamp: now.getTime() })
      }
    );
  }

  const night =
    preferences.themeMode === 'night' || (preferences.themeMode === 'auto' && systemDark);
  const next = night ? 'day' : 'night';
  out.push(
    {
      id: 'theme:toggle',
      title: `Switch to ${next} appearance`,
      group: 'App',
      keywords: 'theme dark light mode toggle',
      disabled: busy,
      run: () => savePreferences({ ...preferences, themeMode: next })
    },
    {
      id: 'app:updates',
      title: 'Check for updates',
      group: 'App',
      hint: 'Opens Settings',
      keywords: 'upgrade version release',
      run: () => navigate('Settings')
    }
  );
  return out;
}

const wordStart = (text: string, at: number) => at === 0 || !/[a-z0-9]/.test(text[at - 1]);
/** Score of one query word against `text` (both lower case); negative when it does not match. */
function scoreToken(token: string, text: string, allowFuzzy: boolean): number {
  const at = text.indexOf(token);
  if (at >= 0) return (wordStart(text, at) ? 100 : 60) - Math.min(at, 40) * 0.1;
  if (!allowFuzzy || token.length < 2) return -1;
  // Letters in order, anywhere ("gth" finds "Go to Habits"); tighter runs rank higher.
  let from = 0;
  let first = -1;
  for (const ch of token) {
    from = text.indexOf(ch, from);
    if (from < 0) return -1;
    if (first < 0) first = from;
    from++;
  }
  return Math.max(1, 30 - (from - first - token.length));
}

/** Commands matching `query` (every word must match), best match first; all of them when empty. */
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return commands;
  const scored: { command: PaletteCommand; score: number; order: number }[] = [];
  commands.forEach((command, order) => {
    const title = command.title.toLowerCase();
    const rest = `${command.group} ${command.hint ?? ''} ${command.keywords ?? ''}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      const best = Math.max(scoreToken(token, title, true), scoreToken(token, rest, false) * 0.5);
      if (best < 0) return;
      score += best;
    }
    scored.push({ command, score, order });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((s) => s.command);
}

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Overlay(props: FeatureOverlayProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const returnTo = useRef<Element | null>(null);
  const id = useId();
  const listId = `${id}-list`;

  // ⌘K (Ctrl+K elsewhere) toggles the palette. Registered in the capture phase so it wins over
  // page handlers, and it works from inside text fields: no text input uses ⌘K itself.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || event.altKey || event.shiftKey || event.isComposing) return;
      const chord = event.metaKey || (event.ctrlKey && !isMac());
      if (!chord) return;
      const modal = document.querySelector('dialog[open]');
      if (modal && modal !== dialog.current) return; // a confirmation is already waiting for an answer
      event.preventDefault();
      if (event.repeat) return;
      setOpen((was) => {
        if (!was) returnTo.current = document.activeElement;
        return !was;
      });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    input.current?.focus();
  }, [open]);

  const systemDark =
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const commands = useMemo(
    () => (open ? buildCommands(props, systemDark) : []),
    // `props` changes identity every second with the clock; the palette only needs fresh data when
    // it is open, and rebuilding a few dozen entries is cheap.
    [open, props.snapshot, props.now, props.busy, props.run, props.confirm, props.navigate, props.savePreferences, systemDark]
  );
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [current, results]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    const back = returnTo.current;
    returnTo.current = null;
    if (back instanceof HTMLElement) back.focus();
  };
  const execute = (command: PaletteCommand | undefined) => {
    if (!command || command.disabled) return;
    close();
    void command.run();
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        if (results.length) setActive((current + step + results.length) % results.length);
        break;
      }
      case 'Home':
      case 'End':
        // Keep the caret keys for editing the query unless it is empty.
        if (!query) {
          event.preventDefault();
          setActive(event.key === 'Home' ? 0 : Math.max(0, results.length - 1));
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (!event.nativeEvent.isComposing) execute(results[current]);
        break;
      case 'Tab': {
        // Focus trap: Tab cycles through the dialog's own controls only.
        const items = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        if (!items.length) break;
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
        event.preventDefault();
        items[next].focus();
        break;
      }
    }
  };

  return (
    <>
      <div className={styles.backdrop} aria-hidden="true" onClick={close} />
      <dialog
        ref={dialog}
        open
        className={styles.palette}
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
      >
        <div className={styles.top}>
          <span className={styles.glyph} aria-hidden="true">⌘</span>
          <input
            ref={input}
            className={styles.input}
            type="text"
            role="combobox"
            aria-label="Search commands"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length ? `${id}-opt-${current}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder="Type a command…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
          <button type="button" className={styles.close} onClick={close} aria-label="Close command palette">
            esc
          </button>
        </div>
        {results.length ? (
          <ul ref={list} id={listId} role="listbox" aria-label="Commands" className={styles.list}>
            {results.map((command, i) => (
              <li
                key={command.id}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === current}
                aria-disabled={command.disabled || undefined}
                className={styles.option}
                onMouseMove={() => i !== current && setActive(i)}
                onClick={() => execute(command)}
              >
                <span className={styles.title}>{command.title}</span>
                <span className={styles.meta}>
                  {command.hint && <span>{command.hint}</span>}
                  <span>{command.group}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p id={listId} className={styles.empty}>No matching commands.</p>
        )}
        <div className={styles.footer} aria-hidden="true">
          <span>↑↓ choose</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
        <span className={styles.hidden} role="status">
          {results.length === 1 ? '1 command' : `${results.length} commands`}
        </span>
      </dialog>
    </>
  );
}
