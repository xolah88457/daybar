# Daybar architecture

The overview diagram and one-minute summary are in the [README](../README.md#architecture-in-a-minute). This page records the boundaries behind them.

No server, accounts, telemetry or runtime network access. The static Next export runs in a Tauri 2 WKWebView. Rust alone reads and writes files; the browser preview uses memory, never a filesystem. Pure TypeScript receives explicit `now` and settings so its tests can reproduce midnight and DST. Calculation conventions: [CORE_API](CORE_API.md).

## Boundaries
- `packages/core/src/contracts/index.ts`: authoritative field names, settings defaults, schemas, IPC operation union; JSON Schemas alongside (`pnpm schemas` regenerates them). Rust mirrors these in `src-tauri/src/contracts.rs` and validates on both read and before write. File shapes: [DATA_FORMATS](DATA_FORMATS.md).
- `apps/desktop/src/lib/ipc.ts`: only frontend `invoke` / event boundary. `daybar://changed` invalidates the snapshot; `daybar://error` carries runtime failures (also surfaced as `runtime:*` snapshot issues). State is loaded once and refreshed after events and mutations.
- DataStore (`src-tauri/src/store.rs`):
  - Folder policy: the debug default is the repository `.dev-data`, the release default an app-local `.dev-data`, never iCloud. Only an explicit preferences submission with `realData: true` selects an existing absolute folder, and consent is checked before any metadata probe of it. Debug startup revokes a previously persisted real-folder selection.
  - Every mutation takes the process mutex, re-reads current disk data, applies one operation, validates, confirms the source bytes are unchanged, then writes a same-directory temp file, fsyncs and renames. No cached snapshot is ever written. Symlinks, path traversal and non-regular files are rejected (`O_NOFOLLOW`); files over 8 MiB are refused.
  - Invalid files become `Snapshot.issues` and block managed mutations; their bytes are preserved. Unrelated Scriptable files are ignored, never rewritten.
  - Before the first managed change in each opted-in folder per process, every managed file, conflict copy and placeholder is copied to `.daybar-backups/<timestamp-pid-sequence>/`. Conflict discard/merge and multi-file operations are backed up too, even in the sandbox.
  - A `notify` watcher emits `daybar://changed`. `.name.json.icloud` placeholders and evicted conflict copies are recognized; `brctl download` has a three-second deadline and the child is killed on timeout, leaving a visible error.
  - Conflict merge is conservative: daily-log set union; focus sessions only when baselines and overlapping sessions agree; sleep values only when equal or non-overlapping; settings only when identical. Anything ambiguous is left for manual review.
- Focus: legacy `days` become immutable `baseline` on upgrade; `sessions[start]` is a unique credited-session ledger. Daily totals are baseline plus sessions. Duplicate settlement is a no-op. Explicit task-set operations are idempotent (not blind toggles). Tagged-threshold completion is repaired on later settlement if an interrupted ledger-to-log update left a gap.
- Scheduler: one Rust deadline queue serviced at about one-second resolution computes future focus, break, routine, no-phone and bedtime alerts, rebuilds after start, data, settings or day changes, and revalidates each alert against current files before firing. Notifications fire only while the process is alive; a session that finished while closed is credited once on next load.
- Tray and global shortcut use the same mutation path as the UI. The tray title is the clamped focus/break countdown or time to bed unless a Mac-local label mode is chosen; menu fingerprints avoid per-second menu rebuilds. A native start during no-phone time opens the window for the UI confirmation instead of bypassing it. Closing the window hides it rather than quitting.
- Preferences are app-local (`preferences.json` in the app's local data directory): folder, consent flag, launch at login, Dock visibility, shortcut, theme and menu-bar label mode. Shared settings contain only widget configuration.
- Confirmations use an accessible HTML `<dialog>` (`apps/desktop/src/lib/confirm.ts`), because WKWebView silently cancels `window.confirm`. A failing dialog fails closed: the action is not performed and the error is shown.

## Safety limits
File-level rename is atomic, but iCloud Drive provides no cross-device compare-and-swap, and Scriptable's `FileManager` cannot atomically replace a file at all. Re-read/apply/write narrows rather than eliminates simultaneous-device races, even with idempotent focus credit. Avoid editing the same data on both devices at once and keep dated backups.

- Mac rename is atomic per file, not across the settings/log/focus files. A rename interrupted between files may need retry or recovery from the timestamped backup.
- Phone writes retain a recovery backup and fail closed while interrupted-write artifacts remain; after a crash, recover those manually ([phone guide](../scriptable/README.md)). Focus-to-habit completion spans two files and is repaired, not made atomic, by a later Focus run.
- Merge conflict copies explicitly; never silently discard. Cross-file task-history changes must preserve old entries if a later write fails. Symlinks, path traversal and a developer-supplied path must not bypass sandbox policy.

## Extension seam
Deadline Radar remains a disabled navigation slot. A future implementation can introduce a Swift EventKit helper behind typed Rust commands without giving the frontend filesystem access. Insights and a bundled phone core are stretch only.

## Toolchain notes
Next uses `output: 'export'`, `frontendDist: '../out'` and unoptimized images per the [Tauri Next.js guide](https://v2.tauri.app/start/frontend/nextjs/); the build uses Next's webpack path for predictable monorepo static export. Tauri's notification plugin has no reliable desktop future scheduling, so Rust owns timing ([decision 004](DECISIONS.md)). Exact versions live in the lockfiles.
