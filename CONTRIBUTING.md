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

### Dependency audit

CI installs npm **11.17.0** independently of the npm bundled with Node 22. This pinned
version uses the supported bulk-advisory endpoint without falling back to the retired
quick-audit endpoint. Installations use `npm ci --no-audit` only to avoid an implicit,
duplicate audit; the separate `npm run audit:dependencies` step remains mandatory.
The lockfile is still validated by `npm ci`, not regenerated to conceal endpoint errors.
The audit explicitly disables offline mode, overriding environment and `.npmrc` settings
that would otherwise let npm report zero findings without contacting the registry.

The audit includes development, optional, and peer dependencies. The wrapper returns 1
for high/critical findings and 2 for unavailable/invalid reports, which **are not a clean
security verdict**. The outer npm/CI launcher may normalize failure to exit 1; use the
explicit `DEPENDENCY AUDIT FAILED` versus `DEPENDENCY AUDIT UNAVAILABLE` log messages
to distinguish these outcomes.
Each attempt has a 210-second process deadline and a 180-second fetch timeout, with one
bounded retry only for unavailable results. CI also caps the step at eight minutes.
This allows the approximately 175-second successful audit observed on a clean Windows
runner without inheriting npm's default retry delays.
No vulnerability finding is retried away or marked successful. Report-validation and
timeout/error contracts run in `test:dependency-audit` and the full verification suite.

For local auditing without changing your system npm:

```powershell
npm.cmd exec --yes --package=npm@11.17.0 -- npm run audit:dependencies
```

See the [npm audit documentation](https://docs.npmjs.com/cli/audit/) for the advisory
protocol. A healthy registry and a successful clean-runner audit remain required evidence;
passing the offline wrapper tests alone does not establish dependency security.

For installed-game integration checks:

```powershell
npm.cmd run smoke:desktop
```

This smoke suite uses an in-memory database and disposable transaction fixtures.
Never point test code at a writable personal stash unless the test is explicitly
part of the documented manual live matrix.

## Change guidelines

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
