# Public beta release gates

Cairn Codex is not considered releasable merely because the UI builds. A public
beta candidate must satisfy every required gate below. Automatic updates are deliberately
deferred until after the beta has real users. Authenticode signing is also deferred for the
initial beta: every Cairn-produced executable and native library remains unsigned, and the
release harness fails on a mixed signing state and records that policy in the manifest. Adopting
signing requires one consistent trusted publisher identity across the installer, app, helper,
injector, and hook, plus deliberate post-signature fingerprint and clean-machine validation.

## External tester gate

Before sending a build to a new tester with a large Item Assistant archive:

- [x] Import and repeat-import 20,000 synthetic mixed-mode copies without duplicates or source mutation.
- [x] Replace the current full-archive/24-copy roll-hydration loop with a bounded background job.
- [x] Page Transfers, quarantine, and operation histories; never mount the full archive.
- [x] Persist redacted rotating logs and export them in a support bundle with correlation IDs.
- [x] Provide Item Assistant import preflight, named progress, safe confirmation-only cancellation, a durable summary, and first-run guidance.
- [x] Deduplicate unchanged Item Assistant source backups and preflight free disk space.

The measured evidence and product/architecture follow-up are tracked in
`docs/test-matrix.md` and `docs/roadmap.md`.

## Source and provenance

- [x] The application has an explicit license.
- [x] Third-party licenses and imported GDIA provenance are documented.
- [x] The exact native hook changes are reproducible from the pinned upstream
      commit; the checked-in DLL is not the only copy of Cairn's modifications.
- [x] A clean history and tracked-file audit finds no user saves, databases,
      caches, game assets, credentials, or machine-specific paths.
- [x] The README identifies Cairn Codex as an unofficial community project that
      is not affiliated with or endorsed by Crate Entertainment.

## Build and package

- [x] TypeScript and Vue production builds pass.
- [x] The packaged helper is self-contained and does not require a separately
      installed .NET runtime.
- [x] The installer embeds and verifies the Microsoft-signed x64 Visual C++ runtime
      required by the native hook/injector; portable builds retain the same explicit
      prerequisite and diagnose it before live injection.
- [x] CI builds both runtimes and runs the game-independent safety self-tests.
- [x] A versioned ZIP and SHA-256 checksum are produced from a clean checkout.
- [x] The release manifest records the explicit unsigned-beta Authenticode policy and the
      release harness rejects a partially or unexpectedly signed Cairn binary.
- [x] Package contents include the project license, third-party notices, and no
      extracted Grim Dawn assets or personal application data.
- [x] The release artifact starts on a clean supported Windows installation.

## First run and compatibility

- [x] Test no prior Cairn database, no GDIA install, and no development SDKs.
- [x] Test a non-default Steam library and missing/partial expansion layouts.
- [x] Test Softcore-only, Hardcore-only, and both save populations.
- [x] Test user-facing Item Assistant migration with SC-only, HC-only, mixed,
      repeated import, retained queue receipts, and unsupported catalog records.
- [x] Missing Grim Dawn, missing saves, or an unsupported game build produces an
      actionable status rather than a blank or permanently loading application.
- [x] Live transfers remain opt-in and fail closed for unknown binary hashes.

## Data safety

- [ ] Exercise offline and live ingest/retrieve round trips with known sacrificial
      items and verify seeds, affixes, stack counts, and archive state.
- [ ] Exercise a full destination, repeated submit, process exit, helper timeout,
      source hash change, interrupted batch, and stale queue receipt.
- [x] Verify that an uncertain write remains recoverable and is never reported as
      an ordinary success or ordinary failure.
- [x] Verify rotating archive snapshots, staged restore, emergency pre-restore
      preservation, backup discovery, and the user-facing recovery procedure.
- [x] Run a duplication audit across retries and application restarts.

Detailed automated evidence and the per-build manual live checklist live in
`docs/test-matrix.md`.

## Release communication

- [x] Publish a compatibility matrix and known limitations.
- [x] Explain where user data, backups, receipts, logs, and quarantine live.
- [x] Provide a private reporting route for save-data and injection issues.
- [x] Mark live transfer support experimental in the first public beta.
