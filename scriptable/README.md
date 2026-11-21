# Daybar Scriptable widgets: install and shared-data setup

Five separate JavaScript files are provided here: [Days Left](./Days%20Left.js), [Daily Log](./Daily%20Log.js), [Focus Timer](./Focus%20Timer.js), [Time Blindness + Sleep](./Time%20Blindness%20%2B%20Sleep.js), and [Deadline Radar](./Deadline%20Radar.js). Open each on GitHub, then use **Raw** to download or copy its source. They are standalone scripts with no npm packages, imports, Mac app, or network service required. The first four scripts share settings and data with Daybar for Mac. **Deadline Radar remains phone-only**: it reads Apple Calendars and Reminders in Scriptable and does not read Daybar settings or sync its radar data to the Mac.

## What each widget does

- **Days Left**: small, medium and large. Medium is the main layout. Large adds details under the grid. Tapping opens a details screen with milestones, weekdays left and previews of all three sizes.
- **Daily Log**: small, medium and large. Medium is the main layout. Large adds today's checklist under the grid. Tapping opens today's checklist directly, using the widget parameter's log if one is set. It shows current and best streaks, with the same rules as the Mac app: a day counts once it reaches `dayCompleteMin`, and today does not break the current streak until the day is over.
- **Focus Timer**: small and medium. Tapping opens a menu. The first choice is Repeat last session. Right after a focus session, breaks come first, and the long break leads after every 4th focus session of the day.
- **Time Blindness + Sleep**: small and medium. Tapping opens a menu. Its first choice is a one-tap log by time of day: "I'm up" in the morning, "Going to bed" in the evening.
- **Deadline Radar**: small, medium and large. Tapping opens the full list. Each row opens Calendar (`calshow:`) for events or Reminders for reminders. It follows the Mac's rules: a running multi-day event shows "Now" or "Today", not overdue; the window is DST-safe; items with equal dates are ordered by title; and the header counts overdue items.

## Appearance

Each script has `const THEME = "night";` near its settings. Set it to `"day"` for Daybar's Day palette, or `"auto"` to follow the iPhone's light/dark mode (it uses `Color.dynamic`). Colors you customised in shared settings are kept as set. The choice is per script. It is not in shared settings, which the Mac validates strictly, and Daybar's own Day/Night choice is Mac-only.

## Before you start: protect existing data

1. Stop any active timer in an older Focus Timer and do not run old and updated Focus Timer scripts together. Older versions can double-credit and write local-only data.
2. If you already use Scriptable, back up both copies of your data before migration: in Files, copy **iCloud Drive → Scriptable** to a dated location outside that folder; also export Scriptable's **local** JSON as described below (local files may not appear in Files). Preserve existing scripts and JSON, and review your current task names and log history. Do not replace the Scriptable folder with this repository.
3. Do not rename/delete tasks or history as part of setup. Daybar does not automatically rename or delete existing phone task data. Existing phone users should preserve their actual task names and histories in settings; any deliberate Mac rename/archive should use Daybar's confirmed Settings workflow after backups.

To export Scriptable's local JSON, create and run a temporary script in Scriptable. Choose a backup location when the export picker opens. It reads local files only and preserves original JSON strings, including malformed files:

```js
const fm = FileManager.local();
const root = fm.documentsDirectory();
const backup = {};
for (const file of fm.listContents(root)) {
  if (/^(daily-log-.+|focus-timer|sleep-data|daybar-settings)\.json$/.test(file)) {
    backup[file] = fm.readString(fm.joinPath(root, file));
  }
}
await DocumentPicker.exportString(JSON.stringify(backup, null, 2), "daybar-local-backup.json");
Script.complete();
```

An exported entry's value is the raw text for that filename, not an object to stringify again. Restore only while no device is editing, and keep another copy of current files first.

## First shared phone + Mac setup

1. Install **Scriptable** from the iOS App Store (search for “Scriptable”). Enable iCloud Drive on iPhone and Mac, use the **same Apple ID**, and allow Scriptable to use iCloud Drive in iOS Settings. Open Scriptable once while online. The Mac can still run Daybar on its own; the phone companion requires Scriptable and the scripts.
2. Make the backups above, then review the task names and Daily Log identity you want to preserve. On Mac, explicitly connect Daybar to the real Scriptable iCloud **Documents** folder only after reviewing those files. In Daybar Settings, select the actual Scriptable folder, enable the real-data opt-in, review and confirm the connection, then save valid shared `daybar-settings.json` settings with the intended task names before first use on phone. Confirm the Mac's displayed `habits.logId` matches the existing `daily-log-<logId>.json` filename: this field is read-only in the Mac UI, so do not try to edit it. If it does not match, pause and resolve the mismatch deliberately before connecting scripts; do not rename/delete files or force migration. Do not rely on the phone scripts' built-in legacy fallback to match Mac data. Daybar backs up managed files before its first real write; confirm that backup exists before editing real data. Selecting/connect may expose real data to the app, so do this only after the backups and review.
3. Keep shared JSON files directly in **iCloud Drive/Scriptable**, the folder represented by Scriptable's `FileManager.iCloud().documentsDirectory()`. Do not put them in an arbitrary nested folder. In Finder, choose **Keep Downloaded** for the Scriptable folder where available. On iPhone, allow Scriptable to download/await evicted files; do not assume an offline placeholder is ready to edit.
4. Install the five scripts linked above. For each file, open it from GitHub, use **Raw** to download or copy the complete source into a Scriptable script with the matching name; preserve the three `Variables used by Scriptable` header lines at the top. Alternatively import via the share sheet; remove duplicate script names only after backup. Do not overwrite the originals until you have backups.
5. Run **Daily Log**, **Focus Timer**, and **Time Blindness + Sleep** once in the Scriptable app and check the result. Grant notification permission if you want their phone alerts. Run **Days Left** and **Deadline Radar** too; grant calendar/reminder permissions to Deadline Radar only if you want those data sources. Permissions and data access are controlled on your device.
6. Add Scriptable widgets to the Home Screen and choose the matching script in each widget's configuration. Small, medium and large work for Days Left, Daily Log and Deadline Radar; Focus and Sleep support small and medium. Medium remains the main layout. On large, Days Left adds details and Daily Log adds today's checklist. Configure Daily Log's optional widget parameter only when you intentionally want a separate log. Keep it empty to use shared `habits.logId` (default `Daily_Tasks`). A different widget parameter writes to its own `daily-log-<parameter>.json` and will not show as the configured Mac Daily Log. Focus-to-habit credit always targets `habits.logId`, not a separate widget parameter.

### Existing Scriptable users and local migration

The updated Daily Log, Focus Timer, and Sleep scripts migrate a same-named local JSON file only if **both** its iCloud canonical file and `.<filename>.icloud` placeholder are absent. They leave local files intact. Existing cloud data wins; local/cloud histories are not merged automatically. A parameterized Daily Log's local file is considered only when that exact parameterized widget is run. Back up both locations first, compare differing data deliberately, and never delete cloud data just to force migration. Preserve your existing task names/history in the saved settings; there is no automatic task rename or deletion.

The Mac's shared JSON mapping is: `daybar-settings.json` (settings), `daily-log-<logId>.json` (habit history), `focus-timer.json` (timer and focus ledger), and `sleep-data.json` (sleep log/plan). Missing settings keys fall back to built-in values, but the phone retains legacy compatibility defaults, and a new Mac install starts with a single placeholder habit ("First habit"). Save matching shared settings before first phone use instead of relying on either fallback. Unknown schema versions, unknown settings keys, and malformed values stop with an error; scripts do not silently reset files. See the [shared data contract](../docs/DATA_FORMATS.md).

## Shared settings example

The Daybar Mac Settings screen can save the shared settings file once connected to the real Scriptable folder. For a fresh setup, configure the chosen task list before the phone scripts first run; use the `habits.logId` displayed by Mac Settings (read-only), and make sure it matches the intended log filename. For an existing phone setup, retain the real task names and log ID; do not copy this sample blindly. If the ID cannot be matched in the Mac UI, pause rather than renaming or deleting a log. Omitted sections/keys use defaults and arrays replace rather than merge.

```json
{
  "schemaVersion": 1,
  "countdown": { "title": "Community Garden Opening", "startDate": "2026-10-01", "endDate": "2027-07-01" },
  "habits": {
    "logId": "Daily_Tasks",
    "tasks": ["Read a chapter", "Sketch a scene", "Take a walk", "Water the plants"],
    "dayCompleteMin": 1,
    "focusThresholds": { "Read a chapter": 50 }
  },
  "focus": { "focusOptions": [25, 50], "blockMinutes": 25, "alerts": true },
  "sleep": { "targetWake": "08:00", "stepMinutes": 15, "bedtimeAlerts": true },
  "appearance": { "green": "#39d353", "cellSize": 10, "gap": 2, "radius": 2 }
}
```

The four integrated scripts use their relevant settings for titles/dates/tasks, focus presets, sleep targets and plan/phase timings, alerts, and palette/grid tokens. Seven grid rows are fixed. `archivedTasks` is retained as metadata; only `tasks` count in today's checklist. Keep `logId` stable when changing a title. Use the Mac Settings UI for a confirmed rename/archive so history transfers; editing task names in JSON does not migrate history. Daybar's Day/Night/Auto appearance and app-local tray-display preferences are Mac-only, not part of shared settings, and are not synced to the phone.

On phone, tagged focus minutes accumulate by task and credit date. Reaching the task's `focusThresholds` adds it to the configured Daily Log; a later Focus run can repair an interrupted two-file update. This is not atomic, and earned completion may be reasserted if manually unchecked. For storage behavior, backup recovery, and concurrency limits, see [Safety and limitations](#safety-and-limitations) below.

## Keep the Health Shortcut

Keep the existing Shortcut if it already calls **Time Blindness + Sleep**. Its input formats have not been removed:

- Dictionary `{ "wake": "2026-11-15T08:00:00-05:00", "bed": "2026-11-15T00:30:00-05:00" }` (either key may be omitted).
- The same dictionary serialized as JSON, or a plain wake-time string.
- Dictionary `{ "starts": [...], "ends": [...] }`, with paired sleep-segment timestamps, oldest first. Arrays or newline-separated strings are accepted. Segments within two hours merge; only sessions spanning at least three hours are logged. Every detected night is retained.
- Time-only input (`08:00`, `7:30 AM`) is still accepted. Prefer ISO timestamps **with date and timezone** to avoid ambiguous DST/night attribution.

To create/repoint a Shortcut:

1. In Shortcuts, use **Find Health Samples**, type **Sleep Analysis**, over your desired look-back (for example 14 days), sorted by start date oldest first. Grant Health read permission. Use the asleep categories you intend to track.
2. Collect each sample's **Start Date** and **End Date** using Get Details/Repeat with Each; format both as ISO 8601 including timezone, retaining paired order.
3. Make a Dictionary with `starts` and `ends` containing those lists. Add Scriptable's **Run Script**, select **Time Blindness + Sleep**, and pass that Dictionary as the parameter. Do not select the old/duplicate imported script.
4. Add **Show Result** during setup: the script returns the last wake/bed and number of nights (or a readable parse/no-session result). Run manually and check the Sleep plan's **Logged days**.
5. Optionally call this Shortcut from a wake-up/personal automation. iOS decides whether an automation needs confirmation; test it on your device. The Mac does not read Health directly.

For a simple manual Shortcut, replace steps 1–3 with a Dictionary containing `wake` and/or `bed`. Time-only bed is resolved before the wake/now, and beds more than 14 hours before a supplied wake are skipped. After-midnight beds (before noon, as in the original) belong to the previous evening's **calendar date**.

## Safety and limitations

- JSON is validated **before reads are used and before writes**. Unknown/malformed files are never silently reset. Scriptable displays the thrown error; repair/restore a copy before retrying. No corruption fallback writes empty data.
- Each mutation re-reads the latest file, applies one operation, writes a unique same-folder temporary file, compares the canonical text again, moves the original to a same-folder recovery backup, then moves the temporary file into place. A failed replacement attempts to restore the original; the backup remains on failure. If recovery fails, the error identifies the backup path. Successful replacements remove the temporary backup. Keep your independent backups.
- **This is not a transactional atomic replacement or distributed lock.** Scriptable exposes no atomic replace/CAS/lock API. Individual filesystem moves may be atomic, but the backup → replacement sequence has a missing-canonical/crash window, and iCloud is eventually consistent. Another device can race after the final comparison; simultaneous offline edits can still create conflict copies or lose an unseen edit. Do not edit the same file simultaneously on devices. Use the Mac conflict-resolution UI for iCloud conflict copies; the phone does not silently merge/delete those copies. Do not delete `.daybar-backup-*` recovery files until reviewed.
- **Interrupted write detection:** If a script run finds the canonical JSON file **and** its `.name.json.icloud` placeholder both missing, but sees `.daybar-backup-*` or `.daybar-temp-*` recovery files for that same canonical name, it **stops with an error naming the recovery files** instead of migrating stale local data or creating a new empty file. Evicted recovery files (`.<recovery-filename>.icloud`) also block initialization; if the directory cannot be inspected, the script stops rather than assuming it is empty. This prevents silently replacing the interrupted state with stale data, but does not eliminate cross-device races after the check. To recover: stop writers on both devices and preserve copies of all canonical, temporary and backup files first. Inspect and validate a known-good backup, then copy that chosen file to the canonical name (e.g., `daily-log-Daily_Tasks.json.daybar-backup-abc123` → `daily-log-Daily_Tasks.json`) before retrying. Do not assume the newest file is correct or delete artifacts to bypass the guard. The script will not auto-restore — you must choose which backup to promote.
- Session keys are exact decimal start-epoch milliseconds, with the shared contract's `type`, `minutes`, `creditedMinutes`, `end`, `date`, optional `task`. Legacy `days` become a baseline once; derived totals never become a second baseline. Crediting an existing key is a no-op. This prevents replay credit, **not** divergent concurrent-device writes that iCloud has not yet delivered.
- Focus → Habits involves two files, not a cross-file transaction. A later Focus run repairs earned checklist completion after interruption; the session remains credited if habits data is corrupt. There is no atomic transaction across devices/files.
- Focus shows a **snapshot** countdown clamped to zero rather than iOS's native date timer, which counts upward after expiry. Refresh is requested every minute/at expiry, but iOS controls refresh frequency: it may display a stale positive snapshot until refreshed. End-clock time and the scheduled notification remain available. Settling happens on the next script run, not continuously in the background.
- Notification permissions, live iCloud behavior, widget sizing, `Color.dynamic` (THEME `auto`), tap URLs and actual iOS refresh must be checked on your phone; Node tests cannot verify them.

## Tests (no iCloud access)

From the repo root:

```sh
TZ=America/Toronto node --test scriptable/tests/*.test.mjs
TZ=UTC node --test scriptable/tests/*.test.mjs
```

The VM harness executes the actual standalone scripts with in-memory Scriptable/FileManager stubs, including storage mutations and full widget entry points. Tests include async syntax for all five files, Days Left medium in night mode matching the legacy script (golden test; Radar is no longer a byte copy of legacy), settings fallback/rejection, evicted downloads, local migration/no overwrite, malformed preservation, interleaved edits, failed moves/recovery, legacy arrays/baselines, duplicate settlement, focus-task repair, DST/calendar dates, midnight credit and Shortcut ingestion.
