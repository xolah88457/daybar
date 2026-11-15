# Requested UI refinements

User follow-up: bare 1–6 category navigation, fictional sample content, day/night controls, and monitor-aware card layout. The user selected **Follow macOS Auto** and authorized working providers after configured Sonnet/Gemini routes failed with quota errors. Do not use RP/GPT or ZAI/GLM routes, including nested scout defaults. Use restricted flat profiles. User-requested ERNIE routes are `cliproxyapi/kilo/baidu/ernie-5.5-flash-preview:free` and `cliproxyapi/openrouter/baidu/ernie-5.5-flash-preview:free`; the former completed the first frontend correction, while the latter returned upstream 429.

## Shared contract

- Add app-local `Preferences.themeMode: 'day' | 'night' | 'auto'`, default `'night'` when absent. Mirror TypeScript/Zod and Rust serde; reject unknown values. This is not a shared phone setting.
- Auto follows system appearance (`prefers-color-scheme`), including subsequent changes. macOS manages its automatic timing; Daybar requests no location or network access. Explain that macOS must be configured for automatic appearance for a system-managed day/night schedule.
- Keep `DaybarClient` methods and real-folder consent/validation unchanged. Browser demo may accept theme-only preference changes in memory, but must still refuse folder/OS-preference changes.

## Fictional examples

Keep four tasks, stable `habits.logId = 'Daily_Tasks'` and existing filenames:

| Original active example | Replacement |
| --- | --- |
| Coursework | Read a chapter |
| Live Trading | Sketch a scene |
| Trade Review | Take a walk |
| Apostles work | Water the plants |
| End of University | Community Garden Opening |

Use generic countdown dates 2026-10-01 through 2027-07-01 and habit start 2026-11-01. Map artificial fixture/demo task tags/history consistently. All five `legacy/` originals remain byte-identical; explicit historical compatibility tests may retain old names. Do not silently rename real user history. Main alone backs up and replaces known development/app-local **sandbox** files; no real iCloud reads or writes.

## UI behavior

- Bare 1–6 selects Today/Countdown/Habits/Focus/Sleep/Settings. Existing Cmd/Ctrl navigation and focus shortcuts keep working. Do not intercept editable fields/descendants, composition, active dialogs or unrelated modifier shortcuts.
- Add an accessible day/night toggle and Day/Night/Auto preference. Preserve the shared confirmation error boundary at all ten gates, including nested real-folder preferences.
- Portrait: readable sequential single-column cards. Landscape: compact grid that fits Today on practical desktop sizes where possible. Do not force long Settings/forms or tiny windows to fit by clipping content or reducing controls/text below usable sizes. Preserve necessary overflow as a fallback.
- Light mode must have readable controls, grids, heatmaps and empty cells. Do not persist theme-only visual transformations into shared settings or alter core mathematical behavior.

## Ownership and verification

- Contracts/examples agent owns core contracts/defaults/schemas/fixtures/core tests and Rust preference/default plumbing plus relevant tests; no desktop source/test edits.
- UI agent owns all desktop frontend source/tests/styles and demo client, including navigation, keyboard help and fictional visible examples; no core/Rust/config edits.
- Main integrates commits, updates existing sandbox data with backups, refreshes old-label media, runs full timezone/browser/native checks and rebuilds the unsigned release.
- Use proper workspace Vitest configuration, not bare root Vitest. No worker starts Next/Tauri builds; main serializes exports and packaging.
