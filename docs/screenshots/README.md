# Portfolio media — capture pending

No screenshots or recordings have been captured. Do not use illustrative mockups as evidence that the app works.

| Asset | Status | Content |
| --- | --- | --- |
| `today.png` | NOT YET CAPTURED | Today dashboard hero linked from the root README |
| `menu-bar.gif` | NOT YET CAPTURED | Start/stop a synthetic focus timer from the menu bar |
| iPhone widget image (filename TBD) | OWNER-SUPPLIED PLACEHOLDER | Original widgets; owner must review/redact before publishing |

## Safe capture procedure

1. Run `pnpm seed` from the repository root; use only synthetic `.dev-data/` fixtures. Launch with `pnpm tauri dev`. Do not select, browse, read or modify a real iCloud folder. Do not enter real task names, sleep history or calendar items.
2. Confirm Settings points at the sandbox. If the current build cannot demonstrate sandbox isolation, stop and leave the placeholders intact.
3. Use a clean desktop or disposable macOS account. Close unrelated windows and hide desktop items. Turn on Do Not Disturb; ensure the menu bar contains no personal account names, location, notifications or sensitive utility readouts.
4. Capture **only the Daybar window** for `today.png` (macOS Shift–Command–4, then Space). Show the full dashboard legibly, with synthetic checklist, focus blocks, countdown and sleep state. Do not capture a full desktop or other apps.
5. Record only the Daybar tray item and its menu for `menu-bar.gif`; crop tightly. Demonstrate a focus preset and stop action without real notifications, audio, personal data or unrelated menu bar items. Convert locally; do not upload raw recordings to a conversion service.
6. Inspect every image and every GIF frame for personal data and unrelated desktop content. Remove unsafe media rather than merely hiding it with a translucent overlay. Strip unnecessary metadata locally.
7. Add the reviewed files here, replace the explicit placeholders in `README.md` with accessible image links/alt text, and record the capture date, commit, sandbox setup and manual checks in the verification record. Images alone do not establish feature parity.

For iPhone media, the owner should use synthetic Scriptable data on a test setup, crop to the relevant widgets and remove personal wallpaper/status details. Never migrate or overwrite real phone data just to stage a screenshot.
