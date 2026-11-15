# Independent implementation review

**Review basis:** the latest authoritative integration notes and artifacts at `/Users/rta.juice/Coding-Projects/Scriptable_code_conversion/docs/PROGRESS.md`, `/tmp/daybar-native-acceptance.log`, and the core/UI/phone/backend independent review reports in `/tmp`. This is a documentation synthesis of those reviews and the subsequent main-branch corrections, not a new source-code audit. No real iCloud data was accessed.

## Findings and dispositions

### Resolved: focus history could be erased during normalization

The original backend review found that a focus file with `sessions: {}` and no `baseline` could cause TypeScript and phone normalization to discard historical `days`, while Rust refused the ambiguous record. Main added shared fail-closed validation and regression coverage (commit `2aa9ac7`), and the matching phone validation was merged as `2d30453`. The latest progress reports 17 regression cases for the shared correction and 59 phone VM tests passing in Toronto, London and UTC. Final integrated rerun after that phone patch is still pending. The corrected rule is documented in `DATA_FORMATS.md`, `CORE_API.md`, and `DECISIONS.md`: preserve the source and require manual recovery rather than infer or erase history.

### Resolved: stable daily-log identifier

The cross-client review found Settings could imply `logId` was editable even though Rust rejected changes. Main made it read-only and demo mutations refuse changes (`8df2bd0`). Keep the stable ID; changing a display title must not orphan the history file.

### Resolved: phone interrupted-write recovery window

The phone review identified that a crash after moving the canonical file to a retained backup could leave no canonical file, allowing stale local migration or empty defaults on a later run. Fail-closed interrupted-write guards were added for the exact file, including evicted recovery artifacts and directory-listing failures. The independent corrected phone review reports 22/22 recovery repro assertions and 57/57 phone tests in Toronto, London and UTC. This detects and refuses; it does not automatically restore or delete artifacts. Manual recovery is required before resuming writes.

### Native HTML confirmation remains pending

Native WKWebView testing found `window.confirm` silently cancels without a visible usable confirmation. A standard HTML-dialog helper is being integrated. The target macOS minimum was raised to 12.3 for the relevant WKWebView baseline, but native confirmation and destructive-action acceptance has **not** passed. Do not treat browser confirmation tests as proof of native behavior.

## Verified behavior versus remaining risk

Main's recorded native synthetic-sandbox acceptance passed six-screen rendering/navigation, external atomic task-file refresh without restart, focus early stop, five-minute break auto-settlement, configured Cmd+Shift+F start/stop, tray start/stop/task actions, changing tray status, and Cmd+W hide followed by tray reopen. Browser smoke covers all six pages and selected workflows. Core and UI independent reviews report passing tests; Rust reports 29 tests. These results do not establish every feature in `VERIFICATION.md`.

Important residual limitations:

- The phone uses temporary files and retained backups, but Scriptable `FileManager` has no atomic replace or shared compare-and-swap. A race remains after the final comparison. iCloud eventual consistency can still produce conflicts.
- Focus-to-habit completion writes two files; repair is retryable but not atomic, and earned linked tasks can be reasserted after manual unchecking.
- No real iCloud folder, iPhone, Shortcut or cross-device convergence was tested.
- Native HTML confirmation/destructive flows, notification delivery, Dock/autostart behavior, shortcut reconfiguration/conflicts, and complete conflict/backup/placeholder acceptance remain pending.
- A release Rust warm compile passed, but no packaged unsigned app/DMG was built/launched. Hosted CI, signing and notarization are unverified.
- `menu-bar.gif` is four real native popup states with synthetic data, two seconds each—not a continuous recording or live-countdown proof. The Today screenshot is browser-demo synthetic data. The owner-supplied iPhone image is unavailable.

## Verdict

The reviewed implementation has meaningful passing core, UI, phone, Rust and native sandbox evidence, and three important cross-client safety findings were corrected. The review does **not** support declaring v1 or real-data readiness: finish the native confirmation helper, rerun integrated tests after the phone patch, and complete the still-pending safety, packaging and OS acceptance rows. Use `docs/VERIFICATION.md` for row-level status and `docs/PROGRESS.md` on main for integration chronology.