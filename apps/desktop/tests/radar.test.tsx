import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultFeatures } from '@daybar/core/contracts';
import type { Snapshot } from '@daybar/core/contracts';
import { Dashboard } from '../src/components/dashboard';
import { SettingsPanel } from '../src/components/settings';
import { Config, TodayCard, View } from '../src/features/radar';
import {
  createDemoRadarClient,
  sampleItems,
  setRadarClient
} from '../src/features/radarClient';
import type { RadarClient, RadarStatus } from '../src/features/radarClient';
import { resetAutoRequest } from '../src/features/radarState';
import { TodayCard as RoomCard } from '../src/features/roomBeforeEvent';
import { demoUpdater } from '../src/lib/updates';
import { fixture } from './fixtures';

const now = new Date(2026, 10, 16, 12, 0);
const status = (events: RadarStatus['events'], reminders = events): RadarStatus => ({
  supported: true,
  events,
  reminders
});
function radarOn(extra: Partial<Snapshot['preferences']['features']['radar']> = {}): Snapshot {
  const s = fixture();
  s.preferences.features.radar = { ...defaultFeatures.radar, enabled: true, ...extra };
  return s;
}
function viewProps(snapshot: Snapshot) {
  return {
    snapshot,
    now,
    busy: false,
    run: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
    savePreferences: vi.fn(async () => true)
  };
}
const use = (client: RadarClient) => setRadarClient(client);

beforeEach(() => resetAutoRequest());
afterEach(() => setRadarClient(null));

describe('demo radar client', () => {
  it('offers about eight realistic items from overdue to 40 days out, and sample calendars', async () => {
    const items = sampleItems(now);
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(items.length).toBeLessThanOrEqual(10);
    const days = items.map((i) => Math.round((i.date - new Date(2026, 10, 16).getTime()) / 86400000));
    expect(Math.min(...days)).toBeLessThan(0);
    expect(Math.max(...days)).toBe(40);
    expect(items.some((i) => i.kind === 'reminder')).toBe(true);
    expect(items.some((i) => !i.allDay)).toBe(true);
    const client = createDemoRadarClient({ clock: () => now });
    expect((await client.calendars()).events.map((c) => c.title)).toEqual(['Home', 'School', 'Work']);
    expect((await client.status()).events).toBe('fullAccess');
  });
  it('grants access only when asked, and tells subscribers', async () => {
    const client = createDemoRadarClient({ clock: () => now, status: status('notDetermined') });
    const changed = vi.fn();
    await client.subscribe(changed);
    expect((await client.items()).items).toEqual([]);
    expect((await client.requestAccess()).events).toBe('fullAccess');
    expect(changed).toHaveBeenCalledTimes(1);
    expect((await client.items()).items.length).toBeGreaterThan(5);
  });
});

describe('Deadline Radar view', () => {
  it('lists items with source, label, date and an urgency accent from the app colours', async () => {
    use(createDemoRadarClient({ clock: () => now }));
    const snapshot = radarOn();
    snapshot.settings.appearance.red = '#aa0000';
    snapshot.settings.appearance.yellow = '#bbbb00';
    snapshot.settings.appearance.green = '#00cc00';
    render(<View {...viewProps(snapshot)} />);
    const list = await screen.findByRole('list', { name: 'Upcoming deadlines' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.length).toBe(sampleItems(now).length);
    expect(rows[0]).toHaveTextContent('Return library books');
    expect(rows[0]).toHaveTextContent('Errands · Reminder');
    expect(rows[0]).toHaveTextContent('2d overdue');
    expect(rows[0]).toHaveTextContent('Sat, Nov 14');
    expect((rows[0].firstElementChild as HTMLElement).style.background).toBe('rgb(170, 0, 0)');
    expect(within(rows[1]).getByText(/^Today 3:00 PM$/)).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('Tomorrow');
    expect(screen.getByText('8 upcoming')).toBeInTheDocument();
    const last = rows[rows.length - 1];
    expect(last).toHaveTextContent('40 days');
    expect((last.firstElementChild as HTMLElement).style.background).toBe('rgb(0, 204, 0)');
    const dentist = rows.find((r) => r.textContent?.includes('Dentist'))!;
    expect(within(dentist).getByText('4 days')).toHaveStyle({ color: 'rgb(187, 187, 0)' });
  });
  it('applies the saved filters on this side too', async () => {
    use(createDemoRadarClient({ clock: () => now }));
    render(<View {...viewProps(radarOn({ calendars: ['School'], includeReminders: false, keywords: ['exam'] }))} />);
    const list = await screen.findByRole('list', { name: 'Upcoming deadlines' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('Final exam');
  });
  it('says so when nothing is due', async () => {
    use(createDemoRadarClient({ clock: () => now, items: [] }));
    render(<View {...viewProps(radarOn())} />);
    expect(await screen.findByText('Nothing due. Enjoy it.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
  it('refresh asks the native side to re-read', async () => {
    const client = createDemoRadarClient({ clock: () => now });
    const items = vi.spyOn(client, 'items');
    use(client);
    render(<View {...viewProps(radarOn())} />);
    await screen.findByRole('list');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(items).toHaveBeenLastCalledWith(true));
  });
  it('explains the permission, asks once automatically and offers Grant access', async () => {
    const client = createDemoRadarClient({ clock: () => now, status: status('notDetermined') });
    const request = vi.spyOn(client, 'requestAccess');
    use(client);
    render(<View {...viewProps(radarOn())} />);
    // Turning Radar on triggers the prompt once, without a click.
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('list', { name: 'Upcoming deadlines' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grant access' })).toBeNull();
  });
  it('shows a Grant access button while undetermined and does not re-ask on its own', async () => {
    const client = createDemoRadarClient({ clock: () => now, status: status('notDetermined') });
    const request = vi.spyOn(client, 'requestAccess').mockImplementation(async () => status('notDetermined'));
    use(client);
    render(<View {...viewProps(radarOn())} />);
    const grant = await screen.findByRole('button', { name: 'Grant access' });
    expect(screen.getByText(/needs your permission to read Calendars/)).toBeInTheDocument();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    fireEvent.click(grant);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Nothing due. Enjoy it.')).toBeNull();
  });
  it('tells a person with denied access how to turn it on in System Settings', async () => {
    use(createDemoRadarClient({ clock: () => now, status: status('denied', 'denied') }));
    render(<View {...viewProps(radarOn())} />);
    const note = await screen.findByText(/System Settings → Privacy & Security → Calendars/);
    expect(note).toBeInTheDocument();
    expect(screen.getByText(/System Settings → Privacy & Security → Reminders/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grant access' })).toBeNull();
    expect(screen.queryByText('Nothing due. Enjoy it.')).toBeNull();
  });
  it('only mentions Reminders when Radar includes them, and handles partial access', async () => {
    use(createDemoRadarClient({ clock: () => now, status: status('fullAccess', 'denied') }));
    const { unmount } = render(<View {...viewProps(radarOn())} />);
    expect(await screen.findByText(/Reminders access is off/)).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    unmount();
    render(<View {...viewProps(radarOn({ includeReminders: false }))} />);
    await screen.findByRole('list');
    expect(screen.queryByText(/Reminders access is off/)).toBeNull();
  });
  it('explains that Radar needs the Mac app when EventKit is unavailable', async () => {
    use(createDemoRadarClient({ status: { supported: false, events: 'unsupported', reminders: 'unsupported' } }));
    render(<View {...viewProps(radarOn())} />);
    expect(await screen.findByText(/works in the Daybar app on a Mac only/)).toBeInTheDocument();
  });
  it('shows a native read error', async () => {
    const client = createDemoRadarClient({ clock: () => now });
    vi.spyOn(client, 'items').mockRejectedValue(new Error('Calendar did not answer in time'));
    use(client);
    render(<View {...viewProps(radarOn())} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Calendar did not answer in time');
  });
});

describe('Today card', () => {
  it('shows the next three items', async () => {
    use(createDemoRadarClient({ clock: () => now }));
    render(<TodayCard {...viewProps(radarOn())} />);
    const list = await screen.findByRole('list', { name: 'Upcoming deadlines' });
    expect(within(list).getAllByRole('listitem').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Return library books'),
      expect.stringContaining('Design review'),
      expect.stringContaining('Renew parking permit')
    ]);
  });
  it('points to the page when access is missing, and is cheerful when nothing is due', async () => {
    use(createDemoRadarClient({ clock: () => now, status: status('denied') }));
    const { unmount } = render(<TodayCard {...viewProps(radarOn())} />);
    expect(await screen.findByText(/needs access to Calendar/)).toBeInTheDocument();
    unmount();
    use(createDemoRadarClient({ clock: () => now, items: [] }));
    render(<TodayCard {...viewProps(radarOn())} />);
    expect(await screen.findByText('Nothing due. Enjoy it.')).toBeInTheDocument();
  });
});

describe('Room before an event card', () => {
  it('counts whole focus blocks before the next timed event today', async () => {
    use(createDemoRadarClient({ clock: () => now }));
    const snapshot = radarOn();
    snapshot.preferences.features.roomBeforeEvent.enabled = true;
    snapshot.settings.focus.blockMinutes = 25;
    render(<RoomCard {...viewProps(snapshot)} />);
    // Design review is at 3:00 PM, three hours (180 min) away: 7 blocks of 25.
    const line = await screen.findByText(/Room for ~/);
    expect(line).toHaveTextContent(/Room for ~7 focus blocks before Design review at 3:00\s*PM/);
    expect(screen.getByText(/180 min until it starts · 25 min \/ block/)).toBeInTheDocument();
  });
  it('uses the configured block length and says "block" for one', async () => {
    const start = new Date(2026, 10, 16, 12, 40).getTime();
    use(
      createDemoRadarClient({
        clock: () => now,
        items: [{ id: 'a', title: 'Call', date: start, end: start + 1800000, allDay: false, source: 'Work', kind: 'event' }]
      })
    );
    const snapshot = radarOn();
    snapshot.settings.focus.blockMinutes = 30;
    render(<RoomCard {...viewProps(snapshot)} />);
    expect(await screen.findByText(/Room for ~/)).toHaveTextContent(/Room for ~1 focus block before Call/);
  });
  it('says so when there is no later timed event today', async () => {
    use(createDemoRadarClient({ clock: () => now, items: sampleItems(now).filter((i) => i.allDay) }));
    render(<RoomCard {...viewProps(radarOn())} />);
    expect(await screen.findByText(/No more timed events today/)).toBeInTheDocument();
  });
});

describe('Radar settings', () => {
  function setup(value = defaultFeatures.radar, client = createDemoRadarClient({ clock: () => now })) {
    use(client);
    const snapshot = radarOn(value);
    const save = vi.fn(async () => true);
    const props = {
      id: 'radar' as const,
      value: snapshot.preferences.features.radar,
      features: snapshot.preferences.features,
      snapshot,
      busy: false,
      save
    };
    return { ...render(<Config {...props} />), save, props };
  }
  const lastSaved = (save: ReturnType<typeof vi.fn>) => save.mock.calls.at(-1)![0];

  it('lists calendars and reminder lists as checklists where empty means all', async () => {
    setup();
    const calendars = await screen.findByRole('group', { name: 'Calendars' });
    await within(calendars).findAllByRole('checkbox');
    expect(within(calendars).getAllByRole('checkbox').map((c) => (c as HTMLInputElement).checked)).toEqual([true, true, true]);
    expect(within(calendars).getByText('All are included.')).toBeInTheDocument();
    const lists = screen.getByRole('group', { name: 'Reminder lists' });
    expect(await within(lists).findAllByRole('checkbox')).toHaveLength(2);
  });
  it('unchecking one calendar saves the others; checking them all again saves an empty list', async () => {
    const first = setup();
    const calendars = await screen.findByRole('group', { name: 'Calendars' });
    fireEvent.click(await within(calendars).findByRole('checkbox', { name: /Home/ }));
    await waitFor(() => expect(first.save).toHaveBeenCalled());
    expect(lastSaved(first.save).calendars).toEqual(['School', 'Work']);
    first.unmount();
    const second = setup({ ...defaultFeatures.radar, calendars: ['School', 'Work'] });
    const again = await screen.findByRole('group', { name: 'Calendars' });
    expect(await within(again).findByText('2 of 3 included.')).toBeInTheDocument();
    fireEvent.click(within(again).getByRole('checkbox', { name: /Home/ }));
    await waitFor(() => expect(second.save).toHaveBeenCalled());
    expect(lastSaved(second.save).calendars).toEqual([]);
  });
  it('will not let the last calendar be unchecked', async () => {
    setup({ ...defaultFeatures.radar, reminderLists: ['Errands'] });
    const lists = await screen.findByRole('group', { name: 'Reminder lists' });
    expect(await within(lists).findByRole('checkbox', { name: /Errands/ })).toBeDisabled();
    expect(within(lists).getByRole('checkbox', { name: /School/ })).not.toBeDisabled();
  });
  it('saves includeReminders and hides the list picker without it', async () => {
    const { save, rerender, props } = setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Include Reminders/ }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(lastSaved(save).includeReminders).toBe(false);
    rerender(<Config {...props} value={{ ...props.value, includeReminders: false }} />);
    expect(screen.queryByRole('group', { name: 'Reminder lists' })).toBeNull();
  });
  it('saves valid day counts on blur and restores invalid ones', async () => {
    const { save } = setup();
    const ahead = await screen.findByLabelText('Look ahead (days)');
    fireEvent.change(ahead, { target: { value: '30' } });
    fireEvent.blur(ahead);
    expect(lastSaved(save).daysAhead).toBe(30);
    const back = screen.getByLabelText('Show overdue reminders back (days)');
    fireEvent.change(back, { target: { value: '0' } });
    fireEvent.blur(back);
    expect(lastSaved(save).overdueDaysBack).toBe(0);
    save.mockClear();
    fireEvent.change(ahead, { target: { value: '400' } });
    fireEvent.blur(ahead);
    expect(save).not.toHaveBeenCalled();
    expect(ahead).toHaveValue(60);
    fireEvent.change(back, { target: { value: '-1' } });
    fireEvent.blur(back);
    expect(save).not.toHaveBeenCalled();
    expect(back).toHaveValue(14);
  });
  it('saves comma-separated keywords, trimmed and without duplicates', async () => {
    const { save } = setup();
    const words = await screen.findByLabelText(/Only events whose title contains/);
    fireEvent.change(words, { target: { value: ' exam, Due ,, exam ' } });
    fireEvent.blur(words);
    expect(lastSaved(save).keywords).toEqual(['exam', 'Due']);
  });
  it('saves the due alert switch and time, and disables the time while it is off', async () => {
    const { save, rerender, props } = setup();
    const time = await screen.findByLabelText('Due alert time');
    expect(time).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Notify me about what is due tomorrow/ }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(lastSaved(save).dueAlerts).toBe(true);
    rerender(<Config {...props} value={{ ...props.value, dueAlerts: true }} />);
    expect(screen.getByLabelText('Due alert time')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Due alert time'), { target: { value: '18:30' } });
    expect(lastSaved(save).alertTime).toBe('18:30');
  });
  it('shows the permission and a Grant access button, asking once when it was undetermined', async () => {
    const client = createDemoRadarClient({ clock: () => now, status: status('notDetermined') });
    const request = vi.spyOn(client, 'requestAccess');
    setup(defaultFeatures.radar, client);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    // The demo grants on request, so the notice goes away and the lists fill in.
    expect(await screen.findByText(/Calendar access is on, and so is Reminders\./)).toBeInTheDocument();
    expect(await screen.findByRole('group', { name: 'Calendars' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grant access' })).toBeNull();
  });
  it('explains a denied permission without offering to ask again', async () => {
    setup(defaultFeatures.radar, createDemoRadarClient({ clock: () => now, status: status('denied') }));
    expect(await screen.findByText(/System Settings → Privacy & Security → Calendars/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grant access' })).toBeNull();
  });
  it('disables every control while a save is in flight', async () => {
    const client = createDemoRadarClient({ clock: () => now });
    use(client);
    const snapshot = radarOn();
    render(
      <Config
        id="radar"
        value={snapshot.preferences.features.radar}
        features={snapshot.preferences.features}
        snapshot={snapshot}
        busy
        save={vi.fn(async () => true)}
      />
    );
    await screen.findByRole('group', { name: 'Calendars' });
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getByLabelText('Look ahead (days)')).toBeDisabled();
  });
});

describe('integration', () => {
  function app(snapshot: Snapshot) {
    return {
      snapshot: vi.fn(async () => structuredClone(snapshot)),
      mutate: vi.fn(async () => ({ snapshot })),
      setPreferences: vi.fn(async () => snapshot),
      resolveConflict: vi.fn(async () => snapshot),
      subscribe: vi.fn(async () => () => undefined)
    };
  }
  it('adds the Deadline Radar page, a Deadlines card and the Room card once the features are on', async () => {
    use(createDemoRadarClient({ clock: () => new Date() }));
    const s = radarOn();
    s.preferences.features.roomBeforeEvent.enabled = true;
    render(<Dashboard client={app(s)} />);
    expect(await screen.findByRole('heading', { name: 'Deadlines' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Room before your next event' })).toBeInTheDocument();
    const nav = within(screen.getByRole('navigation', { name: 'Modules' }));
    fireEvent.click(nav.getByRole('button', { name: /Deadline Radar/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Deadline Radar' })).toBeInTheDocument();
  });
  it('does not show the Room card while Radar is off', async () => {
    use(createDemoRadarClient());
    const s = fixture();
    s.preferences.features.roomBeforeEvent.enabled = true;
    render(<Dashboard client={app(s)} />);
    await screen.findByRole('heading', { level: 1, name: 'Here & now.' });
    expect(screen.queryByRole('heading', { name: 'Room before your next event' })).toBeNull();
  });
  it('offers "Next deadline" in the menu-bar label only while Radar is on', () => {
    const props = (snapshot: Snapshot) => ({
      snapshot,
      now,
      busy: false,
      run: vi.fn(async () => true),
      confirm: vi.fn(async () => true),
      savePreferences: vi.fn(async () => true),
      updater: demoUpdater
    });
    const { unmount } = render(<SettingsPanel {...props(fixture())} />);
    const select = screen.getByRole('combobox', { name: 'Menu-bar label' });
    expect(within(select).queryByRole('option', { name: 'Next deadline' })).toBeNull();
    unmount();
    use(createDemoRadarClient());
    render(<SettingsPanel {...props(radarOn())} />);
    const on = screen.getByRole('combobox', { name: 'Menu-bar label' });
    expect(within(on).getByRole('option', { name: 'Next deadline' })).toHaveValue('nextDeadline');
  });
});



