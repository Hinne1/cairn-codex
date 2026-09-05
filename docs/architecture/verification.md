# Electron verification boundary

The production entry is `src/main/index.ts`. It starts the application assembled in
`src/main/bootstrap.ts`. Synthetic catalog construction, desktop smoke assertions,
native input checks, glossary assertions, and UI interaction drivers live in
`src/verification/`. The verification entry injects typed hooks into the same
bootstrap and uses the real preload, renderer, database, and domain services.

`npm run build` writes the production application to `out/`. It rejects any
verification module in the resolved main, preload, or renderer dependency graph,
then audits emitted JavaScript. Both loose and ASAR package audits check for
verification paths and fixture/driver bodies. A negative-control test imports a
fixture indirectly through another module and requires the actual bundler to fail.

`npm run build:verification` writes a separate application to
`local-cache/verification-build/`. This directory is outside the paths copied by
the portable and installer packaging scripts. The verification entry requires an
explicit isolated user-data directory for window tests. Its application root is
the repository root, so it resolves the same helper build and icons as development.

`npm run verify` builds and audits production, builds verification, and runs the
existing Electron scenarios with the verification entry. `benchmark-ui.mjs
--electron-source` selects it; fixture names, timing reports, DOM measurements,
large-data scenarios, and native input assertions are retained. Standalone
interaction runs require `npm run build:verification` and `npm run build:helper`
first. `test-dismantling-preview.mjs --base-db <disposable snapshot>` also uses this
entry. It no longer accepts a release executable as an interaction driver.

Release applications retain read-only screenshot diagnostics, startup timings,
route selection, viewport sizing, and deliberate operational environment commands
for import, ingest, retrieval planning, and retrieval. Packaged startup benchmarks
use `benchmark-ui.mjs --app <executable> --diagnostic-only --base-profile
<disposable profile>`, optionally with a warm-start budget or typed route hash.
Unsupported interaction options fail at launch instead of producing an untested
success report. `--electron-source --production-entry --diagnostic-only` exercises
the normal development production build with the same diagnostic path.

Visual diagnostics return a disabled live status without inspecting the native
adapter. Periodic sync is a no-op; live mutation endpoints reject requests. The
shared transfer coordinator also rejects diagnostic transfers before reconciling
retained receipts, including requests arriving through offline IPC. Diagnostic
recovery-status reads return the committed summary without reconciling its receipts.
Diagnostic launchers discard inherited operational commands and archive destination overrides;
the installer restores its caller's environment after the isolated process exits.

The installer lifecycle test still launches the actual installed executable. Its
profile starts with an externally generated synthetic catalog cache and uses a
Settings route; no fixture factory is embedded in the release. Profile seeding
refuses existing application data and paths outside the repository's `local-cache`.
The uninstall sentinel check is unchanged.

`smoke:desktop` builds and invokes the dedicated smoke entry. This extraction does
not resolve the pre-existing installed-game/personal-character assumptions tracked
in #124, or establish new live-write compatibility evidence. Do not run those
scenarios against personal saves without the exact authorization required by
`AGENTS.md`.
