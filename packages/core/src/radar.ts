import type { RadarConfig, Settings } from './contracts';
import { addDays, daysBetween, startOfDay } from './dates';
import { roomForBlocks } from './focus';

export type RadarKind = 'event' | 'reminder';
/** One calendar event or due reminder, as read from EventKit. Times are epoch milliseconds. */
export interface RadarItem {
  /** Stable key (event identifier plus start for recurring events); optional for hand-made items. */
  id?: string;
  title: string;
  date: number;
  /** Events only: when the event ends. A timed event that has ended is dropped. */
  end?: number;
  allDay: boolean;
  /** Calendar or reminder-list name. */
  source: string;
  kind: RadarKind;
}
export type Urgency = 'red' | 'orange' | 'yellow' | 'green';
export type RadarFilter = Pick<
  RadarConfig,
  'calendars' | 'reminderLists' | 'includeReminders' | 'daysAhead' | 'overdueDaysBack' | 'keywords'
>;

function byDate(a: RadarItem, b: RadarItem): number {
  return a.date - b.date || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
}
/** Items ordered by date (ties by title), without changing the input. */
export function sortRadarItems(items: readonly RadarItem[]): RadarItem[] {
  return [...items].sort(byDate);
}

/**
 * The phone widget's rules: events from today to `daysAhead` days out (timed events that already
 * ended are skipped), narrowed by calendar names and title keywords (empty = no narrowing);
 * incomplete reminders when `includeReminders`, from `overdueDaysBack` days ago to the same horizon,
 * narrowed by list names. Sorted by date. Day boundaries are local calendar days, so DST never
 * shifts an item to the wrong day.
 */
export function selectRadarItems(items: readonly RadarItem[], config: RadarFilter, now: Date): RadarItem[] {
  const today = startOfDay(now);
  const horizon = addDays(today, config.daysAhead).getTime();
  const earliest = addDays(today, -config.overdueDaysBack).getTime();
  const keywords = config.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  const out = items.filter((item) => {
    if (item.kind === 'reminder') {
      if (!config.includeReminders) return false;
      if (config.reminderLists.length && !config.reminderLists.includes(item.source)) return false;
      return item.date >= earliest && item.date <= horizon;
    }
    if (config.calendars.length && !config.calendars.includes(item.source)) return false;
    if (keywords.length && !keywords.some((k) => item.title.toLowerCase().includes(k))) return false;
    if (item.date >= horizon) return false;
    const end = item.end ?? item.date;
    if (!item.allDay && end <= now.getTime()) return false;
    return end >= today.getTime();
  });
  return sortRadarItems(out);
}

/** Whole local calendar days from today to the item's day; negative when overdue. */
export function radarDaysUntil(date: number | Date, now: Date): number {
  return daysBetween(new Date(date), now);
}
type DatedItem = Pick<RadarItem, 'date' | 'allDay'> & Partial<Pick<RadarItem, 'kind' | 'end'>>;
/** An event that began on an earlier day but has not ended yet: it is happening now, not overdue. */
function isRunningEvent(item: DatedItem, now: Date): boolean {
  return item.kind === 'event' && item.end !== undefined && item.end > now.getTime() && item.date <= now.getTime();
}
/**
 * Days to count and colour an item by. Like `radarDaysUntil`, except that a multi-day event that is
 * still running counts as today (0), never as overdue. Reminders keep their overdue days.
 */
export function radarItemDays(item: DatedItem, now: Date): number {
  const days = radarDaysUntil(item.date, now);
  return days < 0 && isRunningEvent(item, now) ? 0 : days;
}
/** 0 or fewer days red, 2 or fewer orange, 7 or fewer yellow, otherwise green. */
export function radarUrgency(days: number): Urgency {
  if (days <= 0) return 'red';
  if (days <= 2) return 'orange';
  if (days <= 7) return 'yellow';
  return 'green';
}
export function radarColor(days: number, appearance: Pick<Settings['appearance'], Urgency>): string {
  return appearance[radarUrgency(days)];
}
function clock12(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
/** "3d overdue", "Now" (a running multi-day event), "Today" / "Today 2:30 PM", "Tomorrow", "5 days". */
export function radarLabel(
  item: DatedItem,
  now: Date,
  formatTime: (d: Date) => string = clock12
): string {
  const days = radarItemDays(item, now);
  if (days < 0) return `${-days}d overdue`;
  if (days === 0 && radarDaysUntil(item.date, now) < 0) return item.allDay ? 'Today' : 'Now';
  if (days === 0) return item.allDay ? 'Today' : `Today ${formatTime(new Date(item.date))}`;
  if (days === 1) return 'Tomorrow';
  return `${days} days`;
}

export interface RoomBeforeEvent {
  title: string;
  /** Epoch ms the event starts. */
  start: number;
  /** Whole minutes between now and the start. */
  minutes: number;
  /** Whole focus blocks that fit before it. */
  blocks: number;
}
/** The next timed (non-all-day) calendar event that starts later today, and how many focus blocks fit before it. */
export function roomBeforeNextEvent(
  items: readonly RadarItem[],
  now: Date,
  blockMinutes: number
): RoomBeforeEvent | null {
  const endOfToday = addDays(startOfDay(now), 1).getTime();
  const next = sortRadarItems(items).find(
    (i) => i.kind === 'event' && !i.allDay && i.date > now.getTime() && i.date < endOfToday
  );
  if (!next) return null;
  const minutes = Math.floor((next.date - now.getTime()) / 60000);
  return { title: next.title, start: next.date, minutes, blocks: roomForBlocks(minutes, blockMinutes) };
}
