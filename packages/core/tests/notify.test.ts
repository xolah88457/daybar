import { describe, expect, it } from 'vitest';
import {
  describeNext, formatClock, formatTime, inWindow, nextCheckIn, nextHourlyChime, nextMovementNudge,
  nextStreakSaver, parseClock
} from '../src';
import { defaultSettings } from '../src/contracts';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const label = (d: Date | null) => (d ? `${d.getDate()} ${formatTime(d)}` : null);

describe('clock helpers', () => {
  it('parses HH:MM strictly', () => {
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('23:59')).toBe(1439);
    for (const bad of ['', '9:00', '24:00', '08:60', '8:0', 'noon']) expect(parseClock(bad)).toBeNull();
  });
  it('formats 12-hour labels, and "off" for an empty time', () => {
    expect(formatClock('15:00')).toBe('3:00 pm');
    expect(formatClock('00:05')).toBe('12:05 am');
    expect(formatClock('12:00')).toBe('12:00 pm');
    expect(formatClock(8 * 60 + 30)).toBe('8:30 am');
    expect(formatClock('')).toBe('off');
    expect(formatTime(at(15, 21, 45))).toBe('9:45 pm');
  });
  it('windows wrap midnight and equal ends are empty', () => {
    expect(inWindow(23 * 60, 22 * 60, 8 * 60)).toBe(true);
    expect(inWindow(8 * 60, 22 * 60, 8 * 60)).toBe(false);
    expect(inWindow(9 * 60, 9 * 60, 18 * 60)).toBe(true);
    expect(inWindow(18 * 60, 9 * 60, 18 * 60)).toBe(false);
    expect(inWindow(0, 600, 600)).toBe(false);
  });
  it('describes the next time relative to today', () => {
    const now = at(15, 12);
    expect(describeNext(at(15, 15), now)).toBe('Next: 3:00 pm');
    expect(describeNext(at(16, 8), now)).toBe('Next: tomorrow 8:00 am');
    expect(describeNext(at(18, 8), now)).toBe('Next: Wed 8:00 am');
    expect(describeNext(null, now)).toBe('Next: not scheduled');
  });
});

describe('next fire previews', () => {
  const quiet = { quietStart: '22:00', quietEnd: '08:00' };
  it('hourly chime: next whole hour outside quiet hours', () => {
    expect(label(nextHourlyChime(at(15, 14, 20), quiet))).toBe('15 3:00 pm');
    expect(label(nextHourlyChime(at(15, 15, 0), quiet))).toBe('15 4:00 pm');
    expect(label(nextHourlyChime(at(15, 21, 30), quiet))).toBe('16 8:00 am');
    expect(label(nextHourlyChime(at(15, 6, 10), quiet))).toBe('15 8:00 am');
    expect(label(nextHourlyChime(at(15, 21, 30), { quietStart: '00:00', quietEnd: '00:00' }))).toBe('15 10:00 pm');
  });
  it('movement nudges: aligned to the window start, every day', () => {
    const cfg = { intervalMinutes: 50, activeStart: '09:00', activeEnd: '18:00' };
    expect(label(nextMovementNudge(at(15, 8), cfg))).toBe('15 9:00 am');
    expect(label(nextMovementNudge(at(15, 9, 0), cfg))).toBe('15 9:50 am');
    expect(label(nextMovementNudge(at(15, 17, 21), cfg))).toBe('16 9:00 am');
    expect(label(nextMovementNudge(at(15, 17, 19), cfg))).toBe('15 5:20 pm');
    const wrap = { intervalMinutes: 60, activeStart: '22:00', activeEnd: '02:00' };
    expect(label(nextMovementNudge(at(16, 0, 30), wrap))).toBe('16 1:00 am');
    expect(nextMovementNudge(at(15, 8), { ...cfg, activeEnd: '09:00' })).toBeNull();
    expect(nextMovementNudge(at(15, 8), { ...cfg, activeStart: '' })).toBeNull();
  });
  it('check-ins: the soonest of the two, and an empty time is off', () => {
    const cfg = { morningTime: '08:00', eveningTime: '20:00' };
    expect(nextCheckIn(at(15, 6), cfg)).toMatchObject({ kind: 'morning' });
    expect(label(nextCheckIn(at(15, 9), cfg)!.at)).toBe('15 8:00 pm');
    expect(label(nextCheckIn(at(15, 21), cfg)!.at)).toBe('16 8:00 am');
    expect(nextCheckIn(at(15, 9), { ...cfg, eveningTime: '' })).toMatchObject({ kind: 'morning' });
    expect(nextCheckIn(at(15, 9), { morningTime: '', eveningTime: '' })).toBeNull();
  });
  it('streak saver: bedtime minus the lead while it is still ahead', () => {
    const data = { wakes: { '2026-11-15': 8 * 60 }, beds: {}, plan: null };
    // Wake 08:00 and 16 awake hours: bed at midnight.
    expect(label(nextStreakSaver(data, defaultSettings, at(15, 12), 90))).toBe('15 10:30 pm');
    expect(nextStreakSaver(data, defaultSettings, at(15, 23), 90)).toBeNull();
    expect(label(nextStreakSaver(data, defaultSettings, at(15, 12), 0))).toBe('16 12:00 am');
  });
});
