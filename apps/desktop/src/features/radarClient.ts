import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { addDays, startOfDay } from '@daybar/core';
import type { RadarItem } from '@daybar/core';

/** Authorization for one kind of data, as reported by EventKit. */
export type Access =
  | 'notDetermined'
  | 'denied'
  | 'restricted'
  | 'fullAccess'
  | 'writeOnly'
  | 'unsupported';
export interface RadarStatus {
  /** False where there is no EventKit (anything but the Mac app). */
  supported: boolean;
  events: Access;
  reminders: Access;
}
export interface RadarCalendar {
  title: string;
  /** The account it lives in (iCloud, Google, ...). */
  account: string;
}
export interface RadarCalendars {
  events: RadarCalendar[];
  reminders: RadarCalendar[];
}
export interface RadarItems {
  items: RadarItem[];
  status: RadarStatus;
  /** When the native cache last read EventKit (epoch ms); null before the first read. */
  refreshedAt: number | null;
  error: string | null;
}

/**
 * The only way Radar UI reaches the native side. It is a separate small interface so the shared
 * `DaybarClient` does not change. Nothing here asks for permission until `requestAccess` is called.
 */
export interface RadarClient {
  status(): Promise<RadarStatus>;
  /** Asks macOS for access (events, then reminders when Radar includes them) and returns the status. */
  requestAccess(): Promise<RadarStatus>;
  calendars(): Promise<RadarCalendars>;
  /** Items for the saved Radar configuration. `refresh` forces a re-read of Calendar. */
  items(refresh?: boolean): Promise<RadarItems>;
  /** Called when the native cache or the permissions change. */
  subscribe(onChange: () => void): Promise<() => void>;
}

export const tauriRadarClient: RadarClient = {
  status: () => invoke<RadarStatus>('radar_status'),
  requestAccess: () => invoke<RadarStatus>('radar_request_access'),
  calendars: () => invoke<RadarCalendars>('radar_calendars'),
  items: (refresh = false) => invoke<RadarItems>('radar_items', { refresh }),
  subscribe: (onChange) => listen('daybar://radar', onChange)
};

const fullAccess: RadarStatus = { supported: true, events: 'fullAccess', reminders: 'fullAccess' };

/** A realistic spread, from overdue to 40 days out, relative to the clock. Kept in memory only. */
export function sampleItems(now: Date): RadarItem[] {
  const today = startOfDay(now);
  const at = (days: number, hour = 0, minute = 0) => {
    const d = addDays(today, days);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute).getTime();
  };
  const reminder = (id: string, title: string, days: number, source: string): RadarItem => ({
    id, title, date: at(days), allDay: true, source, kind: 'reminder'
  });
  const allDay = (id: string, title: string, days: number, source: string): RadarItem => ({
    id, title, date: at(days), end: at(days, 23, 59), allDay: true, source, kind: 'event'
  });
  const timed = (id: string, title: string, start: number, minutes: number, source: string): RadarItem => ({
    id, title, date: start, end: start + minutes * 60000, allDay: false, source, kind: 'event'
  });
  // A timed event a few hours from now (rounded to a quarter hour), or tomorrow morning late at night.
  let soon = Math.ceil((now.getTime() + 3 * 3600000) / 900000) * 900000;
  if (new Date(soon).getDate() !== now.getDate()) soon = at(1, 10);
  return [
    reminder('demo-return', 'Return library books', -2, 'Errands'),
    timed('demo-review', 'Design review', soon, 45, 'Work'),
    reminder('demo-permit', 'Renew parking permit', 1, 'Errands'),
    allDay('demo-essay', 'Essay draft due', 2, 'School'),
    timed('demo-dentist', 'Dentist appointment', at(4, 14), 60, 'Home'),
    allDay('demo-reg', 'Conference registration closes', 12, 'Work'),
    timed('demo-quarterly', 'Quarterly review', at(21, 10), 90, 'Work'),
    allDay('demo-exam', 'Final exam', 40, 'School')
  ];
}
export const sampleCalendars: RadarCalendars = {
  events: [
    { title: 'Home', account: 'iCloud' },
    { title: 'School', account: 'iCloud' },
    { title: 'Work', account: 'iCloud' }
  ],
  reminders: [
    { title: 'Errands', account: 'iCloud' },
    { title: 'School', account: 'iCloud' }
  ]
};

/** The browser-demo client: sample data, and a permission that "turns on" when asked. */
export function createDemoRadarClient(
  options: {
    clock?: () => Date;
    status?: RadarStatus;
    /** What the status becomes after `requestAccess`. */
    grantedStatus?: RadarStatus;
    items?: RadarItem[];
    calendars?: RadarCalendars;
  } = {}
): RadarClient {
  const clock = options.clock ?? (() => new Date());
  let status = options.status ?? fullAccess;
  const listeners = new Set<() => void>();
  return {
    async status() {
      return { ...status };
    },
    async requestAccess() {
      if (status.events === 'notDetermined' || status.reminders === 'notDetermined') {
        status = options.grantedStatus ?? fullAccess;
        listeners.forEach((fn) => fn());
      }
      return { ...status };
    },
    async calendars() {
      return structuredClone(options.calendars ?? sampleCalendars);
    },
    async items() {
      const readable = status.events === 'fullAccess' || status.reminders === 'fullAccess';
      return {
        items: readable ? structuredClone(options.items ?? sampleItems(clock())) : [],
        status: { ...status },
        refreshedAt: clock().getTime(),
        error: null
      };
    },
    async subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    }
  };
}

let override: RadarClient | null = null;
let demo: RadarClient | null = null;
/** Tests (and nothing else) swap the client. Pass null to restore the default. */
export function setRadarClient(client: RadarClient | null): void {
  override = client;
}
/** The Tauri client inside the app, the in-memory demo in a browser. */
export function getRadarClient(): RadarClient {
  if (override) return override;
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) return tauriRadarClient;
  return (demo ??= createDemoRadarClient());
}
