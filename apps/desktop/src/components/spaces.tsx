'use client';
// Spaces: separate task lists (with their own countdowns and focus time) for parts of life such
// as work and personal. The main space is the existing shared settings and log, so the phone keeps
// working; every other space lives in daybar-spaces.json and its own daily-log file.
//   Overview  - one card per space with today's progress, streak, focus and nearest countdown
//   SpacePage - one space: its checklist and history, countdowns, focus and an editor
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  addDays,
  focusBySpace,
  getSleepView,
  key,
  MAIN_SPACE,
  newSpace,
  spaceSummaries,
  startOfDay
} from '@daybar/core';
import { spacesFileSchema } from '@daybar/core/contracts';
import type { ExtraCountdown, Space, SpacesFile } from '@daybar/core/contracts';
import { countdownProgress } from '../features/extraCountdowns';
import { type Actions, confirmFocusStart, Habits } from './modules';
import { Progress, Section, TimerDisplay } from './primitives';
import styles from './spaces.module.css';

const MAX_SPACES = 12;

export type SpaceActions = Actions & { navigate: (viewId: string) => void };

/** Sidebar id of a space's page. */
export const spaceViewId = (id: string) => `space:${id}`;

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function minutes(n: number) {
  return n >= 60 ? `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, '0')}m` : `${n}m`;
}

export function Overview(props: SpaceActions) {
  const { snapshot, now, navigate } = props;
  const rows = useMemo(() => spaceSummaries(snapshot, now), [snapshot, now]);
  const features = snapshot.preferences.features;
  const total = rows.reduce(
    (t, r) => ({
      done: t.done + r.todayDone,
      tasks: t.tasks + r.tasks,
      focus: t.focus + r.focusToday,
      week: t.week + r.focusWeek
    }),
    { done: 0, tasks: 0, focus: 0, week: 0 }
  );
  const mainPage = features.habits ? 'Habits' : 'Today';
  return (
    <div className="stack">
      <div className={styles.totals} role="group" aria-label="All spaces today">
        <div>
          <span>Tasks today</span>
          <strong>
            {total.done}
            <small> / {total.tasks}</small>
          </strong>
        </div>
        <div>
          <span>Focus today</span>
          <strong>{minutes(total.focus)}</strong>
        </div>
        <div>
          <span>Focus, 7 days</span>
          <strong>{minutes(total.week)}</strong>
        </div>
        <div>
          <span>Spaces</span>
          <strong>{rows.length}</strong>
        </div>
      </div>
      <div className={styles.cards}>
        {rows.map((row) => (
          <article
            key={row.id}
            className={styles.card}
            style={{ '--space': row.color } as CSSProperties}
            data-space={row.id}
          >
            <header className={styles.cardHead}>
              <h2>
                <i aria-hidden="true" />
                {row.name}
              </h2>
              {row.running && <span className="tag green">FOCUSING</span>}
            </header>
            <p className={styles.cardTitle}>{row.title}</p>
            <div className={styles.today}>
              <strong>
                {row.todayDone}
                <small> / {row.tasks} today</small>
              </strong>
              <span>{row.tasks ? Math.round((row.todayDone / row.tasks) * 100) : 0}%</span>
            </div>
            <Progress
              value={row.tasks ? row.todayDone / row.tasks : 0}
              color="var(--space)"
              label={`${row.name}: ${row.todayDone} of ${row.tasks} tasks done today`}
            />
            <dl className={styles.facts}>
              {row.subtasksTotal > 0 && (
                <div>
                  <dt>Subtasks</dt>
                  <dd>
                    {row.subtasksDone} / {row.subtasksTotal}
                  </dd>
                </div>
              )}
              <div>
                <dt>Streak</dt>
                <dd>{row.currentStreak}d</dd>
              </div>
              <div>
                <dt>Rate</dt>
                <dd>{row.percent}%</dd>
              </div>
              <div>
                <dt>Focus</dt>
                <dd>
                  {minutes(row.focusToday)} · {minutes(row.focusWeek)}/wk
                </dd>
              </div>
            </dl>
            {row.countdown && (
              <p className={styles.countdown}>
                <span>{row.countdown.title}</span>
                <span>{plural(row.countdown.daysLeft, 'day')} left</span>
              </p>
            )}
            <button
              type="button"
              className={styles.open}
              onClick={() => navigate(row.id === MAIN_SPACE ? mainPage : spaceViewId(row.id))}
            >
              Open {row.name} →
            </button>
          </article>
        ))}
      </div>
      <NewSpace {...props} />
      <MainSpaceEditor {...props} />
    </div>
  );
}

function NewSpace({ snapshot, now, busy, run, navigate }: SpaceActions) {
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const full = snapshot.spaces.spaces.length >= MAX_SPACES;
  return (
    <Section title="New space" aside={<span className="tag">WORK · SIDE PROJECT · STUDY</span>}>
      <p className="caption">
        A space has its own task list, history, countdowns and focus time. Sleep stays shared. Spaces
        live on this Mac and in your shared folder; the phone widgets keep showing your{' '}
        {snapshot.spaces.main.name} space.
      </p>
      <form
        className="button-row"
        onSubmit={async (e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          if (snapshot.spaces.spaces.some((s) => s.name.toLowerCase() === trimmed.toLowerCase()))
            return setProblem('A space with that name already exists.');
          setProblem('');
          const space = newSpace(snapshot.spaces, trimmed, key(now));
          const next = { ...snapshot.spaces, spaces: [...snapshot.spaces.spaces, space] };
          if (await run({ kind: 'save_spaces', spaces: next })) {
            setName('');
            navigate(spaceViewId(space.id));
          }
        }}
      >
        <label className="inline-field">
          Name
          <input
            value={name}
            maxLength={60}
            placeholder="Work"
            disabled={busy || full}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy || full || !name.trim()}>
          Create space +
        </button>
        <span className="muted">
          {snapshot.spaces.spaces.length + 1} / {MAX_SPACES + 1}
        </span>
      </form>
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}
    </Section>
  );
}

function MainSpaceEditor({ snapshot, busy, run }: SpaceActions) {
  const main = snapshot.spaces.main;
  const [name, setName] = useState(main.name);
  const [color, setColor] = useState(main.color);
  useEffect(() => {
    setName(main.name);
    setColor(main.color);
  }, [main.name, main.color]);
  const dirty = name.trim() !== main.name || color !== main.color;
  return (
    <Section title={`${main.name} space`} collapsible aside={<span className="tag">SHARED WITH PHONE</span>}>
      <p className="caption">
        Your first space uses the shared settings: its tasks are edited in Settings, and its countdown
        and focus are the ones the phone shows.
      </p>
      <form
        className="button-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void run({
            kind: 'save_spaces',
            spaces: { ...snapshot.spaces, main: { ...main, name: name.trim(), color } }
          });
        }}
      >
        <label className="inline-field">
          Name
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="inline-field">
          Colour
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <button disabled={busy || !dirty || !name.trim()}>Save</button>
      </form>
    </Section>
  );
}

export function SpacePage(props: SpaceActions & { space: string }) {
  const { snapshot, space: id } = props;
  const space = snapshot.spaces.spaces.find((s) => s.id === id);
  if (!space) return <p className="muted">This space no longer exists.</p>;
  return (
    <div className="stack" style={{ '--space': space.color } as CSSProperties}>
      <Habits {...props} space={space.id} />
      <div className={styles.split}>
        <SpaceFocus {...props} space={space} />
        <SpaceCountdowns {...props} space={space} />
      </div>
      <SpaceEditor key={space.id} {...props} space={space} />
    </div>
  );
}

function SpaceFocus({ snapshot, now, busy, run, confirm, space }: SpaceActions & { space: Space }) {
  const s = snapshot.settings;
  const [task, setTask] = useState('');
  const state = snapshot.focus.state;
  const running = state ? snapshot.spaces.focus[String(state.start)]?.space : undefined;
  const ours = !!state && running === space.id;
  const focus = snapshot.focus;
  const today = key(now);
  const totals = useMemo(() => {
    const day = focusBySpace(focus, snapshot.spaces, today, today)[space.id] ?? 0;
    const week = focusBySpace(focus, snapshot.spaces, key(addDays(now, -6)), today)[space.id] ?? 0;
    return { day, week };
  }, [focus, snapshot.spaces, space.id, today, now]);
  const start = async (minutes: number) => {
    if (
      !(await confirmFocusStart(
        getSleepView(snapshot.sleep, now, s),
        s.sleep.noPhoneMinutes,
        confirm,
        snapshot.preferences.features.sleep
      ))
    )
      return;
    void run({ kind: 'start_timer', timerType: 'focus', minutes, space: space.id, ...(task ? { task } : {}) });
  };
  const otherName =
    running && running !== space.id
      ? (snapshot.spaces.spaces.find((x) => x.id === running)?.name ?? snapshot.spaces.main.name)
      : snapshot.spaces.main.name;
  return (
    <Section
      title={`${space.name} focus`}
      aside={<span className={`tag ${ours ? 'green' : ''}`}>{ours ? 'IN PROGRESS' : state ? 'TIMER BUSY' : 'READY'}</span>}
    >
      {ours ? (
        <>
          <TimerDisplay state={state} now={now} idleMinutes={s.focus.focusOptions[0]} />
          <button className="stop-button" disabled={busy} onClick={() => void run({ kind: 'stop_timer' })}>
            Stop &amp; count whole minutes <span>■</span>
          </button>
        </>
      ) : state ? (
        <p className="caption">
          A {state.type === 'focus' ? 'focus session' : 'break'} is running
          {state.type === 'focus' ? ` in ${otherName}` : ''}. One timer runs at a time; stop it on the Focus page
          first.
        </p>
      ) : (
        <>
          <label className="inline-field">
            Link a task
            <select value={task} onChange={(e) => setTask(e.target.value)}>
              <option value="">No task tag</option>
              {space.habits.tasks.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <div className="presets">
            <span>Focus</span>
            {s.focus.focusOptions.map((m, i) => (
              <button className="primary" key={i} disabled={busy} onClick={() => void start(m)}>
                {m} min
              </button>
            ))}
          </div>
        </>
      )}
      <div className="spread caption">
        <span>Today {minutes(totals.day)}</span>
        <span>Last 7 days {minutes(totals.week)}</span>
      </div>
    </Section>
  );
}

function SpaceCountdowns({ snapshot, now, space }: SpaceActions & { space: Space }) {
  return (
    <Section title="Countdowns" aside={<span className="tag">{space.countdowns.length} TRACKED</span>}>
      {space.countdowns.length === 0 ? (
        <p className="caption">No countdowns yet. Add a deadline below, under “Edit space”.</p>
      ) : (
        <div className={styles.countdowns}>
          {space.countdowns.map((item) => {
            const p = countdownProgress(item, snapshot.settings, now);
            return (
              <div key={item.id} className={styles.countdownItem}>
                <div className="spread">
                  <strong>{item.title}</strong>
                  <span className="muted">
                    {p.finished
                      ? 'Finished'
                      : p.startsIn > 0
                        ? `Starts in ${plural(p.startsIn, 'day')}`
                        : `${plural(p.daysLeft, 'day')} left`}
                  </span>
                </div>
                <Progress value={p.percent / 100} color="var(--space)" label={`${item.title}: ${p.percent}% elapsed`} />
                <p className="caption">
                  {item.startDate} → {item.endDate} · {p.percent}%
                </p>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function newCountdownId(taken: Set<string>) {
  let n = taken.size + 1;
  while (taken.has(`c${n}`)) n++;
  return `c${n}`;
}

function SpaceEditor({ snapshot, busy, run, confirm, navigate, space }: SpaceActions & { space: Space }) {
  const [draft, setDraft] = useState(space);
  const [newTask, setNewTask] = useState('');
  const [rename, setRename] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const savedKey = JSON.stringify(space);
  useEffect(() => {
    setDraft(space);
    setProblem('');
  }, [savedKey]);
  const dirty = JSON.stringify(draft) !== savedKey;
  const withSpace = (next: Space): SpacesFile => ({
    ...snapshot.spaces,
    spaces: snapshot.spaces.spaces.map((s) => (s.id === space.id ? next : s))
  });
  const check = useMemo(() => spacesFileSchema.safeParse(withSpace(draft)), [draft, snapshot.spaces]);
  const edit = (patch: Partial<Space>) => setDraft((d) => ({ ...d, ...patch }));
  const habits = (patch: Partial<Space['habits']>) => setDraft((d) => ({ ...d, habits: { ...d.habits, ...patch } }));
  const countdown = (index: number, patch: Partial<ExtraCountdown>) =>
    edit({ countdowns: draft.countdowns.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  const issue = check.success ? '' : (check.error.issues[0]?.message ?? 'Check the fields.');
  const where = { space: space.id };
  return (
    <Section title={`Edit ${space.name}`} collapsible aside={<span className="tag">ARCHIVE, NEVER ERASE</span>}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!check.success) return setProblem(issue);
          setProblem('');
          void run({ kind: 'save_spaces', spaces: withSpace(draft) });
        }}
      >
        <fieldset disabled={busy} className={styles.fields}>
          <label>
            Name
            <input value={draft.name} maxLength={60} required onChange={(e) => edit({ name: e.target.value })} />
          </label>
          <label>
            Colour
            <input type="color" value={draft.color} onChange={(e) => edit({ color: e.target.value })} />
          </label>
          <label>
            List title
            <input
              value={draft.habits.title}
              maxLength={120}
              required
              onChange={(e) => habits({ title: e.target.value })}
            />
          </label>
          <label>
            Tasks that complete a day
            <input
              type="number"
              min="1"
              max={draft.habits.tasks.length}
              value={draft.habits.dayCompleteMin}
              onChange={(e) => habits({ dayCompleteMin: Number(e.target.value) || 1 })}
            />
          </label>
          <label>
            Started
            <input
              type="date"
              value={draft.habits.startDate}
              required
              onChange={(e) => habits({ startDate: e.target.value })}
            />
          </label>
          <label>
            Ends (optional)
            <input
              type="date"
              value={draft.habits.endDate}
              min={draft.habits.startDate}
              onChange={(e) => habits({ endDate: e.target.value })}
            />
          </label>
        </fieldset>
        <h3 className={styles.subhead}>Countdowns</h3>
        <fieldset disabled={busy} className={styles.countdownFields}>
          {draft.countdowns.map((c, i) => (
            <div key={c.id} className={styles.countdownRow}>
              <input
                aria-label={`Title of countdown ${i + 1}`}
                value={c.title}
                maxLength={120}
                onChange={(e) => countdown(i, { title: e.target.value })}
              />
              <input
                aria-label={`Start of ${c.title || `countdown ${i + 1}`}`}
                type="date"
                value={c.startDate}
                onChange={(e) => countdown(i, { startDate: e.target.value })}
              />
              <input
                aria-label={`End of ${c.title || `countdown ${i + 1}`}`}
                type="date"
                value={c.endDate}
                min={c.startDate}
                onChange={(e) => countdown(i, { endDate: e.target.value })}
              />
              <button
                type="button"
                className="subtle-danger"
                aria-label={`Remove ${c.title || `countdown ${i + 1}`}`}
                onClick={() => edit({ countdowns: draft.countdowns.filter((_, at) => at !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={draft.countdowns.length >= 12}
            onClick={() => {
              const today = startOfDay(new Date());
              edit({
                countdowns: [
                  ...draft.countdowns,
                  {
                    id: newCountdownId(new Set(draft.countdowns.map((c) => c.id))),
                    title: 'Deadline',
                    startDate: key(today),
                    endDate: key(addDays(today, 30))
                  }
                ]
              });
            }}
          >
            Add countdown
          </button>
        </fieldset>
        {(problem || (dirty && issue)) && (
          <p className="form-error" role="alert">
            {problem || issue}
          </p>
        )}
        <div className="button-row">
          <button className="primary" disabled={busy || !dirty || !check.success}>
            Save {space.name} ↗
          </button>
          <button type="button" disabled={busy || !dirty} onClick={() => setDraft(space)}>
            Reset draft
          </button>
        </div>
      </form>

      <h3 className={styles.subhead}>Tasks, with their history</h3>
      <p className="caption">
        Renames carry past checks and subtasks. Archived tasks stay in the log but no longer count.
      </p>
      <fieldset disabled={busy || dirty} className="task-manager">
        {dirty && <p className="caption">Save or reset the draft above before managing tasks.</p>}
        {space.habits.tasks.map((task) => (
          <div className="task-edit" key={task}>
            <label>
              {task}
              <input
                aria-label={`New name for ${task}`}
                value={rename[task] ?? task}
                maxLength={120}
                onChange={(e) => setRename((r) => ({ ...r, [task]: e.target.value }))}
              />
            </label>
            <button
              type="button"
              disabled={!rename[task]?.trim() || rename[task].trim() === task}
              onClick={async () => {
                const to = rename[task].trim();
                if (await confirm(`Rename “${task}” to “${to}” across all of ${space.name}'s history?`))
                  void run({ kind: 'rename_task', from: task, to, ...where });
              }}
            >
              Rename…
            </button>
            <button
              type="button"
              className="subtle-danger"
              disabled={space.habits.tasks.length <= 1}
              onClick={async () => {
                if (
                  await confirm(
                    `Archive “${task}”? History is kept, but it will no longer count toward ${space.name}'s days.`
                  )
                )
                  void run({ kind: 'archive_task', task, ...where });
              }}
            >
              Archive…
            </button>
          </div>
        ))}
        <form
          className="button-row"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newTask.trim();
            if (!name || [...space.habits.tasks, ...space.habits.archivedTasks].includes(name))
              return setProblem('Choose a new, unique task name.');
            if (space.habits.tasks.length >= 50) return setProblem('A space can have at most 50 tasks.');
            setProblem('');
            const next = { ...space, habits: { ...space.habits, tasks: [...space.habits.tasks, name] } };
            void run({ kind: 'save_spaces', spaces: withSpace(next) }).then((ok) => {
              if (ok) setNewTask('');
            });
          }}
        >
          <label className="inline-field">
            New task
            <input required maxLength={120} value={newTask} onChange={(e) => setNewTask(e.target.value)} />
          </label>
          <button>Add task +</button>
        </form>
        {space.habits.archivedTasks.length > 0 && (
          <p className="caption">Archived, history preserved: {space.habits.archivedTasks.join(', ')}</p>
        )}
      </fieldset>

      <div className={styles.danger}>
        <button
          type="button"
          className="subtle-danger"
          disabled={busy}
          onClick={async () => {
            if (
              !(await confirm(
                `Remove the ${space.name} space? Its history file (daily-log-${space.habits.logId}.json) stays in your folder, and creating a space with the same name brings it back.`
              ))
            )
              return;
            const next = { ...snapshot.spaces, spaces: snapshot.spaces.spaces.filter((s) => s.id !== space.id) };
            if (await run({ kind: 'save_spaces', spaces: next })) navigate('Overview');
          }}
        >
          Remove space…
        </button>
      </div>
    </Section>
  );
}
