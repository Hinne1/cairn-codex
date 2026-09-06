# Contributing to Cairn Codex

Thank you for helping improve Cairn Codex. This project handles real Grim Dawn
items and save-adjacent files, so correctness and recoverability matter more than
speed of delivery.

Coding agents and contributors using agentic tools must also read `AGENTS.md`
before editing. GitHub issues are the canonical work queue; claim an issue before
starting so parallel work does not overlap.

## Before opening an issue

- Search existing issues and the in-app to-do list.
- Confirm the problem on the newest available beta build.
- For live-transfer problems, stop transferring and preserve the application
  data directory before retrying.
- Do not upload character saves, transfer stashes, the Cairn database, queue
  payloads, receipts, crash dumps, or paths containing personal information to a
  public issue.

The in-app diagnostic export is the preferred starting point. It intentionally
omits item payloads and save contents.

## Development setup

Use Windows x64 with Node.js 22+, the .NET 10 SDK, and Git for Windows.

```powershell
npm.cmd ci
npm.cmd run verify
```

### CI cancellation

CI cancels superseded runs using a workflow-and-full-ref concurrency group.
Different PRs, branches, tags, and workflows remain independent; push and PR
merge-ref checks also remain separate. `npm run test:ci-concurrency` guards this
contract and runs as part of full verification. Release publishing is unchanged.

### Dependency audit

The mandatory `npm run audit:dependencies` gate queries the live
[OSV API](https://google.github.io/osv.dev/api/) for every distinct npm name/version
in `package-lock.json`. The maintainer approved this provider change after npm's own
advisory endpoint repeatedly returned service errors. `npm ci --no-audit` still validates
the unchanged lockfile; it skips only npm's implicit audit, not the blocking OSV gate.
No additional npm version, scanner executable, API key, or system installation is needed.

Coverage includes development, optional, peer, nested, aliased, and other-platform
dependencies, even when they are absent from local `node_modules`. Local/git/workspace
sources or malformed/empty inventories are rejected for explicit review, never skipped.
Only package names and versions are sent to OSV; no saves, source code, or credentials.

OSV matches affected versions; full matching advisories supply GitHub's qualitative
`database_specific.severity`. HIGH/CRITICAL findings return 1. LOW/MODERATE findings
are reported without blocking; withdrawn advisories are identified separately.
Missing/unknown severity, mismatched advisory identity, incomplete batches, malformed
responses, and service errors return 2: **not a clean security verdict**. Outer launchers
may normalize failure exit codes; the FAILED/UNAVAILABLE log labels remain distinct.

Every request has a 15-second deadline and at most one retry. The whole audit has a
two-minute deadline, with a three-minute CI step limit. Response size, batch size and
pagination are bounded; exceeding a limit fails closed. No persistent/offline advisory
cache or npm settings can suppress the live lookup. A later service failure never
falls back to a previous clean result or retries away known findings.

Local verification:

```powershell
npm.cmd run test:dependency-audit
npm.cmd run test:dependency-audit:live
npm.cmd run audit:dependencies
```

CI runs known-vulnerable and patched minimist controls before the real lockfile audit,
then proceeds to `npm run verify` only on success. Offline contract tests also run in
full verification, but are not a dependency-security verdict. A new advisory affecting
the patched control will intentionally require investigation, not an automatic exception.
The provider's coverage differs from npm's own audit; this is explicitly an OSV verdict.

The tag release workflow runs those same blocking controls and live audit before
verification, packaging, or publication; a separate CI run is not its security gate.
`test:release-policy` locks the ordering and failure semantics in both workflows.
Build-only packaging always passes `--publish never` to electron-builder, including
when the host has a tag and inherited GitHub credentials. Only the explicit final
release workflow step publishes the audited artifacts.

For installed-game integration checks:

```powershell
npm.cmd run smoke:desktop
```

This smoke suite uses an in-memory database and disposable transaction fixtures.
Character-save checks generate encrypted SC/HC fixtures for supported data versions,
including skills, factions, checksums, truncation and missing saves. They run in the
helper self-tests and desktop smoke; neither requires a named personal character or
particular build. Desktop smoke still requires an installed game's catalog and
retains its installation/catalog assertions.
The older integration assertions still require a populated transfer stash with a
trusted roll-analysis copy and a learned Softcore Abyssal Mask blueprint. Those
save inputs are read only; a successful run does not yet qualify an account with
no saves. Removing those remaining prerequisites is tracked separately from the
generated character-reader checks.
UI verification uses `npm.cmd run build:verification`; production builds exclude
its fixture factories and interaction drivers. See the
[Electron verification boundary](docs/architecture/verification.md) for launch
commands, isolated profiles, and installed-package diagnostics.
Never point test code at a writable personal stash unless the test is explicitly
part of the documented manual live matrix.

## Change guidelines

Local release preparation never runs the production installer. Use
`npm.cmd run test:installer-safety` for synthetic safety checks and follow
[installer qualification](docs/installer-qualification.md) in a fresh disposable
Windows VM for the real lifecycle. `/D` and a custom user-data path alone do not
isolate production installation, shortcut, process or default profile effects.

- Keep the renderer behind the typed preload API. It must not gain direct
  filesystem or database access.
- Preserve fail-closed behavior for unknown game, hook, and injector hashes.
- Do not weaken source-hash checks, atomic replacement, reparsing, backup
  verification, queue receipts, or journal transitions.
- Treat SC and HC identity as part of every stored item and operation.
- Keep full item serialization intact even when a UI feature uses only a subset.
- Follow the [product naming convention](docs/product-copy.md) in user-facing copy:
  use Cairn Codex as the product name, CC as the application actor, and Cairn only
  for genuine Grim Dawn lore.
- Do not commit extracted Grim Dawn databases, archives, icons, maps, saves,
  personal application data, credentials, or machine-specific paths.
- Retain upstream copyright and MIT notices in reused GDIA-derived code.

## Pull-request checklist

- [ ] The change is focused and documented.
- [ ] `npm.cmd run verify` passes.
- [ ] UI changes were checked at multiple window sizes and zoom levels.
- [ ] Changed controls retain accessible names, selected state, keyboard focus, and one error announcement owner; meaningful metadata meets the shared contrast contract.
- [ ] Database changes are idempotent when a profile is reopened.
- [ ] Transfer changes include rejection, timeout, retry, and uncertain-outcome
      behavior—not only the happy path.
- [ ] No personal data, game assets, secrets, generated packages, or local caches
      are tracked.
- [ ] Relevant architecture, compatibility, or recovery documentation is updated.

## Commit style

Use short imperative subjects, for example:

```text
Preserve queued delivery state across restart
```

Explain safety-sensitive reasoning in the commit body when the diff alone does
not make the invariant obvious.
