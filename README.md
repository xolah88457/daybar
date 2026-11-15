# Daybar

**Your day, at a glance.** Daybar brings a countdown, daily habits, a focus timer and a sleep-shift plan into one quiet macOS window and menu bar. Built from everyday iPhone Scriptable widgets, it keeps the original dark, monospace, tiny-square visual language while using shared JSON in iCloud Drive rather than a server, account or database. No telemetry.

> **Work in progress:** feature integration and acceptance verification are pending. This README describes the v1 experience and safety contract, not a claim that every feature has shipped. See the [verification ledger](docs/VERIFICATION.md) and [documentation check report](docs/DOCS_REPORT.md).

![Daybar Today dashboard showing synthetic countdown, tasks, focus and sleep data](docs/screenshots/today.png)

*Captured from the actual static-export UI in browser-demo mode using synthetic in-memory data. It is not evidence of iCloud sync.*

![Native Daybar popup menu showing sampled idle, focus, stopped and task states](docs/screenshots/menu-bar.gif)

*Four actual native popup-window captures, two seconds each, with synthetic data. This is a sampled sequence—not a continuous recording or proof of a live countdown.*

## From Scriptable widgets to a desktop app

The starting point was five separate Scriptable home-screen tools: Days Left, Daily Log, Focus Timer, Time Blindness + Sleep, and Deadline Radar. Four modules are integrated on Mac; Deadline Radar remains a phone-only calendar/reminders widget until a future Mac release. Today combines time until bed, focus controls, today's checklist, focus blocks and the countdown grid. Original scripts remain untouched in [`legacy/`](legacy/).

**iPhone screenshot placeholder:** personal widget screenshot to be supplied by the owner; no image captured or included yet.

## iPhone Scriptable widgets

The five standalone scripts are in [`scriptable/`](scriptable/README.md): [Days Left](scriptable/Days%20Left.js), [Daily Log](scriptable/Daily%20Log.js), [Focus Timer](scriptable/Focus%20Timer.js), [Time Blindness + Sleep](scriptable/Time%20Blindness%20%2B%20Sleep.js), and [Deadline Radar](scriptable/Deadline%20Radar.js). Open each file on GitHub and use **Raw** to download or copy its complete source into Scriptable.

Install **Scriptable** from the iOS App Store by searching its name. For a shared phone/Mac setup, enable iCloud Drive on both devices with the same Apple ID and enable Scriptable's iCloud Drive access. Back up existing phone-local and iCloud Scriptable data before setup. On Mac, explicitly connect Daybar to the real Scriptable **Documents** folder only after reviewing the data and making backups; save valid shared settings with the intended task names before first use on phone, and confirm the Mac's read-only `habits.logId` matches the existing log filename. The Mac app is standalone without the phone; the phone companion requires Scriptable and these scripts. Keep shared files in iCloud Drive's `Scriptable` folder and avoid simultaneous edits. Full setup, widget parameters, data mapping and recovery guidance: [Scriptable setup guide](scriptable/README.md).

The intended desktop experience adds editable settings, habit streaks, history-preserving task renames, focus-to-habit credit and “room for ~N blocks before bed.” Notifications are scheduled by Rust **only while Daybar is running**; this is not a background service. See [capture instructions](docs/screenshots/README.md) before adding portfolio media.

## Architecture in a minute

```mermaid
flowchart TD
  UI[Next.js static client: Today / Countdown / Habits / Focus / Sleep / Settings]
  UI --> Core[Pure TypeScript: calculations + Zod contracts]
  UI --> IPC[Typed IPC: commands + change events]
  IPC --> Rust[Tauri Rust: DataStore / scheduler / tray / preferences]
  Rust <--> Files[Sandbox JSON by default / explicitly selected iCloud JSON]
  Phone[iPhone Scriptable widgets] <--> Files
  Radar[Future: Deadline Radar via Swift EventKit helper] -.-> Rust
```

Next.js is statically exported into Tauri's WKWebView: no SSR, server actions or runtime server. The frontend never accesses the filesystem directly. Rust owns validation, atomic file writes and OS integration; `packages/core` owns deterministic calculations. Browser development uses an in-memory IPC preview, not live shared files. Details: [architecture](docs/ARCHITECTURE.md), [data formats](docs/DATA_FORMATS.md), [decisions](docs/DECISIONS.md).

### Shared files, not magic sync

The phone and Mac share `daily-log-<LOG_ID>.json`, `focus-timer.json`, `sleep-data.json` and `daybar-settings.json`. Each mutation re-reads disk, applies one operation and validates. The Mac replaces files via a same-directory temporary file and atomic rename. Scriptable cannot atomically replace an existing file: it checks for intervening edits, moves the old file to a retained recovery backup, then installs the temporary file. A crash between those phone moves requires manual recovery; see the [phone guide](scriptable/README.md). Focus credit uses a session-start-keyed ledger so repeat settlement is a no-op; legacy daily totals remain a baseline.

**Phone recovery limitation:** Scriptable's FileManager cannot atomically replace an existing file or provide compare-and-swap. Phone writes retain a recovery backup and fail closed when interrupted-write artifacts remain; after a crash, inspect/recover those artifacts manually before continuing. The two-file focus-to-habit repair is also not atomic.

**Concurrency limitation:** atomic rename is not a cross-device transaction. Scriptable's `FileManager.iCloud()` synchronizes files; it does not supply a distributed transaction or a lock shared with the Mac. Re-reading narrows the race window but cannot guarantee that simultaneous phone/Mac edits never overwrite one another, even with idempotent focus credit. Conflict copies must be surfaced for explicit merge/discard, never silently deleted. Avoid editing the same data simultaneously; retain backups. These safety behaviours still require the checks in the ledger.

## Run locally — sandbox first

Requires macOS 12.3 or later (the WKWebView HTML-dialog helper requires 12.3; native confirmation acceptance remains pending), Xcode Command Line Tools (`xcode-select --install` if absent), **Node 22**, **pnpm 10.12.3**, and stable Rust with Cargo. Install Rust using [rustup](https://rustup.rs/) and consult [Tauri's macOS prerequisites](https://v2.tauri.app/start/prerequisites/). Commands below run from the repository root.

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
pnpm test:tz                 # core, UI and phone tests in Toronto and London
node --test scriptable/tests/*.test.mjs  # phone integration must be present
pnpm test:rust               # cargo test for apps/desktop/src-tauri/Cargo.toml
pnpm build                   # static export: apps/desktop/out/
pnpm tauri build --no-sign --bundles app,dmg
```

The app and DMG are produced under `apps/desktop/src-tauri/target/release/bundle/macos/` and `bundle/dmg/` respectively (unless Cargo's target directory is overridden). Tauri runs the static build before packaging. Builds are **unsigned and not notarized**. After mounting a trusted DMG and copying Daybar to Applications, **right-click Daybar → Open**, then confirm Open if macOS offers it. Gatekeeper behaviour varies by macOS/security policy; do not disable Gatekeeper or strip quarantine globally. If blocked, build from source or use the system's app-specific approval flow only after reviewing provenance.

[CI](.github/workflows/ci.yml) uses a macOS runner, Node 22, pnpm 10.12.3 and stable Rust; it runs frozen dependency installation, lint, types, timezone tests, phone Node tests, Rust tests and static export. Phone tests are required, not silently skipped if missing. A `v*` tag additionally packages an unsigned `.app` and `.dmg` and uploads them as **Actions artifacts**, not a signed GitHub Release. Download them from that tag's Actions run; the app is zipped to preserve bundle metadata and artifact retention is 14 days. The workflow uses a read-only repository token; no signing credentials, secrets or real iCloud access are configured. Writing this workflow does **not** mean GitHub CI has run or passed.

## Opt in to real data — only after verification

1. Complete the safety checks in [VERIFICATION.md](docs/VERIFICATION.md) in a disposable sandbox. Keep a separate backup of the phone's existing local data before migration.
2. Follow the [updated phone script installation guide](scriptable/README.md). Back up the existing local files and review migration/recovery steps before replacing working scripts.
3. In Daybar Settings, explicitly choose the Scriptable iCloud Drive **Documents** folder and consent to using real data. Do not repoint dev/test commands at it. Merely installing or building Daybar must not probe it.
4. Before the first real write, Daybar must copy **every managed file it will touch** to a timestamped backup folder. Confirm the backup exists and is readable before editing. Malformed/unknown files must produce a visible error, never an empty replacement.
5. In Finder, choose **Keep Downloaded** for the shared folder where available. Evicted `.icloud` placeholders can delay reads; failed downloads should remain visible errors. Allow iCloud to finish syncing before switching devices.

Native sandbox acceptance has verified real tray actions, external sandbox-file refresh, focus stop/expiry, a global shortcut, and close-hide/reopen. It did not use the real iCloud folder. First-write backup, malformed-file behavior, placeholder handling, conflict resolution and genuine cross-device convergence remain unverified; do not use valuable data until their ledger checks pass.

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
| `docs/` | Architecture, formats, decisions, verification, screenshots |
| `.github/workflows/` | macOS checks and unsigned tag artifacts |

## Roadmap

- Finish and verify v1 parity, live sandbox sync, native integration and safe phone migration.
- **Deadline Radar:** intentionally out of v1; navigation/module seam for a small **Swift EventKit helper** to read calendar events and reminders with explicit permissions.
- Insights relating sleep consistency, focus and habits (stretch).
- Bundle the tested core for Scriptable `importModule()` reuse (stretch).

## License

[MIT](LICENSE). Copyright belongs to Daybar contributors; no personal identity is assumed.
