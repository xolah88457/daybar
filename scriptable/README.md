# Install the Daybar phone widgets

These are **standalone Scriptable scripts**: no imports, npm packages, Mac app, or network service is required. `legacy/` remains the reference; `Deadline Radar.js` is copied byte-for-byte and does not read Daybar settings.

## 1. Back up before installing

1. Stop any running focus timer in the old script. Do not run old and updated versions together: the old Focus Timer can double-credit sessions and old versions write local-only data.
2. In Files, copy **iCloud Drive → Scriptable** to a dated backup outside that folder. Preserve existing JSON files and your original scripts. Do not replace that folder with this repository.
3. Back up Scriptable's **local** JSON too (it may not be visible in Files). Before replacing scripts, create a temporary Scriptable script with the following code and run it yourself. Choose a backup location when the export picker opens. It reads local files only; the export contains original JSON strings, including malformed files, without changing them:

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

   To restore one local export entry, its value is the **raw text** for that filename, not another object to stringify. Restore only while no device is editing; keep a second copy of the current files first.

## 2. Copy the scripts

1. Enable iCloud Drive for Scriptable in iOS Settings. Open Scriptable once while online.
2. Open each `.js` file in this directory, copy its entire contents into the corresponding Scriptable script, and retain its exact name. Keep the three `Variables used by Scriptable` header lines first. Alternatively import the `.js` files using the share sheet; remove duplicate imported names only after backing up.
3. Run **Daily Log**, **Focus Timer**, and **Time Blindness + Sleep** once in the app. Grant notification permission if you want timer/bedtime alerts. Verify your history before editing.
4. Each reads from Scriptable's iCloud documents. It migrates its same-named local JSON only when **neither the cloud canonical file nor its `.name.json.icloud` placeholder exists**. Local files are left intact. Existing cloud data wins; differing local/cloud histories are **not automatically merged**. Resolve differences from backups deliberately, not by deleting cloud data to force migration.
5. In Files on iPhone and Finder on Mac, long-press/right-click the Scriptable folder and choose **Keep Downloaded** where offered (otherwise download the files manually). Evicted files are requested and awaited before reading; a failed download stops the script instead of resetting data.
6. Add medium Scriptable widgets to the Home Screen; choose the appropriate script in each widget's configuration. Daily Log's optional widget parameter selects a separate log (`Other Log` → `daily-log-Other_Log.json`). Leave it empty for `habits.logId`, default `Daily_Tasks`. To migrate a parameterized local log, run that configured widget once. Focus can also preview small; Sleep/Countdown/Daily Log are designed for medium.

First test on copies/a spare log. No installer in this repository accesses your real iCloud data.

## 3. Shared settings

Place `daybar-settings.json` next to the JSON data in **iCloud Drive/Scriptable**, or let Daybar's Settings screen create it after explicitly selecting that folder. Missing files, sections, and individual keys use built-in defaults; arrays replace rather than merge. A malformed value, unknown field, or unsupported schema version **stops the script with an error** and leaves the file unchanged. Defaults are in each script; authoritative camelCase keys and ranges are in [`contracts/index.ts`](../packages/core/src/contracts/index.ts) and [`DATA_FORMATS.md`](../docs/DATA_FORMATS.md).

For example (all omitted settings retain defaults):

```json
{
  "schemaVersion": 1,
  "countdown": { "title": "End of University", "endDate": "2027-05-24" },
  "habits": {
    "logId": "Daily_Tasks",
    "tasks": ["Coursework", "Live Trading", "Trade Review", "Apostles work"],
    "dayCompleteMin": 1,
    "focusThresholds": { "Coursework": 50 }
  },
  "focus": { "focusOptions": [25, 50], "blockMinutes": 25, "alerts": true },
  "sleep": { "targetWake": "08:00", "stepMinutes": 15, "bedtimeAlerts": true },
  "appearance": { "green": "#39d353", "cellSize": 10, "gap": 2, "radius": 2 }
}
```

The four scripts apply their relevant titles/dates/tasks/timer presets, sleep targets, plan/phase timings, notification toggles and palette/opacity/grid tokens. Seven grid rows are fixed by the contract. `archivedTasks` is retained as settings metadata; only `tasks` counts for today's checklist. Keep `logId` stable when changing title. Renames/archive actions should be made in the Mac Settings UI so history is transferred, not by simply replacing task names in JSON.

On phone, choose a focus preset/custom duration, then **No task** or a task. Tagged minutes are totaled per credit date; reaching that task's `focusThresholds` value adds it to the configured Daily Log. This targets `habits.logId`, not a different Daily Log widget parameter. A retry after a habit-write failure repairs the link without adding focus minutes again. Because the contract has no acknowledgement/manual-override field, later Focus runs reassert earned task completion, including if you unchecked that earned task manually.

## 4. Keep the Health Shortcut

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
- **Interrupted write detection:** If a script run finds the canonical JSON file **and** its `.name.json.icloud` placeholder both missing, but sees `.daybar-backup-*` or `.daybar-temp-*` recovery files for that same canonical name, it **stops with an error naming the recovery files** instead of migrating stale local data or creating a new empty file. Evicted recovery files (`.<recovery-filename>.icloud`) also block initialization; if the directory cannot be inspected, the script stops rather than assuming it is empty. This prevents silently replacing the interrupted state with stale data, but does not eliminate cross-device races after the check. To recover: copy the latest `.daybar-backup-*` file to the canonical name (e.g., `daily-log-Daily_Tasks.json.daybar-backup-abc123` → `daily-log-Daily_Tasks.json`), then re-run the widget. The script will not auto-restore — you must choose which backup to promote.
- Session keys are exact decimal start-epoch milliseconds, with the shared contract's `type`, `minutes`, `creditedMinutes`, `end`, `date`, optional `task`. Legacy `days` become a baseline once; derived totals never become a second baseline. Crediting an existing key is a no-op. This prevents replay credit, **not** divergent concurrent-device writes that iCloud has not yet delivered.
- Focus → Habits involves two files, not a cross-file transaction. A later Focus run repairs earned checklist completion after interruption; the session remains credited if habits data is corrupt. There is no atomic transaction across devices/files.
- Focus shows a **snapshot** countdown clamped to zero rather than iOS's native date timer, which counts upward after expiry. Refresh is requested every minute/at expiry, but iOS controls refresh frequency: it may display a stale positive snapshot until refreshed. End-clock time and the scheduled notification remain available. Settling happens on the next script run, not continuously in the background.
- Notification permissions, live iCloud behavior, widget sizing and actual iOS refresh must be checked on your phone; Node tests cannot verify them.

## Tests (no iCloud access)

From the repo root:

```sh
TZ=America/Toronto node --test scriptable/tests/*.test.mjs
TZ=UTC node --test scriptable/tests/*.test.mjs
```

The VM harness executes the actual standalone scripts with in-memory Scriptable/FileManager stubs, including storage mutations and full widget entry points. Tests include async syntax for all five files, exact Radar copy, settings fallback/rejection, evicted downloads, local migration/no overwrite, malformed preservation, interleaved edits, failed moves/recovery, legacy arrays/baselines, duplicate settlement, focus-task repair, DST/calendar dates, midnight credit and Shortcut ingestion.
