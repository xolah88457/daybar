# Daybar UI refinements report

Status: **PASS** for the owned frontend scope.

The task brief referenced `docs/UI_REFINEMENT_PLAN.md`, which is not present in this worktree. I used `docs/UI_REPORT.md`, `docs/REFINEMENT_CONTRACT_REPORT.md`, the current source, and the existing desktop tests as the specification.

## Implemented

- **Appearance preference is effective and persisted through the client.** The header toggle now derives the current appearance from `preferences.themeMode` plus the live system preference, then calls `setPreferences` with the opposite explicit mode. The returned snapshot is applied, so the toggle survives the client round-trip.
- **Auto mode follows the system at runtime.** The dashboard subscribes to `matchMedia('(prefers-color-scheme: dark)')`, applies the initial value, updates on `change`, and removes the listener on unmount.
- **Day projection no longer loses configurable layout or heatmap meaning.** Night mode applies the full settings appearance. Day/Auto-day apply a light palette from CSS while still applying the user's `--cellSize`, `--gap`, and `--radius` layout tokens. Modules receive a shallow visual snapshot whose appearance colors use the day palette; `SettingsPanel` and all `run`/`savePreferences` closures receive the raw snapshot. The previous day `.square { opacity: 1 !important }` override was removed, so core-derived empty/future/completion/today opacities remain intact.
- **Settings exposes Day/Night/Auto.** The Appearance selector is labelled, and saving it uses the app-local `setPreferences` path without changing shared settings.
- **Demo preferences allow theme only.** `createDemoClient.setPreferences` accepts `day`/`night`/`auto` changes in memory and rejects every filesystem or OS preference change (data folder, real-data opt-in, launch at login, hide Dock, global shortcut).
- **Fictional task mapping migrated in frontend tests and browser smoke.** Ordinary examples now use `Read a chapter`, `Sketch a scene`, `Take a walk`, and `Water the plants`. No legacy/core/golden files were changed.
- **Navigation guards expanded in regression tests.** Bare and Ctrl/Cmd+1–6 navigation remain available; typing fields, textarea/select, `role="textbox"`, contenteditable, open dialogs, IME composition, repeat events, Alt, and Shift do not navigate.
- **All ten confirmation gates remain intact.** No `confirmAction`/native error-path code was changed.

## Files changed

- `apps/desktop/src/app/globals.css`
- `apps/desktop/src/components/dashboard.tsx`
- `apps/desktop/src/components/settings.tsx`
- `apps/desktop/src/components/primitives.tsx`
- `apps/desktop/src/lib/demo.ts` (pre-existing owned edit preserved)
- `apps/desktop/tests/browser_smoke.py`
- `apps/desktop/tests/dashboard.test.tsx`
- `apps/desktop/tests/demo.test.ts`
- `apps/desktop/tests/fixtures.ts` (pre-existing owned edit preserved)
- `apps/desktop/tests/ipc.test.ts`
- `apps/desktop/tests/primitives.test.tsx`
- `apps/desktop/tests/settings.test.tsx`
- `docs/REFINEMENT_UI_REPORT.md`

## Verification actually run

- Baseline before edits: `TZ=America/Toronto pnpm --filter @daybar/desktop test` — exit 1; 39 tests, 14 failed, 25 passed (`/tmp/daybar-refinement-ui-ernie-before.log`).
- `pnpm typecheck` — exit 0 (core and desktop).
- `pnpm lint` — exit 0 (full workspace).
- `TZ=America/Toronto pnpm test` — exit 0; **138 core + 48 desktop + 59 phone = 245 tests passed** (`/tmp/daybar-refinement-ui-ernie-test-toronto-full.log`).
- `TZ=Europe/London pnpm test` — exit 0; **138 core + 48 desktop + 59 phone = 245 tests passed** (`/tmp/daybar-refinement-ui-ernie-test-london-full.log`).
- Desktop after changes: 6 test files passed, 48 tests passed. The new frontend tests cover toggle persistence, Settings Auto integration, Auto initial/runtime media changes with listener cleanup, layout-token separation, day heatmap color/opacity preservation, a CSS guard against day opacity overrides, and Settings saves from Day preserving the raw appearance; the existing stale-label failures were migrated rather than weakened.
- Protected `pnpm-lock.yaml` SHA-256 before and after: `6cfe6229783af12c7fb9ddc1abcf8de7c7584e3cddf62aee42140c07d9866992`.

## Not run / limits

- Browser smoke, static Next export, Tauri/native checks, and Rust/Cargo tests were not run in this worker. `apps/desktop/tests/browser_smoke.py` was updated for the fictional task label and a theme-toggle background check, but requires the main branch's static export and Playwright environment.
- Native WKWebView appearance and real macOS Auto behavior remain for the main branch's browser/native gate; jsdom covers state, client calls, MQL changes, cleanup, and attributes, not platform paint.
- No commits, staging, resets, checkouts, installs, or dependency/lockfile changes were made.