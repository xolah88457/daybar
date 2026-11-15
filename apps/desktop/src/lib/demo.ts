import {
  addDays,
  baseline,
  key,
  linkedTasks,
  logSleep,
  normalizeFocus,
  settleFocus,
  startFocus,
  stopFocus
} from '@daybar/core';
import {
  dateKeySchema,
  defaultSettings,
  focusDataSchema,
  preferencesSchema,
  settingsSchema,
  sleepDataSchema
} from '@daybar/core/contracts';
import type {
  DaybarClient,
  MutationResult,
  Snapshot
} from '@daybar/core/contracts';

export function demoSnapshot(now = new Date()): Snapshot {
  const settings = structuredClone(defaultSettings);
  const dailyLog: Snapshot['dailyLog'] = {};
  const sleep: Snapshot['sleep'] = { wakes: {}, beds: {}, plan: null };
  for (let i = 0; i < 70; i++) {
    const date = key(addDays(now, -i));
    dailyLog[date] = settings.habits.tasks.slice(
      0,
      i === 0 ? 1 : (i * 7 + Math.floor(i / 3)) % 5
    );
    if (i < 7) {
      sleep.wakes[date] = 510 + i * 5;
      sleep.beds[date] = 30 + i * 5;
    }
  }
  return {
    settings,
    dailyLog,
    sleep,
    focus: { state: null, days: { [key(now)]: { count: 3, minutes: 85 } } },
    preferences: {
      dataFolder: 'Browser memory · resets on reload',
      realData: false,
      launchAtLogin: false,
      hideDock: false,
      globalShortcut: 'CommandOrControl+Shift+F',
      themeMode: 'night',
      trayDisplay: 'auto'
    },
    issues: [],
    conflicts: []
  };
}

export function createDemoClient(
  initial?: Snapshot,
  clock = () => new Date()
): DaybarClient {
  let memory = structuredClone(initial ?? demoSnapshot(clock()));
  const listeners = new Set<() => void>();
  const logs = new Map([
    [memory.settings.habits.logId, structuredClone(memory.dailyLog)]
  ]);
  const copy = () => structuredClone(memory);
  const publish = (next: Snapshot) => {
    memory = next;
    logs.set(next.settings.habits.logId, structuredClone(next.dailyLog));
    listeners.forEach((fn) => fn());
    return copy();
  };
  return {
    async snapshot() {
      return copy();
    },
    async mutate(operation) {
      // Re-read memory per operation, then publish only after all validation succeeds.
      const next = copy();
      const now = clock();
      let creditedMinutes: number | undefined;
      const s = next.settings;
      if (next.issues.length)
        throw new Error(
          'Resolve file errors before writing. No data was changed.'
        );
      switch (operation.kind) {
        case 'set_task': {
          dateKeySchema.parse(operation.date);
          if (operation.date > key(now))
            throw new Error('Future days cannot be edited.');
          if (!s.habits.tasks.includes(operation.task))
            throw new Error('Task is no longer active.');
          const tasks = new Set(next.dailyLog[operation.date] ?? []);
          if (operation.done) tasks.add(operation.task);
          else tasks.delete(operation.task);
          if (tasks.size) next.dailyLog[operation.date] = [...tasks];
          else delete next.dailyLog[operation.date];
          break;
        }
        case 'rename_task': {
          const to = operation.to.trim();
          if (
            !s.habits.tasks.includes(operation.from) ||
            !to ||
            [...s.habits.tasks, ...s.habits.archivedTasks].includes(to)
          )
            throw new Error('Choose a unique, nonempty task name.');
          s.habits.tasks = s.habits.tasks.map((t) =>
            t === operation.from ? to : t
          );
          for (const day of Object.keys(next.dailyLog))
            next.dailyLog[day] = [
              ...new Set(
                next.dailyLog[day].map((t) => (t === operation.from ? to : t))
              )
            ];
          if (s.habits.focusThresholds[operation.from] !== undefined) {
            s.habits.focusThresholds[to] =
              s.habits.focusThresholds[operation.from];
            delete s.habits.focusThresholds[operation.from];
          }
          if (next.focus.state?.task === operation.from)
            next.focus.state.task = to;
          for (const session of Object.values(next.focus.sessions ?? {}))
            if (session.task === operation.from) session.task = to;
          break;
        }
        case 'archive_task':
          if (
            !s.habits.tasks.includes(operation.task) ||
            s.habits.tasks.length === 1
          )
            throw new Error('Keep at least one active task.');
          s.habits.tasks = s.habits.tasks.filter((t) => t !== operation.task);
          s.habits.archivedTasks = [
            ...new Set([...s.habits.archivedTasks, operation.task])
          ];
          s.habits.dayCompleteMin = Math.min(
            s.habits.dayCompleteMin,
            s.habits.tasks.length
          );
          break;
        case 'start_timer':
          if (next.focus.state)
            throw new Error('Stop the current timer before starting another.');
          if (
            !Number.isInteger(operation.minutes) ||
            operation.minutes < 1 ||
            operation.minutes > 240
          )
            throw new Error('Choose 1–240 whole minutes.');
          if (operation.task && !s.habits.tasks.includes(operation.task))
            throw new Error('Task is no longer active.');
          next.focus = startFocus(
            next.focus,
            operation.timerType,
            operation.minutes,
            now,
            s.focus.blockMinutes,
            operation.task
          );
          break;
        case 'stop_timer': {
          const result = stopFocus(next.focus, now, s.focus.blockMinutes);
          next.focus = result.data;
          creditedMinutes = result.creditedMinutes;
          break;
        }
        case 'settle_timer':
          next.focus = settleFocus(next.focus, now, s.focus.blockMinutes);
          break;
        case 'log_sleep':
          if (
            !Number.isFinite(operation.timestamp) ||
            operation.timestamp > now.getTime()
          )
            throw new Error('Choose a valid time in the past.');
          next.sleep = logSleep(
            next.sleep,
            operation.entry,
            new Date(operation.timestamp)
          );
          break;
        case 'start_plan': {
          const base = baseline(next.sleep, s);
          if (!base) throw new Error('Log a wake time before starting a plan.');
          next.sleep.plan = { start: key(now), wake: base.wake, bed: base.bed };
          break;
        }
        case 'stop_plan':
          next.sleep.plan = null;
          break;
        case 'clear_sleep':
          next.sleep = { wakes: {}, beds: {}, plan: null };
          break;
        case 'save_settings': {
          const parsed = settingsSchema.parse(operation.settings);
          if (
            JSON.stringify(parsed.habits.tasks) !==
              JSON.stringify(s.habits.tasks) ||
            JSON.stringify(parsed.habits.archivedTasks) !==
              JSON.stringify(s.habits.archivedTasks)
          ) {
            // Additions are safe; history-bearing renames/removals use explicit operations.
            if (
              s.habits.tasks.some((t) => !parsed.habits.tasks.includes(t)) ||
              JSON.stringify(parsed.habits.archivedTasks) !==
                JSON.stringify(s.habits.archivedTasks)
            )
              throw new Error(
                'Use Rename or Archive to preserve task history.'
              );
          }
          if (parsed.habits.logId !== s.habits.logId)
            throw new Error(
              'Log ID is stable and cannot be changed. Use the same log ID to preserve history.'
            );
          next.settings = parsed;
          next.focus = normalizeFocus(next.focus, parsed.focus.blockMinutes);
          break;
        }
      }
      for (const date of Object.keys(next.focus.days)) {
        const tasks = linkedTasks(next.focus, next.settings, date);
        if (tasks.length)
          next.dailyLog[date] = [
            ...new Set([...(next.dailyLog[date] ?? []), ...tasks])
          ];
      }
      next.settings = settingsSchema.parse(next.settings);
      next.focus = focusDataSchema.parse(next.focus);
      next.sleep = sleepDataSchema.parse(next.sleep);
      const result: MutationResult = { snapshot: publish(next) };
      if (creditedMinutes !== undefined)
        result.creditedMinutes = creditedMinutes;
      return result;
    },
    async setPreferences(preferences) {
      const parsed = preferencesSchema.parse(preferences);
      if (
        parsed.dataFolder !== memory.preferences.dataFolder ||
        parsed.realData !== memory.preferences.realData ||
        parsed.launchAtLogin !== memory.preferences.launchAtLogin ||
        parsed.hideDock !== memory.preferences.hideDock ||
        parsed.globalShortcut !== memory.preferences.globalShortcut ||
        parsed.trayDisplay !== memory.preferences.trayDisplay
      )
        throw new Error(
          'OS preferences and real folders require the desktop app. Browser demo has no filesystem access.'
        );
      return publish({ ...copy(), preferences: parsed });
    },
    async resolveConflict() {
      throw new Error(
        'Conflict resolution requires the desktop app. No files were changed.'
      );
    },
    async subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    }
  };
}
