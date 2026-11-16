# Release downloads and safe data switch

## What is published

The [v0.1.0 unsigned preview](https://github.com/xolah88457/daybar/releases/tag/v0.1.0) (DMG, app ZIP and `SHA256SUMS.txt`; direct links in the [README](../README.md#download-the-mac-app)) was built locally from product source `f6fd53084bc5e3912f312a3a9291cd700cc71fe0` on 2026-11-15: macOS **arm64**, minimum macOS **12.3**. It is not signed or notarized, and no universal/Intel or older-macOS build exists.

| Artifact | SHA-256 |
| --- | --- |
| `Daybar_0.1.0_aarch64.dmg` (3.73 MiB) | `94be7f25c3cf49efcca2cb1bef36bb26ec4895fa6f1bbd866fd52749f795852f` |
| `Daybar_0.1.0_aarch64.app.zip` (3.73 MiB) | `1ade21f7f200062bc0508baf42e1ae7bd1d986cc70560d74d18775021dc3ffa0` |
| `Daybar.app` executable (app bundle 13.34 MiB) | `22aebd61faab2f39a6096fd58034f0d353c671175ce923d0f75215c8764db453` |

`shasum -a 256 -c SHA256SUMS.txt` checks the two downloads. The published digests matched the local files and an unauthenticated public DMG download. `hdiutil verify` and a read-only mount passed, and the mounted app's metadata and executable matched the tested bundle. These hashes identify this build only; rebuilding can change them.

### Opening an unsigned app

macOS may warn because the app is unsigned. Check provenance and compare hashes through a trusted channel first, then use Finder **right-click → Open** on the copy in Applications and confirm Open if offered. Gatekeeper behaviour varies by macOS and security policy; do not disable Gatekeeper or strip quarantine globally. If blocked, build from reviewed source. Opening has not been verified on another Mac or an older macOS release.

## Reproduce locally

Prerequisites and sandbox commands are in the [README](../README.md#run-locally--sandbox-first).

```sh
pnpm lint
pnpm typecheck
pnpm test:tz
pnpm test:rust
pnpm build
pnpm tauri build --no-sign --bundles app,dmg
```

Bundles land in `apps/desktop/src-tauri/target/release/bundle/macos/Daybar.app` and `bundle/dmg/`; the Tauri build runs the static export first. Do not point development or tests at personal data.

## What was verified

Scope: the v0.1.0 candidate, run locally against fictional sandbox data. Nothing below used a real iCloud folder, and every preference case kept `realData=false` with the four shared JSON files unchanged.

- **Automated:** lint, types and 247 tests in each of America/Toronto and Europe/London (138 core, 50 desktop, 59 phone), 32 Rust tests in temporary folders, and a Playwright browser smoke (`apps/desktop/tests/browser_smoke.py`: six screens, edits, focus/settings/sleep flows, Day/Night fit at 1280×800 and 1440×900, portrait stacking, 375–1440px overflow, no external requests or storage writes). Hosted CI passed on `main` at `dbd047a` (2026-11-16); the tag packaging job has not yet run to completion.
- **Native sandbox:** all six screens and bare 1–6 keys; an external atomic task edit refreshing the open UI; focus start/stop, a real five-minute break expiring, and once-only credit for a session that expired while the app was closed; tray start/stop/task actions and live title; the global shortcut Cmd+Shift+F; Cmd+W close-hide and tray reopen; confirmation dialogs (Cancel, Escape and default Enter refuse; explicit Confirm proceeds); Day/Night persistence and Auto matching macOS; all eight menu-bar label modes with Quit/relaunch persistence.

Typing, composition and dialog guards for bare navigation keys were checked in automated frontend/browser tests, not native field-typing automation.

### Not established
- Real iPhone, Scriptable installation, Shortcut, real iCloud materialization, or cross-device sync and convergence.
- OS notification delivery, launch-at-login and Dock-visibility behavior.
- The native conflict notice/merge/discard walkthrough (Rust merge/discard logic is unit-tested). No promise of automatic recovery for interrupted Scriptable writes.
- Signing/notarization, Intel/universal builds, older macOS, and a tag-built artifact download.
- An owner-supplied iPhone screenshot ([media notes](screenshots/README.md)).

To check any of these yourself, do it in a disposable sandbox (`pnpm seed`, then `pnpm tauri dev`): confirm the **SANDBOX DATA** badge, exercise one case at a time, and compare the managed JSON files before and after.

## Switching to real Scriptable data (owner opt-in only)

Daybar is a standalone Mac app; the phone is optional. Do not switch until sandbox checks are done and you have read the [Scriptable setup, install and recovery guide](../scriptable/README.md). Do not overwrite history, delete canonical files, or change the read-only `habits.logId` in Daybar to force a match.

1. **Prepare backups and stop concurrent edits.** Quit Daybar and stop editing the same files on the phone. Make a separate, dated copy of the existing Scriptable `Documents` folder and phone-local data using Finder or your normal backup tool; retain the originals. Do not treat that copy as disposable after connecting.
2. **Prepare the phone deliberately.** Follow the phone guide's installation/migration steps only if you choose to update scripts. Keep Mac-first shared settings and the guide's compatibility warnings; preserve the blank Daily Log parameter unless you intentionally use a separate log. Back up before replacing any working script, and confirm the intended log ID and existing canonical filename agree.
3. **Check iCloud files before connecting.** In Finder, use **Keep Downloaded** for the Scriptable folder where available and let sync finish. Inspect that the canonical JSON files and settings are present and valid. Resolve a mismatched setup before proceeding rather than renaming files.
4. **Opt in on the Mac only after your independent backup exists.** In Settings, enter/select the existing Scriptable **Documents** folder and explicitly consent to real data. Installing or building does not probe it. Connecting may reconcile an already-expired timer. Daybar writes its own timestamped backup as part of its first write, before changing managed files, so that backup does not exist beforehand. Stop on any backup, malformed/unknown-file or placeholder/download error; never save a destructive replacement.
5. **Start with one small, reviewed operation.** Keep the phone idle. Make one reversible test edit, then inspect the expected file and Daybar's new automatic backup before using other modules. If results are unexpected, quit Daybar and recover manually from a known-good backup; there is no automatic rollback or cross-device transaction. Resume sequential edits only after reviewing the result and letting sync finish.

Concurrency limits (no atomic replace on Scriptable, no cross-device transaction) are described in [ARCHITECTURE](ARCHITECTURE.md#safety-limits). Do not treat the real-phone/iCloud workflow as accepted until you have tested your own copy and understand recovery.
