# Shared data contracts

Runtime schemas: `packages/core/src/contracts/index.ts`; portable JSON Schemas: `packages/core/src/contracts/schemas/`; serde mirrors: `apps/desktop/src-tauri/src/contracts.rs`.
All dates are **local calendar** YYYY-MM-DD. Epoch timestamps are milliseconds. Minutes of day are integers 0–1439. Never parse a day key as a UTC ISO timestamp.

| File | Shape |
|---|---|
| `daily-log-<logId>.json` | `{ "YYYY-MM-DD": ["Task name"] }` or legacy `["YYYY-MM-DD"]` |
| `focus-timer.json` | `{ state: null \| {type, minutes, start, end, task?}, days: {date:{count,minutes}}, sessions?: {start:{type,minutes,creditedMinutes,end,date,task?}}, baseline?: {date:{count,minutes}} }` |
| `sleep-data.json` | `{wakes:{date:minutesOfDay}, beds:{eveningDate:minutesOfDay}, plan:null\|{start,wake,bed}}` |
| `daybar-settings.json` | `{schemaVersion:1,countdown?,habits?,focus?,sleep?,appearance?}`; omitted keys use script defaults |

## Settings
Full defaults in `packages/core/tests/fixtures/daybar-settings.json`. `countdown` has startDate/endDate/title. `habits` has startDate/endDate/title/logId/tasks/archivedTasks/dayCompleteMin/focusThresholds. `focus` has title/focusOptions/breakOptions/longBreakOptions/blockMinutes/alerts. `sleep` has title/awakeHours/sleepHours/targetWake/targetBed/stepMinutes/averageDays/bedtimeAlerts/routineMinutes/noPhoneMinutes. `appearance` holds all palette, opacity and grid tokens. Arrays replace, not merge. Unknown versions/fields and malformed files are read errors, not reset-to-empty writes. Some cross-field checks exceed what generated JSON Schema can express; Zod/Rust remain authoritative.

Log id starts as `Daily_Tasks` (legacy title sanitized); retain it across title changes. Widget parameter still selects a separate log. Renames transfer historical names and tagged-session names; archives retain historical entries but exclude them from current completion counts. A focus threshold maps active task name to daily tagged minutes.

## Focus upgrade
A legacy file without `sessions` is upgraded by capturing `baseline = days` and adding `sessions = {}` before mutation. Once a ledger exists, derive days from the preserved baseline plus focus sessions, with `count = floor(minutes / blockMinutes)`. A session key is the canonical decimal start epoch. Settlement at end credits planned minutes to the end date; early stop credits floor(elapsed minutes) to stop date, capped to planned. Break records credit zero. Already-recorded keys never add credit. Do not manufacture a new baseline from derived days. If `sessions` is present but `baseline` is absent and saved `days` contain unexplained totals, treat the file as ambiguous and refuse mutation; recover it manually rather than guessing or erasing history. `sessions: {}` with no baseline is only safe when the saved days agree with zero baseline.

## App-local preferences (not shared phone data)

The native app's separate `preferences.json` stores `themeMode: 'day' | 'night' | 'auto'` (missing defaults to `night`) and `trayDisplay: 'auto' | 'focusMinutes' | 'focusHours' | 'focusBlocks' | 'activeTimer' | 'bedtime' | 'nextTask' | 'countdown'` (missing defaults to `auto`), alongside native folder/OS preferences. Both enums are strict: unknown values are rejected. They do **not** belong to `daybar-settings.json`, `SharedSettings`, or the phone scripts. Behavior: [decision 009](DECISIONS.md#009--mac-local-appearance-and-tray-preferences-2026-11-15) and the [README](../README.md#everyday-controls).

## IPC
`get_snapshot() -> Snapshot`; `mutate({operation}) -> MutationResult`; `set_preferences({preferences}) -> Snapshot`; `resolve_conflict({file,action:'merge'|'discard'}) -> Snapshot`. Tauri arguments use camelCase. Events: `daybar://changed` (reload snapshot), with no payload requirement. See `DaybarClient`, `Operation`, `Snapshot` for exact types. The browser mock implements the same interface, purely in memory.

## Storage policy
Dev default `.dev-data` is ignored by git; `pnpm seed` copies the fixtures in `packages/core/tests/fixtures/` without overwriting existing files. The app-local preference file is not in the shared folder. A real folder may only be selected deliberately in Settings (production may offer the Scriptable path, never create it silently). The existence of the conventional iCloud path is checked **only on explicit selection**: no real-iCloud read happens during development. Backups, atomic writes, placeholders and conflict handling: [ARCHITECTURE](ARCHITECTURE.md#boundaries).
