# v1 acceptance ledger

**Status: scoped automated/core, browser, sandbox/native, and local packaging evidence is recorded per row; external/OS/device acceptance remains incomplete.** `PASS (...)` means only the named scope passed, not the entire broader requirement. `PENDING` means the outstanding acceptance scope is not demonstrated; any tests noted in its evidence are partial evidence only. See `docs/PROGRESS.md` for integration chronology. Native observations used synthetic `.dev-data`; no real iCloud folder was selected or accessed. A passing build, screenshot or test name alone is not acceptance evidence.

Scope: every requirement in `AGENT_PROMPT.md` §5.2–5.4 and §6.1–6.3. Phone installation, CI and media checks are added at the end. No real iCloud data may be read or written during development, tests or capture.

## Evidence scope and executed gates

- Node 22.23.5: `pnpm lint`, `pnpm typecheck`, `pnpm test:tz` (137 core + 37 desktop + 59 phone tests in each of America/Toronto and Europe/London), and static export passed at `a841ef8`; logs: `/tmp/daybar-final-node22-gates.log`. Settled-HEAD reviewer independently reran the gates on Node 26.13.0; logs: `/tmp/daybar-final-safety-settled-{lint,typecheck,tests,rust,build}.log`.
- Core golden tests execute extracted legacy functions in a Node VM and cover date/grid/color/focus/sleep calculations and the listed boundaries; see `docs/CORE_REPORT.md`. Phone tests execute the actual standalone scripts in fake Scriptable/FileManager VMs, including malformed-data preservation, recovery artifacts, idempotence, settings, DST and migration (`docs/PHONE_REPORT.md`). Rust tests use temporary folders and cover validation, backups, atomic per-file writes, sync/conflicts, timers and consent (`docs/BACKEND_REPORT.md`). These are automated sandbox results, not real-device or real-iCloud proof.
- Browser smoke passed six screens, selected edits/focus/settings/sleep workflows and 375–1280px widths with no runtime errors, external requests or storage writes (`/tmp/daybar-final-browser.log`). Native observations and exact limits are recorded per row and in `/tmp/daybar-native-acceptance.log`.

## Evidence scope and executed methods

All executed commands/logs and their scoped results are summarized above. Feature test coverage is in `docs/CORE_REPORT.md`, `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`, and `docs/UI_REPORT.md`. Do not treat these reports as evidence for an untested UI, OS, hosted CI, actual iPhone, or distributed iCloud behavior.

## §5.2 — Data safety

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 5.2-01 | Dev/test default to seeded sandbox, never read/write/probe real iCloud; real folder only by deliberate opt-in | PASS (automated/native sandbox boundary) | Rust consent/path tests and native debug sandbox acceptance; backend release default is app-local sandbox. Real-folder opt-in was not exercised; no iCloud folder was probed or selected. `docs/BACKEND_REPORT.md`; `/tmp/daybar-native-acceptance.log`. |
| 5.2-02 | Before first real write, timestamped backup contains every managed file that will be touched | PASS (automated disposable-folder tests) | Rust tests cover first-write managed-file backups and backup-before-discard; tests use temporary folders and include the consent/backup branch. No real folder tested; backup-failure and repeated real-write acceptance is not separately observed. `docs/BACKEND_REPORT.md`. |
| 5.2-03 | Writes use temporary file in same directory and atomic rename | PASS (automated Rust/phone subset) | Rust tests cover same-directory temp/write/fsync/rename, byte rechecks and failure preservation; phone VM tests cover temp/backup recovery and fail-closed behavior. Rust rename is per-file; phone FileManager replacement is not atomic. No distributed CAS guarantee. `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`. |
| 5.2-04 | Validate every read; malformed or unknown files are not overwritten and show a UI error | PASS (automated validation/preservation; UI subset) | Rust/core/phone tests reject malformed/unknown data and preserve bytes; desktop tests cover surfaced issues and browser settings validation. No dedicated native malformed-file error walkthrough. `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`, `/tmp/daybar-final-safety-settled-tests.log`. |

## §5.3 — Sync and conflict handling

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 5.3-01 | Watch folder, push UI changes without restart | PASS (sandbox) | Native WKWebView: external same-folder atomic task JSON edit updated Habits without restart (`/tmp/daybar-native-acceptance.log`). Repeated writes, sleep edits and iCloud delivery remain unverified. |
| 5.3-02 | Every mutation re-reads, applies one operation, validates and writes atomically; no whole cached object writes | PASS (automated per-client sandbox) | Rust tests cover current-disk rereads, stale-write rejection, process serialization and operation mutations; phone VM tests cover interleaved writes and re-read/validate/commit. Native external task edit refreshed the open UI. No distributed CAS or cross-device serialization is claimed. `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`, `/tmp/daybar-native-acceptance.log`. |
| 5.3-03 | Detect `.name.json.icloud`, request download, wait before reading | PASS (automated fake/sandbox subset) | Backend and phone tests exercise placeholder/evicted-file handling and download-before-read; backend attempts bounded macOS download. No actual iCloud materialization or live network delivery was tested. `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`. |
| 5.3-04 | Detect conflict copies; explicit merge/discard UI; no silent deletion | PENDING | Rust automated tests cover conservative merge/discard semantics and backups (`docs/BACKEND_REPORT.md`); full native conflict-notice, cancel, merge and discard workflow was not observed. No actual iCloud conflict copy tested. |

Per-file atomic rename and re-reading cannot guarantee distributed serialization. Scriptable FileManager has no atomic replace/CAS; its recovery guards detect but do not restore artifacts. iCloud races and actual concurrent-device writes remain unverified and must not be described as lossless.

## §5.4 — Idempotent focus credit

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 5.4-01 | Sessions keyed by start timestamp retain type, planned/credited minutes and end/stop time | PASS (automated core/Rust/phone) | Session ledger schema, settlement, stops, breaks and tagged records are tested in core/Rust and actual phone-script VM; integrity bounds reject malformed records. No real-device round-trip. `docs/CORE_REPORT.md`, `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`. |
| 5.4-02 | Derive daily minutes/count from session log using floor(minutes / block length) | PASS (automated core/Rust/phone) | Partial-session accumulation, derived daily totals and block flooring are covered by core/Rust tests and phone VM tests; no actual cross-device comparison. `docs/CORE_REPORT.md`, `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`. |
| 5.4-03 | Crediting an existing key is a no-op, including phone then Mac settlement | PASS (automated retry/idempotency; no real cross-device) | Repeated settlement and baseline preservation are covered by core/Rust/phone VM tests. Phone→Mac behavior is a tested data-contract subset, not a real iCloud/device round-trip. `docs/CORE_REPORT.md`, `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`. |
| 5.4-04 | Legacy files without sessions remain readable and preserve days as baseline | PASS (automated core/Rust/phone) | Legacy normalization and one-time baseline upgrade are tested; ambiguous untracked history is rejected rather than erased. `docs/CORE_REPORT.md`, `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`, `/tmp/daybar-final-safety-review.md`. |
| 5.4-05 | Other repeatable cross-device operations use the same retry-safe principle | PASS (automated operation subset) | Explicit desired task states, focus/sleep retries, history rename/archive and recovery are covered by Rust/phone tests. Does not establish distributed exactly-once behavior; two-file focus→habit updates remain repairable but non-atomic. `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`. |

## §6.1 — App shape and native integration

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 6.1-01 | Sidebar: Today, Countdown, Habits, Focus, Sleep, Settings | PASS | Browser smoke and native WKWebView acceptance visited all six screens; native keyboard navigation also exercised. `/tmp/daybar-native-acceptance.log`. |
| 6.1-02 | Script-style dark theme; responsive grids, no hard-coded widget width | PASS | Same browser smoke: no document overflow at 375/600/900/1280 px; component tests assert grid order/colors/padding. Actual hero visually inspected, `docs/screenshots/today.png`. |
| 6.1-03 | Today combines day progress/time to bed, active focus start/stop, inline tasks, focus blocks and countdown grid | PASS | Browser smoke and native six-screen acceptance; native focus stop and task changes persisted in sandbox. Full visual parity remains bounded by the captured synthetic screenshot. |
| 6.1-04 | Tray title is live focus countdown or time until bed | PASS (sandbox) | Native tray showed changing Break countdown (`Break4:47`) and returned to sleep status at expiry; actual tray status visually inspected (`/tmp/daybar-native-acceptance.log`). |
| 6.1-05 | Tray: all focus presets, stop, today's task toggles, open window, quit | PASS (sandbox; quit partial) | Native menu displayed all focus/break/long-break presets, Stop, tasks, Show/Quit. Focus25 start, Stop, task toggle persisted; Open restored after Cmd+W hide. Quit/relaunch not tested. |
| 6.1-06 | Dock icon hide preference | PENDING | Dock visibility preference exists in the UI/backend but OS Dock hide/show and relaunch persistence were not exercised; do not change this setting for acceptance. |
| 6.1-07 | Launch-at-login setting | PENDING | Setting/plugin implementation exists, but registration, login/restart behavior and cleanup were not tested. No OS login item was enabled. |
| 6.1-08 | Configurable global shortcut starts/stops focus | PASS (configured binding only) | Native Cmd+Shift+F started Focus25 and a second invocation stopped it; persisted state checked. Reconfiguration/conflict and relaunch persistence remain untested. |
| 6.1-09 | Focus-done and break-over notifications | PENDING | Rust scheduler logic/tests exist, but OS notification delivery was never observed and permissions were not enabled. See `docs/BACKEND_REPORT.md` and `/tmp/daybar-native-acceptance.log`. |
| 6.1-10 | Night routine, no-phone and bedtime notifications | PENDING | Schedule logic is automated-tested; actual routine/no-phone/bedtime notification delivery and permission behavior were not observed. No OS permission changes. |
| 6.1-11 | Rust timers rebuild on start/relevant changes; notifications only while running | PASS (automated scheduler subset) | Rust tests cover deadline queue scheduling/cancellation and revalidation; actual OS delivery and close/quit/relaunch scheduling behavior are not established. Notifications only run while the process is alive. `docs/BACKEND_REPORT.md`. |

## §6.2 — Countdown parity

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 6.2-C01 | Column-major dates, seven rows, one square/day, trailing blanks | PASS (automated/core; browser subset) | Extracted legacy golden tests cover column-major dates, seven-row grids and padding; desktop tests/browser smoke cover rendered grid and responsive widths. Golden/core scope only; `docs/CORE_REPORT.md`, `docs/UI_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.2-C02 | Past green, today's white fades across 24h, future dim | PASS (automated/core; DST legacy parity) | Core golden tests cover legacy countdown color/fade behavior, midnight and DST; phone VM compares actual legacy script at DST boundaries. Native/iPhone rendering not verified. `docs/CORE_REPORT.md`, `docs/PHONE_REPORT.md`. |
| 6.2-C03 | Footer title, days left, fractional % done, Day X/Y, weeks left | PASS (automated/core; browser screen smoke) | Core legacy golden comparisons cover countdown calculations and UI smoke visits Countdown; all footer values were not separately manually inspected. `docs/CORE_REPORT.md`, `/tmp/daybar-final-browser.log`. |

## §6.2 — Habits parity

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 6.2-H01 | Configurable tasks and DAY_COMPLETE_MIN | PASS (automated/core; browser settings subset) | Core golden tests cover variable task counts and completion thresholds; browser smoke covers settings save/reload workflows. `docs/CORE_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.2-H02 | Exact all-green / partial red→orange→yellow blends and MIN_DONE_OPACITY→1 scaling | PASS (automated/core/UI tests) | Extracted legacy golden tests cover exact dayColor/blend, partial completion and opacity; desktop tests assert cell colors/order/padding. Native visual parity not separately inspected. `docs/CORE_REPORT.md`, `docs/UI_REPORT.md`. |
| 6.2-H03 | Empty past dim; future slightly brighter dim | PASS (automated/core) | Core golden fixtures compare legacy past/future empty-day styling around today. `docs/CORE_REPORT.md`; native visual parity not separately verified. |
| 6.2-H04 | Rolling window fills width; newest day bottom-right; no end date | PASS (automated/core; browser widths subset) | Core golden tests cover rolling newest-day placement and grids; browser smoke covers 375/600/900/1280px. `docs/CORE_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.2-H05 | Fixed start/end range mode | PASS (automated/core) | Core golden tests cover fixed-range padding and before/after range cases; native rendering not inspected for all edge dates. `docs/CORE_REPORT.md`. |
| 6.2-H06 | Stats: completed/elapsed, today x/N, %, missed and fixed-mode days left | PASS (automated/core; browser UI subset) | Core golden tests cover empty/partial/complete statistics and fixed-mode calculations; smoke visits Habits but does not separately assert every displayed value. `docs/CORE_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.2-H07 | Edit any past day using date picker, not typed text | PASS (browser/demo subset) | Browser smoke exercised past-day editing and UI tests cover native date-picker controls; no native disk-backed date edit was manually observed. `docs/UI_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.2-H08 | Count only still-existing tasks | PASS (automated/core) | Core tests cover active-task filtering, removed/unknown names and duplicate handling. `docs/CORE_REPORT.md`; rendered value parity not separately manually checked. |
| 6.2-H09 | Read old fully-done-day array format | PASS (automated core/Rust/phone) | Legacy daily-log array normalization is covered in core, backend and phone VM tests; no personal files used. `docs/CORE_REPORT.md`, `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`. |

## §6.2 — Focus parity

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 6.2-F01 | Settings presets: focus 25/50, break 5/10, long break 15/30 | PASS (automated/native preset subset) | Core/UI tests cover configured presets; native tray displayed all six presets and native Focus25/Break5 actions were exercised. Edited preset persistence not manually checked. `/tmp/daybar-native-acceptance.log`, `docs/CORE_REPORT.md`, `docs/UI_REPORT.md`. |
| 6.2-F02 | Custom focus 1–240 minutes | PASS (automated validation) | Core and desktop schema tests cover valid and invalid custom-duration inputs; browser settings validation exercised. No native custom duration session observed. `docs/CORE_REPORT.md`, `docs/UI_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.2-F03 | Early stop credits whole minutes; <1 minute credits nothing and explains it | PASS (automated/native early-stop subset) | Core/Rust/phone tests cover whole-minute/zero-credit rules; browser smoke and native acceptance exercised early Stop. Native sub-minute feedback was not separately observed. `docs/CORE_REPORT.md`, `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`, `/tmp/daybar-native-acceptance.log`. |
| 6.2-F04 | Partial minutes accumulate; daily blocks floor(total / block length) | PASS (automated/core/Rust/phone) | Partial-session totals, baseline and block flooring are tested across clients; no actual iCloud cross-device accumulation observed. `docs/CORE_REPORT.md`, `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`. |
| 6.2-F05 | Finished while closed credits on next load exactly once | PASS (native sandbox + automated) | Bundled app sandbox: after normal quit, a valid expired one-minute focus was seeded; launch credited exactly one minute/session once, and the second normal quit/relaunch left ledger/totals byte-equivalent JSON. Original app-local focus bytes were restored byte-exactly afterward. Automated core/Rust/phone tests also cover load settlement and repeat no-op. No real iCloud. `/tmp/daybar-native-acceptance.log`. |
| 6.2-F06 | End clock shown beside countdown; countdown clamps at 0:00 | PASS (automated/browser/native subset) | Core/UI tests cover end clock and zero-clamped calculations; native tray showed changing countdown and expiry status. Exact boundary display was not manually inspected. `docs/CORE_REPORT.md`, `docs/UI_REPORT.md`, `/tmp/daybar-native-acceptance.log`. |
| 6.2-F07 | Width-filling block-square row; completed blocks green | PASS (automated UI/core subset) | UI/core tests cover block calculation and responsive grids; browser widths 375–1280 passed. Every zero/many visual state was not manually captured. `docs/UI_REPORT.md`, `/tmp/daybar-final-browser.log`. |

## §6.2 — Sleep parity

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 6.2-S01 | Latest logged wake within AWAKE_HOURS + 6h, else plan→7-day average→target fallback | PASS (automated/core) | Core extracted-legacy golden tests cover latest-wake recency and plan/average/target fallback states; no live sleep data used. `docs/CORE_REPORT.md`. |
| 6.2-S02 | Estimated state marked (est); before estimated wake shows Sleeping / Wake in… | PASS (automated/core; browser screen subset) | Core golden tests cover logged/estimated state and wake boundaries; browser smoke visits Sleep. All labels/states were not separately manually inspected. `docs/CORE_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.2-S03 | Tonight's plan goal at least one hour after wake, otherwise wake + AWAKE_HOURS | PASS (automated/core) | Core golden tests cover plan/no-plan bedtime and sleep calculation boundaries; UI value parity was not separately manually checked. `docs/CORE_REPORT.md`. |
| 6.2-S04 | Wake→bed progress green, yellow at ≤120 minutes left, red past bedtime | PASS (automated/core) | Core golden tests cover progress/status calculations and threshold boundaries. Native visual colors not separately inspected. `docs/CORE_REPORT.md`. |
| 6.2-S05 | Last-two-hour phases: Night routine • bed prep, then No phone time | PASS (automated/native subset) | Core tests cover phase boundaries; native no-phone state was seeded and used to exercise the focus confirmation dialog. Routine-phase UI was not separately observed. `docs/CORE_REPORT.md`, `/tmp/daybar-native-acceptance.log`. |
| 6.2-S06 | Circular average over last AVERAGE_DAYS, exact circMean/wrap/signedDiff | PASS (automated/core/phone VM) | Core golden tests cover circular means, midnight/wrap and configurable sample counts; phone VM covers same calculation and legacy parity. `docs/CORE_REPORT.md`, `docs/PHONE_REPORT.md`. |
| 6.2-S07 | Plan shifts wake/bed toward targets by STEP_MINUTES/day; shiftToward/planDays parity | PASS (automated/core/phone VM) | Core tests cover plan progression/preview and phone VM exercises plan behavior; selected browser smoke exercised sleep planning. All target edge values were not manually inspected. `docs/CORE_REPORT.md`, `docs/PHONE_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.2-S08 | Plan screen: current average, logged days, baseline, adjustment, every night/current highlight | PASS (automated/browser subset) | Core plan summaries are tested; browser smoke exercised sleep-plan workflow, but did not separately verify every label/night against an oracle. `docs/CORE_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.2-S09 | Plan start/restart/stop and clear-all-data | PASS (automated/browser-demo subset) | Core/UI tests cover plan lifecycle and browser smoke exercised plan and clear flows against memory-only demo data. Native disk persistence and every cancellation path not manually verified. `docs/CORE_REPORT.md`, `docs/UI_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.2-S10 | Manual wake/bed just-now and time picker; after-midnight bed uses previous evening date | PASS (automated/core/phone; browser logging subset) | Core and phone VM tests cover time parsing, date resolution, previous-evening attribution and DST; browser smoke exercised sleep logging. No real phone/manual disk entry. `docs/CORE_REPORT.md`, `docs/PHONE_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.2-S11 | Health remains phone Shortcut input; no Mac Health access required | PASS (automated phone-VM input; no device) | Phone VM tests cover Shortcut payload ingestion; desktop uses shared sleep data and no Mac Health access. No actual Shortcut/iPhone or Health payload tested. `docs/PHONE_REPORT.md`. |
| 6.2-S12 | Core contains/tests parseWhen, resolveDates, findSleepSessions | PASS (automated/core) | Core report records tested parsing/date resolution and sleep-session merge/pairing behavior, including time-only/full-date inputs and boundaries. `docs/CORE_REPORT.md`. |

## §6.3 — v1 improvements

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| 6.3-01 | Settings replace every hard-coded SETTINGS constant and persist daybar-settings.json | PASS (automated settings/schema subset) | Settings editors/schema and phone per-key fallback/strict validation are implemented and tested; browser smoke exercised settings validation/save. Not every field was manually edited/reloaded in native UI; `rows`/schema version remain fixed invariants. `docs/UI_REPORT.md`, `docs/PHONE_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.3-02 | Confirmed task rename carries all history in one operation | PASS (automated/browser-demo subset) | Rust tests cover all-log/session rename and browser smoke exercised confirmed history rename; cross-file interruption recovery and native disk-backed confirmation not comprehensively exercised. `docs/BACKEND_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.3-03 | Task removal archives rather than erases history | PASS (automated backend/core subset) | Rust tests cover archive retaining historical entries and core filters archived/inactive tasks; no native disk-backed archive walkthrough. `docs/BACKEND_REPORT.md`, `docs/CORE_REPORT.md`. |
| 6.3-04 | Current/longest streaks and per-task completion rate | PASS (automated/core; browser screen subset) | Extracted legacy core tests cover streak conventions and task-rate calculations; browser smoke visits Habits. All displayed values were not manually asserted. `docs/CORE_REPORT.md`, `/tmp/daybar-final-browser.log`. |
| 6.3-05 | Focus tag plus per-task threshold automatically checks task for day | PASS (automated core/Rust/phone) | Core/Rust/phone tests cover tagging, threshold accumulation and retry repair; native end-to-end focus-tag threshold flow was not observed. `docs/CORE_REPORT.md`, `docs/BACKEND_REPORT.md`, `docs/PHONE_REPORT.md`. |
| 6.3-06 | Focus and Today show room for ~N blocks before bed | PASS (automated/core/UI subset) | Core calculation and UI components are tested; browser smoke visits Today and Focus-related flows. Cross-screen clock updates were not separately manually compared. `docs/CORE_REPORT.md`, `docs/UI_REPORT.md`. |
| 6.3-07 | Starting focus during no-phone time gives gentle confirmation | PASS (sandbox/native screen subset) | Actual WKWebView no-phone acceptance showed labeled dialog; Cancel, Escape and default Enter left timer stopped; Confirm started Focus25. Other initiation paths were not exhaustively exercised. `/tmp/daybar-native-acceptance.log`, `/tmp/daybar-native-confirm-dialog.txt`. |
| 6.3-08 | Keyboard shortcuts throughout main window | PASS (automated/native navigation subset) | Desktop tests cover keyboard behavior and text-input non-hijacking; native Cmd+1–6 navigation exercised across screens. Full keyboard-only task/timer/date-picker acceptance not performed. `docs/UI_REPORT.md`, `/tmp/daybar-native-acceptance.log`. |

## Integration, packaging and portfolio follow-through

| ID | Acceptance point | Status | Intended method / evidence |
| --- | --- | --- | --- |
| I-01 | Updated standalone phone scripts and safe local→iCloud migration | PASS (automated phone VM; no iPhone) | Phone VM tests cover standalone scripts, download-before-read and local migration only when cloud destination is absent; legacy originals remain byte-identical. Actual Scriptable installation, iCloud and owner setup remain unverified. `docs/PHONE_REPORT.md`. |
| I-02 | Static export and native app launch | PASS (sandbox) | Static export, debug native launch and six-screen interaction passed against synthetic sandbox. Release bundle evidence is separately tracked in I-03. `/tmp/daybar-native-acceptance.log`, `/tmp/daybar-final-node22-gates.log`. |
| I-03 | GitHub macOS CI green, tag unsigned app/DMG downloadable | PENDING | Local `pnpm tauri build --no-sign --bundles app,dmg` succeeded: arm64 unsigned app 13.31 MiB and DMG 3.72 MiB; DMG `hdiutil verify` passed and bundled app launched in its app-local sandbox. Active five-minute break survived Quit/relaunch; an expired one-minute focus settled exactly once on bundled launch and stayed unchanged on a second relaunch, after which original focus bytes were restored. Artifact predates the final confirmation-error-path correction and is provisional, not a final release artifact. Hosted CI, tagged upload/download, trusted-open workflow, signing/notarization remain unverified. `/tmp/daybar-unsigned-bundle-retry.log`; `/tmp/daybar-native-acceptance.log`. |
| I-04 | Hero, menu bar GIF and owner iPhone screenshot | PENDING (synthetic assets only; owner phone image missing) | Browser Today hero and four-state actual native popup GIF exist using synthetic data; GIF is not continuous/countdown proof. Owner iPhone screenshot unavailable. See `docs/screenshots/README.md`, `docs/PROGRESS.md`. |

## Outstanding manual / external acceptance

- Real iCloud folder consent/backup and real phone/iCloud materialization, migration, Shortcut installation and cross-device convergence; no personal data has been touched.
- Native conflict-copy notice/cancel/merge/discard workflow; Dock visibility, launch-at-login and actual OS notification delivery/permissions.
- Hosted macOS CI, tagged artifact download/open, final corrected unsigned app/DMG rebuild, signing/notarization and owner iPhone screenshot.
- Confirmation-helper exceptional error reporting remains a P2 review blocker even though the normal native dialog path passed.

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

Do not promote a requirement to PASS based on planned tests, code inspection alone for native behavior, another worker's unverified claim or unavailable personal-device checks. A scoped PASS records only its automated/browser/sandbox evidence; do not imply real-phone, hosted-CI, notification delivery, signing, notarization, real iCloud or owner acceptance.
