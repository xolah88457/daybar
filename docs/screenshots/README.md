# Portfolio media

The Today hero is an actual Playwright screenshot of the static export, captured at 1280 px with the in-memory browser client and synthetic data. Browser smoke covered six screens and responsive widths; this image is not native-window or sync evidence.

`menu-bar.gif` is an actual native Daybar popup-window capture sequence, 546×780, with four sampled states (idle, active focus, stopped, task unchecked), two seconds each. It contains synthetic data and no other app content. It is not a continuous recording, and does not prove a live countdown or countdown timing. The owner-supplied iPhone image is unavailable; retain the placeholder.

| Asset | Status | Content |
| --- | --- | --- |
| `today.png` | CAPTURED — browser demo | Static-export Today UI; synthetic in-memory data, no personal files |
| `menu-bar.gif` | CAPTURED — native popup states | Four actual Daybar popup-window states, 546×780, 2 seconds each; synthetic data, not continuous/countdown proof |
| iPhone widget image (filename TBD) | OWNER-SUPPLIED PLACEHOLDER | Unavailable; owner must supply and review/redact before publishing |

## Safe capture procedure

1. For any recapture, run `pnpm seed` from the repository root; use only synthetic `.dev-data/` fixtures. Do not select, browse, read or modify a real iCloud folder or enter real personal data.
2. Confirm Settings points at the sandbox. If isolation cannot be demonstrated, stop.
3. Use a clean desktop or disposable macOS account. Close unrelated windows and hide desktop items; keep personal menu-bar content out of captures.
4. Capture only the Daybar window or Daybar-owned popup content. Do not capture a full desktop or other apps.
5. Inspect every image and GIF frame for personal data and unrelated content. Remove unsafe media; strip unnecessary metadata locally.
6. Record capture date, commit, sandbox setup and manual checks in the verification record. Images alone do not establish feature parity.

For iPhone media, the owner should use synthetic Scriptable data on a test setup, crop to the relevant widgets and remove personal wallpaper/status details. Never migrate or overwrite real phone data just to stage a screenshot.
