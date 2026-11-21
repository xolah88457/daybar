'use client';
// The daily task checklist, shared by the main space (Habits, Today) and every other space.
// A task can carry subtasks. They stay collapsed behind a small "1/3" toggle so the list stays
// short; ticking every subtask ticks the task, and ticking the task ticks them all.
import { useId, useState } from 'react';
import { doneOn, subtaskMap, subtasksDone, withSubtasks } from '@daybar/core';
import { SUBTASK_SEPARATOR } from '@daybar/core/contracts';
import type { DailyLog } from '@daybar/core/contracts';
import type { Actions } from './modules';
import styles from './checklist.module.css';

export function Checklist({
  snapshot,
  busy,
  run,
  date,
  tasks,
  log,
  space
}: Pick<Actions, 'snapshot' | 'busy' | 'run'> & {
  date: string;
  tasks: string[];
  log: DailyLog;
  /** Space id; undefined is the main space. */
  space?: string;
}) {
  const done = doneOn(log, date, tasks);
  const subtasks = subtaskMap(snapshot.spaces, space);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (task: string) => setOpen((o) => ({ ...o, [task]: !o[task] }));
  const where = space ? { space } : {};
  return (
    <div className="checklist">
      {tasks.map((task, i) => {
        const subs = subtasks[task] ?? [];
        const subsDone = subtasksDone(log, date, task, subs);
        const expanded = !!open[task];
        return (
          <div className={styles.item} key={task}>
            <div className={styles.line}>
              <label className={`check-row ${done.includes(task) ? 'checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={done.includes(task)}
                  disabled={busy}
                  onChange={(e) =>
                    void run({ kind: 'set_task', date, task, done: e.target.checked, ...where })
                  }
                />
                <span>{task}</span>
                <small>{String(i + 1).padStart(2, '0')}</small>
              </label>
              <button
                type="button"
                className={`${styles.toggle} ${subs.length ? styles.count : styles.add}`}
                aria-expanded={expanded}
                aria-label={
                  subs.length
                    ? `${expanded ? 'Hide' : 'Show'} subtasks of ${task}, ${subsDone.length} of ${subs.length} done`
                    : `Add subtasks to ${task}`
                }
                title={subs.length ? 'Subtasks' : 'Add subtasks'}
                onClick={() => toggle(task)}
              >
                {subs.length ? (
                  <>
                    <span aria-hidden="true" className={expanded ? styles.open : undefined}>
                      ▸
                    </span>
                    {subsDone.length}/{subs.length}
                  </>
                ) : (
                  <span aria-hidden="true">+</span>
                )}
              </button>
            </div>
            {expanded && (
              <Subtasks
                task={task}
                subs={subs}
                done={subsDone}
                busy={busy}
                onTick={(subtask, value) =>
                  void run({ kind: 'set_subtask', date, task, subtask, done: value, ...where })
                }
                onChange={(next) =>
                  run({ kind: 'save_spaces', spaces: withSubtasks(snapshot.spaces, space, task, next) })
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Subtasks({
  task,
  subs,
  done,
  busy,
  onTick,
  onChange
}: {
  task: string;
  subs: string[];
  done: string[];
  busy: boolean;
  onTick: (subtask: string, done: boolean) => void;
  onChange: (next: string[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState('');
  const inputId = useId();
  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    if (subs.includes(name)) return setProblem('That subtask already exists.');
    if ((task + SUBTASK_SEPARATOR + name).length > 120)
      return setProblem('Too long: the task and subtask together must fit 120 characters.');
    if (subs.length >= 30) return setProblem('A task can have at most 30 subtasks.');
    setProblem('');
    if (await onChange([...subs, name])) setDraft('');
  };
  return (
    <div className={styles.subtasks} role="group" aria-label={`Subtasks of ${task}`}>
      {subs.map((sub) => (
        <div className={styles.subRow} key={sub}>
          <label className={done.includes(sub) ? styles.subDone : undefined}>
            <input
              type="checkbox"
              checked={done.includes(sub)}
              disabled={busy}
              onChange={(e) => onTick(sub, e.target.checked)}
            />
            <span>{sub}</span>
          </label>
          <button
            type="button"
            className={styles.remove}
            disabled={busy}
            aria-label={`Remove subtask ${sub}`}
            title="Remove (ticks already logged stay in history)"
            onClick={() => void onChange(subs.filter((s) => s !== sub))}
          >
            ×
          </button>
        </div>
      ))}
      <form
        className={styles.addRow}
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label htmlFor={inputId} className={styles.hidden}>
          New subtask for {task}
        </label>
        <input
          id={inputId}
          value={draft}
          maxLength={117}
          placeholder="Add a subtask…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button disabled={busy || !draft.trim()}>Add</button>
      </form>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
