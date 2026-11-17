# Release downloads and safe data switch

## What is published

The [v0.1.0 unsigned preview](https://github.com/xolah88457/daybar/releases/tag/v0.1.0) (DMG, app ZIP and `SHA256SUMS.txt`; direct links in the [README](../README.md#download-the-mac-app)) was built locally from product source `f6fd53084bc5e3912f312a3a9291cd700cc71fe0` on 2026-11-15: macOS **arm64**, minimum macOS **12.3**. It is not signed or notarized, and no universal/Intel or older-macOS build exists.

| Artifact | SHA-256 |
| --- | --- |
| `Daybar_0.1.0_aarch64.dmg` (3.73 MiB) | `94be7f25c3cf49efcca2cb1bef36bb26ec4895fa6f1bbd866fd52749f795852f` |
| `Daybar_0.1.0_aarch64.app.zip` (3.73 MiB) | `1ade21f7f200062bc0508baf42e1ae7bd1d986cc70560d74d18775021dc3ffa0` |
| `Daybar.app` executable (app bundle 13.34 MiB) | `22aebd61faab2f39a6096fd58034f0d353c671175ce923d0f75215c8764db453` |

`shasum -a 256 -c SHA256SUMS.txt` checks the two downloads. The published digests matched the local files and an unauthenticated public DMG download. `hdiutil verify` and a read-only mount passed, and the mounted app's metadata and executable matched the tested bundle. These hashes identify this build only; rebuilding can change them.

### Opening the app on a Mac

From v0.2.1 the app is ad-hoc signed (`signingIdentity: "-"`) but not Developer ID signed or notarized, so macOS cannot verify who made it. Check the download against `SHA256SUMS.txt` first (`shasum -a 256 -c SHA256SUMS.txt`), then:

1. Drag Daybar to Applications and open it. macOS says it cannot verify the developer.
2. Open **System Settings → Privacy & Security**, scroll to the Daybar message and click **Open Anyway** (macOS 15 and later; earlier versions also allow right-click → Open). Confirm once; later launches are normal.
3. If macOS says **"Daybar.app" is damaged and can't be opened** (copies downloaded from v0.2.0 or older, which had no bundle signature), remove the quarantine flag from that app only: `xattr -dr com.apple.quarantine /Applications/Daybar.app`. Do not disable Gatekeeper or strip quarantine anywhere else.

In-app updates do not show this warning: the updater downloads and verifies the archive itself, so nothing is quarantined. Removing the first-open warning entirely needs an Apple Developer ID certificate and notarization, which are not configured. These steps are untested on a downloaded release build.

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

Use `--no-sign` for local builds without the updater key: without it, a build with a public key configured fails with "A public key has been found, but no private key". Release builds in CI omit it because it also skips updater signing.

Bundles land in `apps/desktop/src-tauri/target/release/bundle/macos/Daybar.app` and `bundle/dmg/`; the Tauri build runs the static export first. Do not point development or tests at personal data.

## Publishing a release and in-app updates

Daybar can update itself, but only when you ask: **Settings → Check for updates** fetches `latest.json` from the newest published GitHub Release (`https://github.com/xolah88457/daybar/releases/latest/download/latest.json`), then downloads, verifies and installs the update and offers **Restart now**. There are no automatic or background checks, and the app makes no other network requests. The update archive is verified against the public key in `plugins.updater.pubkey` in [`tauri.conf.json`](../apps/desktop/src-tauri/tauri.conf.json); this is Tauri's own updater signature and is unrelated to Apple code signing; the app is ad-hoc signed and not notarized.

**0.1.0 has no updater.** Anyone on v0.1.0 installs v0.2.0 manually once (the [README](../README.md#download-the-mac-app) download links); from then on Settings can fetch later releases.

### One-time setup: updater signing key

1. Generate the keypair on your Mac: `pnpm tauri signer generate -w ~/.tauri/daybar-updater.key`. Choose a password and store it in a password manager. This writes the private key to `~/.tauri/daybar-updater.key` and the public key to `~/.tauri/daybar-updater.key.pub`.
2. **Back up the private key and its password** somewhere safe and separate (for example an encrypted backup). **If you lose either, installed copies of Daybar can never be updated again**: they only trust the public key they shipped with, so users would have to download a new build by hand. Never commit the private key.
3. Add two repository secrets under **Settings → Secrets and variables → Actions**: `TAURI_SIGNING_PRIVATE_KEY` (the full contents of `~/.tauri/daybar-updater.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the password).
4. Put the contents of `~/.tauri/daybar-updater.key.pub` in `plugins.updater.pubkey` in `apps/desktop/src-tauri/tauri.conf.json` and commit it. The key must be in place before the first updater-enabled build is released, because the public key is compiled into each install.

### Per release

1. Bump the version to the same `X.Y.Z` in `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml` and `apps/desktop/package.json` (keep the root `package.json` in step). Refresh `apps/desktop/src-tauri/Cargo.lock` with `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`; CI's `cargo test --locked` fails if the lockfile is stale. Merge to `main`.
2. Tag that commit and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. Tags must look like `vX.Y.Z`.
3. The [CI workflow](../.github/workflows/ci.yml) first fails fast if the tag does not match the three versions or the signing secret is missing. It then runs every check, builds the app and DMG with `pnpm tauri build --bundles app,dmg` (no `--no-sign`, since that would also skip updater signing; the bundle is ad-hoc signed via `signingIdentity: "-"`, with no Apple certificate and no notarization) and creates a **draft** GitHub Release. Only that final job has write access to the repository.
4. Open the draft under **Releases**. It should hold: `Daybar_X.Y.Z_aarch64.dmg`, `Daybar_X.Y.Z_aarch64.app.zip`, `Daybar_X.Y.Z_aarch64.app.tar.gz` and its `.sig` (the updater archive and signature), `latest.json` and `SHA256SUMS.txt`. Review the generated notes and edit them if you like. The `notes` in `latest.json` are not copied from the release page: they are a one-line version plus a link to it.
5. Publish it as a normal release: leave **Set as a pre-release** unchecked and **Set as the latest release** checked. `/releases/latest/download/latest.json` serves only the newest published, non-prerelease, non-draft release, so a draft or prerelease is invisible to the updater.

`latest.json` lists only `darwin-aarch64` because the macOS runner builds Apple Silicon only, as v0.1.0 did. Intel Macs get no update until an Intel or universal build is added.

### Verify an update end to end

Nothing here has been run on a real tag yet.

1. Install the previous updater-enabled release (v0.2.0 or later) in Applications and note its version under **Settings → Updates**.
2. Publish the newer release as above, then in that older app click **Check for updates**. Confirm it shows the new version, installs, and **Restart now** reopens it at the new version.
3. Confirm the failure paths do not crash: check again while on the newest version (it should say you are up to date), and check with the network off (it should show an error with a retry).
4. Optionally compare downloads with `shasum -a 256 -c SHA256SUMS.txt` and inspect `latest.json` in the published release. Its `url` must point at the `.app.tar.gz` asset of the same tag and its `version` must match the new version.

## What was verified

Scope: the v0.1.0 candidate, run locally against fictional sandbox data. Nothing below used a real iCloud folder, and every preference case kept `realData=false` with the four shared JSON files unchanged.

- **Automated:** lint, types and 247 tests in each of America/Toronto and Europe/London (138 core, 50 desktop, 59 phone), 32 Rust tests in temporary folders, and a Playwright browser smoke (`apps/desktop/tests/browser_smoke.py`: six screens, edits, focus/settings/sleep flows, Day/Night fit at 1280×800 and 1440×900, portrait stacking, 375–1440px overflow, no external requests or storage writes). Hosted CI passed on `main` at `dbd047a` (2026-11-16); the tag packaging job has not yet run to completion.
- **Native sandbox:** all six screens and bare 1–6 keys; an external atomic task edit refreshing the open UI; focus start/stop, a real five-minute break expiring, and once-only credit for a session that expired while the app was closed; tray start/stop/task actions and live title; the global shortcut Cmd+Shift+F; Cmd+W close-hide and tray reopen; confirmation dialogs (Cancel, Escape and default Enter refuse; explicit Confirm proceeds); Day/Night persistence and Auto matching macOS; all eight menu-bar label modes with Quit/relaunch persistence.

Typing, composition and dialog guards for bare navigation keys were checked in automated frontend/browser tests, not native field-typing automation.

### Not established
- Real iPhone, Scriptable installation, Shortcut, real iCloud materialization, or cross-device sync and convergence.
- OS notification delivery, launch-at-login and Dock-visibility behavior.
- The native conflict notice/merge/discard walkthrough (Rust merge/discard logic is unit-tested). No promise of automatic recovery for interrupted Scriptable writes.
- Developer ID signing/notarization, a Mac opening a downloaded ad-hoc signed build, Intel/universal builds, older macOS, a tag-built artifact download, and a real in-app update from one published release to the next.
- An owner-supplied iPhone screenshot ([media notes](screenshots/README.md)).
- For the 0.3.0 optional features, everything that needs a real Mac: the Calendars/Reminders permission prompts (macOS 14+ and 12.3–13) and whether macOS asks again after an update; real calendar data in Deadline Radar; notification delivery and the chime sound; running a named Shortcut; idle detection; Finder reveal after export; ⌘K inside the native window. These are covered by unit tests and a macOS type-check only.

To check any of these yourself, do it in a disposable sandbox (`pnpm seed`, then `pnpm tauri dev`): confirm the **SANDBOX DATA** badge, exercise one case at a time, and compare the managed JSON files before and after.

## Switching to real Scriptable data (owner opt-in only)

Daybar is a standalone Mac app; the phone is optional. Do not switch until sandbox checks are done and you have read the [Scriptable setup, install and recovery guide](../scriptable/README.md). Do not overwrite history, delete canonical files, or change the read-only `habits.logId` in Daybar to force a match.

1. **Prepare backups and stop concurrent edits.** Quit Daybar and stop editing the same files on the phone. Make a separate, dated copy of the existing Scriptable `Documents` folder and phone-local data using Finder or your normal backup tool; retain the originals. Do not treat that copy as disposable after connecting.
2. **Prepare the phone deliberately.** Follow the phone guide's installation/migration steps only if you choose to update scripts. Keep Mac-first shared settings and the guide's compatibility warnings; preserve the blank Daily Log parameter unless you intentionally use a separate log. Back up before replacing any working script, and confirm the intended log ID and existing canonical filename agree.
3. **Check iCloud files before connecting.** In Finder, use **Keep Downloaded** for the Scriptable folder where available and let sync finish. Inspect that the canonical JSON files and settings are present and valid. Resolve a mismatched setup before proceeding rather than renaming files.
4. **Opt in on the Mac only after your independent backup exists.** In Settings, enter/select the existing Scriptable **Documents** folder and explicitly consent to real data. Installing or building does not probe it. Connecting may reconcile an already-expired timer. Daybar writes its own timestamped backup as part of its first write, before changing managed files, so that backup does not exist beforehand. Stop on any backup, malformed/unknown-file or placeholder/download error; never save a destructive replacement.
5. **Start with one small, reviewed operation.** Keep the phone idle. Make one reversible test edit, then inspect the expected file and Daybar's new automatic backup before using other modules. If results are unexpected, quit Daybar and recover manually from a known-good backup; there is no automatic rollback or cross-device transaction. Resume sequential edits only after reviewing the result and letting sync finish.

Concurrency limits (no atomic replace on Scriptable, no cross-device transaction) are described in [ARCHITECTURE](ARCHITECTURE.md#safety-limits). Do not treat the real-phone/iCloud workflow as accepted until you have tested your own copy and understand recovery.
