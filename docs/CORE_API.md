# Fixed pure-core API for workers

All below are named exports from `@daybar/core`. Use explicit `now: Date` rather than Date.now defaults where provided. `Settings` and storage types come from `@daybar/core/contracts`. Core owns implementation/tests and may add exports, but do not rename these without orchestrator approval.

```ts
key(d: Date): string;
parseKey(s: string): Date;
startOfDay(d: Date): Date;
addDays(d: Date, n: number): Date;
daysBetween(a: Date, b: Date): number;
blend(a: string, b: string, t: number): string;
dayColor(n: number, settings: Settings): string;
normalizeLog(raw: DailyLog | string[], tasks: string[]): DailyLog;
doneOn(log: DailyLog, date: string, tasks: string[]): string[];
getHabitStats(log: DailyLog, settings: Settings, now: Date): {
 elapsed: number; total: number | null; completedDays: number; missedDays: number;
 todayDone: number; daysLeft: number | null; percent: number;
 currentStreak: number; longestStreak: number; taskRates: Record<string, number>;
};
// cells are ROW-MAJOR for direct CSS grid display; their dates are COLUMN-MAJOR.
// null cells are blank padding after range end. colors are #rrggbb; opacity separate.
// width is content width, excluding caller-owned padding (legacy medium: 354 - 24 = 330).
// taskRates are percentages (0–100); currentStreak ignores an unfinished today until tomorrow.
getHabitGrid(log: DailyLog, settings: Settings, now: Date, width: number): {cells: (GridCell | null)[]; columns: number; cellSize: number};
getCountdown(settings: Settings, now: Date): {total: number; elapsed: number; daysLeft: number; percent: number; weeksLeft: number; columns: number; cells: (GridCell | null)[]};
interface GridCell { date: string; color: string; opacity: number; count?: number; }

// focus helpers are PURE: return new data, never mutate arguments.
// Ambiguous saved days with a present session ledger and absent baseline fail closed;
// callers must surface the error and preserve the source bytes for manual recovery.
normalizeFocus(data: FocusData, blockMinutes: number): FocusData;
settleFocus(data: FocusData, now: Date, blockMinutes: number): FocusData;
startFocus(data: FocusData, type: 'focus'|'break', minutes: number, now: Date, blockMinutes: number, task?: string): FocusData;
stopFocus(data: FocusData, now: Date, blockMinutes: number): {data: FocusData; creditedMinutes: number};
formatCountdown(state: TimerState | null, now: Date): string; // MM:SS, >= 0:00
roomForBlocks(leftMinutes: number, blockMinutes: number): number;
linkedTasks(data: FocusData, settings: Settings, date: string): string[]; // tasks over thresholds

wrap(m: number): number;
signedDiff(from: number, to: number): number;
circMean(list: number[]): number | null;
toMin(hhmm: string): number;
atMinutes(day: Date, m: number): Date;
fmtDuration(mins: number): string;
parseWhen(v: unknown, now?: Date): {date: Date; hasDay: boolean} | null;
resolveDates(strs: string[], now: Date): Date[] | null;
findSleepSessions(starts: Date[], ends: Date[]): {s: Date; e: Date}[];
recentAvg(map: Record<string,number>, averageDays: number): {mean: number | null; n: number};
baseline(data: SleepData, settings: Settings): {wake:number;bed:number;nWake:number;nBed:number;bedEst:boolean} | null;
shiftToward(start: number, target: number, k: number, stepMinutes: number): number;
planDays(st: {wake:number;bed:number}, settings: Settings): number;
currentState(data: SleepData, now: Date, settings: Settings): {wake: Date; logged:boolean; asleep:boolean};
getSleepView(data: SleepData, now: Date, settings: Settings): {
 wake: Date; bed: Date; logged:boolean; asleep:boolean; elapsedMinutes:number; leftMinutes:number;
 progress:number; color:string; phase:string | null; status:string; planIndex:number | null;
};
getPlanNights(data: SleepData, now: Date, settings: Settings): {night:number;wake:number;bed:number;current:boolean}[];
logSleep(data: SleepData, entry:'wake'|'bed', date:Date): SleepData;
```

Sleeping progress uses the configured white color at opacity 0.4; callers apply this opacity when `asleep` is true. Always pass `now` to `parseWhen` in application/tests despite its compatibility default.

Golden fixtures must execute extracted legacy pure functions in Node with deterministic Date and DateFormatter stubs. Preserve the legacy rounding/calendar semantics including DST; document any intentional safety improvement rather than silently changing expected outputs.
