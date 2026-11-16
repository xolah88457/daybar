# Core calculation conventions

`@daybar/core` (`packages/core/src`) is pure: no file, network, DOM or OS access. Exact signatures live in the source; this page records the conventions behind them. Types and schemas come from `@daybar/core/contracts`.

| Module | Contents |
| --- | --- |
| `dates.ts` | Local-calendar day keys and date arithmetic |
| `habits.ts` | Day colors, daily-log normalization/rename, habit stats, habit and countdown grids |
| `focus.ts` | Focus ledger: normalize, settle, start, stop, countdown text, room before bed, tagged-task thresholds, block cells, tag rename |
| `sleep.ts` | Circular time math, `parseWhen`/`resolveDates`/`findSleepSessions` parsing, averages, plan shifting, current state and view, logging and plan start/stop/clear, no-phone confirmation |

## Conventions
- Pass an explicit `now: Date` everywhere. `parseWhen` keeps an optional `now` default for compatibility; always pass it in application code and tests.
- Focus and sleep helpers return new data and never mutate their arguments. Inputs are validated at the boundary: invalid dates, non-finite numbers and invalid timers throw instead of silently resetting data.
- Grid `cells` are **row-major** for direct CSS grid display, but their dates are **column-major**. `null` cells are blank padding after the range end. Colors are `#rrggbb`; opacity is separate. `width` is *content* width, excluding caller-owned padding (legacy medium widget: 354 - 24 = 330).
- `taskRates` are percentages (0-100), computed over elapsed days including today. `currentStreak` ignores an unfinished today until tomorrow; fixed-range streaks are measured at the range end once the range finishes.
- `getSleepView.color` is hex only. While `asleep`, progress is the configured white at opacity 0.4, which callers apply themselves.
- Ambiguous focus ledgers (a `sessions` map without `baseline` and unexplained saved `days`) fail closed: callers must surface the error and preserve the source bytes for manual recovery. See [DATA_FORMATS](DATA_FORMATS.md#focus-upgrade).

## Legacy parity
The golden tests parse each original script in `legacy/` with TypeScript's AST and execute its function declarations in a Node VM against fixed `Date`/`DateFormatter` stubs; they do not re-implement the legacy math. Fixtures cover Toronto/London DST, midnight, range boundaries and legacy array logs. Quirks preserved on purpose and covered by tests:

- `daysBetween` rounds elapsed local-midnight milliseconds / 86400000. Today's fade in the countdown also divides by 86400000, not the real DST day length: on a 25-hour day today's opacity can exceed 1. Percent after the end can briefly be below 100 because the original formula uses `elapsed - 1 + fraction`.
- `addDays` resets the clock to midnight, so `resolveDates` resets a time-only entry rolled into the previous day to midnight. Fixing this would have to change phone and core together.
- `recentAvg` uses the last N *logged* keys, not the last N calendar dates; `currentState` inspects the last three wake keys, as the original does.

Deliberate differences from legacy:

- Focus credit is idempotent and keyed by session start; legacy `days` are kept as a baseline. An expired Stop credits the session's end date. Starting over an active timer, or reusing a recorded start timestamp, throws rather than losing credit.
- Rolling habit/focus slot counts are capped when a large configured gap would give zero or negative cell widths; normal settings produce identical grids. Fixed grids keep the legacy 3px minimum cell size and may need horizontal overflow for very long ranges.
- Tagged-task accumulation uses a `Map`, so task names such as `constructor` are safe.
