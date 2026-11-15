# UI refinement contract handoff

## Shared contract

- Added `Preferences.themeMode` with the exact values `day`, `night`, and `auto`; missing values resolve to `night`. TypeScript/Zod rejects other values, and Rust serde uses the same lowercase enum representation, rejects unknown modes, and defaults absent persisted fields to `night`.
- The TypeScript `Preferences` type and `preferences.schema.json` include the new required serialized field; generated schemas now include preferences.
- Preserved preference validation, folder consent, and client methods. Theme-only handling remains the UI/demo integration's responsibility.

## Fictional defaults and fixture mapping

- Countdown: start `2026-10-01`, end `2027-07-01`, title `Community Garden Opening`.
- Habits start `2026-11-01`; stable `logId` remains `Daily_Tasks`.
- Task order/mapping: `Read a chapter`, `Sketch a scene`, `Take a walk`, `Water the plants` replace Coursework, Live Trading, Trade Review, and Apostles work respectively.
- Updated matching TypeScript/Zod and Rust native defaults, core settings fixture and daily-log fixture. Focus/sleep fixtures have no fictional task labels and already use dates inside the sample period, so remain unchanged. Historical golden cases and all five `legacy/` originals remain untouched.
- Core calculations and consent/focus/recovery protections were not changed.

## Verification

- Core tests: 138 passed in both `America/Toronto` and `Europe/London`.
- Core TypeScript typecheck and ESLint on changed core TS/script files passed.
- Rust tests: 30 passed with `PATH=$HOME/.cargo/bin:$PATH` and shared `CARGO_TARGET_DIR`.

## UI integration

The UI agent should consume `Preferences.themeMode` (`day | night | auto`, default `night`) and the fictional defaults above. Auto-mode behavior/system-appearance subscription and visible label mapping are frontend work. Active sandbox reset, full desktop/browser checks, media refresh, and release builds remain with main. Desktop typecheck was not run because its UI fixture is owned by the UI agent.
