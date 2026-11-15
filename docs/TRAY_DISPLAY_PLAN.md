# Menu-bar display follow-up

User asks to customize the native menu-bar label rather than always seeing time until bed. Implement one selection, not rotation or custom templates.

## Contract and scope

- Add app-local `Preferences.trayDisplay`, strict enum with missing-value default `auto`, mirrored in Zod, generated preferences schema and Rust serde/validation. Do not add this to phone/shared settings or change IPC method names.
- Values: `auto`, `focusMinutes`, `focusHours`, `focusBlocks`, `activeTimer`, `bedtime`, `nextTask`, `countdown`.
- `auto` preserves current timer-first/bedtime behavior exactly. Explicit selections stay selected while other activities occur.
- Minutes/hours/blocks use **today's credited totals**, matching the Focus screen; no speculative live credit. Example labels: `85 min`, `1h 25m`, `3 blocks`.
- `activeTimer` covers both focus and breaks, with their remaining time; idle is clearly labeled rather than stale. Reuse existing clamped timer formatting.
- `bedtime` reuses existing sleep-state logic. Do not alter sleep algorithms.
- `nextTask` is the first unfinished active task in configured order today. Handle all done/no tasks/outside habit dates clearly. Bound long labels without altering stored task names; keep full information available in existing task menu/tooltip where practical.
- `countdown` matches core Countdown's **remaining** count, not a newly invented inclusive count: currently 228 days. Before the start cap at inclusive total; on/after the end zero. No goal title in the label.
- Add a labeled dropdown to On this Mac preferences, explain credited totals and Mac-only behavior. Current default stays Auto. Browser demo remains theme-only: reject native tray preference changes without file/OS effects.
- Preserve theme round trips, folder consent, ten confirmation guards, global shortcut, menu actions and one-second native refresh. No new dependencies or configurable polling.

## Verification and ownership

Flat isolated coder owns the minimal TS/Rust preference/runtime/UI changes and relevant tests. No child agents, provider changes, installs, Git mutations or real iCloud access. Parent commits/integrates/builds.

Test all mode labels with explicit times, partial/expired/idle timers, midnight, no history, task ordering/all done/long Unicode labels, countdown before/start/end/after, missing/invalid enum, UI saved selection and browser demo rejection. Reuse existing math and fixtures. Maintain the accepted Day/Night/Auto/navigation/layout/confirmation behavior.
