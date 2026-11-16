# Release downloads and safe data switch

## What exists

The [v0.1.0 unsigned preview](https://github.com/xolah88457/daybar/releases/tag/v0.1.0) is published on GitHub. It was built from product source `f6fd53084bc5e3912f312a3a9291cd700cc71fe0` on 2026-11-15: macOS **arm64**, minimum macOS **12.3**. It is not signed/notarized or a production-ready certification; no universal/Intel or older-macOS build is claimed.

- [Download DMG](https://github.com/xolah88457/daybar/releases/download/v0.1.0/Daybar_0.1.0_aarch64.dmg)
- [Download app ZIP](https://github.com/xolah88457/daybar/releases/download/v0.1.0/Daybar_0.1.0_aarch64.app.zip)
- [Download SHA256SUMS.txt](https://github.com/xolah88457/daybar/releases/download/v0.1.0/SHA256SUMS.txt)

All three uploaded asset sizes/digests matched local files. An unauthenticated public DMG download also matched the recorded SHA-256. The app ZIP was extracted and its executable, metadata and execute permission verified before upload.

Build log: `/tmp/daybar-custom-tray-native-build.log` (Tauri build includes Next static export). Local bundle paths:

- App: `apps/desktop/src-tauri/target/release/bundle/macos/Daybar.app` (13.34 MiB)
- Disk image: `apps/desktop/src-tauri/target/release/bundle/dmg/Daybar_0.1.0_aarch64.dmg` (3.73 MiB)

Exact artifact manifest: `/tmp/daybar-release-final-manifest.json`.

| Artifact/check | Recorded result |
| --- | --- |
| DMG SHA-256 | `94be7f25c3cf49efcca2cb1bef36bb26ec4895fa6f1bbd866fd52749f795852f` |
| App ZIP SHA-256 | `1ade21f7f200062bc0508baf42e1ae7bd1d986cc70560d74d18775021dc3ffa0` |
| App executable SHA-256 | `22aebd61faab2f39a6096fd58034f0d353c671175ce923d0f75215c8764db453` |
| `hdiutil verify` | Passed |
| Read-only mount and mounted app metadata/executable equality | Passed |
| Signature / notarization | **Unsigned / not notarized** |

These hashes identify this local build only. Rebuilding can change them. Before opening an artifact, check its provenance and compare hashes through a trusted channel. macOS may warn because it is unsigned; do not disable Gatekeeper globally or remove quarantine globally. If choosing to open a locally built candidate, use the app-specific Finder **right-click → Open** flow only after reviewing its origin, or build from reviewed source. This has not been verified on another Mac or an older macOS release.

## Reproduce locally

Prerequisites and sandbox commands are in the root [README](../README.md). From the repository root, with the documented Node 22, pnpm 10.12.3, Rust and macOS prerequisites:

```sh
pnpm lint
pnpm typecheck
pnpm test:tz
pnpm test:rust
pnpm build
pnpm tauri build --no-sign --bundles app,dmg
```

The Tauri build runs the static export as its before-build command. Output paths are listed above. Do not point development/tests at personal data. Latest recorded gates: `/tmp/daybar-tray-integrated-node22.log` (lint/types and 247 tests per timezone: 138 core, 50 desktop, 59 phone in Toronto and London), `/tmp/daybar-tray-parent-rust.log` (32 Rust tests), `/tmp/daybar-custom-tray-browser.log` (browser layout/interactions), and `/tmp/daybar-custom-tray-native-build.log`. The initial hosted CI runs were cancelled before job steps; no hosted CI pass is claimed. See the [scoped verification ledger](VERIFICATION.md).

The actual `today.png` and `today-day.png` are fictional-data native-window captures. `menu-bar.gif` is eight actual owned status-item mode crops at two seconds each (500×80), not four popup frames, continuous video, or proof of a running live clock. Media detail: [screenshots README](screenshots/README.md).

## Mac-local presentation preferences

Daybar's app-local `themeMode` defaults to **Night**; **Day**, **Night**, and **Auto** persist locally. Auto follows the macOS appearance setting, including changes; Daybar does not use location or a location-based schedule. For automatic day/night timing, configure macOS Appearance to **Auto**. Theme selection changes only presentation, not shared JSON.

The **Menu-bar label** selector is at **Settings → On this Mac → Menu-bar label → Save**. It stores one of eight Mac-local modes: Auto, today's credited focus minutes/hours/blocks, active timer, bedtime, next task, or countdown. The actual saved modes/status-item labels were observed; normal Quit/relaunch retained countdown (`228d`) and Day theme. Auto remains timer-first, then bedtime; explicit modes are not overridden by the timer. Today's focus totals are credited values, not speculative live credit. Countdown shows remaining days without the goal title. These preferences are not phone/shared settings.

Native bare keys **1–6** reached Today/Countdown/Habits/Focus/Sleep/Settings. Typing/composition/dialog guards were checked in automated frontend/browser tests, not by native field-typing automation. Portrait stacks naturally and checked desktop landscape sizes use three columns. Smaller windows and long forms may scroll. See [progress](PROGRESS.md) for fuller evidence and limits.

## Switching to real Scriptable data (owner opt-in only)

Daybar is a standalone Mac app; the phone is optional. Do not switch until sandbox checks are complete and you have read the [Scriptable setup, install and recovery guide](../scriptable/README.md). No acceptance run described here used real iCloud data. Do not overwrite history, delete canonical files, or change the read-only `habits.logId` in Daybar to force a match.

1. **Prepare backups and stop concurrent edits.** Quit Daybar and stop editing the same files on the phone. Make a separate, dated copy of the existing Scriptable `Documents` folder and phone-local data using Finder/filesystem backup procedures; retain the originals. Do not experiment on that copy as if it were disposable after connecting it.
2. **Prepare the phone deliberately.** Follow the phone guide's installation/migration instructions only if you choose to update scripts. Keep Mac-first shared settings and the guide's compatibility warnings; preserve the blank Daily Log parameter unless you intentionally use a separate log. Back up before replacing any working script, confirm the intended log ID and existing canonical filename agree, and retain the guide's recovery artifacts/instructions. Avoid phone/Mac concurrent editing; iCloud sync is not a lock or distributed transaction.
3. **Check iCloud files before connecting.** In Finder, use **Keep Downloaded** for the Scriptable folder where available and allow sync/download to finish. Inspect that canonical JSON files and settings are present and valid. Do not rename/delete canonical files or change the read-only log ID to bypass a mismatch; resolve mismatched setup before proceeding.
4. **Explicitly opt in on Mac only after your independent backup exists.** Open Daybar, enter/select the existing Scriptable **Documents** folder in Settings and explicitly consent to real data. Installing/building does not probe it. Connecting may reconcile an already-expired timer. Daybar creates its own timestamped backup as part of its first write, before changing managed files; that automatic backup may not exist before the first operation. Stop on any backup, malformed/unknown-file or placeholder/download error; never save a destructive replacement.
5. **Start with one small, reviewed operation.** Keep the phone idle. With your independent dated backup confirmed, make one reversible test edit, then inspect the expected file and Daybar's newly created automatic backup before using other modules. Quit Daybar and inspect/recover manually from a known-good backup if results are unexpected; do not rely on automatic rollback or a cross-device transaction. Resume sequential edits only after reviewing the result and allowing sync to finish.

Scriptable cannot atomically replace a file or provide compare-and-swap. Its guarded write can leave recovery artifacts after interruption; recovery is manual from known-good copies. Mac atomic per-file replacement and idempotent focus credits do not prevent all cross-device races. Avoid simultaneous edits and keep independent backups. Do not claim the real-phone/iCloud workflow is accepted until you test your own copy and understand recovery.

## Not established by this candidate

- No passing hosted CI run, signed/notarized distribution, Intel/universal artifact, or older-macOS acceptance. The published downloads are the locally verified build.
- No real iPhone, Scriptable installation, Shortcut, real iCloud folder/materialization, or cross-device sync/convergence test.
- No OS notification delivery, login-at-login behavior, Dock visibility behavior, or complete native conflict-notice/merge/discard walkthrough.
- No native conflict UI evidence or promise of automatic recovery for interrupted Scriptable writes.
