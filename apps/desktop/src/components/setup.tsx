'use client';
// The guided setup: a short series of steps shown on a brand-new install (and again from
// Settings). Every step saves through the normal operations, so it can be skipped or left at any
// point and nothing is half-written. Removing the sample data is offered on the first step.
import { useEffect, useId, useRef, useState } from 'react';
import { addDays, key, newSpace } from '@daybar/core';
import { settingsSchema } from '@daybar/core/contracts';
import type { Preferences, Settings } from '@daybar/core/contracts';
import type { Actions } from './modules';
import styles from './setup.module.css';
import { device, isWindows } from '../lib/platform';

const steps = ['Welcome', 'Tasks', 'Countdown', 'Spaces', 'Modules', 'Done'] as const;
type Step = (typeof steps)[number];
const PLACEHOLDER = 'First habit';
const suggestions = ['Work', 'Study', 'Side project', 'Fitness'];
const taskIdeas = ['Read 20 pages', 'Move for 30 minutes', 'Plan tomorrow'];

/** The task list still holds only the starter placeholder. */
export const placeholderTasks = (settings: Settings) =>
  settings.habits.tasks.length === 1 && settings.habits.tasks[0] === PLACEHOLDER;

/** True when the folder holds something besides the blank starter (sample or earlier data). */
export const hasSampleData = (snapshot: Actions['snapshot']) =>
  !snapshot.preferences.realData &&
  (!placeholderTasks(snapshot.settings) ||
    Object.keys(snapshot.dailyLog).length > 0 ||
    snapshot.spaces.spaces.length > 0);

/**
 * The operations that turn `old` into `next` while keeping history: removed tasks are renamed to
 * new ones where possible, the rest archived; then one save sets the order, title and minimum.
 */
export function taskPlan(settings: Settings, next: string[], title: string, dayCompleteMin: number) {
  const old = settings.habits.tasks;
  const removed = old.filter((t) => !next.includes(t));
  const added = next.filter((t) => !old.includes(t));
  const renames = removed.slice(0, added.length).map((from, i) => ({ from, to: added[i] }));
  const archived = removed.slice(added.length);
  const renamed = new Map(renames.map((r) => [r.from, r.to]));
  const thresholds = Object.fromEntries(
    Object.entries(settings.habits.focusThresholds)
      .map(([task, minutes]) => [renamed.get(task) ?? task, minutes] as const)
      .filter(([task]) => next.includes(task))
  );
  const final: Settings = {
    ...settings,
    habits: {
      ...settings.habits,
      title,
      tasks: next,
      archivedTasks: [...settings.habits.archivedTasks, ...archived.filter((t) => !settings.habits.archivedTasks.includes(t))],
      dayCompleteMin: Math.min(Math.max(1, dayCompleteMin), next.length),
      focusThresholds: thresholds
    }
  };
  return { renames, archived, final };
}

export function SetupWizard({
  snapshot,
  now,
  busy,
  run,
  confirm,
  savePreferences,
  onClose
}: Actions & {
  savePreferences: (p: Preferences) => Promise<boolean>;
  /** Closes the wizard for now; it is shown again next launch until finished or skipped. */
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('Welcome');
  const [problem, setProblem] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const s = snapshot.settings;
  const index = steps.indexOf(step);

  // Drafts start from what is saved whenever their step opens, so a reset or a save shows through.
  const [tasks, setTasks] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [minimum, setMinimum] = useState(1);
  const [countdown, setCountdown] = useState(s.countdown);
  const [mainName, setMainName] = useState(snapshot.spaces.main.name);
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [modules, setModules] = useState(() => pickModules(snapshot.preferences));
  const [wake, setWake] = useState(s.sleep.targetWake);
  const [sleepHours, setSleepHours] = useState(s.sleep.sleepHours);
  // Filled while rendering the new step (not in an effect), so the fields are ready in the same
  // commit the step appears and nothing typed into them can be overwritten. Only on step change: a
  // save from elsewhere should not wipe a draft being typed.
  const [shown, setShown] = useState<Step | null>(null);
  if (shown !== step) {
    setShown(step);
    setProblem('');
    if (step === 'Tasks') {
      setTasks(placeholderTasks(s) ? ['', '', ''] : [...s.habits.tasks]);
      setTitle(s.habits.title);
      setMinimum(s.habits.dayCompleteMin);
    }
    if (step === 'Countdown') setCountdown(s.countdown);
    if (step === 'Spaces') {
      setMainName(snapshot.spaces.main.name);
      setPicked([]);
      setCustom('');
    }
    if (step === 'Modules') {
      setModules(pickModules(snapshot.preferences));
      setWake(s.sleep.targetWake);
      setSleepHours(s.sleep.sleepHours);
    }
  }
  useEffect(() => heading.current?.focus(), [step]);

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [onClose]);

  const next = () => setStep(steps[Math.min(index + 1, steps.length - 1)]);
  const back = () => setStep(steps[Math.max(index - 1, 0)]);
  const finish = async () => {
    if (await savePreferences({ ...snapshot.preferences, setupDone: true })) onClose();
  };

  const saveTasks = async () => {
    const names = tasks.map((t) => t.trim()).filter(Boolean);
    if (!names.length) return setProblem('Add at least one task.');
    if (new Set(names).size !== names.length) return setProblem('Each task needs a different name.');
    if (names.some((n) => s.habits.archivedTasks.includes(n)))
      return setProblem('One of those names belongs to an archived task. Pick another.');
    const plan = taskPlan(s, names, title.trim() || s.habits.title, minimum);
    const parsed = settingsSchema.safeParse(plan.final);
    if (!parsed.success) return setProblem(parsed.error.issues[0]?.message ?? 'Check the tasks.');
    for (const r of plan.renames) if (!(await run({ kind: 'rename_task', ...r }))) return;
    for (const task of plan.archived) if (!(await run({ kind: 'archive_task', task }))) return;
    if (await run({ kind: 'save_settings', settings: parsed.data })) next();
  };
  const saveCountdown = async () => {
    const parsed = settingsSchema.safeParse({ ...s, countdown: { ...countdown, title: countdown.title.trim() } });
    if (!parsed.success) return setProblem('Give the countdown a title and an end date after its start.');
    if (await run({ kind: 'save_settings', settings: parsed.data })) next();
  };
  const saveSpaces = async () => {
    const names = [...picked, ...custom.split(',')]
      .map((n) => n.trim())
      .filter((n, i, all) => n && all.indexOf(n) === i)
      .filter((n) => !snapshot.spaces.spaces.some((x) => x.name.toLowerCase() === n.toLowerCase()));
    const main = mainName.trim() || snapshot.spaces.main.name;
    if (!names.length && main === snapshot.spaces.main.name) return next();
    let spaces = { ...snapshot.spaces, main: { ...snapshot.spaces.main, name: main } };
    for (const name of names) {
      if (spaces.spaces.length >= 12) break;
      spaces = { ...spaces, spaces: [...spaces.spaces, newSpace(spaces, name, key(now))] };
    }
    if (await run({ kind: 'save_spaces', spaces })) next();
  };
  const saveModules = async () => {
    const features = { ...snapshot.preferences.features, ...modules };
    if (!(await savePreferences({ ...snapshot.preferences, features }))) return;
    if (modules.sleep && (wake !== s.sleep.targetWake || sleepHours !== s.sleep.sleepHours)) {
      const parsed = settingsSchema.safeParse({ ...s, sleep: { ...s.sleep, targetWake: wake, sleepHours } });
      if (!parsed.success) return setProblem('Check the wake time and hours of sleep.');
      if (!(await run({ kind: 'save_settings', settings: parsed.data }))) return;
    }
    next();
  };
  const clearSample = async () => {
    if (
      await confirm(
        snapshot.preferences.dataFolder.startsWith('Browser memory')
          ? 'Clear the demo data and start from a blank day? It is only in this tab.'
          : 'Clear the sample data and start from a blank day? The old files are moved to a sample-data folder, not deleted.'
      )
    )
      await run({ kind: 'reset_starter' });
  };

  return (
    <div className={styles.backdrop}>
      <dialog open className={styles.dialog} aria-modal="true" aria-labelledby={titleId}>
        <ol className={styles.progress} aria-label="Setup steps">
          {steps.map((name, i) => (
            <li key={name} aria-current={i === index ? 'step' : undefined} data-done={i < index || undefined}>
              <span>{name}</span>
            </li>
          ))}
        </ol>
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {heads[step]}
        </h2>

        {step === 'Welcome' && (
          <div className={styles.body}>
            <p>
              Daybar shows your day in small squares: a short task list, a countdown to something that
              matters, focus time and a sleep rhythm. Setup takes about a minute, and you can change
              everything later in Settings.
            </p>
            {hasSampleData(snapshot) && (
              <div className={styles.callout}>
                <p>
                  {snapshot.preferences.dataFolder.startsWith('Browser memory')
                    ? 'This demo is filled with sample tasks and history.'
                    : `This ${device()} has tasks and history in it already, perhaps sample data from an earlier version.`}{' '}
                  Start blank?
                </p>
                <button type="button" disabled={busy} onClick={() => void clearSample()}>
                  Remove sample data…
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'Tasks' && (
          <div className={styles.body}>
            <p>What do you want to do most days? Keep it short: three to five small things work well.</p>
            <label className={styles.field}>
              List name
              <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className={styles.list}>
              {tasks.map((task, i) => (
                <div key={i} className={styles.row}>
                  <input
                    aria-label={`Task ${i + 1}`}
                    value={task}
                    maxLength={100}
                    placeholder={taskIdeas[i] ?? 'Another task'}
                    onChange={(e) => setTasks((all) => all.map((t, at) => (at === i ? e.target.value : t)))}
                  />
                  <button
                    type="button"
                    aria-label={`Remove task ${i + 1}`}
                    disabled={tasks.length <= 1}
                    onClick={() => setTasks((all) => all.filter((_, at) => at !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.add}
                disabled={tasks.length >= 12}
                onClick={() => setTasks((all) => [...all, ''])}
              >
                Add a task +
              </button>
            </div>
            <label className={styles.field}>
              A day counts as done after
              <span className={styles.inline}>
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, tasks.filter((t) => t.trim()).length)}
                  value={minimum}
                  onChange={(e) => setMinimum(Number(e.target.value) || 1)}
                />
                task(s)
              </span>
            </label>
            <p className={styles.hint}>Tasks can have subtasks too: use the small + next to a task on Today.</p>
          </div>
        )}

        {step === 'Countdown' && (
          <div className={styles.body}>
            <p>Count down to something: a launch, a trip, the end of term. Each square is one day.</p>
            <label className={styles.field}>
              What are you counting down to?
              <input
                value={countdown.title}
                maxLength={120}
                onChange={(e) => setCountdown((c) => ({ ...c, title: e.target.value }))}
              />
            </label>
            <div className={styles.pair}>
              <label className={styles.field}>
                From
                <input
                  type="date"
                  value={countdown.startDate}
                  onChange={(e) => setCountdown((c) => ({ ...c, startDate: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                Until
                <input
                  type="date"
                  value={countdown.endDate}
                  min={countdown.startDate}
                  onChange={(e) => setCountdown((c) => ({ ...c, endDate: e.target.value }))}
                />
              </label>
            </div>
            <div className={styles.chips} role="group" aria-label="Quick lengths">
              {[
                ['30 days', 30],
                ['100 days', 100],
                ['A year', 365]
              ].map(([label, days]) => (
                <button
                  type="button"
                  key={label}
                  onClick={() =>
                    setCountdown((c) => ({ ...c, startDate: key(now), endDate: key(addDays(now, Number(days))) }))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'Spaces' && (
          <div className={styles.body}>
            <p>
              Keep work and personal life apart: each space has its own tasks, countdowns and focus time,
              and the Overview page shows them side by side. You can add spaces later too.
            </p>
            <label className={styles.field}>
              Your first space is called
              <input value={mainName} maxLength={60} onChange={(e) => setMainName(e.target.value)} />
            </label>
            <div className={styles.chips} role="group" aria-label="Add spaces">
              {suggestions
                .filter((n) => !snapshot.spaces.spaces.some((x) => x.name === n))
                .map((name) => (
                  <button
                    type="button"
                    key={name}
                    aria-pressed={picked.includes(name)}
                    onClick={() =>
                      setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]))
                    }
                  >
                    {picked.includes(name) ? '✓ ' : '+ '}
                    {name}
                  </button>
                ))}
            </div>
            <label className={styles.field}>
              Other spaces (comma separated)
              <input value={custom} maxLength={200} placeholder="Freelance, Band" onChange={(e) => setCustom(e.target.value)} />
            </label>
            {snapshot.spaces.spaces.length > 0 && (
              <p className={styles.hint}>Already set up: {snapshot.spaces.spaces.map((x) => x.name).join(', ')}.</p>
            )}
          </div>
        )}

        {step === 'Modules' && (
          <div className={styles.body}>
            <p>Pick what you want to see. Switched-off modules keep their data and can come back any time.</p>
            <div className={styles.toggles}>
              {moduleInfo.map(([id, label, text]) => (
                <label key={id} className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={modules[id]}
                    onChange={(e) => setModules((m) => ({ ...m, [id]: e.target.checked }))}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{text}</small>
                  </span>
                </label>
              ))}
            </div>
            {modules.sleep && (
              <div className={styles.pair}>
                <label className={styles.field}>
                  I want to wake at
                  <input type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
                </label>
                <label className={styles.field}>
                  Hours of sleep
                  <input
                    type="number"
                    min="4"
                    max="12"
                    step="0.5"
                    value={sleepHours}
                    onChange={(e) => setSleepHours(Number(e.target.value) || 8)}
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {step === 'Done' && (
          <div className={styles.body}>
            <p>That is it. A few things you can turn on later:</p>
            <ul className={styles.tips}>
              {isWindows() ? (
                <>
                  <li>
                    <strong>Google Drive.</strong> Settings → On this PC → “Use a Google Drive folder” keeps
                    your data in Google Drive, so your other computers can share it.
                  </li>
                  <li>
                    <strong>Google Calendar and Tasks.</strong> Settings → Features → Deadline Radar shows
                    upcoming events and tasks with a due date once you sign in with Google.
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <strong>Your iPhone.</strong> Settings → On this Mac → “Use my iPhone’s Scriptable folder”
                    shares tasks with the phone widgets.
                  </li>
                  <li>
                    <strong>Calendars.</strong> Settings → Features → Deadline Radar shows upcoming events from
                    the calendars on this Mac (iCloud and any account added there) and, if you sign in, Google
                    Calendar and Google Tasks.
                  </li>
                </>
              )}
              <li>
                <strong>Spaces.</strong> The Overview page shows every space and lets you add more.
              </li>
            </ul>
          </div>
        )}

        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
        <footer className={styles.actions}>
          {step === 'Done' ? (
            <button type="button" className="primary" disabled={busy} onClick={() => void finish()}>
              Start my day ↗
            </button>
          ) : (
            <>
              <button type="button" className={styles.skip} disabled={busy} onClick={() => void finish()}>
                Skip setup
              </button>
              <span className={styles.spacer} />
              {index > 0 && (
                <button type="button" disabled={busy} onClick={back}>
                  ← Back
                </button>
              )}
              {index > 0 && (
                <button type="button" disabled={busy} onClick={next}>
                  Skip step
                </button>
              )}
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  setProblem('');
                  if (step === 'Welcome') next();
                  else if (step === 'Tasks') void saveTasks();
                  else if (step === 'Countdown') void saveCountdown();
                  else if (step === 'Spaces') void saveSpaces();
                  else void saveModules();
                }}
              >
                {step === 'Welcome' ? 'Get started →' : 'Save & continue →'}
              </button>
            </>
          )}
        </footer>
      </dialog>
    </div>
  );
}

const heads: Record<Step, string> = {
  Welcome: 'Welcome to Daybar.',
  Tasks: 'Your daily tasks',
  Countdown: 'A countdown',
  Spaces: 'Spaces for each part of life',
  Modules: 'What to show',
  Done: 'You are set.'
};

type ModuleId = 'countdown' | 'habits' | 'focus' | 'sleep';
const moduleInfo: [ModuleId, string, string][] = [
  ['habits', 'Tasks', 'The daily checklist and its history.'],
  ['countdown', 'Countdown', 'Days left until your date, one square each.'],
  ['focus', 'Focus', 'A timer that counts whole minutes of focus.'],
  ['sleep', 'Sleep', 'Wake and bed times, and how much day is left.']
];
function pickModules(preferences: Preferences): Record<ModuleId, boolean> {
  const f = preferences.features;
  return { habits: f.habits, countdown: f.countdown, focus: f.focus, sleep: f.sleep };
}
