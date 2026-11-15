# Documentation handoff

Updated documentation is bounded to the current evidence and explicitly distinguishes browser checks, native sandbox checks, and unavailable release/device checks.

## Changes in this handoff

- `README.md` now links the captured native popup GIF and accurately captions its four synthetic sampled states (not a continuous recording or countdown proof). It records the macOS 12.3 WKWebView minimum, selected native sandbox acceptance, and remaining real-data safety gates.
- `docs/VERIFICATION.md` retains the full requirement-by-requirement ledger. It records the actual native sandbox evidence for six screens, task edit refresh, tray actions/title, configured global shortcut, and close-hide/reopen; untested OS and data-safety rows remain pending.
- `docs/REVIEW.md` records the corrected independent review findings, follow-up fixes, residual risks and verification boundaries.
- `docs/DATA_FORMATS.md`, `docs/CORE_API.md`, and `docs/DECISIONS.md` clarify fail-closed handling for an ambiguous focus session ledger rather than implying saved history may be discarded.
- `docs/screenshots/README.md` documents the present browser hero, native popup GIF and unavailable owner-supplied iPhone image.

## Evidence and limits

The authoritative current integration history is `/Users/rta.juice/Coding-Projects/Scriptable_code_conversion/docs/PROGRESS.md` (read only), supported by `/tmp/daybar-native-acceptance.log` and independent-review reports under `/tmp/daybar-*-independent-review.md`. Main records real WKWebView sandbox checks: all six screens, external atomic task edit refresh, focus stop and expiry, a configured global shortcut, native tray start/stop/task actions, and Cmd+W hide followed by tray reopen. Four native popup states were captured into `docs/screenshots/menu-bar.gif` on main (102,799 bytes). The asset is referenced here but is owned by the main integration work, not this documentation change.

The shared core/UI gate of 137 core + 29 UI tests in Toronto and London and the 29-test Rust suite passed before the latest phone semantic-validation patch. The phone worker's 59 VM tests passed in Toronto/London/UTC; the final combined rerun remains pending. Native HTML-dialog confirmation support is still being integrated, so confirmation/destructive native acceptance is not claimed. Release Rust warm compilation passed, but no unsigned app/DMG bundle or release launch is verified. Hosted CI, signing/notarization, notification delivery, real cloud convergence, and actual iPhone/Shortcut behavior remain unverified. No real iCloud folder was read, selected or written.

`docs/VERIFICATION.md` is the acceptance ledger; preserve each row's scope and pending status rather than inferring a blanket pass. `docs/PROGRESS.md` is orchestrator-owned and was not edited in this worktree.