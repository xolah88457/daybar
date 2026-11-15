# Decisions

## 001 — Safe defaults (2026-11-15)
Use a local sandbox in debug builds and a memory-only browser preview. Never probe the user's actual Scriptable folder during automated development. Existence is checked on deliberate Settings selection, resolving the brief's path-check request in favour of its stricter no-real-data-read rule.

## 002 — Ledger extension, not a database
Keep legacy focus `days` as baseline during migration. A session key is its start epoch; include completion date so aggregation does not depend on the current timezone after travel. File re-read operations cannot guarantee distributed transactions across iCloud; document that limitation instead of promising locks that iOS cannot honour.

## 003 — Explicit sets and stable log id
UI task toggles issue `set_task(date,task,done)`, making retry safe. Keep logId separate from display title to prevent a title edit orphaning history. Archive by moving names into archivedTasks; confirmation precedes history renames and destructive clears.

## 004 — Scheduling belongs in Rust
Future notification scheduling is not portable on desktop. Rust checks pending deadlines while the app is alive and rebuilds on starts/data changes. No background service or server.

## 005 — Toolchain and packaging
Next static export + Tauri 2, pnpm workspace, Zod schemas and serde mirrors. Use webpack build explicitly rather than relying on evolving Turbopack behaviour. Mac builds are unsigned. App name lives in Tauri config, frontend metadata and README (these are the three platform entry points).

## 006 — Work allocation
Foundation is orchestrator-only. Independent core, Rust, UI and phone work uses separate git worktrees with nonoverlapping ownership; merge sequentially and run tests at every merge. Core APIs are fixed in CORE_API.md. UI module implementation may proceed in its shell worktree against that contract instead of creating four competing page writers; phases retain their verification gates.

## 007 — Ambiguous focus ledgers fail closed (2026-11-15)
A file containing a session ledger but no baseline cannot safely treat saved `days` as either legacy baseline or session-derived totals. If they disagree with zero-baseline derivation, refuse rather than normalize and erase history. Manual recovery is safer than guessing. Shared TypeScript/Rust/phone validators were aligned after independent review.

## 008 — Native HTML dialog compatibility (2026-11-15)
The HTML `<dialog>` confirmation helper requires macOS 12.3+ in the target WKWebView baseline, so set the app minimum accordingly. This is not evidence that confirmation behavior has passed native acceptance; keep those checks pending until exercised in the app.
