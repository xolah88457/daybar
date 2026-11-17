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
Instead of the planned Swift helper, Rust calls EventKit directly through the `objc2-event-kit` bindings, behind typed commands, so the frontend still gets no calendar or filesystem access of its own. Access is requested only when the user turns Radar on (macOS 14+ full-access APIs, the older request API on 12.3–13). The bundle carries usage strings in `Info.plist` and the calendars entitlement required under the hardened runtime. Because builds are ad-hoc signed, macOS may treat each update as a new app and ask for access again. Radar alerts and the "next deadline" label read an in-process cache that refreshes on a timer and on demand.
