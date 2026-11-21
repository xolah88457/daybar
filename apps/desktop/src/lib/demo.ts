import {
  addDays,
  baseline,
  key,
  linkedTasks,
  logSleep,
  MAIN_SPACE,
  normalizeFocus,
  renameInLog,
  settleFocus,
  startFocus,
  stopFocus,
  toggleSubtask,
  toggleTask
} from '@daybar/core';
import {
  dateKeySchema,
  currentFeaturesVersion,
  defaultFeatures,
  defaultSettings,
  defaultSpaces,
  focusDataSchema,
  preferencesSchema,
  settingsSchema,
  sleepDataSchema,
  spacesFileSchema
} from '@daybar/core/contracts';
import type {
  DaybarClient,
  DailyLog,
  MutationResult,
  Snapshot
} from '@daybar/core/contracts';

/** The task list, subtasks and log an operation addresses in the demo. */
function target(next: Snapshot, space?: string) {
  if (!space || space === MAIN_SPACE)
    return {
      tasks: next.settings.habits.tasks,
      subtasks: next.spaces.main.subtasks,
      log: next.dailyLog,
      setLog: (log: DailyLog) => (next.dailyLog = log)
    };
  const found = next.spaces.spaces.find((s) => s.id === space);
  if (!found) throw new Error('That space no longer exists.');
  return {
    tasks: found.habits.tasks,
    subtasks: found.subtasks,
    log: next.spaceLogs[space] ?? {},
    setLog: (log: DailyLog) => (next.spaceLogs[space] = log)
  };
}

function demoSnapshot(now = new Date()): Snapshot {
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
    spaces: structuredClone(defaultSpaces),
    spaceLogs: {},
    preferences: {
      dataFolder: 'Browser memory · resets on reload',
      realData: false,
      launchAtLogin: false,
      hideDock: false,
      globalShortcut: 'CommandOrControl+Shift+F',
      themeMode: 'night',
      trayDisplay: 'auto',
      features: structuredClone(defaultFeatures),
      featuresVersion: currentFeaturesVersion,
      setupDone: true
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
  const copy = () => structuredClone(memory);
  const publish = (next: Snapshot) => {
    memory = next;
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
        case 'set_task':
        case 'set_subtask': {
          dateKeySchema.parse(operation.date);
          if (operation.date > key(now))
            throw new Error('Future days cannot be edited.');
          const t = target(next, operation.space);
          if (!t.tasks.includes(operation.task))
            throw new Error('Task is no longer active.');
          const subs = t.subtasks[operation.task] ?? [];
          t.setLog(
            operation.kind === 'set_task'
              ? toggleTask(t.log, operation.date, operation.task, operation.done, subs)
              : toggleSubtask(t.log, operation.date, operation.task, operation.subtask, operation.done, subs)
          );
          break;
        }
        case 'rename_task': {
          const to = operation.to.trim();
          const space =
            operation.space && operation.space !== MAIN_SPACE
              ? next.spaces.spaces.find((x) => x.id === operation.space)
              : undefined;
          if (operation.space && operation.space !== MAIN_SPACE && !space)
            throw new Error('That space no longer exists.');
          const h = space ? space.habits : s.habits;
          if (
            !h.tasks.includes(operation.from) ||
            !to ||
            [...h.tasks, ...h.archivedTasks].includes(to)
          )
            throw new Error('Choose a unique, nonempty task name.');
          h.tasks = h.tasks.map((t) => (t === operation.from ? to : t));
          const subs = space ? space.subtasks : next.spaces.main.subtasks;
          if (subs[operation.from]) {
            subs[to] = subs[operation.from];
            delete subs[operation.from];
          }
          if (space) {
            next.spaceLogs[space.id] = renameInLog(next.spaceLogs[space.id] ?? {}, operation.from, to);
            for (const link of Object.values(next.spaces.focus))
              if (link.space === space.id && link.task === operation.from) link.task = to;
            break;
          }
          next.dailyLog = renameInLog(next.dailyLog, operation.from, to);
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
        case 'archive_task': {
          const space =
            operation.space && operation.space !== MAIN_SPACE
              ? next.spaces.spaces.find((x) => x.id === operation.space)
              : undefined;
          const h = space ? space.habits : s.habits;
          if (!h.tasks.includes(operation.task) || h.tasks.length === 1)
            throw new Error('Keep at least one active task.');
          h.tasks = h.tasks.filter((t) => t !== operation.task);
          h.archivedTasks = [...new Set([...h.archivedTasks, operation.task])];
          h.dayCompleteMin = Math.min(h.dayCompleteMin, h.tasks.length);
          break;
        }
        case 'save_spaces': {
          const parsed = spacesFileSchema.parse(operation.spaces);
          for (const space of parsed.spaces) {
            if (space.habits.logId === s.habits.logId)
              throw new Error('A space cannot use the main task log.');
            const old = next.spaces.spaces.find((x) => x.id === space.id);
            if (old && old.habits.logId !== space.habits.logId)
              throw new Error('Log ID cannot be changed.');
            if (old?.habits.tasks.some((t) => !space.habits.tasks.includes(t) && !space.habits.archivedTasks.includes(t)))
              throw new Error('Use Rename or Archive to preserve task history.');
          }
          parsed.focus = next.spaces.focus;
          next.spaceLogs = Object.fromEntries(
            parsed.spaces.map((x) => [x.id, next.spaceLogs[x.id] ?? {}])
          );
          next.spaces = parsed;
          break;
        }
        case 'reset_starter': {
          const today = key(now);
          const blank = structuredClone(defaultSettings);
          blank.countdown = { title: 'Countdown', startDate: today, endDate: key(addDays(now, 365)) };
          blank.habits = { ...blank.habits, startDate: today, tasks: ['First habit'], archivedTasks: [], focusThresholds: {} };
          next.settings = blank;
          next.dailyLog = {};
          next.focus = { state: null, days: {}, sessions: {} };
          next.sleep = { wakes: {}, beds: {}, plan: null };
          next.spaces = structuredClone(defaultSpaces);
          next.spaceLogs = {};
          break;
        }
        case 'start_timer': {
          if (next.focus.state)
            throw new Error('Stop the current timer before starting another.');
          if (
            !Number.isInteger(operation.minutes) ||
            operation.minutes < 1 ||
            operation.minutes > 240
          )
            throw new Error('Choose 1–240 whole minutes.');
          const space = operation.space && operation.space !== MAIN_SPACE ? operation.space : undefined;
          const tasks = target(next, space).tasks;
          if (operation.task && !tasks.includes(operation.task))
            throw new Error('Task is no longer active.');
          next.focus = startFocus(
            next.focus,
            operation.timerType,
            operation.minutes,
            now,
            s.focus.blockMinutes,
            space ? undefined : operation.task
          );
          if (space && next.focus.state)
            next.spaces.focus[String(next.focus.state.start)] = operation.task
              ? { space, task: operation.task }
              : { space };
          break;
        }
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
          // Additions are safe; history-bearing renames/removals use explicit operations.
          if (
            s.habits.tasks.some((t) => !parsed.habits.tasks.includes(t)) ||
            JSON.stringify(parsed.habits.archivedTasks) !==
              JSON.stringify(s.habits.archivedTasks)
          )
            throw new Error('Use Rename or Archive to preserve task history.');
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
      next.spaces = spacesFileSchema.parse(next.spaces);
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
