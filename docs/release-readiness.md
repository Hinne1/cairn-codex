# Public beta release gates

Cairn Codex is not considered releasable merely because the UI builds. A public
beta candidate must satisfy every required gate below. Code signing and automatic
updates are deliberately deferred until after the beta has real users.

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
- [x] CI builds both runtimes and runs the game-independent safety self-tests.
- [x] A versioned ZIP and SHA-256 checksum are produced from a clean checkout.
- [x] Package contents include the project license, third-party notices, and no
      extracted Grim Dawn assets or personal application data.
- [ ] The release artifact starts on a clean supported Windows installation.

## First run and compatibility

- [ ] Test no prior Cairn database, no GDIA install, and no development SDKs.
- [ ] Test a non-default Steam library and missing/partial expansion installs.
- [ ] Test Softcore-only, Hardcore-only, and both save populations.
- [ ] Test user-facing Item Assistant migration with SC-only, HC-only, mixed,
      repeated import, retained queue receipts, and unsupported catalog records.
- [ ] Missing Grim Dawn, missing saves, or an unsupported game build produces an
      actionable status rather than a blank or permanently loading application.
- [ ] Live transfers remain opt-in and fail closed for unknown binary hashes.

## Data safety

- [ ] Exercise offline and live ingest/retrieve round trips with known sacrificial
      items and verify seeds, affixes, stack counts, and archive state.
- [ ] Exercise a full destination, repeated submit, process exit, helper timeout,
      source hash change, interrupted batch, and stale queue receipt.
- [x] Verify that an uncertain write remains recoverable and is never reported as
      an ordinary success or ordinary failure.
- [x] Verify backup discovery and document a user-facing recovery procedure.
- [ ] Run a duplication audit across retries and application restarts.

Detailed automated evidence and the per-build manual live checklist live in
`docs/test-matrix.md`.

## Release communication

- [x] Publish a compatibility matrix and known limitations.
- [x] Explain where user data, backups, receipts, logs, and quarantine live.
- [x] Provide a private reporting route for save-data and injection issues.
- [x] Mark live transfer support experimental in the first public beta.
