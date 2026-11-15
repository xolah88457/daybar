# Pure-core implementation report

## Delivered

The existing partial implementation was inspected and retained, not replaced. All named exports and return shapes in `docs/CORE_API.md` are implemented and re-exported by `packages/core/src/index.ts`; no fixed signature changed. Production core has no file, network, DOM or OS access. Mutations return independent objects; clock-sensitive functions accept `now` (the documented optional `parseWhen` parameter retains its default for compatibility; callers should pass it).

- Local-calendar date helpers; row-major display arrays whose dates advance column-major; fixed-range padding and rolling newest-day placement.
- Exact legacy interpolation, opacity, stats and countdown math; legacy array normalization; active-task filtering, percentage task rates, current/longest streaks, immutable history rename.
- Focus baseline migration, session-start keyed ledger, idempotent settlement, whole-minute/capped early stops, breaks, block totals, tagged thresholds, clamped countdown, room-before-bed and immutable tag rename.
- Circular sleep math, parsing, date resolution, merged >=3-hour sessions with <=2-hour gaps, wake/bed averages, plan progression/preview/start/stop/clear, cross-midnight logging, estimated/logged current state, phases/progress/status and no-phone confirmation.

Additional exports: `renameTask`, `getFocusBlocks`, `renameFocusTask`, `startSleepPlan`, `stopSleepPlan`, `clearSleep`, `needsFocusConfirmation`.

## Verification

Executed successfully after final edits:

```sh
pnpm --filter @daybar/core typecheck
TZ=America/Toronto pnpm --filter @daybar/core test
TZ=Europe/London pnpm --filter @daybar/core test
pnpm exec eslint packages/core/src/{dates,habits,focus,sleep,index}.ts packages/core/tests/legacy-harness.ts packages/core/tests/{golden-grids,focus,sleep,habits}.test.ts
```

Both timezone runs pass **120 tests in 5 files** (including the pre-existing contract tests). Dependencies were already installed; no install or lockfile change was needed.

The golden harness parses each actual legacy source with TypeScript's AST and executes its function declarations in a Node VM; it does not replace the legacy mathematics with copied expected implementations. Fixed Date/Date.now and DateFormatter stubs, in-memory storage and widget-recording stubs make results reproducible without Scriptable or real files. Fixture cases cover Toronto/London spring/fall DST, midnight, before/after ranges, empty logs, legacy arrays, variable task counts/completion thresholds, partial colors, focus stops/settlement across midnight, circular midnight means, time-only/ISO/AM-PM inputs, sleep merge boundaries, estimates and custom settings. Other tests cover additions and immutability/idempotency.

## Preserved legacy quirks

- `daysBetween` rounds elapsed local-midnight milliseconds / 86400000. Countdown today's fraction also divides by 86400000, not the actual DST day's duration: on a 25-hour day today's opacity may exceed 1. Percent after the end can briefly be below 100 because the original formula uses `elapsed - 1 + fraction`; retained and golden-tested.
- `addDays` resets the clock to midnight. Consequently `resolveDates` resets a time-only entry rolled into the previous day to midnight. This surprising legacy behavior is explicitly tested, not silently fixed. A future correction should change both phone and core deliberately.
- `recentAvg` uses the last N logged keys, not the last N calendar dates. `currentState` inspects the last three wake keys, as the original does.
- Current streak excludes an unfinished today until tomorrow; fixed-range streaks are measured at the range end after the range finishes. Task rates are percentages (0–100), using elapsed days including today.

## Intentional safety/improvement differences

- Input boundary schemas/helpers reject invalid dates, nonfinite values and invalid timers instead of silently resetting data; no caller-owned input is modified.
- Ledger idempotency and legacy-baseline preservation intentionally replace the legacy non-idempotent credit operation. Expired Stop credits the session's end date, matching settlement that the legacy UI normally runs before presenting Stop.
- Starting over an active timer or reusing an already-recorded start timestamp throws rather than losing/overwriting credit.
- Rolling habit/focus slot counts are capped when a large configured gap would otherwise yield zero/negative cell widths. Normal legacy settings produce identical grids. Fixed grids retain the legacy minimum 3px cell size and may require UI horizontal overflow for large ranges.
- Tagged-task accumulation uses Map, including valid task names such as `constructor`.

## API/contract coordination

No blocking contract/API correction is required. Suggested documentation clarifications (not changed here because owned by the orchestrator):

1. Grid width means **content width**, excluding caller-owned padding (legacy medium widget: 354 - 24 = 330).
2. `taskRates` values are percentages; current streak has the unfinished-today convention above.
3. `getSleepView.color` can express only a hex color. Legacy sleeping progress uses white **at opacity 0.4**; the UI should apply that opacity when `asleep` is true, or a future API can add a separate opacity field. Hex color parity is tested.
4. Keep the documented optional `parseWhen` clock parameter for compatibility; always pass `now` for deterministic application/test use.

No real iCloud path was accessed. This core-only task did not run desktop UI, Rust, notifications or a release build; those remain integration-worker checks.
