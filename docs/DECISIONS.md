# Decisions

Numbers are stable identifiers; 006 (the original build's work allocation) was a process note and is retired.

## 001 — Safe defaults (2026-11-15)
Use a local sandbox in debug builds and a memory-only browser preview. Never probe the user's actual Scriptable folder during automated development. Existence of the conventional iCloud path is checked only on deliberate Settings selection, favouring the stricter no-real-data-read rule over probing it earlier.

## 002 — Ledger extension, not a database
Keep legacy focus `days` as baseline during migration. A session key is its start epoch; include completion date so aggregation does not depend on the current timezone after travel. File re-read operations cannot guarantee distributed transactions across iCloud; document that limitation instead of promising locks that iOS cannot honour.

## 003 — Explicit sets and stable log id
UI task toggles issue `set_task(date,task,done)`, making retry safe. Keep logId separate from display title to prevent a title edit orphaning history. Archive by moving names into archivedTasks; confirmation precedes history renames and destructive clears.

## 004 — Scheduling belongs in Rust
Future notification scheduling is not portable on desktop. Rust checks pending deadlines while the app is alive and rebuilds on starts/data changes. No background service or server.

## 005 — Toolchain and packaging
Next static export + Tauri 2, pnpm workspace, Zod schemas and serde mirrors. Use webpack build explicitly rather than relying on evolving Turbopack behaviour. Mac bundles are ad-hoc signed (`signingIdentity: "-"`), not Developer ID signed or notarized. Update archives are signed with a separate Tauri updater (minisign) key, and the user-initiated update check is the one deliberate network exception. App name lives in Tauri config, frontend metadata and README.

## 007 — Ambiguous focus ledgers fail closed (2026-11-15)
A file containing a session ledger but no baseline cannot safely treat saved `days` as either legacy baseline or session-derived totals. If they disagree with zero-baseline derivation, refuse rather than normalize and erase history. Manual recovery is safer than guessing. Shared TypeScript/Rust/phone validators were aligned after independent review.

## 008 — Native HTML dialog compatibility (2026-11-15)
The HTML `<dialog>` confirmation helper requires macOS 12.3+ in the target WKWebView baseline, so set the app minimum accordingly. Native WKWebView acceptance exercised Cancel, Escape, default Enter and explicit Confirm; errors fail closed and surface through the shared UI notice. This does not claim broader OS/device compatibility.

## 009 — Mac-local appearance and tray preferences (2026-11-15)
Keep `themeMode` (`day|night|auto`, missing defaults to night) and `trayDisplay` (strict eight-value enum, missing defaults to auto) in the separate native preferences contract, not shared `daybar-settings.json` or phone settings. Auto appearance follows macOS's configured light/dark schedule without Daybar location access. Tray Auto preserves timer-first then bedtime; explicit choices stay selected. Validation, types and Rust serde reject unknown values.

## 010 — Feature switches are Mac-local and default off (2026-11-17)
Module and feature switches, and each feature's settings, live in `preferences.features` in the Mac-only preferences file, never in shared `daybar-settings.json`, which the iPhone scripts validate strictly. Existing modules default on and every new feature defaults off, so an update changes nothing until the user opts in. Turning a module off hides it and silences its alerts but never modifies data. A missing `features` key loads as defaults on both the TypeScript and Rust sides.

## 011 — Deadline Radar reads EventKit from Rust (2026-11-17)
Instead of the planned Swift helper, Rust calls EventKit directly through the `objc2-event-kit` bindings, behind typed commands, so the frontend still gets no calendar or filesystem access of its own. Access is requested only on a deliberate action, originally turning Radar on and since 012 opening the Radar page or pressing Grant access (macOS 14+ full-access APIs, the older request API on 12.3–13). The bundle carries usage strings in `Info.plist` and the calendars entitlement required under the hardened runtime. Because builds are ad-hoc signed, macOS may treat each update as a new app and ask for access again. Radar alerts and the "next deadline" label read an in-process cache that refreshes on a timer and on demand.

## 012 — Useful features start on; fewer switches (2026-11-18)
Supersedes the "default off" half of 010. Shipping every feature off left most of 0.3.0 undiscovered, and seventeen switches in one list was overwhelming. Now everything starts on except the three that interrupt often or change how sessions run (hourly chime, movement nudges, auto-cycle). Features that are inert until used, or are part of another feature (Room before an event, Focus shortcuts, Export history, Command palette, Extra countdowns), lose their switch. Settings groups the rest into five closed sections. Radar starting on must not prompt by itself, so Settings no longer asks for Calendar access automatically; the Radar page (a deliberate visit) and the Grant access button do. Because 0.3.0 wrote its `false` defaults into `preferences.json`, a `featuresVersion` field lets the app raise an older file to the new defaults once and then respect later choices. Switches stay Mac-local, as in 010.

## 013 — The app starts blank (2026-11-19)
Until 0.3.2 the installed app filled its private folder with the fictional test fixtures (a "Community Garden Opening" countdown, four sample tasks, ten weeks of history), so a new user saw someone else's data. Now the folder starts with the smallest valid files: one placeholder habit, because shared settings require at least one task, a year-long countdown from the first launch, and empty logs. An install that already holds the old sample moves those files into a `sample-data-<timestamp>` folder once, guarded by a `.daybar-starter` marker, rather than deleting them, because some people used the private folder as their real data. Settings gains a button that fills in Scriptable's iCloud Drive folder, but connecting still needs the explicit real-data opt-in and confirmation. The browser preview keeps its in-memory demo data, since it is a demo.

## 014 — Phone widgets follow Daybar's rules, stay separate (2026-11-21)
The phone scripts stay five standalone files because Scriptable's memory is tight, so shared logic is copied inline rather than imported. Streak and radar rules mirror `packages/core`. `THEME` (`day|night|auto`) is a constant inside each script, defaulting to night like the Mac's default (009), and is not part of shared settings. Deadline Radar is no longer byte-identical to the legacy copy (`legacy/` is untouched), while Days Left medium in night mode stays golden-tested against legacy. Widget taps use `scriptable:///run/<script name>?action=…`, built from `Script.name()` so renamed scripts still work.

## 015 — Spaces and subtasks live beside the shared files (2026-11-21)
Work, Personal and other parts of life become *spaces*: each has its own task list, history file (`daily-log-<logId>.json`), countdowns and focus credit, while sleep, appearance and focus presets stay shared. The main space is the existing `daybar-settings.json` and its log, so the phone keeps working untouched and shows the main space only. Extra spaces and every space's subtask definitions are stored in a new `daybar-spaces.json`, which the phone scripts never read (014 keeps them standalone). Focus sessions are credited to a space through a `focus` map keyed by session start, so the focus ledger (007) is not changed. Subtask completion is written into the same daily log as `"Task › Subtask"` entries: it resets each day like tasks, keeps history in one place, and a phone that sees an unknown entry simply ignores it. A task ticks itself when all its subtasks are done and unticks when one is undone; ticking the task ticks every subtask. Removing a space keeps its history file, so recreating it with the same name brings the history back.

## 016 — Guided setup and removing sample data (2026-11-21)
A new install opens a short setup window (tasks, a countdown, spaces, which pages to show) instead of a page of placeholders. Only a brand-new install sees it: `preferences.setupDone` is missing on existing files and defaults to `true`, so an update never interrupts anyone. Skipping or finishing records it; Escape only hides it for this run. Setup changes the task list with the same rename-then-archive steps as Settings, so it never discards history. "Remove sample data" (demo banner, Settings and the setup window) resets the private sandbox folder to the blank starter from 013 and is refused for a connected real folder.

## 017 — Google Calendar is the second network exception (2026-11-21)
Deadline Radar could already read Google calendars added to macOS Calendar, but people asked for Google without going through macOS. Daybar now signs in to Google directly with OAuth for installed apps: the browser shows Google's consent page, the reply comes back to a one-shot listener on `127.0.0.1`, and the code is exchanged with PKCE. The only scope is `calendar.readonly`, and Daybar talks only to `accounts.google.com`, `oauth2.googleapis.com` and `www.googleapis.com`, and only while signed in. Daybar ships no client ID of its own: the person creates a Desktop OAuth client in their own Google Cloud project, which avoids Google's app verification and means no shared quota or secret. The client ID, secret and refresh token are kept together in one macOS Keychain item, never in the data folder, so nothing about Google reaches the phone or a synced folder. Google events merge with EventKit ones in the Radar cache; an event that appears in both (same title and start) is shown once. When Google cannot be reached, the last Google items stay and the error names Google. Disconnecting revokes the grant and deletes the Keychain item. This is the second deliberate network exception after the update check (005).

