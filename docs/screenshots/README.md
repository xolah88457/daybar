# Portfolio media

The Daybar ad replaced the earlier screenshots (`today.png`, `today-day.png` and `menu-bar.gif`, captured 2026-11-15 from the native build). They are still in git history if you need them.

| Asset | Actual content |
| --- | --- |
| `daybar-ad.mp4` | 48-second 1920×1080, 30 fps ad with a synthesized soundtrack, made 2026-11-20 from the browser build's fictional in-memory demo data. No real iCloud folder, calendar or personal data is involved. |
| `daybar-ad-poster.jpg` | A frame from the ad at 7.6 s, used in the main README as a link to the video. |
| `ad/` | The source that renders the ad (see below). |
| iPhone image | **OWNER-SUPPLIED PLACEHOLDER:** unavailable; not fabricated |

## What the ad shows, and what it doesn't

- The window content is the real app UI (the static browser build), driven by real clicks: ticking habits, starting a focus block, opening Deadline Radar, switching Day and Night.
- The app font is DejaVu Sans Mono, which Menlo (the font Daybar uses on macOS) is based on.
- The backdrop, window frame, headlines, camera moves and cursor are added by the stage page.
- The "Menu bar" chip mirrors the app's live timer as an illustration. It is not a capture of the macOS menu bar.
- The iPhone widgets are described, not shown. Sync between devices is not demonstrated.

## How it is made

- `ad/stage.html` holds the live app in an iframe inside the designed stage, and describes the scenes: camera keyframes, cursor path, click times and text timing.
- `ad/render.js` renders the stage frame by frame on Playwright's fake clock, so the app's timers advance exactly 1/30 s per frame and the focus timer counts at real speed.
- `ad/music.py` synthesizes the soundtrack: pad chords that change with each scene, a quiet arpeggio, UI clicks on the on-screen clicks, and a chime on the logo.

To re-render after UI changes:

```bash
pnpm build
```
```bash
(cd apps/desktop/out && python3 -m http.server 4173) &
```
```bash
node docs/screenshots/ad/render.js frames
```
```bash
python3 docs/screenshots/ad/music.py music.wav
```
```bash
ffmpeg -framerate 30 -i frames/%05d.jpg -i music.wav -c:v libx264 -preset slow -crf 19 -tune animation -pix_fmt yuv420p -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 192k -shortest -movflags +faststart docs/screenshots/daybar-ad.mp4
```

If the layout changes, check the scene timing in `stage.html` and the click times in `render.js`, which must match. Inspect a contact sheet of the frames before publishing.

## Safe capture rules

1. Use only the browser build's in-memory demo data or known synthetic sandbox files. Never point a capture at a real iCloud folder.
2. Show only Daybar. Never capture the desktop, other apps, or a Settings page with a personal folder path.
3. Don't turn an image or video into an unsupported sync, notification or timing claim.

The owner should supply iPhone media from a disposable fictional-data setup, cropped and redacted before publishing. Never overwrite real phone history to stage an image.
