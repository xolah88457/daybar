# v1 acceptance ledger

**Status: all acceptance checks below are PENDING.** This is a test plan, not evidence of successful execution. Foundation checks recorded elsewhere do not establish feature parity. The integration owner should replace individual statuses only after execution, recording commit, command or manual steps, environment, result and evidence in `docs/PROGRESS.md`. A passing build, a screenshot or a test name alone is not acceptance evidence.

Scope: every requirement in `AGENT_PROMPT.md` §5.2–5.4 and §6.1–6.3. Phone installation, CI and media checks are added at the end. No real iCloud data may be read or written during development, tests or capture.

## Intended methods

- **Core:** `pnpm test:tz` runs Vitest in `America/Toronto` and `Europe/London`. Compare calculations with extracted legacy functions/golden fixtures, including midnight, DST, empty/legacy input and injected `now` values. Implementation workers must add missing coverage; this ledger does not claim those cases already exist.
- **Rust:** `pnpm test:rust` uses disposable temporary folders, including a **simulated real-folder** consent path; never the actual Scriptable folder. Inspect contents/bytes before and after mutations and injected failures.
- **Phone:** `node --test scriptable/tests/*.test.mjs` exercises standalone scripts with fake FileManager/clock/Scriptable globals. It must never invoke personal iCloud storage.
- **UI:** `pnpm seed && pnpm tauri dev`, with synthetic `.dev-data/` only. Inspect every screen and tray; exercise mouse, keyboard and narrow/wide window sizes. Browser preview is insufficient evidence for native capabilities.
- **Sync:** while the native app is open against a disposable sandbox, edit the JSON externally to simulate the phone. Inspect UI refresh and disk content; genuine distributed iCloud behaviour is a separate owner-authorized check, not part of development.

## §5.2 — Data safety

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 5.2-01 | Dev/test default to seeded sandbox, never read/write/probe real iCloud; real folder only by deliberate opt-in | PENDING | Rust: assert default path and denied arbitrary/escaped/symlink paths; UI: fresh launch shows sandbox, no implicit personal-folder discovery. Review release default too. |
| 5.2-02 | Before first real write, timestamped backup contains every managed file that will be touched | PENDING | Rust: consent to a disposable simulated real folder, compare backup bytes for all managed files; backup failure must block writes. Repeat mutation must not erase backup. |
| 5.2-03 | Writes use temporary file in same directory and atomic rename | PENDING | Rust: inspect write path; simulate write/rename failure and verify original remains valid and unchanged, including cleanup/error reporting. |
| 5.2-04 | Validate every read; malformed or unknown files are not overwritten and show a UI error | PENDING | Rust/Phone: invalid JSON, schema versions, types and unknown fields; attempt mutation, compare original bytes. UI: actionable error, not reset-to-empty success. |

## §5.3 — Sync and conflict handling

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 5.3-01 | Watch folder, push UI changes without restart | PENDING | Sync: externally set a task and sleep value via same-folder atomic replacement; UI updates without restart; watcher survives repeated writes. |
| 5.3-02 | Every mutation re-reads, applies one operation, validates and writes atomically; no whole cached object writes | PENDING | Rust/Phone: load stale snapshot, add unrelated external edit, mutate another field and assert both survive. Inspect all mutation callers, including tray/shortcuts and settings/history changes. |
| 5.3-03 | Detect `.name.json.icloud`, request download, wait before reading | PENDING | Rust: fake downloader success, timeout and failure; no network or real iCloud. UI shows bounded failure rather than overwriting placeholder. Phone fake asserts download-before-read. |
| 5.3-04 | Detect conflict copies; explicit merge/discard UI; no silent deletion | PENDING | Rust/UI: create `focus-timer 2.json`, inspect notice, cancel, merge and explicitly discard on separate fixtures. Assert unique session union, preserved ambiguous values and no deletion without action. |

Atomic rename and re-reading cannot guarantee distributed serialization. Even after these checks pass, document the FileManager/iCloud race limit; do not mark concurrent-device writes as lossless.

## §5.4 — Idempotent focus credit

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 5.4-01 | Sessions keyed by start timestamp retain type, planned/credited minutes and end/stop time | PENDING | Core/Rust/Phone: inspect completed, stopped and break session fixtures, including optional task tag and completion date. |
| 5.4-02 | Derive daily minutes/count from session log using floor(minutes / block length) | PENDING | Core/Rust/Phone: multiple partial sessions and changed block length; compare all derived totals across implementations. |
| 5.4-03 | Crediting an existing key is a no-op, including phone then Mac settlement | PENDING | Core/Rust/Phone: settle same expired/stopped session repeatedly, round-trip JSON between fake clients, assert one credit and no baseline inflation. |
| 5.4-04 | Legacy files without sessions remain readable and preserve days as baseline | PENDING | Core/Rust/Phone: load nonempty legacy days; first mutation upgrades once; second load/settlement preserves baseline plus new credit exactly. |
| 5.4-05 | Other repeatable cross-device operations use the same retry-safe principle | PENDING | Rust/Phone: replay explicit task sets, logging and rename/archive operations; assert retries do not toggle back, duplicate entries or destroy history. Review non-idempotent operations and document limits. |

## §6.1 — App shape and native integration

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 6.1-01 | Sidebar: Today, Countdown, Habits, Focus, Sleep, Settings | PENDING | UI: visit each screen, active navigation and return paths; no dead in-scope route. |
| 6.1-02 | Script-style dark theme; responsive grids, no hard-coded widget width | PENDING | UI: resize minimum to wide; inspect tokens, grid fit, legible labels and absence of horizontal clipping. |
| 6.1-03 | Today combines day progress/time to bed, active focus start/stop, inline tasks, focus blocks and countdown grid | PENDING | UI: seeded dashboard plus active/idle/expired timer and task mutations; record screenshot only after checks. |
| 6.1-04 | Tray title is live focus countdown or time until bed | PENDING | UI/native: observe successive ticks, start/stop, expiry and idle return without reopening window. |
| 6.1-05 | Tray: all focus presets, stop, today's task toggles, open window, quit | PENDING | UI/native: exercise each action against sandbox; compare UI and JSON after tray changes. Relaunch after quit. |
| 6.1-06 | Dock icon hide preference | PENDING | UI/native: toggle, verify Dock visibility, reopen from tray and persistence after relaunch. |
| 6.1-07 | Launch-at-login setting | PENDING | UI/native: inspect registration change with disposable test account; restore initial OS setting. Record restart/login check separately. |
| 6.1-08 | Configurable global shortcut starts/stops focus | PENDING | UI/native: configure, use while app unfocused, change/unregister, test invalid/conflicting binding and persistence. Restore registration. |
| 6.1-09 | Focus-done and break-over notifications | PENDING | Rust: injected near-future clock deadlines; UI/native: allow permission and observe each notification once, without real data. |
| 6.1-10 | Night routine, no-phone and bedtime notifications | PENDING | Rust: seeded schedules at boundaries; UI/native: observe all three once using synthetic times, test alert toggles and permission denial. |
| 6.1-11 | Rust timers rebuild on start/relevant changes; notifications only while running | PENDING | Rust/native: alter timer/sleep data, verify obsolete deadlines cancel and new ones fire; close/quit/relaunch behaviour is explicit. No claim of OS background scheduling. |

## §6.2 — Countdown parity

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 6.2-C01 | Column-major dates, seven rows, one square/day, trailing blanks | PENDING | Core golden fixtures + UI: short/long and non-week-aligned ranges; verify orientation and padding. |
| 6.2-C02 | Past green, today's white fades across 24h, future dim | PENDING | Core golden fixtures at midnight/noon/end of day and DST; UI sample cell styles. |
| 6.2-C03 | Footer title, days left, fractional % done, Day X/Y, weeks left | PENDING | Core legacy comparison before/start/middle/end/after range; UI displays each footer value. |

## §6.2 — Habits parity

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 6.2-H01 | Configurable tasks and DAY_COMPLETE_MIN | PENDING | Core/UI: edit settings, reload, verify completion threshold independently of total task count. |
| 6.2-H02 | Exact all-green / partial red→orange→yellow blends and MIN_DONE_OPACITY→1 scaling | PENDING | Core: golden compare `dayColor`/`blend` for all completion counts, rounding and palette settings; UI cell colour/opacity assertions. |
| 6.2-H03 | Empty past dim; future slightly brighter dim | PENDING | Core legacy fixtures around today; UI inspect past/future cells. |
| 6.2-H04 | Rolling window fills width; newest day bottom-right; no end date | PENDING | Core/UI: multiple widths, date advances and non-week-aligned start, compare legacy cell order. |
| 6.2-H05 | Fixed start/end range mode | PENDING | Core/UI: fixed mode, blanks, before/after range and leap day. |
| 6.2-H06 | Stats: completed/elapsed, today x/N, %, missed and fixed-mode days left | PENDING | Core golden fixtures with empty/partial/complete days; UI all stat labels and values. |
| 6.2-H07 | Edit any past day using date picker, not typed text | PENDING | UI: date-picker selection, task change, reload, verify only chosen date changed on disk. |
| 6.2-H08 | Count only still-existing tasks | PENDING | Core: logs with removed/unknown names and duplicates; UI totals follow active list. |
| 6.2-H09 | Read old fully-done-day array format | PENDING | Core/Rust/Phone: legacy array fixture migration/read, no lost dates, compare expected active task completion. |

## §6.2 — Focus parity

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 6.2-F01 | Settings presets: focus 25/50, break 5/10, long break 15/30 | PENDING | Core/UI/tray: every default preset and edited preset starts correct type, duration and end time. |
| 6.2-F02 | Custom focus 1–240 minutes | PENDING | UI/Rust/Phone validation: accept bounds; reject zero, negative, >240, fractional/invalid inputs as appropriate to contract. |
| 6.2-F03 | Early stop credits whole minutes; <1 minute credits nothing and explains it | PENDING | Core/Rust/Phone: 0/59/60/119 seconds and beyond duration; UI inspect zero-credit feedback. |
| 6.2-F04 | Partial minutes accumulate; daily blocks floor(total / block length) | PENDING | Core/Rust/Phone: two partial sessions crossing a block boundary and legacy baseline; compare counts. |
| 6.2-F05 | Finished while closed credits on next load exactly once | PENDING | Native: seed expired state, launch/relaunch; inspect one session and unchanged totals on second load. Cross-check 5.4. |
| 6.2-F06 | End clock shown beside countdown; countdown clamps at 0:00 | PENDING | Core/UI: second before/at/after expiry, negative remaining time and midnight end time; observe display, no negative tick. |
| 6.2-F07 | Width-filling block-square row; completed blocks green | PENDING | UI: zero/many blocks and narrow/wide windows; component assertions for completed vs empty styles. |

## §6.2 — Sleep parity

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 6.2-S01 | Latest logged wake within AWAKE_HOURS + 6h, else plan→7-day average→target fallback | PENDING | Core legacy fixtures at recency boundary with each fallback independently present/absent; configured averaging window too. |
| 6.2-S02 | Estimated state marked (est); before estimated wake shows Sleeping / Wake in… | PENDING | Core/UI: pre-wake, wake boundary and logged-vs-estimated states, including midnight. |
| 6.2-S03 | Tonight's plan goal at least one hour after wake, otherwise wake + AWAKE_HOURS | PENDING | Core: plan/no-plan, near-midnight goal and too-early bed fixtures; UI compare displayed bedtime. |
| 6.2-S04 | Wake→bed progress green, yellow at ≤120 minutes left, red past bedtime | PENDING | Core golden/UI: 121/120/0/negative remaining minutes and pre-wake state. |
| 6.2-S05 | Last-two-hour phases: Night routine • bed prep, then No phone time | PENDING | Core/UI: exact routine/no-phone boundaries and configured intervals. |
| 6.2-S06 | Circular average over last AVERAGE_DAYS, exact circMean/wrap/signedDiff | PENDING | Core golden: times across midnight, empty data, antipodal values, signed wrap and configured sample count. |
| 6.2-S07 | Plan shifts wake/bed toward targets by STEP_MINUTES/day; shiftToward/planDays parity | PENDING | Core legacy fixtures: earlier/later and wraparound targets, final partial step, no adjustment and custom step size. |
| 6.2-S08 | Plan screen: current average, logged days, baseline, adjustment, every night/current highlight | PENDING | UI/Core: multi-night synthetic plan, current night and completed plan; compare all labels/numbers and list length. |
| 6.2-S09 | Plan start/restart/stop and clear-all-data | PENDING | UI/Rust/Phone: exercise each on disposable data, verify persisted plan and confirmation/cancellation for destructive clear. |
| 6.2-S10 | Manual wake/bed just-now and time picker; after-midnight bed uses previous evening date | PENDING | Core/UI/Rust/Phone: both entry modes around midnight and DST; inspect exact file key/value. |
| 6.2-S11 | Health remains phone Shortcut input; no Mac Health access required | PENDING | Review UI/IPC boundary; fake phone Shortcut payload populates shared sleep data and external sandbox edit refreshes Mac. No personal Health data. |
| 6.2-S12 | Core contains/tests parseWhen, resolveDates, findSleepSessions | PENDING | Core golden fixtures: time-only/full-date/invalid payloads, date resolution near midnight and sleep-session pairing/ordering. |

## §6.3 — v1 improvements

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 6.3-01 | Settings replace every hard-coded SETTINGS constant and persist daybar-settings.json | PENDING | Audit each original constant against schema/UI (dates, titles, tasks, presets, block length, sleep targets/hours/step/averages, routine/no-phone, alerts, colours, opacities/grid tokens). UI edit/save/reload; Phone fallback tests for absent file/key. |
| 6.3-02 | Confirmed task rename carries all history in one operation | PENDING | Rust/UI/Phone: cancel then confirm rename across past dates, task thresholds and tagged sessions; inject failure to ensure history survives cross-file partial failure. |
| 6.3-03 | Task removal archives rather than erases history | PENDING | UI/Rust/Phone: archive, inspect retained historical names and archived setting; current counts exclude archived task. |
| 6.3-04 | Current/longest streaks and per-task completion rate | PENDING | Core/UI: gaps, today unfinished, range start, renamed/archived tasks and empty logs; assert rates and both streaks. |
| 6.3-05 | Focus tag plus per-task threshold automatically checks task for day | PENDING | Core/Rust/UI/Phone: tag sessions, cross threshold using partial sessions; only correct task/date checked, replay credit has no additional effect. |
| 6.3-06 | Focus and Today show room for ~N blocks before bed | PENDING | Core/UI: positive, zero/negative remaining time and changed block length; both screens agree and update with clock. |
| 6.3-07 | Starting focus during no-phone time gives gentle confirmation | PENDING | UI/native: before/during phase, cancel/confirm; inspect window, tray and global-shortcut entry paths so none silently bypasses policy. |
| 6.3-08 | Keyboard shortcuts throughout main window | PENDING | UI: discoverable navigation/actions, focus-visible state, task/timer/date-picker control via keyboard; shortcuts do not hijack text inputs and native shortcut setting works. |

## Integration, packaging and portfolio follow-through

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| I-01 | Updated standalone phone scripts and safe local→iCloud migration | PENDING | Phone harness: FileManager.iCloud, download-before-read, migrate only if destination absent; original `legacy/` hashes unchanged. Owner separately follows `scriptable/README.md` on a disposable phone setup. |
| I-02 | Static export and native app launch | PENDING | Execute documented install/check/build commands after all workstreams merge; inspect `apps/desktop/out/`, launch native sandbox app and check every screen. |
| I-03 | GitHub macOS CI green, tag unsigned app/DMG downloadable | PENDING | Actual push/PR run then trusted version tag: inspect logs and download/unzip artifacts, mount DMG, open trusted app via right-click → Open. Local YAML validation is not a hosted CI run. |
| I-04 | Hero, menu bar GIF and owner iPhone screenshot | PENDING | Follow `docs/screenshots/README.md` with synthetic data only; review all frames/metadata, record commit/date and replace placeholders honestly. |

## Evidence record template

```text
ID(s):
Commit / macOS / Node / pnpm / Rust / TZ:
Command or exact manual steps (sandbox path only):
Expected:
Observed:
Result: PASS / FAIL / BLOCKED
Evidence / known limitation:
```

Do not promote a requirement to PASS based on planned tests, code inspection alone for native behaviour, another worker's unverified claim or unavailable personal-device checks. Keep failures and blocked checks visible.
