# Daybar

**Your day, at a glance.** Daybar brings a countdown, daily habits, a focus timer and a sleep-shift plan into one quiet macOS window and menu bar. Built from everyday iPhone Scriptable widgets, it keeps the original dark, monospace, tiny-square visual language while using shared JSON in iCloud Drive rather than a server, account or database. No telemetry.

> **Unsigned preview:** [Download Daybar v0.1.0](https://github.com/xolah88457/daybar/releases/tag/v0.1.0) for Apple Silicon, macOS 12.3+. The published app was verified locally from product source `f6fd53084bc5e3912f312a3a9291cd700cc71fe0`; it is not notarized. Real iPhone/iCloud acceptance is not claimed. See the [release and safe-switch guide](docs/RELEASE.md) and [scoped verification ledger](docs/VERIFICATION.md).

## Download the Mac app

- [Download DMG](https://github.com/xolah88457/daybar/releases/download/v0.1.0/Daybar_0.1.0_aarch64.dmg) — mount and copy Daybar to Applications.
- [Download app ZIP](https://github.com/xolah88457/daybar/releases/download/v0.1.0/Daybar_0.1.0_aarch64.app.zip) — extract the complete app bundle.
- [SHA-256 checksums](https://github.com/xolah88457/daybar/releases/download/v0.1.0/SHA256SUMS.txt).

These downloads need no Node/Rust installation. macOS may warn because the app is unsigned; review the [opening and safety notes](docs/RELEASE.md) before using it.

![Daybar Today dashboard showing synthetic countdown, tasks, focus and sleep data](docs/screenshots/today.png)

*Captured from an actual native app window on 2026-11-15, using fictional app-local sandbox data. It is not evidence of iCloud sync.*

![Sampled Daybar-owned menu-bar labels across eight saved modes](docs/screenshots/menu-bar.gif)

*Eight actual Daybar-owned status-item mode crops, two seconds each, with synthetic data. This is a sampled sequence—not a continuous recording or proof of a live countdown.*

## Everyday controls

- Press **1–6** to switch modules; typing, composition and open dialogs are protected.
- Use the header **Day/Night** button, or **Settings → On this Mac → Appearance → Auto** to follow macOS. Set macOS itself to Auto for scheduled day/night changes; Daybar requests no location.
- Choose **Settings → On this Mac → Menu-bar label**, then **Save Mac preferences**: Auto, focus minutes/hours/blocks, active timer, bedtime, next task or countdown days only. Focus totals are today's credited work; explicit modes stay selected even during a timer.
- Landscape Today is compact; portrait stacks the cards. Small windows and long forms scroll rather than hide controls.

## From Scriptable widgets to a desktop app

The starting point was five separate Scriptable home-screen tools: Days Left, Daily Log, Focus Timer, Time Blindness + Sleep, and Deadline Radar. Four modules are integrated on Mac; Deadline Radar remains a phone-only calendar/reminders widget until a future Mac release. Today combines time until bed, focus controls, today's checklist, focus blocks and the countdown grid. Original scripts remain untouched in [`legacy/`](legacy/).

**iPhone screenshot placeholder:** owner-supplied fictional-data widget capture; no image captured or included yet.

## iPhone Scriptable widgets

The five standalone scripts are in [`scriptable/`](scriptable/README.md): [Days Left](scriptable/Days%20Left.js), [Daily Log](scriptable/Daily%20Log.js), [Focus Timer](scriptable/Focus%20Timer.js), [Time Blindness + Sleep](scriptable/Time%20Blindness%20%2B%20Sleep.js), and [Deadline Radar](scriptable/Deadline%20Radar.js). Open each file on GitHub and use **Raw** to download or copy its complete source into Scriptable.

Install **Scriptable** from the iOS App Store by searching its name. For a shared phone/Mac setup, enable iCloud Drive on both devices with the same Apple ID and enable Scriptable's iCloud Drive access. Back up existing phone-local and iCloud Scriptable data before setup. On Mac, explicitly connect Daybar to the real Scriptable **Documents** folder only after reviewing the data and making backups; save valid shared settings with the intended task names before first use on phone, and confirm the Mac's read-only `habits.logId` matches the existing log filename. The Mac app is standalone without the phone; the phone companion requires Scriptable and these scripts. Keep shared files in iCloud Drive's `Scriptable` folder and avoid simultaneous edits. Full setup, widget parameters, data mapping and recovery guidance: [Scriptable setup guide](scriptable/README.md).

The desktop app includes editable settings, habit streaks, history-preserving task renames, focus-to-habit credit and “room for ~N blocks before bed.” Notifications are scheduled by Rust **only while Daybar is running**; this is not a background service, and OS notification delivery remains unverified. See [capture instructions](docs/screenshots/README.md) before adding portfolio media.

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

Daybar itself works without an iPhone; Scriptable is an optional companion for users who want shared files.

The phone and Mac share `daily-log-<LOG_ID>.json`, `focus-timer.json`, `sleep-data.json` and `daybar-settings.json`. Each mutation re-reads disk, applies one operation and validates. The Mac replaces files via a same-directory temporary file and atomic rename. Scriptable cannot atomically replace an existing file: it checks for intervening edits, moves the old file to a retained recovery backup, then installs the temporary file. A crash between those phone moves requires manual recovery; see the [phone guide](scriptable/README.md). Focus credit uses a session-start-keyed ledger so repeat settlement is a no-op; legacy daily totals remain a baseline.

**Phone recovery limitation:** Scriptable's FileManager cannot atomically replace an existing file or provide compare-and-swap. Phone writes retain a recovery backup and fail closed when interrupted-write artifacts remain; after a crash, inspect/recover those artifacts manually before continuing. The two-file focus-to-habit repair is also not atomic.

**Concurrency limitation:** atomic rename is not a cross-device transaction. Scriptable's `FileManager.iCloud()` synchronizes files; it does not supply a distributed transaction or a lock shared with the Mac. Re-reading narrows the race window but cannot guarantee that simultaneous phone/Mac edits never overwrite one another, even with idempotent focus credit. Conflict copies must be surfaced for explicit merge/discard, never silently deleted. Avoid editing the same data simultaneously; retain backups. These safety behaviours still require the checks in the ledger.

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
pnpm test:tz                 # core, UI and phone tests in Toronto and London
node --test scriptable/tests/*.test.mjs  # phone integration must be present
pnpm test:rust               # cargo test for apps/desktop/src-tauri/Cargo.toml
pnpm build                   # static export: apps/desktop/out/
pnpm tauri build --no-sign --bundles app,dmg
```

The app and DMG are produced under `apps/desktop/src-tauri/target/release/bundle/macos/` and `bundle/dmg/` respectively (unless Cargo's target directory is overridden). Tauri runs the static build before packaging. Builds are **unsigned and not notarized**. After mounting a trusted DMG and copying Daybar to Applications, **right-click Daybar → Open**, then confirm Open if macOS offers it. Gatekeeper behaviour varies by macOS/security policy; do not disable Gatekeeper or strip quarantine globally. If blocked, build from source or use the system's app-specific approval flow only after reviewing provenance.

[CI](.github/workflows/ci.yml) uses a macOS runner, Node 22, pnpm 10.12.3 and stable Rust; it runs frozen dependency installation, lint, types, timezone tests, phone Node tests, Rust tests and static export. Phone tests are required, not silently skipped if missing. A `v*` tag additionally packages an unsigned `.app` and `.dmg` and uploads them as **Actions artifacts**, not a signed GitHub Release. Download them from that tag's Actions run; the app is zipped to preserve bundle metadata and artifact retention is 14 days. The workflow uses a read-only repository token; no signing credentials, secrets or real iCloud access are configured. The initial hosted runs were cancelled before any job steps executed; **hosted CI is not claimed as passing**. The release downloads above are the separately verified local build, not Actions artifacts.

## Opt in to real data — only after verification

Follow the complete [release and safe-switch guide](docs/RELEASE.md); do not switch valuable data based on this README alone.

1. Complete the safety checks in [VERIFICATION.md](docs/VERIFICATION.md) in a disposable sandbox. Keep a separate backup of the phone's existing local data before migration.
2. Follow the [updated phone script installation guide](scriptable/README.md). Back up the existing local files and review migration/recovery steps before replacing working scripts.
3. In Daybar Settings, explicitly choose the Scriptable iCloud Drive **Documents** folder and consent to using real data. Do not repoint dev/test commands at it. Merely installing or building Daybar must not probe it.
4. Keep your own dated backup **before opting in**. Daybar creates its automatic timestamped backup as part of the first real write, before changing managed files; it may not exist beforehand. Connecting can reconcile an expired timer. Inspect the automatic backup after the first operation and stop on any backup/validation error. Malformed/unknown files must never become an empty replacement.
5. In Finder, choose **Keep Downloaded** for the shared folder where available. Evicted `.icloud` placeholders can delay reads; failed downloads should remain visible errors. Allow iCloud to finish syncing before switching devices.

Native sandbox acceptance has verified tray actions, external sandbox-file refresh, focus stop/expiry, a global shortcut, close-hide/reopen, and fail-closed confirmation dialogs. The final local candidate additionally verified six bare navigation keys, Day/Night persistence and Auto matching current macOS appearance, all eight saved menu-bar label modes, and normal Quit/relaunch persistence for the selected countdown label and theme. These checks used fictional data; every preference case retained `realData=false` and four shared JSON hashes remained unchanged. The real iCloud folder was not used. Automated temporary-folder tests cover backup and validation behavior, but actual iCloud materialization, full native conflict resolution and cross-device convergence remain unverified; see the scoped ledger.

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

- Owner acceptance: real phone/iCloud setup, pending native/OS checks and hosted CI; see [verification ledger](docs/VERIFICATION.md).
- **Deadline Radar:** intentionally out of v1; navigation/module seam for a small **Swift EventKit helper** to read calendar events and reminders with explicit permissions.
- Insights relating sleep consistency, focus and habits (stretch).
- Bundle the tested core for Scriptable `importModule()` reuse (stretch).

## License

[MIT](LICENSE). Copyright belongs to Daybar contributors; no personal identity is assumed.
