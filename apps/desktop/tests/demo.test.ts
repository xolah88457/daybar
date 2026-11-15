import { describe, expect, it, vi } from 'vitest';
import { createDemoClient } from '../src/lib/demo';
import { fixture } from './fixtures';

const start = new Date(2026, 10, 15, 12);
describe('in-memory DaybarClient', () => {
  it('applies single task operations idempotently and isolates returned snapshots', async () => {
    const client = createDemoClient(fixture(), () => start);
    const op = {
      kind: 'set_task' as const,
      date: '2026-11-14',
      task: 'Coursework',
      done: true
    };
    await Promise.all([
      client.mutate(op),
      client.mutate(op),
      client.mutate({ ...op, task: 'Live Trading' })
    ]);
    const snapshot = await client.snapshot();
    expect(snapshot.dailyLog[op.date]).toEqual(['Coursework', 'Live Trading']);
    snapshot.dailyLog[op.date].push('Not saved');
    expect((await client.snapshot()).dailyLog[op.date]).not.toContain(
      'Not saved'
    );
    await expect(client.mutate({ ...op, date: '2026-11-16' })).rejects.toThrow(
      'Future'
    );
    await expect(
      client.mutate({ ...op, date: '2026-02-30' })
    ).rejects.toThrow();
    await expect(client.mutate({ ...op, task: 'Unknown' })).rejects.toThrow(
      'active'
    );
    await client.mutate({ ...op, done: false });
    expect((await client.snapshot()).dailyLog[op.date]).toEqual([
      'Live Trading'
    ]);
  });
  it('renames historical entries, thresholds and timer tags; archives without erasing history', async () => {
    const initial = fixture();
    initial.dailyLog['2026-11-01'] = ['Coursework'];
    initial.settings.habits.focusThresholds.Coursework = 40;
    initial.focus.state = {
      type: 'focus',
      minutes: 25,
      start: start.getTime(),
      end: start.getTime() + 25 * 60000,
      task: 'Coursework'
    };
    initial.focus.sessions = {
      '123': {
        type: 'focus',
        minutes: 25,
        creditedMinutes: 10,
        end: start.getTime() - 60000,
        date: '2026-11-14',
        task: 'Coursework'
      }
    };
    initial.focus.baseline = {};
    const client = createDemoClient(initial, () => start);
    await client.mutate({
      kind: 'rename_task',
      from: 'Coursework',
      to: 'Deep work'
    });
    let snapshot = await client.snapshot();
    expect(snapshot.dailyLog['2026-11-01']).toEqual(['Deep work']);
    expect(snapshot.settings.habits.focusThresholds).toEqual({
      'Deep work': 40
    });
    expect(snapshot.focus.state?.task).toBe('Deep work');
    expect(snapshot.focus.sessions?.['123'].task).toBe('Deep work');
    await expect(
      client.mutate({
        kind: 'rename_task',
        from: 'Deep work',
        to: 'Live Trading'
      })
    ).rejects.toThrow('unique');
    await client.mutate({ kind: 'archive_task', task: 'Deep work' });
    snapshot = await client.snapshot();
    expect(snapshot.settings.habits.tasks).not.toContain('Deep work');
    expect(snapshot.settings.habits.archivedTasks).toContain('Deep work');
    expect(snapshot.dailyLog['2026-11-01']).toEqual(['Deep work']);
  });
  it('credits only whole early-stop minutes, links task thresholds and never credits a session twice', async () => {
    let now = start;
    const initial = fixture();
    initial.settings.habits.focusThresholds.Coursework = 2;
    const client = createDemoClient(initial, () => now);
    await client.mutate({
      kind: 'start_timer',
      timerType: 'focus',
      minutes: 25,
      task: 'Coursework'
    });
    await expect(
      client.mutate({ kind: 'start_timer', timerType: 'focus', minutes: 25 })
    ).rejects.toThrow('current timer');
    now = new Date(start.getTime() + 179000);
    const stopped = await client.mutate({ kind: 'stop_timer' });
    expect(stopped.creditedMinutes).toBe(2);
    expect(stopped.snapshot.focus.days['2026-11-15']).toEqual({
      count: 0,
      minutes: 2
    });
    expect(stopped.snapshot.dailyLog['2026-11-15']).toContain('Coursework');
    await client.mutate({ kind: 'settle_timer' });
    expect((await client.snapshot()).focus.days['2026-11-15'].minutes).toBe(2);
    now = new Date(now.getTime() + 1000);
    await client.mutate({
      kind: 'start_timer',
      timerType: 'focus',
      minutes: 25
    });
    now = new Date(now.getTime() + 59000);
    expect((await client.mutate({ kind: 'stop_timer' })).creditedMinutes).toBe(
      0
    );
    now = new Date(now.getTime() + 1000);
    await client.mutate({
      kind: 'start_timer',
      timerType: 'focus',
      minutes: 25
    });
    now = new Date(now.getTime() + 25 * 60000);
    await client.mutate({ kind: 'settle_timer' });
    await client.mutate({ kind: 'settle_timer' });
    expect((await client.snapshot()).focus.days['2026-11-15']).toEqual({
      count: 1,
      minutes: 27
    });
    await expect(
      client.mutate({ kind: 'start_timer', timerType: 'focus', minutes: 241 })
    ).rejects.toThrow('1–240');
  });
  it('logs after-midnight beds under the evening before and handles plan lifecycle', async () => {
    const client = createDemoClient(fixture(), () => start);
    await expect(client.mutate({ kind: 'start_plan' })).rejects.toThrow('wake');
    await client.mutate({
      kind: 'log_sleep',
      entry: 'wake',
      timestamp: new Date(2026, 10, 15, 9).getTime()
    });
    await client.mutate({
      kind: 'log_sleep',
      entry: 'bed',
      timestamp: new Date(2026, 10, 15, 1).getTime()
    });
    expect((await client.snapshot()).sleep.beds).toEqual({ '2026-11-14': 60 });
    await client.mutate({ kind: 'start_plan' });
    expect((await client.snapshot()).sleep.plan?.start).toBe('2026-11-15');
    await client.mutate({ kind: 'stop_plan' });
    expect((await client.snapshot()).sleep.wakes['2026-11-15']).toBe(540);
    await client.mutate({ kind: 'clear_sleep' });
    expect((await client.snapshot()).sleep).toEqual({
      wakes: {},
      beds: {},
      plan: null
    });
    await expect(
      client.mutate({
        kind: 'log_sleep',
        entry: 'wake',
        timestamp: start.getTime() + 1
      })
    ).rejects.toThrow('past');
  });
  it('validates settings before publishing and refuses history-erasing edits', async () => {
    const client = createDemoClient(fixture(), () => start);
    const listener = vi.fn();
    await client.subscribe(listener);
    const settings = (await client.snapshot()).settings;
    settings.focus.blockMinutes = 0;
    await expect(
      client.mutate({ kind: 'save_settings', settings })
    ).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
    expect((await client.snapshot()).settings.focus.blockMinutes).toBe(25);
    settings.focus.blockMinutes = 25;
    settings.habits.tasks.pop();
    await expect(
      client.mutate({ kind: 'save_settings', settings })
    ).rejects.toThrow('Rename or Archive');
    settings.habits.tasks = [
      'Coursework',
      'Live Trading',
      'Trade Review',
      'Apostles work',
      'Read'
    ];
    await client.mutate({ kind: 'save_settings', settings });
    expect((await client.snapshot()).settings.habits.tasks).toContain('Read');
  });
  it('rejects logId changes and preserves history', async () => {
    const initial = fixture();
    initial.dailyLog['2026-11-14'] = ['Coursework'];
    const client = createDemoClient(initial, () => start);
    const settings = structuredClone(initial.settings);
    settings.habits.logId = 'Other_Log';
    await expect(
      client.mutate({ kind: 'save_settings', settings })
    ).rejects.toThrow('Log ID is stable');
    // History unchanged after rejected logId change
    expect((await client.snapshot()).dailyLog['2026-11-14']).toEqual([
      'Coursework'
    ]);
    expect((await client.snapshot()).settings.habits.logId).toBe(
      initial.settings.habits.logId
    );
  });
  it('allows other settings changes while keeping logId stable', async () => {
    const client = createDemoClient(fixture(), () => start);
    const settings = structuredClone((await client.snapshot()).settings);
    settings.focus.blockMinutes = 30;
    settings.habits.dayCompleteMin = 2;
    await client.mutate({ kind: 'save_settings', settings });
    const snap = await client.snapshot();
    expect(snap.settings.focus.blockMinutes).toBe(30);
    expect(snap.settings.habits.dayCompleteMin).toBe(2);
    expect(snap.settings.habits.logId).toBe('Daily_Tasks');
  });
  it('blocks writes on file issues, never offers OS/filesystem emulation, and cleans subscriptions', async () => {
    const initial = fixture();
    initial.issues = [{ file: 'sleep-data.json', message: 'Invalid JSON' }];
    const broken = createDemoClient(initial, () => start);
    await expect(broken.mutate({ kind: 'clear_sleep' })).rejects.toThrow(
      'No data was changed'
    );
    const client = createDemoClient(fixture(), () => start);
    const listener = vi.fn();
    const unsubscribe = await client.subscribe(listener);
    await client.mutate({
      kind: 'set_task',
      date: '2026-11-15',
      task: 'Coursework',
      done: true
    });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await client.mutate({ kind: 'clear_sleep' });
    expect(listener).toHaveBeenCalledTimes(1);
    await expect(client.setPreferences(fixture().preferences)).rejects.toThrow(
      'desktop app'
    );
    await expect(
      client.resolveConflict('conflict.json', 'discard')
    ).rejects.toThrow('No files were changed');
  });
});
