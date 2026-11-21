import { describe, expect, it } from 'vitest';
import { defaultFeatures, defaultSettings, defaultSpaces, spacesFileSchema, type Snapshot, type SpacesFile } from '../src/contracts';
import { focusBySpace, MAIN_SPACE, newSpace, renameInLog, runningSpace, spaceSettings, spaceSummaries, subtaskEntry, subtasksDone, toggleSubtask, toggleTask } from '../src/spaces';
import { getHabitStats } from '../src/habits';

const day = '2026-11-15';

describe('subtasks', () => {
  const subs = ['Stretch', 'Run'];
  it('tick the parent only when all are done, and untick it when one is undone', () => {
    let log = toggleSubtask({}, day, 'Workout', 'Stretch', true, subs);
    expect(log[day]).toEqual(['Workout › Stretch']);
    log = toggleSubtask(log, day, 'Workout', 'Run', true, subs);
    expect(log[day]).toContain('Workout');
    expect(subtasksDone(log, day, 'Workout', subs)).toEqual(subs);
    log = toggleSubtask(log, day, 'Workout', 'Run', false, subs);
    expect(log[day]).toEqual(['Workout › Stretch']);
    expect(() => toggleSubtask(log, day, 'Workout', 'Swim', true, subs)).toThrow();
  });
  it('follow the parent when it is ticked or unticked, and an empty day is removed', () => {
    let log = toggleTask({}, day, 'Workout', true, subs);
    expect(new Set(log[day])).toEqual(new Set(['Workout', 'Workout › Stretch', 'Workout › Run']));
    log = toggleTask(log, day, 'Workout', false, subs);
    expect(log[day]).toBeUndefined();
  });
  it('never count toward a day: completion only sees active task names', () => {
    const settings = structuredClone(defaultSettings);
    settings.habits.startDate = day;
    settings.habits.tasks = ['Workout', 'Read'];
    settings.habits.dayCompleteMin = 2;
    const log = { [day]: ['Workout', 'Workout › Stretch', 'Workout › Run'] };
    expect(getHabitStats(log, settings, new Date(2026, 10, 15, 12)).todayDone).toBe(1);
  });
  it('move with a rename', () => {
    const log = { [day]: ['Workout', 'Workout › Run', 'Workoutish', 'Read'] };
    expect(renameInLog(log, 'Workout', 'Exercise')[day]).toEqual(['Exercise', 'Exercise › Run', 'Workoutish', 'Read']);
  });
  it('are limited so the log entry still fits 120 characters', () => {
    const long = 'x'.repeat(110);
    expect(() => spacesFileSchema.parse({ main: { subtasks: { [long]: ['too long here'] } } })).toThrow();
    expect(() => spacesFileSchema.parse({ main: { subtasks: { Task: ['a', 'a'] } } })).toThrow();
    expect(subtaskEntry('Task', 'Sub')).toBe('Task › Sub');
  });
});

describe('spaces', () => {
  function withWork(): SpacesFile {
    const spaces = structuredClone(defaultSpaces);
    const work = newSpace(spaces, 'Work', '2026-11-01');
    work.habits.tasks = ['Inbox', 'Ship'];
    spaces.spaces.push(work);
    return spacesFileSchema.parse(spaces);
  }
  it('get unique ids and log ids', () => {
    const spaces = withWork();
    expect(spaces.spaces[0]).toMatchObject({ id: 'work', habits: { logId: 'Space_work' } });
    const again = newSpace(spaces, 'Work!', '2026-11-01');
    expect(again.id).toBe('work-2');
    expect(again.habits.logId).toBe('Space_work_2');
    expect(newSpace(spaces, 'Main', day).id).toBe('main-2');
    expect(newSpace(spaces, '¡¡', day).id).toBe('space');
  });
  it('reject duplicate ids and shared logs', () => {
    const spaces = withWork();
    expect(() => spacesFileSchema.parse({ ...spaces, spaces: [spaces.spaces[0], spaces.spaces[0]] })).toThrow();
    const copy = { ...spaces.spaces[0], id: 'other' };
    expect(() => spacesFileSchema.parse({ ...spaces, spaces: [spaces.spaces[0], copy] })).toThrow();
  });
  it('see their own tasks and first countdown through spaceSettings', () => {
    const work = withWork().spaces[0];
    work.countdowns = [{ id: 'q4', title: 'Q4', startDate: '2026-10-01', endDate: '2026-12-31' }];
    const s = spaceSettings(defaultSettings, work);
    expect(s.habits.tasks).toEqual(['Inbox', 'Ship']);
    expect(s.countdown.title).toBe('Q4');
    expect(s.sleep).toBe(defaultSettings.sleep);
  });
  it('split focus minutes by the space a session was started in', () => {
    const spaces = withWork();
    spaces.focus['1000'] = { space: 'work' };
    spaces.focus['3000'] = { space: 'deleted-space' };
    const focus = {
      state: { type: 'focus' as const, minutes: 25, start: 5000, end: 5000 + 25 * 60000 },
      days: {}, baseline: { [day]: { count: 1, minutes: 10 } },
      sessions: {
        '1000': { type: 'focus' as const, minutes: 25, creditedMinutes: 25, end: 1000 + 25 * 60000, date: day },
        '2000': { type: 'focus' as const, minutes: 25, creditedMinutes: 20, end: 2000 + 20 * 60000, date: day },
        '3000': { type: 'focus' as const, minutes: 5, creditedMinutes: 5, end: 3000 + 5 * 60000, date: day },
        '4000': { type: 'break' as const, minutes: 5, creditedMinutes: 0, end: 4000 + 5 * 60000, date: day }
      }
    };
    expect(focusBySpace(focus, spaces, day, day)).toEqual({ [MAIN_SPACE]: 35, work: 25 });
    expect(focusBySpace(focus, spaces, '2026-11-16', '2026-11-20')).toEqual({ [MAIN_SPACE]: 0, work: 0 });
    expect(runningSpace(focus, spaces)).toBe(MAIN_SPACE);
    spaces.focus['5000'] = { space: 'work' };
    expect(runningSpace(focus, spaces)).toBe('work');
  });
  it('summarise every space for the overview, main first', () => {
    const spaces = withWork();
    spaces.spaces[0].subtasks = { Ship: ['Write', 'Review'] };
    spaces.spaces[0].countdowns = [
      { id: 'old', title: 'Done', startDate: '2026-01-01', endDate: '2026-02-01' },
      { id: 'q4', title: 'Q4', startDate: '2026-10-01', endDate: '2026-12-31' }
    ];
    const settings = structuredClone(defaultSettings);
    settings.habits.startDate = '2026-11-01';
    const snapshot = {
      settings, dailyLog: { [day]: ['Read a chapter'] }, focus: { state: null, days: {} }, sleep: { wakes: {}, beds: {}, plan: null },
      spaces, spaceLogs: { work: { [day]: ['Inbox', 'Ship › Write'] } },
      preferences: { features: defaultFeatures } as Snapshot['preferences'], issues: [], conflicts: []
    } satisfies Snapshot;
    const [main, work] = spaceSummaries(snapshot, new Date(2026, 10, 15, 12));
    expect(main).toMatchObject({ id: MAIN_SPACE, name: 'Personal', todayDone: 1, tasks: 4 });
    expect(main.countdown?.title).toBe(settings.countdown.title);
    expect(work).toMatchObject({ id: 'work', todayDone: 1, tasks: 2, subtasksTotal: 2, subtasksDone: 1 });
    expect(work.countdown).toMatchObject({ title: 'Q4', daysLeft: 46 });
  });
});
