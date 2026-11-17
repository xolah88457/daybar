# Daybar

**Your day, at a glance.** Daybar brings a countdown, daily habits, a focus timer and a sleep-shift plan into one quiet macOS window and menu bar. Built from everyday iPhone Scriptable widgets, it keeps the original dark, monospace, tiny-square visual language while using shared JSON in iCloud Drive rather than a server, account or database. No telemetry.

> **Preview:** Apple Silicon, macOS 12.3+. Ad-hoc signed, not notarized. Real iPhone/iCloud acceptance is not claimed. See the [release, verification and safe-switch guide](docs/RELEASE.md).

## Download the Mac app

Get the newest version from the [latest release](https://github.com/xolah88457/daybar/releases/latest):

- `Daybar_<version>_aarch64.dmg`: mount it and copy Daybar to Applications.
- `Daybar_<version>_aarch64.app.zip`: extract the complete app bundle.
- `SHA256SUMS.txt`: checksums for the files above.

These downloads need no Node/Rust installation. macOS will not recognise the developer on first open; see [opening the app](docs/RELEASE.md#opening-the-app-on-a-mac) for the steps.

**Updates:** from v0.2.0, **Settings → Check for updates** looks for a newer release on GitHub, installs it after verifying its updater signature, and offers a restart. It runs only when you click; Daybar never checks in the background. v0.1.0 has no updater, so install v0.2.0 manually once. How releases and the signing key work: [release guide](docs/RELEASE.md#publishing-a-release-and-in-app-updates).

![Daybar Today dashboard showing synthetic countdown, tasks, focus and sleep data](docs/screenshots/today.png)

*Native app window, 2026-11-15, fictional sandbox data. Not evidence of iCloud sync.*

![Sampled Daybar-owned menu-bar labels across eight saved modes](docs/screenshots/menu-bar.gif)

*Eight Daybar-owned status-item mode crops, two seconds each, synthetic data. A sampled sequence, not a continuous recording or proof of a live countdown. Capture details: [media notes](docs/screenshots/README.md).*

## Everyday controls

- Press the number keys to switch screens; the numbers follow the sidebar, so they shift when you turn modules or features on or off. Typing, composition and open dialogs are protected.
- Use the header **Day/Night** button, or **Settings → On this Mac → Appearance → Auto** to follow macOS. Set macOS itself to Auto for scheduled day/night changes; Daybar requests no location.
- Choose **Settings → On this Mac → Menu-bar label**, then **Save Mac preferences**: Auto, focus minutes/hours/blocks, active timer, bedtime, next task, countdown days only or, with Deadline Radar on, next deadline. Focus totals are today's credited work; explicit modes stay selected even during a timer.
- Landscape Today is compact; portrait stacks the cards. Small windows and long forms scroll rather than hide controls.

## Optional features

**Settings → Features** has a switch for each module and feature. The switches are stored only on this Mac (`preferences.json`); the settings file shared with the phone is never changed. Countdown, Habits, Focus and Sleep start on; turning one off hides its screen, Today card, menu-bar label and alerts, and keeps its data. Everything below starts **off**, so updating changes nothing until you opt in.

| Group | Feature | What it does |
| --- | --- | --- |
| Deadline Radar | Deadline Radar | Calendar events and reminders with due dates, colored by urgency like the phone widget. Own screen, Today card, optional "next deadline" menu-bar label and a daily "Due tomorrow" alert. Asks for Calendars/Reminders access only when you turn it on. |
| | Room before next event | "Room for ~N focus blocks before Design review at 12:15", from your next timed event today. Needs Deadline Radar. |
| Time awareness | Hourly chime | A notification on the hour, outside quiet hours. |
| | Check-ins | "Plan your day" in the morning; "N tasks left" in the evening (skipped when you're done). |
| | Streak saver | One alert before bed if today's habits would break your streak. |
| | Movement nudges | "Stand up and stretch" every N minutes in your active hours, skipped during focus. |
| Focus | Auto-cycle | When a focus session runs to the end, the break starts by itself; a long break every Nth session. |
| | Run a Shortcut | Runs a macOS Shortcut you name when focus starts and ends, e.g. to turn on Do Not Disturb. |
| | Away detection | If the Mac sits idle during focus, asks "Still focusing?" and offers to stop the timer. |
| Review & extras | Weekly insights | Focus, habits and sleep this week vs last week, built from data you already have. |
| | Export history | Saves focus, habit and sleep history as CSV or JSON to Downloads. Never changes your data. |
| | Command palette | ⌘K to jump to a screen, start or stop focus, tick off a task or log wake/bed. |
| | Extra countdowns | More countdowns on Today. Mac only; the phone keeps the main countdown. |

Alerts only fire while Daybar is running, like every other Daybar notification. None of these features use the network.

## From Scriptable widgets to a desktop app

The starting point was five separate Scriptable home-screen tools: Days Left, Daily Log, Focus Timer, Time Blindness + Sleep, and Deadline Radar. All five are on Mac: Deadline Radar is an optional feature that reads Calendar and Reminders on the Mac itself (the phone widget keeps reading the phone's own calendars). Today combines time until bed, focus controls, today's checklist, focus blocks and the countdown grid. Original scripts remain untouched in [`legacy/`](legacy/).

## iPhone Scriptable widgets

The five standalone scripts are in [`scriptable/`](scriptable/README.md): [Days Left](scriptable/Days%20Left.js), [Daily Log](scriptable/Daily%20Log.js), [Focus Timer](scriptable/Focus%20Timer.js), [Time Blindness + Sleep](scriptable/Time%20Blindness%20%2B%20Sleep.js), and [Deadline Radar](scriptable/Deadline%20Radar.js). Open each file on GitHub and use **Raw** to download or copy its complete source into Scriptable.

Install **Scriptable** from the iOS App Store by searching its name. For a shared phone/Mac setup, enable iCloud Drive on both devices with the same Apple ID and enable Scriptable's iCloud Drive access. Back up existing phone-local and iCloud Scriptable data before setup. On Mac, explicitly connect Daybar to the real Scriptable **Documents** folder only after reviewing the data and making backups; save valid shared settings with the intended task names before first use on phone, and confirm the Mac's read-only `habits.logId` matches the existing log filename. The Mac app is standalone without the phone; the phone companion requires Scriptable and these scripts. Keep shared files in iCloud Drive's `Scriptable` folder and avoid simultaneous edits. Full setup, widget parameters, data mapping and recovery guidance: [Scriptable setup guide](scriptable/README.md).

The desktop app includes editable settings, habit streaks, history-preserving task renames, focus-to-habit credit and “room for ~N blocks before bed.” Notifications are scheduled by Rust **only while Daybar is running**; this is not a background service, and OS notification delivery remains unverified.

## Architecture in a minute

```mermaid
flowchart TD
  UI[Next.js static client: Today / Countdown / Habits / Focus / Sleep / Settings]
  UI --> Core[Pure TypeScript: calculations + Zod contracts]
  UI --> IPC[Typed IPC: commands + change events]
  IPC --> Rust[Tauri Rust: DataStore / scheduler / tray / preferences]
  Rust <--> Files[Sandbox JSON by default / explicitly selected iCloud JSON]
  Phone[iPhone Scriptable widgets] <--> Files
  Rust <--> EventKit[Calendar + Reminders via EventKit, only with Deadline Radar on]
```

Next.js is statically exported into Tauri's WKWebView: no SSR, server actions or runtime server. The frontend never accesses the filesystem directly. Rust owns validation, atomic file writes and OS integration; `packages/core` owns deterministic calculations. Browser development uses an in-memory IPC preview, not live shared files. Details: [architecture](docs/ARCHITECTURE.md), [calculation conventions](docs/CORE_API.md), [data formats](docs/DATA_FORMATS.md), [decisions](docs/DECISIONS.md).

### Shared files, not magic sync

Daybar itself works without an iPhone; Scriptable is an optional companion for users who want shared files.

The phone and Mac share `daily-log-<LOG_ID>.json`, `focus-timer.json`, `sleep-data.json` and `daybar-settings.json`. Each mutation re-reads disk, applies one operation and validates. The Mac replaces files via a same-directory temporary file and atomic rename. Scriptable cannot atomically replace an existing file: it checks for intervening edits, moves the old file to a retained recovery backup, then installs the temporary file. A crash between those moves requires manual recovery; see the [phone guide](scriptable/README.md). Focus credit uses a session-start-keyed ledger so repeat settlement is a no-op; legacy daily totals remain a baseline.

**Limits:** atomic rename is not a cross-device transaction, and iCloud supplies no lock shared with the Mac. Re-reading narrows the race window but cannot guarantee that simultaneous phone/Mac edits never overwrite one another. Avoid editing the same data on both devices at once and keep backups. Conflict copies are surfaced for explicit merge/discard, never silently deleted. Full list: [safety limits](docs/ARCHITECTURE.md#safety-limits).

## Run locally — sandbox first

Requires macOS 12.3 or later (the WKWebView HTML-dialog helper requires 12.3; native confirmation behavior was exercised on the test Mac), Xcode Command Line Tools (`xcode-select --install` if absent), **Node 22**, **pnpm 10.12.3**, and stable Rust with Cargo. Install Rust using [rustup](https://rustup.rs/) and consult [Tauri's macOS prerequisites](https://v2.tauri.app/start/prerequisites/). Commands below run from the repository root.

```sh
corepack enable
corepack prepare pnpm@10.12.3 --activate
pnpm install --frozen-lockfile
pnpm seed
pnpm tauri dev
```

`pnpm seed` creates `.dev-data/` from synthetic fixtures without replacing existing files. Development must default to the sandbox; do not select a personal folder to test features. Browser-only preview: `pnpm dev` at `http://127.0.0.1:3000` (memory-only data; no native tray or notifications). No real iCloud path is needed for development or CI.

### Checks and builds

```sh
pnpm lint
pnpm typecheck
pnpm test:tz                 # core, desktop UI and phone tests in Toronto and London
pnpm test:rust               # cargo test for apps/desktop/src-tauri/Cargo.toml
pnpm build                   # static export: apps/desktop/out/
pnpm tauri build --no-sign --bundles app,dmg
```

`--no-sign` is for local builds without the updater key (otherwise the build errors "A public key has been found, but no private key"); release builds in CI omit it so the updater archive gets signed.

The app and DMG are produced under `apps/desktop/src-tauri/target/release/bundle/macos/` and `bundle/dmg/` respectively (unless Cargo's target directory is overridden). Tauri runs the static build before packaging. Release builds are **ad-hoc signed, not notarized** (`--no-sign` builds are unsigned); see [opening the app](docs/RELEASE.md#opening-the-app-on-a-mac).

[CI](.github/workflows/ci.yml) uses a macOS runner, Node 22, pnpm 10.12.3 and stable Rust; it runs frozen dependency installation, lint, types, timezone tests, phone Node tests (required, never silently skipped), Rust tests and static export. A `vX.Y.Z` tag additionally checks that the tag matches the app version, packages an ad-hoc signed, non-notarized `.app` and `.dmg` plus the signed updater archive and `latest.json`, and creates a **draft** GitHub Release for you to review and publish by hand. Only that last job holds a write token, and the only secrets are the two updater signing-key secrets used by the build step; real iCloud access is never configured.

## Opt in to real data — only after verification

Follow the complete [release and safe-switch guide](docs/RELEASE.md); do not switch valuable data based on this README alone. In short: back up the phone's existing local data and the Scriptable **Documents** folder first; install the updated scripts per the [phone guide](scriptable/README.md); then, in Daybar Settings, explicitly choose that folder and consent to real data. Do not repoint dev/test commands at it, and merely installing or building Daybar never probes it. Daybar writes its own timestamped backup as part of the first real write, so keep your own dated backup **before** opting in, and stop on any backup or validation error. Malformed or unknown files never become an empty replacement. In Finder, choose **Keep Downloaded** for the shared folder where available, and let iCloud finish syncing before switching devices.

Sandbox acceptance on fictional data covered the tray, external-file refresh, focus stop/expiry, the global shortcut, close-hide/reopen, confirmation dialogs, Day/Night/Auto, bare 1–6 navigation and all eight menu-bar modes. Actual iCloud materialization, full native conflict resolution and cross-device convergence remain unverified; the exact scope is in [what was verified](docs/RELEASE.md#what-was-verified).

## Stack & repository map

- **Tauri 2 / Rust:** native window, tray, scheduling, file safety; serde, notify and Tauri plugins.
- **Next.js App Router / React / strict TypeScript:** static client interface, no runtime server.
- **Zod / Vitest / Cargo tests:** contracts and deterministic calculations; pnpm workspaces.
- **Scriptable / iCloud Drive:** standalone iPhone widgets, shared backward-compatible JSON.

| Path | Responsibility |
| --- | --- |
| `apps/desktop/` | Next UI, typed IPC, `src-tauri/` backend |
| `packages/core/` | Pure logic, schemas, fixtures and tests |
| `scriptable/` | Updated phone scripts, isolated tests and install/recovery notes |
| `legacy/` | Original five scripts, preserved unchanged |
| `scripts/seed-sandbox.mjs` | Non-destructive synthetic sandbox seed |
| `docs/` | Architecture, calculation conventions, data formats, decisions, release/verification, screenshot notes |
| `.github/workflows/` | macOS checks; tag builds create a draft release with updater files |

## Roadmap

- Owner acceptance: real phone/iCloud setup, pending native/OS checks and a tag-built release; see [what is not established](docs/RELEASE.md#not-established).
- Bundle the tested core for Scriptable `importModule()` reuse (stretch).

## License

[MIT](LICENSE). Copyright belongs to Daybar contributors; no personal identity is assumed.
