'use client';
// Feature: radar (Deadline Radar). The registry picks up `Config`, `View` and `TodayCard` by name.
import { useEffect, useMemo, useState } from 'react';
import {
  radarColor,
  radarDaysUntil,
  radarLabel,
  selectRadarItems
} from '@daybar/core';
import type { RadarItem } from '@daybar/core';
import type { RadarConfig } from '@daybar/core/contracts';
import { Section } from '../components/primitives';
import { getRadarClient } from './radarClient';
import type { Access, RadarCalendar, RadarCalendars, RadarStatus } from './radarClient';
import { useAutoRequest, useRadarItems, useRadarStatus } from './radarState';
import styles from './radar.module.css';
import type { FeatureCardProps, FeatureConfigProps, FeatureViewProps } from './types';

const settingsPath = (pane: 'Calendars' | 'Reminders') => `System Settings → Privacy & Security → ${pane}`;

/** What to tell the person about one kind of access, or null when it is fine. */
function accessNote(
  pane: 'Calendars' | 'Reminders',
  access: Access
): { text: string; canGrant: boolean } | null {
  switch (access) {
    case 'fullAccess':
      return null;
    case 'notDetermined':
      return {
        canGrant: true,
        text: `Daybar needs your permission to read ${pane}. It only reads, and nothing leaves your Mac.`
      };
    case 'writeOnly':
      return {
        canGrant: false,
        text: `Daybar has write-only access to ${pane}, but it needs to read them. Choose Full Access for Daybar in ${settingsPath(pane)}, then press Refresh.`
      };
    case 'restricted':
      return {
        canGrant: false,
        text: `${pane} access is restricted on this Mac (for example by a device profile or Screen Time). Daybar cannot ask for it.`
      };
    case 'unsupported':
      return null;
    default:
      return {
        canGrant: false,
        text: `${pane} access is off for Daybar. Turn it on in ${settingsPath(pane)}, then press Refresh.`
      };
  }
}

function AccessNotice({
  status,
  includeReminders,
  onGrant,
  disabled
}: {
  status: RadarStatus;
  includeReminders: boolean;
  onGrant: () => void;
  disabled?: boolean;
}) {
  if (!status.supported)
    return (
      <div className="notice warning" role="status">
        <div className={styles.access}>
          <p>Deadline Radar reads Calendar and Reminders through macOS, so it works in the Daybar app on a Mac only.</p>
        </div>
      </div>
    );
  const notes = [
    accessNote('Calendars', status.events),
    includeReminders ? accessNote('Reminders', status.reminders) : null
  ].filter((n): n is NonNullable<typeof n> => n !== null);
  if (!notes.length) return null;
  return (
    <div className="notice warning" role="status">
      <div className={styles.access}>
        {notes.map((n) => (
          <p key={n.text}>{n.text}</p>
        ))}
        {notes.some((n) => n.canGrant) && (
          <button type="button" disabled={disabled} onClick={onGrant}>
            Grant access
          </button>
        )}
      </div>
    </div>
  );
}

function dateText(item: RadarItem): string {
  const d = new Date(item.date);
  const day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return item.allDay
    ? day
    : `${day}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function Rows({
  items,
  now,
  appearance,
  compact
}: {
  items: RadarItem[];
  now: Date;
  appearance: Parameters<typeof radarColor>[1];
  compact?: boolean;
}) {
  return (
    <ol className={`${styles.list}${compact ? ` ${styles.compact}` : ''}`} aria-label="Upcoming deadlines">
      {items.map((item) => {
        const color = radarColor(radarDaysUntil(item.date, now), appearance);
        return (
          <li className={styles.row} key={item.id ?? `${item.kind}:${item.title}:${item.date}`}>
            <span className={styles.bar} style={{ background: color }} aria-hidden="true" />
            <span>
              <span className={styles.title}>{item.title}</span>
              <span className={styles.source}>
                {item.source} · {item.kind === 'reminder' ? 'Reminder' : 'Event'}
              </span>
            </span>
            <span className={styles.when}>
              <span className={styles.label} style={{ color }}>
                {radarLabel(item, now)}
              </span>
              <span className={styles.date}>{dateText(item)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Items for the saved configuration with the live clock applied (finished events drop out). */
function useSelected(config: RadarConfig, now: Date) {
  const radar = useRadarItems(config);
  const items = useMemo(
    () => (radar.data ? selectRadarItems(radar.data.items, config, now) : []),
    // `now` ticks every second; the minute is all a finished event needs.
    [radar.data, config, Math.floor(now.getTime() / 60000)]
  );
  return { ...radar, items };
}

export function View({ snapshot, now }: FeatureViewProps) {
  const config = snapshot.preferences.features.radar;
  const radar = useSelected(config, now);
  const status = radar.data?.status;
  useAutoRequest(status, config.includeReminders, radar.requestAccess);
  const readable =
    status?.events === 'fullAccess' || (config.includeReminders && status?.reminders === 'fullAccess');
  return (
    <Section
      title="Deadline Radar"
      aside={<span className="tag">CALENDAR + REMINDERS · THIS MAC</span>}
    >
      <div className={styles.toolbar}>
        <span aria-live="polite">
          {radar.loading && !radar.data ? 'Reading your calendar…' : `${radar.items.length} upcoming`}
        </span>
        <button type="button" disabled={radar.loading} onClick={() => void radar.refresh(true)}>
          Refresh
        </button>
      </div>
      {status && (
        <AccessNotice
          status={status}
          includeReminders={config.includeReminders}
          onGrant={() => void radar.requestAccess()}
          disabled={radar.loading}
        />
      )}
      {radar.error && (
        <div className="notice error" role="alert">
          <strong>Could not read your calendar.</strong>
          <p>{radar.error}</p>
        </div>
      )}
      {radar.data && readable && radar.items.length === 0 && !radar.error && (
        <p className={styles.empty}>Nothing due. Enjoy it.</p>
      )}
      {radar.items.length > 0 && (
        <Rows items={radar.items} now={now} appearance={snapshot.settings.appearance} />
      )}
    </Section>
  );
}

export function TodayCard({ snapshot, now }: FeatureCardProps) {
  const config = snapshot.preferences.features.radar;
  const radar = useSelected(config, now);
  const status = radar.data?.status;
  const next = radar.items.slice(0, 3);
  const blocked =
    status && status.supported && status.events !== 'fullAccess' && status.reminders !== 'fullAccess';
  return (
    <Section title="Deadlines" aside={<span className="tag">NEXT 3</span>}>
      {!radar.data ? (
        <p className="muted">Reading your calendar…</p>
      ) : blocked || (status && !status.supported) ? (
        <p className="muted">
          Deadline Radar needs access to Calendar. Open Deadline Radar in the sidebar to set it up.
        </p>
      ) : next.length === 0 ? (
        <p className={styles.empty}>Nothing due. Enjoy it.</p>
      ) : (
        <Rows items={next} now={now} appearance={snapshot.settings.appearance} compact />
      )}
    </Section>
  );
}

function CalendarChecklist({
  legend,
  all,
  selected,
  disabled,
  onChange
}: {
  legend: string;
  all: RadarCalendar[];
  selected: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  // One entry per name: saved filters match by name, so two same-named calendars act as one.
  const titles = [...new Set(all.map((c) => c.title))];
  const on = (title: string) => selected.length === 0 || selected.includes(title);
  const picked = titles.filter(on);
  const toggle = (title: string, checked: boolean) => {
    const next = checked ? [...picked, title] : picked.filter((t) => t !== title);
    onChange(next.length === titles.length ? [] : titles.filter((t) => next.includes(t)));
  };
  return (
    <fieldset className={styles.group}>
      <legend>{legend}</legend>
      {titles.length === 0 ? (
        <p className={styles.hint}>None found yet.</p>
      ) : (
        <ul className={styles.checks}>
          {titles.map((title) => {
            const account = all.find((c) => c.title === title)?.account;
            const checked = on(title);
            return (
              <li key={title}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={checked}
                    // Unchecking the last one would silently mean "all".
                    disabled={disabled || (checked && picked.length === 1)}
                    onChange={(e) => toggle(title, e.target.checked)}
                  />
                  <span>
                    {title}
                    {account ? <small> · {account}</small> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {titles.length > 0 && (
        <p className={styles.hint}>
          {selected.length === 0 ? 'All are included.' : `${picked.length} of ${titles.length} included.`}
        </p>
      )}
    </fieldset>
  );
}

const keywordList = (text: string) =>
  [...new Set(text.split(',').map((k) => k.trim()).filter(Boolean))].slice(0, 100);

export function Config({ value, save, busy }: FeatureConfigProps<'radar'>) {
  const client = getRadarClient();
  const { status, requestAccess } = useRadarStatus(client);
  useAutoRequest(status, value.includeReminders, requestAccess);
  const [calendars, setCalendars] = useState<RadarCalendars>({ events: [], reminders: [] });
  const events = status?.events;
  const reminders = status?.reminders;
  useEffect(() => {
    let alive = true;
    if (events === 'fullAccess' || reminders === 'fullAccess')
      client
        .calendars()
        .then((c) => alive && setCalendars(c))
        .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [client, events, reminders]);

  const [ahead, setAhead] = useState(String(value.daysAhead));
  const [back, setBack] = useState(String(value.overdueDaysBack));
  const [words, setWords] = useState(value.keywords.join(', '));
  useEffect(() => setAhead(String(value.daysAhead)), [value.daysAhead]);
  useEffect(() => setBack(String(value.overdueDaysBack)), [value.overdueDaysBack]);
  useEffect(() => setWords(value.keywords.join(', ')), [value.keywords]);

  const patch = (next: Partial<RadarConfig>) => void save({ ...value, ...next });
  const commitNumber = (
    text: string,
    field: 'daysAhead' | 'overdueDaysBack',
    min: number,
    max: number,
    reset: (s: string) => void
  ) => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max) {
      if (n !== value[field]) patch({ [field]: n });
    } else reset(String(value[field]));
  };

  return (
    <div className={styles.config}>
      {status && (
        <AccessNotice
          status={status}
          includeReminders={value.includeReminders}
          onGrant={() => void requestAccess()}
          disabled={busy}
        />
      )}
      {status?.supported && status.events === 'fullAccess' && (
        <p className={styles.hint}>
          Calendar access is on
          {value.includeReminders
            ? status.reminders === 'fullAccess'
              ? ', and so is Reminders.'
              : '. Reminders is not allowed yet.'
            : '.'}
        </p>
      )}
      <CalendarChecklist
        legend="Calendars"
        all={calendars.events}
        selected={value.calendars}
        disabled={busy}
        onChange={(next) => patch({ calendars: next })}
      />
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={value.includeReminders}
          disabled={busy}
          onChange={(e) => patch({ includeReminders: e.target.checked })}
        />
        Include Reminders with a due date
      </label>
      {value.includeReminders && (
        <CalendarChecklist
          legend="Reminder lists"
          all={calendars.reminders}
          selected={value.reminderLists}
          disabled={busy}
          onChange={(next) => patch({ reminderLists: next })}
        />
      )}
      <div className={styles.grid}>
        <label className={styles.field}>
          Look ahead (days)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            step={1}
            value={ahead}
            disabled={busy}
            onChange={(e) => setAhead(e.target.value)}
            onBlur={() => commitNumber(ahead, 'daysAhead', 1, 365, setAhead)}
          />
        </label>
        <label className={styles.field}>
          Show overdue reminders back (days)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={90}
            step={1}
            value={back}
            disabled={busy}
            onChange={(e) => setBack(e.target.value)}
            onBlur={() => commitNumber(back, 'overdueDaysBack', 0, 90, setBack)}
          />
        </label>
      </div>
      <label className={styles.field}>
        Only events whose title contains
        <input
          type="text"
          value={words}
          placeholder="exam, deadline, due"
          spellCheck={false}
          disabled={busy}
          onChange={(e) => setWords(e.target.value)}
          onBlur={() => {
            const next = keywordList(words);
            if (next.join('\n') !== value.keywords.join('\n')) patch({ keywords: next });
            else setWords(value.keywords.join(', '));
          }}
        />
        <span className={styles.hint}>
          Separate words with commas, any case. Leave empty to include every event.
        </span>
      </label>
      <div className={styles.inline}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={value.dueAlerts}
            disabled={busy}
            onChange={(e) => patch({ dueAlerts: e.target.checked })}
          />
          Notify me about what is due tomorrow, at
        </label>
        <input
          type="time"
          aria-label="Due alert time"
          value={value.alertTime}
          disabled={busy || !value.dueAlerts}
          onChange={(e) => {
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value)) patch({ alertTime: e.target.value });
          }}
        />
      </div>
    </div>
  );
}
