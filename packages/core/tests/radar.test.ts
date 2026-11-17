import { describe, expect, it } from 'vitest';
import {
  addDays,
  defaultSettings,
  radarColor,
  radarDaysUntil,
  radarItemDays,
  radarLabel,
  radarUrgency,
  roomBeforeNextEvent,
  selectRadarItems,
  sortRadarItems,
  startOfDay
} from '../src';
import type { RadarFilter, RadarItem } from '../src';

const all: RadarFilter = {
  calendars: [], reminderLists: [], includeReminders: true, daysAhead: 60, overdueDaysBack: 14, keywords: []
};
const now = new Date(2026, 10, 16, 12, 0);
const at = (days: number, h = 0, m = 0) => {
  const d = addDays(now, days);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
};
const ev = (title: string, date: number, extra: Partial<RadarItem> = {}): RadarItem => ({
  title, date, allDay: false, source: 'Work', kind: 'event', end: date + 3600_000, ...extra
});
const rem = (title: string, date: number, extra: Partial<RadarItem> = {}): RadarItem => ({
  title, date, allDay: true, source: 'School', kind: 'reminder', ...extra
});

describe('selectRadarItems', () => {
  it('sorts by date and keeps events and reminders together', () => {
    const out = selectRadarItems([ev('B', at(3, 9)), rem('A', at(1)), ev('C', at(0, 15))], all, now);
    expect(out.map((i) => i.title)).toEqual(['C', 'A', 'B']);
  });
  it('skips timed events that already ended but keeps running and all-day ones', () => {
    const items = [
      ev('Done', at(0, 9)), // 9-10 today, ended
      ev('Running', at(0, 11, 30)), // 11:30-12:30, in progress
      ev('Holiday', at(0), { allDay: true, end: at(0, 23, 59) })
    ];
    expect(selectRadarItems(items, all, now).map((i) => i.title)).toEqual(['Holiday', 'Running']);
  });
  it('honours the horizon for events and reminders', () => {
    const cfg = { ...all, daysAhead: 7 };
    const out = selectRadarItems([ev('In', at(6, 10)), ev('Out', at(7, 10)), rem('RemIn', at(7)), rem('RemOut', at(8))], cfg, now);
    expect(out.map((i) => i.title)).toEqual(['In', 'RemIn']);
  });
  it('includes overdue reminders back to overdueDaysBack only', () => {
    const cfg = { ...all, overdueDaysBack: 3 };
    const out = selectRadarItems([rem('Old', at(-4)), rem('Edge', at(-3)), rem('Late', at(-1))], cfg, now);
    expect(out.map((i) => i.title)).toEqual(['Edge', 'Late']);
  });
  it('drops reminders when includeReminders is off', () => {
    expect(selectRadarItems([rem('R', at(1)), ev('E', at(1, 9))], { ...all, includeReminders: false }, now).map((i) => i.title)).toEqual(['E']);
  });
  it('filters by calendar and reminder-list names; empty means all', () => {
    const items = [ev('W', at(1, 9)), ev('H', at(1, 10), { source: 'Home' }), rem('S', at(1)), rem('X', at(1), { source: 'Other' })];
    expect(selectRadarItems(items, { ...all, calendars: ['Home'] }, now).map((i) => i.title)).toEqual(['S', 'X', 'H']);
    expect(selectRadarItems(items, { ...all, reminderLists: ['School'] }, now).map((i) => i.title)).toEqual(['S', 'W', 'H']);
  });
  it('matches keywords case-insensitively on event titles only', () => {
    const items = [ev('Final EXAM', at(2, 9)), ev('Lunch', at(2, 12)), rem('exam form', at(2))];
    const out = selectRadarItems(items, { ...all, keywords: ['Exam', '  '] }, now);
    expect(out.map((i) => i.title)).toEqual(['exam form', 'Final EXAM']);
  });
  it('does not change its input', () => {
    const items = [ev('B', at(3, 9)), ev('A', at(1, 9))];
    const copy = structuredClone(items);
    selectRadarItems(items, all, now);
    expect(items).toEqual(copy);
    expect(sortRadarItems(items).map((i) => i.title)).toEqual(['A', 'B']);
  });
});

describe('urgency and labels', () => {
  it('maps days to red, orange, yellow and green at the boundaries', () => {
    expect([-5, 0, 1, 2, 3, 7, 8, 40].map(radarUrgency)).toEqual(['red', 'red', 'orange', 'orange', 'yellow', 'yellow', 'green', 'green']);
  });
  it('uses the appearance colours', () => {
    const a = { ...defaultSettings.appearance, red: '#111111', orange: '#222222', yellow: '#333333', green: '#444444' };
    expect([0, 2, 7, 30].map((d) => radarColor(d, a))).toEqual(['#111111', '#222222', '#333333', '#444444']);
  });
  it('labels overdue, today (with time for timed items), tomorrow and later', () => {
    expect(radarLabel({ date: at(-3), allDay: true }, now)).toBe('3d overdue');
    expect(radarLabel({ date: at(0), allDay: true }, now)).toBe('Today');
    expect(radarLabel({ date: at(0, 14, 5), allDay: false }, now)).toBe('Today 2:05 PM');
    expect(radarLabel({ date: at(0, 0, 30), allDay: false }, now)).toBe('Today 12:30 AM');
    expect(radarLabel({ date: at(1, 8), allDay: false }, now)).toBe('Tomorrow');
    expect(radarLabel({ date: at(12), allDay: true }, now)).toBe('12 days');
    expect(radarLabel({ date: at(0, 14, 5), allDay: false }, now, () => '14:05')).toBe('Today 14:05');
  });
});

describe('events that are still running', () => {
  const trip = ev('Conference', at(-2, 9), { end: at(2, 17) });
  it('counts a multi-day event in progress as today, not overdue', () => {
    expect(radarItemDays(trip, now)).toBe(0);
    expect(radarUrgency(radarItemDays(trip, now))).toBe('red');
    expect(radarLabel(trip, now)).toBe('Now');
    expect(radarLabel(ev('Retreat', at(-1), { allDay: true, end: at(3) }), now)).toBe('Today');
  });
  it('keeps overdue for reminders, for ended events and for items with no end', () => {
    expect(radarLabel(rem('File taxes', at(-2)), now)).toBe('2d overdue');
    expect(radarItemDays(rem('File taxes', at(-2)), now)).toBe(-2);
    expect(radarLabel(ev('Ended', at(-2, 9), { end: at(-2, 10) }), now)).toBe('2d overdue');
    expect(radarLabel({ date: at(-3), allDay: false, kind: 'event' }, now)).toBe('3d overdue');
  });
  it('leaves an event starting today or later as it was', () => {
    expect(radarLabel(ev('Standup', at(0, 9), { end: at(0, 13) }), now)).toBe('Today 9:00 AM');
    expect(radarItemDays(ev('Later', at(5, 9)), now)).toBe(5);
  });
  it('is still selected while it runs', () => {
    expect(selectRadarItems([trip], all, now)).toEqual([trip]);
  });
});

describe('local, DST-safe day maths', () => {
  it('counts whole calendar days across every day of 2026, at awkward hours', () => {
    for (let n = 0; n < 365; n++) {
      const day = addDays(new Date(2026, 0, 1), n);
      for (const hour of [0, 1, 12, 23]) {
        const from = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 30);
        for (const offset of [-2, -1, 0, 1, 2, 30]) {
          const target = addDays(day, offset);
          const late = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 23, 59);
          expect(radarDaysUntil(late, from)).toBe(offset);
          expect(radarDaysUntil(startOfDay(target), from)).toBe(offset);
        }
      }
    }
  });
  it('keeps "Tomorrow" tomorrow on the 23 and 25 hour days', () => {
    for (const [y, m, d] of [[2026, 2, 8], [2026, 2, 29], [2026, 9, 25], [2026, 10, 1]] as const) {
      const from = new Date(y, m, d, 0, 5);
      expect(radarLabel({ date: new Date(y, m, d + 1, 0, 0).getTime(), allDay: false }, from)).toBe('Tomorrow');
      const noon = new Date(y, m, d, 12);
      expect(radarLabel({ date: new Date(y, m, d + 1, 23, 59).getTime(), allDay: false }, noon)).toBe('Tomorrow');
    }
  });
  it('windows by local day when the horizon crosses a DST change', () => {
    const from = new Date(2026, 9, 24, 12); // 2026-10-24
    const cfg = { ...all, daysAhead: 3 };
    const inside = new Date(2026, 9, 26, 23, 30).getTime();
    const outside = new Date(2026, 9, 27, 0, 30).getTime();
    const out = selectRadarItems([ev('in', inside), ev('out', outside)], cfg, from);
    expect(out.map((i) => i.title)).toEqual(['in']);
  });
});

describe('roomBeforeNextEvent', () => {
  it('finds the next timed event later today and counts whole blocks', () => {
    const items = [ev('Later', at(0, 17)), ev('Standup', at(0, 14, 10)), ev('Tomorrow', at(1, 9))];
    expect(roomBeforeNextEvent(items, now, 25)).toEqual({
      title: 'Standup', start: at(0, 14, 10), minutes: 130, blocks: 5
    });
  });
  it('ignores all-day items, reminders, tomorrow, events already started and finished ones', () => {
    const items = [
      ev('Holiday', at(0), { allDay: true }),
      rem('Due', at(0, 15)),
      ev('Started', at(0, 11)),
      ev('Tomorrow', at(1, 0, 5))
    ];
    expect(roomBeforeNextEvent(items, now, 25)).toBeNull();
    expect(roomBeforeNextEvent([], now, 25)).toBeNull();
  });
  it('can report no room when the event is imminent', () => {
    expect(roomBeforeNextEvent([ev('Soon', at(0, 12, 10))], now, 25)).toMatchObject({ minutes: 10, blocks: 0 });
  });
});
