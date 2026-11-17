'use client';
import { useMemo, useState } from 'react';
import {
  atMinutes,
  baseline,
  doneOn,
  fmtDuration,
  getCountdown,
  getHabitGrid,
  getHabitStats,
  getPlanNights,
  getSleepView,
  key,
  normalizeFocus,
  parseKey,
  planDays,
  recentAvg,
  roomForBlocks,
  signedDiff,
  toMin,
  wrap
} from '@daybar/core';
import type { Operation, Snapshot } from '@daybar/core/contracts';
import { AwayBanner } from '../features/awayDetection';
import {
  Blocks,
  clock,
  Heatmap,
  Progress,
  Section,
  Stats,
  TimerDisplay,
  useWidth
} from './primitives';

export type Actions = {
  snapshot: Snapshot;
  now: Date;
  busy: boolean;
  run: (op: Operation) => Promise<boolean>;
  confirm: (message: string) => Promise<boolean>;
};
// True unless it is no-phone time and the user declines to start a focus session anyway.
// With the Sleep module off there is no bedtime, so there is nothing to confirm.
export async function confirmFocusStart(
  view: ReturnType<typeof getSleepView>,
  noPhoneMinutes: number,
  confirm: Actions['confirm'],
  sleepEnabled = true
) {
  return !(
    sleepEnabled &&
    !view.asleep &&
    view.leftMinutes > 0 &&
    view.leftMinutes <= noPhoneMinutes &&
    !(await confirm('It is no-phone time. Start a focus session anyway?'))
  );
}
export function Countdown({ snapshot, now }: Actions) {
  const result = getCountdown(snapshot.settings, now);
  return (
    <Section
      title={snapshot.settings.countdown.title}
      index="04"
      aside={<span className="tag">ONE SQUARE / ONE DAY</span>}
    >
      <div className="countdown-head">
        <strong>
          {result.daysLeft}
          <small>days left</small>
        </strong>
        <p className="muted">
          A little perspective.
          <br />
          Make the days count.
        </p>
      </div>
      <Heatmap
        cells={result.cells}
        columns={result.columns}
        label="Countdown days"
        fixedSize
      />
      <Stats
        items={[
          ['Progress', `${result.percent}%`],
          ['Day', `${result.elapsed} / ${result.total}`],
          ['Weeks left', result.weeksLeft]
        ]}
      />
      <p className="caption">
        {snapshot.settings.countdown.startDate} <span>→</span>{' '}
        {snapshot.settings.countdown.endDate} · columns read top to bottom
      </p>
    </Section>
  );
}
function Checklist({
  snapshot,
  now,
  busy,
  run,
  date = key(now)
}: Actions & { date?: string }) {
  const done = doneOn(snapshot.dailyLog, date, snapshot.settings.habits.tasks);
  return (
    <div className="checklist">
      {snapshot.settings.habits.tasks.map((task, i) => (
        <label
          className={`check-row ${done.includes(task) ? 'checked' : ''}`}
          key={task}
        >
          <input
            type="checkbox"
            checked={done.includes(task)}
            disabled={busy}
            onChange={(e) =>
              void run({ kind: 'set_task', date, task, done: e.target.checked })
            }
          />
          <span>{task}</span>
          <small>{String(i + 1).padStart(2, '0')}</small>
        </label>
      ))}
    </div>
  );
}
export function Habits(props: Actions & { compact?: boolean }) {
  const { snapshot, now, compact } = props;
  const today = key(now);
  const [selected, setSelected] = useState(today);
  const { ref, width } = useWidth();
  const s = snapshot.settings;
  const stats = useMemo(
    () =>
      compact ? null : getHabitStats(snapshot.dailyLog, s, parseKey(today)),
    [compact, snapshot.dailyLog, s, today]
  );
  const grid = useMemo(
    () =>
      compact
        ? null
        : getHabitGrid(snapshot.dailyLog, s, parseKey(today), width),
    [compact, snapshot.dailyLog, s, today, width]
  );
  const date = compact ? today : selected;
  return (
    <Section
      title={s.habits.title}
      index="02"
      aside={
        <span className="tag">
          {doneOn(snapshot.dailyLog, date, s.habits.tasks).length} /{' '}
          {s.habits.tasks.length} DONE
        </span>
      }
    >
      {stats && grid && (
        <>
          <div ref={ref}>
            <Heatmap
              cells={grid.cells}
              columns={grid.columns}
              label="Habit history"
              fixedSize={!!s.habits.endDate}
              onPick={(d) => {
                if (d <= today) setSelected(d);
              }}
            />
          </div>
          <div className="legend">
            <span>Less</span>
            {[
              s.appearance.red,
              s.appearance.orange,
              s.appearance.yellow,
              s.appearance.green
            ].map((c, i) => (
              <i key={i} style={{ background: c }} />
            ))}
            <span>More · select a day to edit</span>
          </div>
          <Stats
            items={[
              ['Completed', `${stats.completedDays} / ${stats.elapsed}`],
              ['Rate', `${stats.percent}%`],
              ['Missed', stats.missedDays],
              ['Today', `${stats.todayDone} / ${s.habits.tasks.length}`],
              ['Current streak', `${stats.currentStreak}d`],
              ['Best streak', `${stats.longestStreak}d`],
              ...(stats.daysLeft !== null
                ? [['Days left', stats.daysLeft] as [string, number]]
                : [])
            ]}
          />
          <div className="toolbar">
            <label>
              Edit day{' '}
              <input
                aria-label="Edit habit day"
                type="date"
                max={today}
                value={selected}
                onChange={(e) => {
                  if (e.target.value && e.target.value <= today)
                    setSelected(e.target.value);
                }}
              />
            </label>
            <span className="muted">
              {s.habits.dayCompleteMin} task(s) completes a day
            </span>
          </div>
        </>
      )}
      <Checklist {...props} date={date} />
      {stats && (
        <div className="task-rates">
          <h3>Per-task completion</h3>
          {s.habits.tasks.map((t) => (
            <div className="data-row" key={t}>
              <span>{t}</span>
              <span>
                {Math.round(stats.taskRates[t] ?? 0)}%
                {s.habits.focusThresholds[t]
                  ? ` · auto at ${s.habits.focusThresholds[t]} focus min`
                  : ''}
              </span>
            </div>
          ))}
          {s.habits.archivedTasks.length > 0 && (
            <p className="caption">
              Archived, history preserved: {s.habits.archivedTasks.join(', ')}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
export function DayProgress({ snapshot, now }: Actions) {
  const view = getSleepView(snapshot.sleep, now, snapshot.settings);
  const planTotal = snapshot.sleep.plan
    ? planDays(snapshot.sleep.plan, snapshot.settings)
    : 0;
  return (
    <Section
      title={snapshot.settings.sleep.title}
      index="01"
      aside={
        <span className="tag">
          {view.asleep
            ? 'SLEEPING'
            : `AWAKE ${fmtDuration(view.elapsedMinutes)}`}
        </span>
      }
    >
      <div className="day-head">
        <h3 style={{ color: view.color, opacity: view.asleep ? 0.4 : 1 }}>
          {view.status}
        </h3>
        <span className="live-clock">{clock(now)}</span>
      </div>
      <Progress
        value={view.progress}
        color={view.color}
        label="Wake to bedtime"
      />
      <div className="spread caption">
        <span>
          {view.asleep ? 'Wake' : 'Woke'} {clock(view.wake)}
          {view.logged ? '' : ' (est)'}
        </span>
        <span>Bed {clock(view.bed)}</span>
      </div>
      <p
        className="phase"
        style={{ color: view.color, opacity: view.asleep ? 0.4 : 1 }}
      >
        {view.phase ??
          (snapshot.sleep.plan
            ? (view.planIndex ?? 0) >= planTotal
              ? 'Sleep plan complete · steady at your targets'
              : `Sleep plan · night ${(view.planIndex ?? 0) + 1}/${planTotal}`
            : view.asleep
              ? 'A new day starts with rest.'
              : view.leftMinutes <= 0
                ? 'Rest is part of the work. Call it a day.'
                : 'A steady pace. There is room to begin.')}
      </p>
    </Section>
  );
}
export function Focus(props: Actions) {
  const { snapshot, now, busy, run, confirm } = props;
  const [custom, setCustom] = useState(
    String(snapshot.settings.focus.focusOptions[0])
  );
  const [task, setTask] = useState('');
  const s = snapshot.settings;
  const view = getSleepView(snapshot.sleep, now, s);
  const state = snapshot.focus.state;
  const focus = useMemo(
    () => normalizeFocus(snapshot.focus, s.focus.blockMinutes),
    [snapshot.focus, s.focus.blockMinutes]
  );
  const day = focus.days[key(now)] ?? { count: 0, minutes: 0 };
  const start = async (timerType: 'focus' | 'break', minutes: number) => {
    if (
      timerType === 'focus' &&
      !(await confirmFocusStart(
        view,
        s.sleep.noPhoneMinutes,
        confirm,
        snapshot.preferences.features.sleep
      ))
    )
      return;
    void run({
      kind: 'start_timer',
      timerType,
      minutes,
      ...(timerType === 'focus' && task ? { task } : {})
    });
  };
  const presets = (
    name: string,
    timerType: 'focus' | 'break',
    options: number[],
    primary = false
  ) => (
    <div className="presets">
      <span>{name}</span>
      {options.map((m, i) => (
        <button
          className={primary ? 'primary' : undefined}
          key={i}
          disabled={busy}
          onClick={() => void start(timerType, m)}
        >
          {m} min{primary && <> <span>↗</span></>}
        </button>
      ))}
    </div>
  );
  return (
    <Section
      title={s.focus.title}
      index="03"
      aside={
        <span className={`tag ${state ? 'green' : ''}`}>
          {state ? 'IN PROGRESS' : 'READY WHEN YOU ARE'}
        </span>
      }
    >
      <AwayBanner {...props} />
      <TimerDisplay
        state={state}
        now={now}
        idleMinutes={s.focus.focusOptions[0]}
      />
      {state ? (
        <button
          className="stop-button"
          disabled={busy}
          onClick={() => void run({ kind: 'stop_timer' })}
        >
          {state.type === 'focus' ? 'Stop & count whole minutes' : 'Stop break'}{' '}
          <span>■</span>
        </button>
      ) : (
        <>
          <label className="inline-field">
            Link a task
            <select value={task} onChange={(e) => setTask(e.target.value)}>
              <option value="">No task tag</option>
              {s.habits.tasks.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          {presets('Focus', 'focus', s.focus.focusOptions, true)}
          {presets('Break', 'break', s.focus.breakOptions)}
          {presets('Long break', 'break', s.focus.longBreakOptions)}
          <form
            className="custom-focus"
            onSubmit={(e) => {
              e.preventDefault();
              const minutes = Number(custom);
              if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 240)
                void start('focus', minutes);
            }}
          >
            <label>
              Custom{' '}
              <input
                aria-label="Custom focus minutes"
                type="number"
                min="1"
                max="240"
                step="1"
                required
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />{' '}
              min
            </label>
            <button disabled={busy}>Start →</button>
          </form>
        </>
      )}
      <div className="focus-footer">
        <Blocks day={day} settings={s} />
        <div className="spread caption">
          <span>
            Today {day.count} blocks · {day.minutes} min
          </span>
          <span>{s.focus.blockMinutes} min / block</span>
        </div>
        <p className="room">
          Room for ~{roomForBlocks(view.leftMinutes, s.focus.blockMinutes)}{' '}
          blocks before bed <span>↗</span>
        </p>
      </div>
    </Section>
  );
}
export function Sleep(props: Actions) {
  const { snapshot, now, busy, run, confirm } = props;
  const [date, setDate] = useState(key(now));
  const [time, setTime] = useState('08:00');
  const { sleep, settings: s } = snapshot;
  const base = baseline(sleep, s);
  const nights = getPlanNights(sleep, now, s);
  const w = recentAvg(sleep.wakes, s.sleep.averageDays),
    b = recentAvg(sleep.beds, s.sleep.averageDays);
  const formatMin = (m: number | null) =>
    m === null ? '—' : clock(atMinutes(now, m));
  const targetBed = s.sleep.targetBed
    ? toMin(s.sleep.targetBed)
    : wrap(toMin(s.sleep.targetWake) - s.sleep.sleepHours * 60);
  const start = sleep.plan ?? base;
  const shift = (from: number, to: number) => {
    const d = signedDiff(from, to);
    return d === 0
      ? 'on target'
      : `${fmtDuration(Math.abs(d))} ${d < 0 ? 'earlier' : 'later'}`;
  };
  const log = (entry: 'wake' | 'bed', justNow: boolean) => {
    const timestamp = justNow
      ? now.getTime()
      : new Date(`${date}T${time}:00`).getTime();
    void run({ kind: 'log_sleep', entry, timestamp });
  };
  const logs = [
    ...new Set([...Object.keys(sleep.wakes), ...Object.keys(sleep.beds)])
  ]
    .sort()
    .reverse();
  return (
    <>
      <DayProgress {...props} />
      <Section
        title="Log your rhythm"
        aside={<span className="tag">LOCAL TIME</span>}
      >
        <div className="button-row">
          <button disabled={busy} onClick={() => log('wake', true)}>
            Woke just now ↗
          </button>
          <button disabled={busy} onClick={() => log('bed', true)}>
            Going to bed ↗
          </button>
        </div>
        <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
          <label>
            Date
            <input
              type="date"
              required
              max={key(now)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Time
            <input
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !date || !time}
            onClick={() => log('wake', false)}
          >
            Log wake
          </button>
          <button
            disabled={busy || !date || !time}
            onClick={() => log('bed', false)}
          >
            Log bed
          </button>
        </form>
        <p className="caption">
          After-midnight bedtimes belong to the previous evening. Health logs
          arrive from your phone’s Shortcut.
        </p>
      </Section>
      <Section
        title="A gentler landing"
        aside={<span className="tag">SLEEP PLAN</span>}
      >
        <Stats
          items={[
            ['Average wake', formatMin(w.mean)],
            ['Average bed', formatMin(b.mean)],
            ['Wake logs', w.n],
            ['Bed logs', b.n],
            ['Target wake', s.sleep.targetWake],
            ['Target bed', formatMin(targetBed)]
          ]}
        />
        <p className="caption">
          Circular averages · latest {s.sleep.averageDays} logged days
          {base?.bedEst ? ' · baseline bedtime estimated' : ''}
        </p>
        {sleep.plan && (
          <p className="plan-baseline">
            Baseline {sleep.plan.start} · wake {formatMin(sleep.plan.wake)} /
            bed {formatMin(sleep.plan.bed)}
          </p>
        )}
        {start ? (
          <>
            <h3>Adjustment needed</h3>
            <p className="muted">
              Wake {shift(start.wake, toMin(s.sleep.targetWake))} · bed{' '}
              {shift(start.bed, targetBed)}
              <br />
              {planDays(start, s)} days at {s.sleep.stepMinutes} min/day
            </p>
          </>
        ) : (
          <p className="empty">
            Log a wake time to calculate your starting schedule.
          </p>
        )}
        <div className="button-row">
          {base && (
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (
                  !sleep.plan ||
                  (await confirm(
                    'Restart the sleep plan from your current averages?'
                  ))
                )
                  void run({ kind: 'start_plan' });
              }}
            >
              {sleep.plan
                ? 'Restart from current averages'
                : 'Start plan today'}{' '}
              →
            </button>
          )}
          {sleep.plan && (
            <button
              disabled={busy}
              onClick={async () => {
                if (
                  await confirm(
                    'Stop the plan? Logged wake and bed times are kept.'
                  )
                )
                  void run({ kind: 'stop_plan' });
              }}
            >
              Stop plan
            </button>
          )}
        </div>
        {nights.length > 0 && (
          <div className="night-list">
            {nights.map((n) => (
              <div
                className={`data-row ${n.current ? 'current-night' : ''}`}
                key={n.night}
              >
                <span>
                  {n.current ? '▶ ' : ''}Night {n.night}
                </span>
                <span>
                  Bed {formatMin(n.bed)} → wake {formatMin(n.wake)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section
        title="Logged days"
        aside={<span className="tag">{logs.length} DAYS</span>}
      >
        {logs.length ? (
          <div className="night-list">
            {logs.map((d) => (
              <div className="data-row" key={d}>
                <span>{d}</span>
                <span>
                  Wake {formatMin(sleep.wakes[d] ?? null)} · bed{' '}
                  {formatMin(sleep.beds[d] ?? null)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">No sleep entries yet.</p>
        )}
        <button
          className="danger"
          disabled={busy || (!logs.length && !sleep.plan)}
          onClick={async () => {
            if (
              await confirm(
                'Permanently clear ALL wake logs, bed logs and the sleep plan? This cannot be undone.'
              )
            )
              void run({ kind: 'clear_sleep' });
          }}
        >
          Clear all sleep data…
        </button>
      </Section>
    </>
  );
}
