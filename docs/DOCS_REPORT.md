# Documentation and CI handoff

## Delivered

- Preserved and completed the previous worker's `README.md`, MIT `LICENSE`, macOS workflow and safe media instructions.
- README covers the widget-to-desktop story, honest hero/menu GIF/iPhone placeholders, Mermaid boundaries, sandbox-first setup, exact workspace commands, unsigned app opening, explicit real-folder consent/first-write backups, Keep Downloaded and distributed FileManager/iCloud race limits. Links to the phone install guide, architecture/contracts and roadmap are included.
- `docs/VERIFICATION.md` enumerates every §5.2–5.4 and §6.1–6.3 acceptance point as **PENDING**, with intended automated/manual methods; extra rows cover phone integration, packaging and media. Nothing is marked passed by inference.
- CI: macOS 14, Node 22, pnpm 10.12.3, stable Rust; frozen install, synthetic seed, lint, typecheck, Toronto/London Vitest, required phone Node tests, locked Cargo tests and static export. Trusted `v*` tags additionally build unsigned app/DMG and upload separate 14-day Actions artifacts. App bundle is archived with `ditto` to preserve metadata/symlinks. Only `contents: read` is granted; checkout credentials are not persisted. No release-write permission, signing secrets or personal iCloud path is used.
- Only owned documentation/workflow files are included. No orchestrator reports, code, config or lockfiles are changed. Next's generated `next-env.d.ts` build side effect was restored to its original tracked content.

## Executed checks

Executed in the isolated `feature/docs` worktree on foundation commit `e9ba147`, before other feature branches were merged. These checks validate documentation commands and the foundation, **not integrated v1 acceptance**.

Environment: macOS 26.6.2 arm64; Node 22.23.5 (temporary npm-provided binary), pnpm 10.12.3; rustc/Cargo 1.100.0. An initial dependency install and CLI-help query used the system Node 26.13.0; frozen install and all JavaScript checks listed below were then executed with Node 22.

| Check | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS on Node 22; lockfile up to date, no tracked dependency changes. |
| `pnpm seed` and repeat with SHA-256 comparisons | PASS; four synthetic JSON files created, re-seed leaves existing bytes unchanged. |
| `pnpm lint` | PASS. |
| `pnpm typecheck` | PASS for core and desktop. |
| `pnpm test:tz` | PASS: three foundation contract tests in each timezone. Desktop had **no tests**; this does not demonstrate parity/component coverage. |
| `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS: two contract tests, no integration tests; unused-code/dependency warnings remain in foundation. |
| `NEXT_TELEMETRY_DISABLED=1 pnpm build` | PASS; static `apps/desktop/out/index.html` and other export files generated. |
| `pnpm tauri build --help` | PASS; installed CLI confirms `--no-sign` and comma-separated `--bundles app,dmg`. Actual packaging not run here. |
| Ruby Psych YAML parse | PASS; syntax parsed. YAML 1.1 represents the `on` key as boolean, so Actions semantics were checked separately. |
| `actionlint 1.7.7 -shellcheck= -pyflakes= .github/workflows/ci.yml` | PASS; downloaded standalone tool to `/tmp`, no repository dependency added. External shellcheck/pyflakes not run. |
| `bash -n` on every workflow run block | PASS. |
| Workflow phone-test guard with absent files | PASS negative check: exits 1 with explicit error, not a silent skip. |

## Limitations and integration follow-up

- The foundation has no `scriptable/tests/` yet. A direct Node 22 `node --test scriptable/tests/*.test.mjs` unexpectedly exits successfully with **zero tests** when the glob matches nothing; CI therefore explicitly rejects an empty glob. The phone worker must provide `scriptable/tests/*.test.mjs`, or the integration owner must update both CI and docs to its actual test location.
- `scriptable/README.md` is owned by phone integration and absent in this worktree. Keep the root install link; verify it after merge. No phone-device migration or actual iCloud check was attempted.
- `docs/screenshots/today.png` is deliberately a placeholder link; no binary image or GIF has been invented. Main integration will capture synthetic sandbox media. iPhone imagery remains owner-supplied and must be reviewed before publication.
- No GitHub workflow/tag run, unsigned app/DMG packaging, Gatekeeper opening, native UI/tray/notification check or acceptance-ledger scenario was executed by this docs worker. Hosted runner architecture determines artifact architecture; this is not a universal build.
- GitHub Releases are deliberately not created: the brief permits release/upload artifacts, and Actions artifacts satisfy distribution without a repository-write token. They expire after 14 days; durable publication is a separate owner decision.
- No real iCloud path was read, selected or written. First-write backups, malformed-data handling, placeholder downloads and conflict UI are acceptance requirements awaiting backend/UI integration, not verified guarantees.
- Re-run all checks after core/backend/UI/phone merge, then update `docs/VERIFICATION.md` and orchestrator-owned progress with actual evidence. Keep unsupported native/device checks PENDING or BLOCKED.
