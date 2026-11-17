'use client';
// Feature: extraCountdowns. More countdown grids for other dates, kept in
// `preferences.features.extraCountdowns` (Mac only; the phone shows just the main countdown).
//   Config    - list editor (add, edit, remove, reorder), validated with the feature schema
//   TodayCard - one row per countdown: days left, progress bar and percent elapsed
import { useEffect, useMemo, useState } from 'react';
import { addDays, daysBetween, getCountdown, key, parseKey, startOfDay } from '@daybar/core';
import { featuresSchema } from '@daybar/core/contracts';
import type { ExtraCountdown, ExtraCountdownsConfig } from '@daybar/core/contracts';
import { Progress, Section } from '../components/primitives';
import styles from './extraCountdowns.module.css';
import type { FeatureCardProps, FeatureConfigProps } from './types';

const MAX_ITEMS = 12;
const schema = featuresSchema.shape.extraCountdowns;

function newId(taken: Set<string>): string {
  for (;;) {
    const random =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 14).padEnd(8, '0');
    const id = `c${random}`;
    if (!taken.has(id)) return id;
  }
}

/** Plain-language problem with one row, or '' when it is fine. */
function rowProblem(item: ExtraCountdown, schemaMessages: string[]): string {
  if (!item.title.trim()) return 'Give this countdown a title.';
  if (!item.startDate) return 'Pick a start date.';
  if (!item.endDate) return 'Pick an end date.';
  return schemaMessages[0] ?? '';
}

export function Config({ value, save, busy }: FeatureConfigProps<'extraCountdowns'>) {
  const saved = value.items;
  const [draft, setDraft] = useState<ExtraCountdown[]>(saved);
  const [status, setStatus] = useState('');
  // Follow saves from elsewhere, but only when the stored list itself changed.
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setDraft(saved);
    setStatus('');
  }, [savedKey]);

  const check = useMemo(() => schema.safeParse({ enabled: value.enabled, items: draft }), [draft, value.enabled]);
  const problems = useMemo(() => {
    const byRow = new Map<number, string[]>();
    const general: string[] = [];
    if (!check.success)
      for (const issue of check.error.issues) {
        const [head, index] = issue.path;
        if (head === 'items' && typeof index === 'number') byRow.set(index, [...(byRow.get(index) ?? []), issue.message]);
        else general.push(issue.message);
      }
    return { byRow, general };
  }, [check]);
  const rowErrors = draft.map((item, i) => rowProblem(item, problems.byRow.get(i) ?? []));
  const dirty = JSON.stringify(draft) !== savedKey;
  const valid = check.success;

  const edit = (index: number, patch: Partial<ExtraCountdown>) => {
    setStatus('');
    setDraft((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };
  const move = (index: number, by: -1 | 1) => {
    setStatus('');
    setDraft((items) => {
      const target = index + by;
      if (target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const add = () => {
    setStatus('');
    const today = startOfDay(new Date());
    setDraft((items) => [
      ...items,
      {
        id: newId(new Set(items.map((i) => i.id))),
        title: 'New countdown',
        startDate: key(today),
        endDate: key(addDays(today, 30))
      }
    ]);
  };
  const submit = async () => {
    if (!check.success) return;
    const next: ExtraCountdownsConfig = { ...value, items: check.data.items };
    if (await save(next)) setStatus('Saved.');
  };

  return (
    <div>
      <p className={styles.help}>
        Extra countdowns appear as a card on Today, under the main countdown, with the days left and
        how far along you are. They live on this Mac only: your phone widgets keep showing just the
        main countdown. Up to {MAX_ITEMS}.
      </p>
      {draft.length > 0 && (
        <ol className={styles.list} aria-label="Extra countdowns">
          {draft.map((item, i) => {
            const error = rowErrors[i];
            const label = item.title.trim() || `countdown ${i + 1}`;
            const errorId = `extra-${item.id}-error`;
            return (
              <li key={item.id} className={styles.row} data-invalid={error ? 'true' : undefined}>
                <label className={styles.field}>
                  Title
                  <input
                    type="text"
                    value={item.title}
                    maxLength={120}
                    aria-label={`Title of ${label}`}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    disabled={busy}
                    onChange={(e) => edit(i, { title: e.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  Start
                  <input
                    type="date"
                    value={item.startDate}
                    aria-label={`Start date of ${label}`}
                    disabled={busy}
                    onChange={(e) => edit(i, { startDate: e.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  End
                  <input
                    type="date"
                    value={item.endDate}
                    min={item.startDate || undefined}
                    aria-label={`End date of ${label}`}
                    disabled={busy}
                    onChange={(e) => edit(i, { endDate: e.target.value })}
                  />
                </label>
                <div className={styles.tools} role="group" aria-label={`Actions for ${label}`}>
                  <button type="button" aria-label={`Move ${label} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${label} down`}
                    disabled={busy || i === draft.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button type="button" className="subtle-danger" aria-label={`Remove ${label}`} disabled={busy} onClick={() => {
                    setStatus('');
                    setDraft((items) => items.filter((_, at) => at !== i));
                  }}>
                    ×
                  </button>
                </div>
                {error && (
                  <p id={errorId} className={styles.error} role="alert">
                    {error}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {problems.general.map((message) => (
        <p key={message} className={styles.error} role="alert">
          {message}
        </p>
      ))}
      <div className={styles.actions}>
        <button type="button" disabled={busy || draft.length >= MAX_ITEMS} onClick={add}>
          Add countdown
        </button>
        <button type="button" className="primary" disabled={busy || !dirty || !valid} onClick={() => void submit()}>
          Save countdowns
        </button>
        <button type="button" disabled={busy || !dirty} onClick={() => setDraft(saved)}>
          Revert
        </button>
        <span className={styles.count}>
          {draft.length} / {MAX_ITEMS}
        </span>
      </div>
      <p className={styles.status} role="status">
        {status || (dirty ? 'Unsaved changes.' : '')}
      </p>
    </div>
  );
}

/** What the card shows for one countdown on a given day. Pure, so it is easy to test. */
export function countdownProgress(item: ExtraCountdown, settings: FeatureCardProps['snapshot']['settings'], now: Date) {
  const result = getCountdown(
    { ...settings, countdown: { ...settings.countdown, title: item.title, startDate: item.startDate, endDate: item.endDate } },
    now
  );
  const today = startOfDay(now);
  const startsIn = Math.max(0, daysBetween(parseKey(item.startDate), today));
  const finished = daysBetween(today, parseKey(item.endDate)) > 0;
  // getCountdown stops at the last day's fraction; a finished countdown reads as complete.
  return { ...result, percent: finished ? 100 : result.percent, daysLeft: finished ? 0 : result.daysLeft, startsIn, finished };
}

export function TodayCard({ snapshot, now }: FeatureCardProps) {
  const items = snapshot.preferences.features.extraCountdowns.items;
  return (
    <Section title="More countdowns" aside={<span className="tag">{items.length} TRACKED</span>}>
      {items.length === 0 ? (
        <p className={styles.empty}>No extra countdowns yet. Add some in Settings → Features.</p>
      ) : (
        <div className={styles.card}>
          {items.map((item) => {
            const p = countdownProgress(item, snapshot.settings, now);
            const state = p.finished ? 'Finished' : p.startsIn > 0 ? 'Not started' : p.daysLeft === 0 ? 'Last day' : `${p.daysLeft} ${p.daysLeft === 1 ? 'day' : 'days'} left`;
            return (
              <div className={styles.item} key={item.id} data-countdown={item.id}>
                <div className={styles.itemHead}>
                  <h3 className={styles.itemTitle}>{item.title}</h3>
                  <strong className={styles.left}>
                    {p.finished || p.startsIn > 0 || p.daysLeft === 0 ? state : (
                      <>
                        {p.daysLeft}
                        <small>{p.daysLeft === 1 ? 'day left' : 'days left'}</small>
                      </>
                    )}
                  </strong>
                </div>
                <Progress value={p.percent / 100} color="var(--green)" label={`${item.title}: ${p.percent}% elapsed`} />
                <div className={styles.meta}>
                  <span>{p.percent}% elapsed</span>
                  <span>
                    {p.startsIn > 0 ? `starts in ${p.startsIn} ${p.startsIn === 1 ? 'day' : 'days'} · ` : ''}
                    {item.startDate} → {item.endDate}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
