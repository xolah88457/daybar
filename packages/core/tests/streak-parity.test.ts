import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getHabitStats, parseKey } from '../src';
import { defaultSettings, type DailyLog } from '../src/contracts';

interface Case {
  name: string; today: string; startDate: string; endDate: string; dayCompleteMin: number;
  log: DailyLog; currentStreak: number;
}
const fixture = JSON.parse(readFileSync(new URL('./fixtures/streak-parity.json', import.meta.url), 'utf8')) as {
  tasks: string[]; cases: Case[];
};

// The Rust streak saver (features/streak.rs) reads the same file and must agree case by case.
describe('current streak parity fixture', () => {
  it.each(fixture.cases)('$name', c => {
    const s = structuredClone(defaultSettings);
    s.habits.tasks = fixture.tasks;
    s.habits.startDate = c.startDate;
    s.habits.endDate = c.endDate;
    s.habits.dayCompleteMin = c.dayCompleteMin;
    const noon = parseKey(c.today);
    noon.setHours(12);
    expect(getHabitStats(c.log, s, noon).currentStreak).toBe(c.currentStreak);
  });
});
