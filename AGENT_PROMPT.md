# Build brief: Scriptable widgets → unified macOS app (Tauri + Next.js)

Working app name: **Daybar** (placeholder, rename freely in one place: `app.config` / `tauri.conf.json` / README).

---

## 1. Your role and how to work

You are the **orchestrating agent** for this project. You own the plan, the architecture, the shared contracts, merging, and final verification. You may spawn **as many sub-agents as you find useful**, in parallel wherever work is independent.

Rules for using sub-agents:
- Do the foundation (Phase 0) yourself before fanning out. Sub-agents build against contracts you wrote, never invent their own.
- Give every sub-agent: the relevant section of this brief, the contract files it must code against, the exact files/folders it owns, and a clear "done" check (tests that must pass, commands that must succeed). Two sub-agents never own the same file.
- Run sub-agents on separate branches or git worktrees. Merge one at a time; run the full test suite after every merge before merging the next.
- Use at least one **fresh review sub-agent** (one that did not write the code) in Phase 4 to verify behaviour against the legacy scripts and this brief.
- Keep `docs/PROGRESS.md` updated with what is done, what is next, and any decision you made that this brief did not cover.

When this brief is silent, make the reasonable call, record it in `docs/DECISIONS.md` (short ADR style), and keep going. Stop and ask me only for something irreversible or something that would touch my real data in a way this brief does not allow.

---

## 2. Context

This folder holds five JavaScript files I wrote for the **Scriptable** app on iPhone. They run home-screen widgets I use every day:

| File | What it does |
|---|---|
| `Days Left.js` | GitHub-style grid counting down from a start date to an end date ("End of University") |
| `Daily Log.js` | Multi-task daily checklist with a heatmap of how many tasks were done each day |
| `Focus Timer.js` | Pomodoro timer with focus/break/long-break options, daily focus-block tracker |
| `Time Blindness + Sleep.js` | Day progress bar from wake to bedtime, bedtime phases, sleep data from Apple Health via a Shortcut, 15-min/day sleep-shift plan |
| `Deadline Radar.js` | Upcoming calendar events + reminders by urgency (**out of scope for v1**) |

**Read all five files completely before planning.** They are the functional spec. Every behaviour in the four in-scope scripts must exist in the Mac app (see §6 for the parity checklist).

**Goal:** a macOS desktop app that unifies the four in-scope scripts into one app, **shares live data with the iPhone widgets** through iCloud Drive, and is polished enough to be a portfolio project on my public GitHub. The iPhone widgets keep working; the Mac app is a second front end on the same data.

Code quality, tests, documentation and the README count as much as the features. Someone reviewing my GitHub should be able to understand the architecture in five minutes.

---

## 3. Fixed decisions (do not change)

- **Desktop shell:** Tauri 2 (Rust backend).
- **Frontend:** Next.js (App Router) + TypeScript in strict mode.
- **Platform:** macOS only for v1. No server, no accounts, no telemetry.
- **Data:** shared JSON files in Scriptable's iCloud Drive folder (§5). No database.
- **Deadline Radar:** not ported in v1. Leave a clean seam (a module slot in navigation and the architecture doc) so it can be added later via a small Swift EventKit helper.
- **Package manager / layout:** pnpm workspaces monorepo (§8).
- **Visual identity:** keep the look of the scripts. Background `#0d1117`, text `#ffffff`, accent green `#39d353`, break blue `#58a6ff`, urgency red `#ff5c5c`, orange `#ff9f43`, yellow `#f2cc60`, Menlo / monospace type, small rounded squares (radius 2) for grids, dim white at low opacity for empty cells. Turn these into design tokens in one place.

### Next.js inside Tauri: hard constraints
- `output: 'export'` (static export). No SSR at runtime, no Route Handlers, no Server Actions, no middleware, no `next/image` optimisation (`images.unoptimized: true`).
- Interactive pages are client components. All file and OS access goes through Tauri commands; the frontend never touches the filesystem directly.
- Tauri config: `devUrl` → Next dev server, `frontendDist` → the export output folder. Follow the current official Tauri + Next.js guide and verify versions against current docs rather than memory.

---

## 4. Architecture overview (target)

```
Next.js UI (client components)
   │  typed IPC client (one module wrapping invoke() + event listeners)
   ▼
Tauri Rust backend
   ├─ DataStore: read / atomic write / watch the iCloud JSON files
   ├─ Scheduler: fires notifications at specific times while the app runs
   ├─ Tray: menu bar title + menu
   └─ Settings: app-local prefs (data folder path, launch at login, dock icon)
   │
   ▼
~/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/*.json  ◄── iPhone Scriptable widgets
```

- **`packages/core`** (pure TypeScript, no I/O, no DOM): every calculation from the scripts lives here, fully unit-tested. The UI calls core; core never calls the UI or the backend.
- **Rust backend** owns all file I/O and OS integration. Keep it small and well-tested.
- Confirm the Scriptable iCloud path exists on this Mac before relying on it; make the path a setting.

---

## 5. Data layer (most important section, get this right first)

### 5.1 Files (existing formats, derived from the scripts; confirm by reading them)
- `daily-log-<LOG_ID>.json`: `{ "YYYY-MM-DD": ["Task name", ...] }`. Older format was an array of fully done day keys; the script migrates it on read. `LOG_ID` comes from the widget parameter or the title (non-alphanumerics → `_`), default `daily-log-Daily_Tasks.json`.
- `focus-timer.json`: `{ state: null | { type: "focus"|"break", minutes, start, end }, days: { "YYYY-MM-DD": { count, minutes } } }`. Times are epoch ms.
- `sleep-data.json`: `{ wakes: { "YYYY-MM-DD": minutesOfDay }, beds: { "YYYY-MM-DD": minutesOfDay }, plan: null | { start: "YYYY-MM-DD", wake, bed } }`. A bedtime after midnight is stored under the previous evening's date.
- **New:** `daybar-settings.json`: the settings that are currently hard-coded `SETTINGS` constants in each script (task list, start/end dates, titles, focus options, block length, target wake/bed, awake/sleep hours, step minutes, routine/no-phone minutes, alert toggles, colours). Both the Mac app and the updated phone scripts read it; the phone scripts fall back to their built-in constants when the file or a key is missing. Include a `schemaVersion`.

Write TypeScript types **and** JSON Schemas (or zod schemas) for every file in `packages/core/src/contracts/`. Mirror them as serde structs in Rust. These are the contracts every sub-agent codes against.

### 5.2 Safety rules for my real data
- During development and tests, **never read or write the real iCloud folder.** Default the data folder to a dev sandbox (e.g. `./.dev-data/`) seeded with fixture files. The real path is used only when I select it in Settings, or in a release build.
- Before the app writes to a real data folder for the first time, copy every file it will touch into a timestamped backup folder.
- Writes are atomic (write temp file in the same folder, then rename).
- Validate every file on read. A malformed or unknown file is never overwritten; surface an error in the UI instead.

### 5.3 Sync and conflicts (phone and Mac editing the same files)
- Watch the data folder for changes (e.g. the `notify` crate) and push updates to the UI, so a task checked on the phone appears on the Mac without restarting.
- **Never write a whole cached object.** For every mutation: re-read the file, apply the single operation (toggle task X on day D, log wake for D, start timer...), validate, write atomically. This keeps the window for clobbering a concurrent phone edit tiny.
- iCloud may leave files as evicted placeholders (`.name.json.icloud`). Detect this, trigger a download (e.g. `brctl download <path>`), wait, then read. Recommend "Keep Downloaded" for the folder in the README.
- Detect iCloud conflict copies (e.g. `focus-timer 2.json`) and surface them in the UI with an option to merge or discard. Do not silently delete them.

### 5.4 Focus crediting must be idempotent
Today, `settle()` credits a finished focus session by adding minutes to `days[date]` and clearing `state`. If both the phone and the Mac settle the same session, the minutes are double-counted. Fix this:
- Add a `sessions` log (keyed by session start timestamp, with type, planned minutes, credited minutes, end/stop time). Derive `days[date].minutes` and `count` from it (`count = floor(minutes / BLOCK_MINUTES)`).
- Crediting a session whose key already exists is a no-op.
- Keep `days` written for backward compatibility. The updated phone script must use the same rule (§7). Old files without `sessions` keep working, and their existing `days` totals are preserved as a baseline.
- Same principle anywhere else two devices could apply the same operation.

---

## 6. Features

### 6.1 App shape
- **Main window:** sidebar navigation with **Today**, **Countdown**, **Habits** (Daily Log), **Focus**, **Sleep**, **Settings**. Dark theme in the scripts' style. Resizes cleanly; grids size themselves to the available width (no hard-coded widget widths).
- **Today dashboard:** a single screen combining the day progress bar and "time until bed", the active focus timer with start/stop, today's checklist (toggle tasks in place), today's focus blocks, and the countdown grid. This is the screen in the README hero screenshot.
- **Menu bar (tray):** title text shows the live focus countdown when a timer is running, otherwise time until bed (e.g. `4h 30m → bed`). Menu: start focus (each preset), stop timer, today's tasks as toggles, open window, quit. Setting to hide the Dock icon.
- **Launch at login** (setting) and a **global shortcut** to start/stop focus (setting).
- **Notifications** on the Mac: focus done, break over, night routine, no-phone time, bedtime. Implement scheduling in the Rust backend (a timer per pending notification, rebuilt whenever relevant data changes or the app starts). Do not assume a plugin supports future-dated notifications on desktop; check current docs. Notifications only need to fire while the app is running (it lives in the menu bar).

### 6.2 Parity checklist (every item must work like the script)
**Countdown (Days Left)**
- Column-major grid, 7 rows, one square per day from start to end; blanks after the end date.
- Past days green; today fades from dim to full white across the 24h day; future days dim.
- Footer: title, days left, % done (including fraction of today), Day X/Y, weeks left.

**Habits (Daily Log)**
- Configurable task list and `DAY_COMPLETE_MIN`.
- Heatmap colour: all tasks done = green; partial days blend through red → orange → yellow by count (match `dayColor` and `blend` exactly); opacity scales from `MIN_DONE_OPACITY` to 1; empty past days dim; future days a slightly brighter dim.
- Two modes: rolling window (no end date, newest day bottom-right, grid fills width) and fixed range (start to end date).
- Stats: completed/elapsed, today x/N, %, missed days, days left (fixed-range mode).
- Edit any past day via a date picker (not typed text). Only tasks that still exist are counted, same as the script, but see §6.3 for renames.
- Read the old array format.

**Focus**
- Presets: focus 25/50, break 5/10, long break 15/30 (from settings); custom focus length 1–240 min.
- Stopping a focus session early credits whole minutes worked; under 1 minute credits nothing and says so.
- Blocks per day = floor(total focus minutes / block length); minutes from separate partial sessions add up.
- A timer that finished while the app was closed gets credited on next load (idempotently, §5.4).
- Show the end clock time next to the countdown. The countdown must stop at 0:00.
- Row of block squares filling the width, green = completed blocks.

**Sleep (Time Blindness + Sleep)**
- Current state: latest logged wake within `AWAKE_HOURS + 6` h; otherwise estimate wake from plan, then 7-day average, then target. Show "(est)" when estimated and "Sleeping / Wake in ..." when before the estimated wake.
- Bedtime: plan's goal for tonight (must be at least 1 h after wake), otherwise wake + `AWAKE_HOURS`.
- Progress bar wake → bed coloured green / yellow (≤120 min left) / red (past bedtime).
- Phase line in the last two hours: "Night routine • bed prep", then "No phone time".
- Averages use a **circular mean** over the last `AVERAGE_DAYS` logged days (match `circMean`, `wrap`, `signedDiff`).
- Plan: shift wake and bed toward targets by `STEP_MINUTES` per day (`shiftToward`, `planDays`); plan screen lists current average, logged days, baseline, adjustment needed, every night of the plan with the current night highlighted; start / restart / stop plan; clear all data.
- Manual log wake / log bed ("just now" or a time picker); a bedtime after midnight belongs to the previous evening.
- Health data still arrives from the phone's Shortcut (the Mac has no Health data). The Mac app does not need the Shortcut ingest path, but `core` should still contain and test `parseWhen`, `resolveDates` and `findSleepSessions` so the phone script can share them later.

### 6.3 Improvements over the scripts (in scope for v1)
- Settings screen replaces every hard-coded `SETTINGS` constant and writes `daybar-settings.json`.
- Habits: renaming a task carries its history with it (rewrite past day entries in one operation, with confirmation). Removing a task archives it rather than erasing history.
- Habits: streaks (current and longest) and a per-task completion rate.
- **Focus → Habits link:** a focus session can be tagged with a Daily Log task; when tagged focus minutes for that task reach a threshold set per task in Settings, the task is checked off for that day automatically.
- **Time-aware focus:** the Focus screen and Today dashboard show "room for ~N blocks before bed" from time until bed and block length. During no-phone time, starting a focus session shows a gentle confirmation.
- Keyboard shortcuts throughout the main window.

### 6.4 Stretch (only after everything above is done and verified)
- Insights page: sleep (duration, consistency) vs focus minutes and habit completion over time.
- Build `packages/core` into a single CommonJS file copied to the Scriptable folder so the phone scripts can `importModule()` the same tested logic.

---

## 7. Phone-side script updates

Put updated copies of the scripts in `scriptable/` (do not edit the originals, which move to `legacy/` unchanged). I will copy the new versions into Scriptable myself.
- `Daily Log.js`, `Focus Timer.js`, `Time Blindness + Sleep.js`: switch `FileManager.local()` to `FileManager.iCloud()`. Before reading, call `await fm.downloadFileFromiCloud(path)` if the file is not downloaded.
- One-time migration in each: if the iCloud file is missing but the old local file exists, copy it across on first run. Never overwrite an existing iCloud file.
- All four in-scope scripts read `daybar-settings.json` with fallback to their built-in constants.
- `Focus Timer.js` uses the idempotent `sessions` model from §5.4 and stays able to read old files.
- Mutations follow the same re-read → apply one operation → write rule.
- Keep each script runnable as a standalone Scriptable script. Document the changes in `scriptable/README.md`, including the exact steps for me to install them.
- `Deadline Radar.js` is copied unchanged.

---

## 8. Repository layout

```
/apps/desktop/            Next.js app + src-tauri/
/packages/core/           Pure TS logic, contracts, tests, golden fixtures
/scriptable/              Updated phone scripts + install notes
/legacy/                  The five original scripts, untouched
/docs/                    ARCHITECTURE.md, DECISIONS.md, PROGRESS.md, DATA_FORMATS.md, screenshots
/.github/workflows/       CI
README.md
```

---

## 9. Phases and sub-agent plan

**Phase 0 — Foundation (orchestrator only, sequential)**
1. Read all five scripts. Write `docs/ARCHITECTURE.md` and `docs/DATA_FORMATS.md`.
2. Scaffold the monorepo, Next.js static export, Tauri 2 app; confirm `pnpm tauri dev` opens an empty window.
3. Write the contracts (§5.1) in TS and Rust, design tokens, the typed IPC interface (command names, arguments, return types, events), and dev-sandbox fixture files.
Gate: workspace builds, an empty app launches, contracts compile on both sides.

**Phase 1 — Parallel sub-agents**
- **Core logic:** port every pure function from the four in-scope scripts into `packages/core` with golden-fixture tests (§10).
- **Backend:** DataStore (read, atomic write, validation, backups, watcher, evicted placeholders, conflict-copy detection), operation-based mutation commands, Scheduler, Tray scaffold, app settings, launch at login, global shortcut. Rust unit tests on a temp folder.
- **UI shell:** layout, sidebar, design system components (grid square, progress bar, stat row, checklist row, timer display), typed IPC client with a mock implementation for browser-only development.
Gate: all three merged, all tests green.

**Phase 2 — Parallel module sub-agents** (each owns its module's pages, components, and its tray / notification hooks)
- Countdown · Habits · Focus · Sleep
Gate: each module passes its parity checklist items against the dev sandbox.

**Phase 3 — Integration (orchestrator, plus sub-agents as needed)**
- Today dashboard, menu bar title/menu, Settings screen, Focus → Habits link, time-aware focus, live sync from file changes, phone-side script updates (§7).

**Phase 4 — Verification and polish**
- Fresh review sub-agent: walk the parity checklist (§6.2) and safety rules (§5.2–5.4) against the code and the running app; report gaps. Fix them.
- A sync test: simulate a "phone" edit by writing to a sandbox file while the app runs; confirm the UI updates and no data is lost.
- README, screenshots/GIF, CI, release build.

---

## 10. Testing and verification

- **Golden fixtures for parity:** build a small Node harness that loads the pure functions from the legacy scripts (copy them out, and stub the few Scriptable globals they touch, e.g. `DateFormatter`). Generate expected outputs over many inputs, including midnight, bedtimes after midnight, DST changes, empty data, and the old Daily Log array format. Assert the TypeScript port matches exactly. Run tests with `TZ=America/Toronto` plus at least one other timezone.
- Vitest for `packages/core` (aim for full coverage of the logic), `cargo test` for the backend, component tests for the trickier UI (heatmap colours, timer display).
- CI on GitHub Actions (macOS runner): lint, typecheck, Vitest, `cargo test`, and on version tags a `tauri build` that uploads an unsigned `.dmg` as a release artifact.
- Before declaring done, actually run the app against the dev sandbox and check each screen, the tray, and a notification firing.

---

## 11. README (portfolio quality)

- One-paragraph pitch, hero screenshot of the Today dashboard, short GIF of the menu bar timer.
- "From Scriptable widgets to a desktop app": the before/after story, with a screenshot slot for the iPhone widgets (leave a placeholder; I'll add mine).
- Architecture diagram (Mermaid), the shared-iCloud-files approach and how conflicts are handled.
- Setup: install, dev, test, build. Note that the release build is unsigned and how to open it (right-click → Open), and recommend "Keep Downloaded" for the Scriptable iCloud folder.
- How to install the updated phone scripts (link to `scriptable/README.md`).
- Tech stack, project structure, roadmap (Deadline Radar via EventKit helper, insights, shared core on the phone).
- MIT license.

---

## 12. Definition of done (v1)

- [ ] App builds and runs with `pnpm tauri dev` and `pnpm tauri build`.
- [ ] Every item in §6.1–6.3 works; every parity item in §6.2 is covered by a passing test or a recorded manual check in `docs/PROGRESS.md`.
- [ ] No code path writes to the real data folder during tests or dev; first real write makes a backup.
- [ ] Editing a sandbox file externally updates the UI live; operation-based writes don't lose concurrent edits; focus sessions are never double-counted.
- [ ] Updated phone scripts in `scriptable/` with migration from local storage and install instructions.
- [ ] CI green. README, ARCHITECTURE, DECISIONS, DATA_FORMATS complete.
- [ ] Final summary for me: what was built, decisions made, known limitations, and the exact steps to switch from the dev sandbox to my real data.

## 13. Do not
- Do not modify the files in `legacy/` or touch my real iCloud data during development.
- Do not add a backend server, accounts, analytics, or network calls.
- Do not use Next.js server features that break static export.
- Do not port Deadline Radar in v1.
- Do not mark anything done without running its tests.
