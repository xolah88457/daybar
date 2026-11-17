'use client';
// Feature: insights. A week-in-review page built only from data Daybar already has. All the maths
// lives in packages/core (`getWeeklyInsights`); this file only lays it out. Sections for modules
// that are switched off are left out.
import { useMemo } from 'react';
import { fmtDuration, formatSpread, getWeeklyInsights, parseKey } from '@daybar/core';
import type { FocusInsights, HabitInsights, SleepInsights, SleepFocusInsight, SleepMetric } from '@daybar/core';
import { Section, Stats } from '../components/primitives';
import styles from './insights.module.css';
import type { FeatureViewProps } from './types';

const dayName = (date: string, width: 'short' | 'narrow' = 'short') =>
  parseKey(date).toLocaleDateString([], { weekday: width });
const shortDate = (date: string) => parseKey(date).toLocaleDateString([], { day: 'numeric', month: 'short' });
const minutesText = (m: number) => fmtDuration(Math.round(m));
/**
 * A minutes-after-midnight value as a clock time. Built in UTC so a daylight-saving change on the
 * viewer's today can never shift it: 02:30 stays 02:30 even on a spring-forward day.
 */
export const clockAt = (m: number | null) =>
  m === null
    ? '—'
    : new Date(Date.UTC(2000, 0, 1, 0, Math.round(m))).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC'
      });

function Delta({ value, text, better = 'up' }: { value: number; text: string; better?: 'up' | 'down' | 'none' }) {
  const direction = value === 0 ? 'flat' : value > 0 === (better === 'up') ? 'up' : 'down';
  const tone = better === 'none' || value === 0 ? styles.flat : direction === 'up' ? styles.up : styles.down;
  return <span className={`${styles.delta} ${tone}`}>{text}</span>;
}

function FocusChart({ focus }: { focus: FocusInsights }) {
  const width = 308, height = 132, top = 18, bottom = 22, slot = width / 7, barW = 26;
  const max = Math.max(1, ...focus.days.map((d) => d.minutes), ...focus.previousDays.map((d) => d.minutes));
  const plot = height - top - bottom;
  const scale = (m: number) => (m / max) * plot;
  const summary = `Focus minutes per day over the last 7 days: ${focus.days
    .map((d) => `${dayName(d.date)} ${d.minutes}`)
    .join(', ')}. Total ${focus.total} minutes; the previous 7 days totalled ${focus.previousTotal}.`;
  return (
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} data-testid="focus-chart">
      <line className={styles.axis} x1="0" x2={width} y1={top + plot} y2={top + plot} />
      {focus.days.map((d, i) => {
        const x = i * slot + (slot - barW) / 2;
        const h = scale(d.minutes), ph = scale(focus.previousDays[i].minutes);
        const last = i === focus.days.length - 1;
        return (
          <g key={d.date}>
            <title>{`${dayName(d.date)} ${shortDate(d.date)}: ${d.minutes} min (a week earlier: ${focus.previousDays[i].minutes} min)`}</title>
            {ph > 0 && <rect className={styles.ghost} x={x - 2} y={top + plot - ph} width={barW + 4} height={ph} rx="3" />}
            {d.minutes > 0 && (
              <rect className={last ? styles.barToday : styles.bar} x={x} y={top + plot - h} width={barW} height={h} rx="3" />
            )}
            {d.minutes > 0 && (
              <text className={styles.value} x={x + barW / 2} y={top + plot - h - 5}>
                {d.minutes}
              </text>
            )}
            <text className={styles.label} x={x + barW / 2} y={height - 6}>
              {dayName(d.date, 'short')}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function FocusSection({ focus }: { focus: FocusInsights }) {
  const change = focus.change;
  const percent = focus.changePercent === null ? '' : ` (${focus.changePercent > 0 ? '+' : ''}${focus.changePercent}%)`;
  return (
    <Section title="Focus" aside={<span className="tag">LAST 7 DAYS</span>}>
      <div className={styles.split}>
        <div>
          <FocusChart focus={focus} />
          <p className={styles.legend} aria-hidden="true">
            <span><i className={`${styles.swatch} ${styles.swatchNow}`} />Minutes per day</span>
            <span><i className={`${styles.swatch} ${styles.swatchPrev}`} />Same day a week earlier</span>
          </p>
        </div>
        <div>
          <span className={styles.bigLabel}>Week total</span>
          <strong className={styles.big}>{focus.total ? minutesText(focus.total) : '0m'}</strong>
          <p style={{ margin: '12px 0 0' }}>
            <Delta
              value={change}
              text={
                focus.previousTotal === 0 && focus.total === 0
                  ? 'No focus in either week'
                  : change === 0
                    ? 'Same as the previous 7 days'
                    : `${change > 0 ? '▲' : '▼'} ${minutesText(Math.abs(change))} vs previous 7 days${percent}`
              }
            />
          </p>
          <ul className={styles.facts}>
            <li>Previous 7 days: {focus.previousTotal ? minutesText(focus.previousTotal) : '0m'}</li>
            <li>Average per day: {minutesText(focus.averagePerDay)}</li>
            <li>
              Best day:{' '}
              {focus.bestDay ? `${dayName(focus.bestDay.date)} · ${minutesText(focus.bestDay.minutes)}` : 'none yet'}
            </li>
          </ul>
        </div>
      </div>
    </Section>
  );
}

function HabitsSection({ habits }: { habits: HabitInsights }) {
  const rate = habits.rate === null ? '—' : `${Math.round(habits.rate * 100)}%`;
  const summary = `Habit completion per day over the last 7 days: ${habits.days
    .map((d) => `${dayName(d.date)} ${d.tracked ? `${d.done} of ${d.total}${d.complete ? ', complete' : ''}` : 'not tracked'}`)
    .join('; ')}.`;
  return (
    <Section title="Habits" aside={<span className="tag">LAST 7 DAYS</span>}>
      <div className={styles.days} role="img" aria-label={summary} data-testid="habit-days">
        {habits.days.map((d) => (
          <div
            key={d.date}
            className={`${styles.day} ${d.complete && d.tracked ? styles.complete : ''} ${d.tracked ? '' : styles.untracked}`}
            title={`${dayName(d.date)} ${shortDate(d.date)}: ${d.tracked ? `${d.done} of ${d.total} tasks` : 'not tracked'}`}
          >
            <span className={styles.track}>
              <span className={styles.fill} style={{ height: `${d.tracked ? Math.round(d.fraction * 100) : 0}%` }} />
            </span>
            <span aria-hidden="true">{dayName(d.date, 'short')}</span>
          </div>
        ))}
      </div>
      <Stats
        items={[
          ['Completed days', habits.trackedDays ? `${habits.completedDays} / ${habits.trackedDays}` : '—'],
          [
            'Completion rate',
            <>
              {rate}{' '}
              {habits.rateChange !== null && habits.rateChange !== 0 && (
                <Delta value={habits.rateChange} text={`${habits.rateChange > 0 ? '+' : ''}${habits.rateChange} pts`} />
              )}
            </>
          ],
          ['Current streak', `${habits.currentStreak}d`],
          ['Best streak', `${habits.bestStreak}d`]
        ]}
      />
      <p className="caption">
        A day counts as complete under your habit settings. The change compares with the previous 7 days.
      </p>
    </Section>
  );
}

function Metric({ name, metric, later = 'later', earlier = 'earlier' }: { name: string; metric: SleepMetric; later?: string; earlier?: string }) {
  const shift = metric.shift;
  return (
    <div className={styles.metric}>
      <span className={styles.metricName}>{name}</span>
      <span className={styles.metricValue}>{clockAt(metric.mean)}</span>
      <span className={styles.metricNote}>
        Consistency {formatSpread(metric.spread)}
        {metric.samples === 1 ? ' (1 entry)' : ''}
      </span>
      <span className={styles.metricNote}>
        {shift === null ? 'No earlier week to compare' : Math.abs(shift) < 1 ? 'Same as the previous week' : `${fmtDuration(Math.abs(shift))} ${shift > 0 ? later : earlier} than the previous week`}
      </span>
    </div>
  );
}

function SleepSection({ sleep }: { sleep: SleepInsights }) {
  const none = sleep.wake.samples === 0 && sleep.bed.samples === 0;
  return (
    <Section title="Sleep rhythm" aside={<span className="tag">LAST 7 DAYS</span>}>
      {none ? (
        <p className={styles.nodata}>No wake or bed times logged in the last 7 days.</p>
      ) : (
        <div className={styles.sleepGrid}>
          <Metric name="Average wake" metric={sleep.wake} />
          <Metric name="Average bed" metric={sleep.bed} />
        </div>
      )}
      <p className="caption">
        Consistency is the typical spread around your average, in minutes. Smaller is steadier.
      </p>
    </Section>
  );
}

function RelationSection({ relation }: { relation: SleepFocusInsight }) {
  return (
    <Section title="Sleep and focus" aside={<span className="tag">LAST {relation.lookbackDays / 7} WEEKS</span>}>
      {relation.enough ? (
        <>
          <div className={styles.relation}>
            <div className={styles.metric}>
              <span className={styles.metricName}>After an earlier bedtime</span>
              <span className={styles.metricValue}>{minutesText(relation.early.averageMinutes ?? 0)}</span>
              <span className={styles.metricNote}>average focus · {relation.early.days} days</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricName}>After a later bedtime</span>
              <span className={styles.metricValue}>{minutesText(relation.late.averageMinutes ?? 0)}</span>
              <span className={styles.metricNote}>average focus · {relation.late.days} days</span>
            </div>
          </div>
          <p className={styles.sentence}>
            Your usual bedtime is {clockAt(relation.usualBed)}.{' '}
            {relation.difference === 0
              ? 'You focus about the same either way.'
              : `On the day after going to bed earlier, you focused ${minutesText(Math.abs(relation.difference ?? 0))} ${(relation.difference ?? 0) > 0 ? 'more' : 'less'} on average.`}
          </p>
          <p className="caption">A pattern, not a cause. Other things change from day to day too.</p>
        </>
      ) : (
        <>
          <p className={styles.nodata}>Not enough data yet</p>
          <p className="caption">
            Needs at least {relation.minPerSide} days after an earlier and {relation.minPerSide} after a later bedtime than usual
            (so far {relation.early.days} and {relation.late.days}), counted over the last {relation.lookbackDays / 7} weeks.
          </p>
        </>
      )}
    </Section>
  );
}

export function View({ snapshot, now }: FeatureViewProps) {
  const features = snapshot.preferences.features;
  const insights = useMemo(
    () =>
      getWeeklyInsights(
        { settings: snapshot.settings, dailyLog: snapshot.dailyLog, focus: snapshot.focus, sleep: snapshot.sleep },
        now
      ),
    // The week only changes when the data or the calendar day does.
    [snapshot.settings, snapshot.dailyLog, snapshot.focus, snapshot.sleep, now.getFullYear(), now.getMonth(), now.getDate()]
  );
  const { range } = insights;
  const anything = features.focus || features.habits || features.sleep;
  return (
    <div className={styles.page}>
      <p className={styles.range}>
        {shortDate(range.start)} – {shortDate(range.end)}, compared with {shortDate(range.previousStart)} –{' '}
        {shortDate(range.previousEnd)}
      </p>
      {features.focus && <FocusSection focus={insights.focus} />}
      {features.habits && <HabitsSection habits={insights.habits} />}
      {features.sleep && <SleepSection sleep={insights.sleep} />}
      {features.focus && features.sleep && <RelationSection relation={insights.sleepFocus} />}
      {!anything && (
        <p className="muted">
          Every module is switched off, so there is nothing to review. Turn some back on in Settings → Features; your data is
          kept.
        </p>
      )}
    </div>
  );
}
