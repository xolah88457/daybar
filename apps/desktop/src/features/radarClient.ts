import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { addDays, startOfDay } from '@daybar/core';
import type { RadarItem } from '@daybar/core';
import { isWindows } from '../lib/platform';

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
  /** Signed in to Google, which is read without macOS Calendar access. */
  google?: boolean;
  /** Google sign-in is available (the Mac and Windows apps). On Windows it is the whole radar. */
  googleSupported?: boolean;
}
/** The Google sign-in, kept in the macOS Keychain or the Windows Credential Manager. */
export interface GoogleStatus {
  /** False outside the Mac and Windows apps. */
  supported: boolean;
  connected: boolean;
  /** The signed-in address, when connected. */
  account: string | null;
  /** The sign-in includes Google Tasks (false for one made before 0.4.0). */
  tasks?: boolean;
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
  googleStatus(): Promise<GoogleStatus>;
  /**
   * Opens Google's consent page in the browser and resolves once the person comes back (or after
   * five minutes). The client ID and secret come from the person's own Google Cloud project.
   */
  googleConnect(clientId: string, clientSecret: string): Promise<GoogleStatus>;
  /** Revokes the sign-in and forgets it. */
  googleDisconnect(): Promise<GoogleStatus>;
}

export const tauriRadarClient: RadarClient = {
  status: () => invoke<RadarStatus>('radar_status'),
  requestAccess: () => invoke<RadarStatus>('radar_request_access'),
  calendars: () => invoke<RadarCalendars>('radar_calendars'),
  items: (refresh = false) => invoke<RadarItems>('radar_items', { refresh }),
  subscribe: (onChange) => listen('daybar://radar', onChange),
  googleStatus: () => invoke<GoogleStatus>('radar_google_status'),
  googleConnect: (clientId, clientSecret) =>
    invoke<GoogleStatus>('radar_google_connect', { clientId, clientSecret }),
  googleDisconnect: () => invoke<GoogleStatus>('radar_google_disconnect')
};

/** The client ID shape Google issues for OAuth clients. */
export const googleClientIdPattern = /^[\w.-]+\.apps\.googleusercontent\.com$/;

const fullAccess: RadarStatus = {
  supported: true,
  events: 'fullAccess',
  reminders: 'fullAccess',
  googleSupported: true
};
/** What the Windows app reports: no EventKit, Google only. */
export const googleOnly: RadarStatus = {
  supported: false,
  events: 'unsupported',
  reminders: 'unsupported',
  googleSupported: true
};
const demoGoogleAccount = 'you@gmail.com';

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
    /** Start signed in to Google. */
    google?: boolean;
  } = {}
): RadarClient {
  const clock = options.clock ?? (() => new Date());
  // A demo opened on Windows looks like the Windows app: Google only, already signed in.
  const windowsDemo = !options.status && isWindows();
  let status = options.status ?? (windowsDemo ? googleOnly : fullAccess);
  let google = options.google ?? windowsDemo;
  const listeners = new Set<() => void>();
  const googleStatus = (): GoogleStatus => ({
    supported: status.googleSupported !== false,
    connected: google,
    account: google ? demoGoogleAccount : null,
    tasks: google
  });
  const googleItems = (): RadarItem[] => {
    const d = addDays(startOfDay(clock()), 3);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 11).getTime();
    const due = addDays(startOfDay(clock()), 5).getTime();
    return [
      { id: 'google:demo-standup', title: 'Team offsite planning', date: start, end: start + 3600000, allDay: false, source: 'Team', kind: 'event' },
      { id: 'google-task:demo-expenses', title: 'Submit expense report', date: due, allDay: true, source: 'My Tasks', kind: 'reminder' }
    ];
  };
  return {
    async status() {
      return { ...status, google };
    },
    async requestAccess() {
      if (status.events === 'notDetermined' || status.reminders === 'notDetermined') {
        status = options.grantedStatus ?? fullAccess;
        listeners.forEach((fn) => fn());
      }
      return { ...status };
    },
    async calendars() {
      const lists = structuredClone(options.calendars ?? sampleCalendars);
      if (windowsDemo)
        for (const c of [...lists.events, ...lists.reminders]) c.account = `Google · ${demoGoogleAccount}`;
      if (google) {
        lists.events.push({ title: 'Team', account: `Google · ${demoGoogleAccount}` });
        lists.reminders.push({ title: 'My Tasks', account: `Google · ${demoGoogleAccount}` });
      }
      return lists;
    },
    async items() {
      // The Windows demo shows the sample spread as if it came from Google.
      const readable =
        status.events === 'fullAccess' || status.reminders === 'fullAccess' || (windowsDemo && google);
      const own = readable ? structuredClone(options.items ?? sampleItems(clock())) : [];
      return {
        items: google ? [...own, ...googleItems()].sort((a, b) => a.date - b.date) : own,
        status: { ...status, google },
        refreshedAt: clock().getTime(),
        error: null
      };
    },
    async subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    async googleStatus() {
      return googleStatus();
    },
    async googleConnect(clientId, clientSecret) {
      if (!googleClientIdPattern.test(clientId.trim()))
        throw new Error('That does not look like a Google OAuth client ID (it ends in .apps.googleusercontent.com).');
      if (!clientSecret.trim()) throw new Error('Paste the client secret that came with the client ID.');
      google = true;
      listeners.forEach((fn) => fn());
      return googleStatus();
    },
    async googleDisconnect() {
      google = false;
      listeners.forEach((fn) => fn());
      return googleStatus();
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
