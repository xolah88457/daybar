# Rust backend handoff

## Implemented

- Exact IPC names/arguments/results: `get_snapshot`, `mutate({operation})`, `set_preferences({preferences})`, `resolve_conflict({file,action})`. No changes to the locked `src/contracts.rs`.
- Strict serde and semantic validation for all managed files, including inactive daily logs, nested unknown fields, calendar dates, settings ranges, timer/session consistency, optional-but-not-null fields, and legacy daily-log arrays. Invalid files produce `Snapshot.issues` and block managed mutations; their bytes are preserved. Unrelated Scriptable files are ignored, never rewritten. Files are limited to 8 MiB each.
- Debug default is repository `.dev-data`, seeded without replacing existing files **or evicted placeholders**. Release default is app-local `.dev-data`, not iCloud. Only an explicit preferences submission with `realData: true` can select an existing non-sandbox absolute folder. Consent is checked before *any* metadata probe of that folder. Debug startup resets both memory and persisted folder consent before inspecting the formerly selected folder.
- Every mutation holds the process DataStore mutex, reads current disk state, applies one operation, validates, checks that the source bytes are still current, and uses same-folder create-new temp/write/fsync/rename/directory-fsync. Symlink ancestors/files, traversal and nonregular files are rejected; Unix opens use `O_NOFOLLOW` and nonblocking reads.
- Before the first managed change in each opted-in folder/process, all managed files/conflict copies/placeholders are copied into `.daybar-backups/<timestamp-pid-sequence>/`. Explicit conflict discard/merge also backs up both copies; multi-file operations are backed up even in the sandbox. All tests use disposable temporary folders, including those that exercise the consent/backup branch.
- `notify` watcher invalidates `daybar://changed`; operational failures are both snapshot issues (`runtime:*`) and `daybar://error` events. Watchers rebind on folder changes. `.name.json.icloud` and evicted conflict copies are recognized; macOS `brctl download` attempts have a three-second deadline and child processes are killed/reaped on timeout. No actual iCloud folder was inspected or selected in development.
- Conflict merges: daily-log set union; unique focus sessions only when baselines and overlapping sessions agree; nonoverlapping/equal sleep values; identical settings only. Ambiguous values remain untouched for manual review. Discard is explicit and backed up, including malformed/evicted conflict copies.
- Focus: immutable legacy baseline upgrade, unique canonical start-epoch session keys, repeated settlement no-op, whole-minute early stops, zero-credit breaks, derived blocks, and startup/snapshot settlement. Tagged thresholds check habits, including recovery after an interrupted ledger→log update. Renames transfer all managed daily-log history plus running/recorded session tags; archives retain historical entries.
- Rust sleep calculations needed by tray/notifications: circular averages, plan baseline/shift, latest nonstale wake, estimated wake/sleep state, plan bedtime at least one hour after wake, previous-evening bed logging, and JavaScript-compatible DST/time rounding.
- Actual Tauri tray: second-by-second clamped focus/break title or remaining bed/wake time; all presets, stop, today's checked tasks, open, quit. Menu fingerprints prevent per-second menu rebuilding. Window close hides rather than quits. Dock visibility, launch-at-login and configurable global shortcut use native plugins. Native starts during no-phone time open the window for UI confirmation rather than bypassing it.
- Alive-process Rust notification deadline queue for focus, break, routine, no-phone and bed. Rebuilt on startup/data/settings/day changes; due alerts are revalidated against current files, and cancelled timers are not notified. Scheduling is Rust-owned, not future-dated desktop plugin calls.

## Verification

Environment:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR=/Users/rta.juice/Coding-Projects/Scriptable_code_conversion/apps/desktop/src-tauri/target
```

Executed successfully:

- `TZ=America/Toronto cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` — 29 tests.
- `TZ=Pacific/Auckland cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` — 29 tests.
- `TZ=UTC cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` — 29 tests.
- `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml` — debug binary built without launching.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` — no warnings/errors.
- Rustfmt and rustfmt `--check` on owned Rust modules only, with `skip_children=true` so the locked contracts remain unchanged; `git diff --check` passed.

Tests cover malformed/unknown-field preservation, missing required nullable fields, first-write backups (including discard), independent phone edits and stale-write rejection, process serialization, watcher delivery, placeholder bounds and seeding, consent reset, symlinks/traversal, baseline/idempotence/partial stops, threshold recovery, all-log/session rename/archive, conservative conflicts, scheduler cancellation, DST, circular rounding, and post-midnight sleep logs.

## Contract hardening to coordinate (foundation left untouched)

The typed wire contract is unchanged. The authoritative Zod/portable schemas should consider matching these additional backend integrity checks:

1. Timer duration equals planned minutes; session keys are canonical nonnegative decimal epochs (no leading-zero aliases); stop/end is between start and planned end; credited minutes cannot exceed elapsed whole minutes. Session date must lie within one UTC calendar day of end, permitting records written in another timezone.
2. Never replace unexplained `days.minutes` with smaller ledger-derived totals. A file with `sessions: {}` and nonzero legacy days but no baseline is ambiguous and currently surfaces an issue instead of losing those totals. Lower/stale derived totals can safely be regenerated.
3. Serde `Option` accepts missing required nullable fields and explicit null optional fields by itself. Backend raw-file guards enforce the existing TS rules (`state`/`plan` required; `sessions`/`baseline`/`task` optional but not null), without editing the locked structs.
4. Folder paths returned by the native backend are absolute. `realData: false` permits only the application sandbox. Settings saves preserve `logId`; use explicit rename/archive operations rather than removing historical task names through a whole-settings save.

## Limitations / remaining manual checks

- No native GUI, Dock/autostart registration, global-hotkey dispatch, actual notification presentation, release bundle, or real iCloud download was exercised. The app was deliberately not launched to avoid OS/permission changes. Those require sandbox-only manual verification after UI integration.
- File rename is atomic **per file**, not across settings/log/focus files or across devices. Backups and byte rechecks preserve recoverability, but iCloud has no distributed compare-and-swap. A phone write in the final check→rename window can still race. Renames interrupted between files may need retry/recovery from the timestamped backup.
- The scheduler uses a single Rust deadline queue serviced at roughly one-second resolution instead of one sleeping thread per notification. File materialization/validation can delay its tick (download attempts are bounded). Notifications only fire while the process is alive; completed sessions are still credited on next startup.
- Conservative merges intentionally refuse different legacy baselines, same-key differing sessions, same-day differing sleep values, and differing settings; no heuristic silently chooses a winner.
- Development restarts intentionally revoke real-folder selection. To opt in, choose an existing absolute folder in Settings and explicitly enable real-data consent. First managed mutation creates the backup; do not use real folders for testing.
