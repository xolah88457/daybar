# Progress

## Current local release candidate

**Product source: `f6fd53084bc5e3912f312a3a9291cd700cc71fe0` (v0.1.0).** Implementation, independent source reviews, local automated gates, native sandbox checks and unsigned arm64 packaging have passed. Final handoff and conservative owner setup instructions are in [RELEASE.md](RELEASE.md). Real-phone/iCloud, notification delivery, login/Dock preferences and hosted CI acceptance are not claimed.

- **Node 22.23.5:** lint, strict types and **138 core + 50 desktop + 59 Scriptable = 247 tests in EACH America/Toronto and Europe/London**, all passing (`/tmp/daybar-tray-integrated-node22.log`).
- **Rust:** 32 tests passing; the worker also tested Toronto/London (`/tmp/daybar-tray-parent-rust.log`).
- **Static export / browser:** final Tauri build and committed Playwright smoke pass. Six screens, edits, focus/settings/sleep flows, Day/Night whole-page fit at 1280×800 and 1440×900, portrait stacking and 375–1440px overflow checks; no external requests, storage writes or runtime errors (`/tmp/daybar-custom-tray-browser.log`). Browser Auto switching and typing guards were separately exercised.
- **Native app:** all six bare 1–6 shortcuts, Day/Night controls and saved appearance, Auto matching current macOS Light, eight menu-bar choices and actual status-item labels. Countdown/Day survived normal Quit/relaunch. Every preference case kept `realData=false`; all four sandbox JSON hashes remained unchanged.
- **Packaging:** Node 22 unsigned `.app` and `.dmg` succeeded (`/tmp/daybar-custom-tray-native-build.log`): arm64, minimum macOS 12.3, app 13.34 MiB / DMG 3.73 MiB. `hdiutil verify` and read-only mount passed; mounted app executable/metadata match the tested bundle. Exact hashes: `/tmp/daybar-release-final-manifest.json`.

## Requested refinements — complete

- Safe bare **1–6** navigation ignores typing, IME, dialogs and modified keystrokes; existing modified/global shortcuts remain.
- Four fictional tasks, five sample log dates and **Community Garden Opening** replace active personal-looking examples. Original five scripts remain untouched in `legacy/`; explicitly labeled compatibility tests retain legacy inputs.
- App-local **Day / Night / Auto** preferences; Auto follows macOS appearance, not a Daybar location/astronomy service. Day-mode palette is display-only, preserves core opacity and never changes shared saved appearance settings.
- Landscape Today uses three columns with Focus spanning two rows; portrait is readable and sequential. Main caught and fixed both a CSS syntax error and residual footer scrolling with actual red→green regressions. All controls remain visible; small windows and long forms may scroll normally.
- **Menu-bar label** offers Auto, today's focus minutes/hours/blocks, active focus/break timer, bedtime, next task or countdown days only. Explicit modes are not overridden by a running timer. All eight native choices were saved and observed; countdown is `228d`, without the goal title.
- All five standalone phone scripts are in `scriptable/`. Phone compatibility review passed 59 VM tests; Radar is byte-identical and phone-only. Root and phone READMEs explain GitHub Raw installation, widgets, backups, blank Daily Log parameter, matching log ID/settings and safe iCloud setup. Parent validated 27 links, the sample settings JSON and the read-only local-backup snippet.

## Safety and preserved behavior

- Read `AGENT_PROMPT.md` first, then all five originals. Foundation established strict shared TS/Zod/JSON Schema/Rust contracts, typed IPC, pure extracted-legacy golden comparisons, static Next export and Rust-owned filesystem/OS integration.
- Phone countdown DST fade uses the exact legacy `/ 86400000`. Focus settlement is keyed by session start, preserves a legacy baseline and rejects ambiguous/untracked history instead of erasing it. Matching integrity checks exist in Rust, shared schemas and all four inline phone validators.
- Phone interrupted-write guards fail closed on matching backup/temp artifacts (including evicted placeholders) and directory-listing failure. Recovery was independently reproduced after a simulated crash; no atomic-replace/CAS guarantee is claimed for Scriptable.
- Real WKWebView testing replaced unusable `window.confirm` with accessible HTML dialogs. Cancel/Escape/default Enter refuse the action; explicit Confirm proceeds. One shared error boundary surfaces confirmation failures at all ten gates, including the nested real-folder preferences form; the regression was verified failing before the fix.
- Earlier genuine native sandbox checks passed: external atomic JSON task edit refreshing the open UI, focus stop, a real five-minute break expiring, Cmd+Shift+F, tray start/stop/task actions, Cmd+W close-hide/tray reopen, timer restart persistence and once-only credit after expiry while closed. These observations are recorded in `/tmp/daybar-native-acceptance.log`; notification delivery was not observed.

## Independent reviews and media

Core/UI reviews passed their scopes; phone review found and then independently accepted crash recovery and integrity corrections. Final confirmation review passed at `9d2d329`; refined theme/navigation/layout review passed at `a5d7bec`; focused menu-bar review **PASS** at `f6fd530` (`/tmp/daybar-tray-final-review.md`). The last reviewer inspected parent native evidence, not a personally driven GUI session.

`docs/screenshots/today.png` and `today-day.png` are inspected real native windows with fictional sandbox data. `menu-bar.gif` contains eight real owned-status-item crops, two seconds each, **not continuous video or timing proof**. No personal paths or unrelated apps are published. iPhone media remains an honest owner-supplied placeholder.

The user's tmux extension replaced ACP. Failed/quota-limited agents were not counted as results. Dead nested-agent waits were recovered after preserving work. Current flat profiles cannot spawn prohibited GLM children; no new RP/GLM agents or credential changes were used.

## Data boundary and remaining owner checks

**No real iCloud folder has been selected, read or written.** Original development-test JSON was restored byte-for-byte before the separately requested fictional reset. Only eight known development/app-local sandbox files were then replaced with schema-validated fictional fixtures; originals remain backed up under `/tmp/daybar-fictional-samples-backup-20261115-115838`. Later menu/theme verification changed only app-local preferences, not shared JSON.

The acceptance ledger retains scoped automated/native evidence and explicit pending owner checks: full native conflict UI, Dock/login behavior, notification delivery, hosted CI/distribution and an owner iPhone image. Real iOS/Shortcuts/iCloud convergence, signing/notarization, older macOS and Intel builds remain unverified. Do not enable real-folder mode casually; use the [phone setup](../scriptable/README.md) and [release/safe-switch instructions](RELEASE.md).
