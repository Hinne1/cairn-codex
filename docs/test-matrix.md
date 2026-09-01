# Release test matrix

The CI suite is intentionally independent of a Grim Dawn installation. Before a
public tag, the maintainer additionally runs `npm.cmd run test:release-local` on
a supported game installation and records the manual live-transfer results here.

## Automated gates

| Scenario | Evidence | Current result |
| --- | --- | --- |
| TypeScript/Vue production build | `npm run build` | Passed 2026-08-30 |
| Fresh database migration/idempotent reopen | desktop smoke, in-memory database | Passed |
| Atomic replacement, backup, rollback | helper write self-test in a unique temporary directory | Passed |
| Stale source hash | helper write self-test | Rejected without changing source |
| Invalid replacement | helper write self-test | Rejected without changing source |
| Live CSV serialization and semantic receipt hash | helper live-queue self-test | Passed, 18 fields |
| Offline live-queue recovery state machine | helper live-queue self-test with disposable queue root | Passed: pending, deposited, rejected, multi-item, stale semantic hash, and path escape guard |
| Unsupported live build negative control | helper fingerprint self-test | Passed: unknown `Game.dll` hash and known crashing hook fingerprint remain outside the verified allowlist |
| Bundled hook/injector fingerprints | helper and package audits | Passed |
| Duplicate vault selection | desktop smoke | Rejected |
| Rejected retrieval state rollback | desktop smoke | Passed |
| Generated personal/special delivery journal | desktop smoke | Committed and rejected outcomes retained; queue identity persisted before acknowledgement |
| Lost helper response after a queued write | desktop smoke | Retained as `needs_recovery`; later writes blocked |
| Cairn restart after queued retrieval | disposable on-disk archive plus simulated durable deposited receipt | Passed: journal survived close/reopen, exact copy committed once, duplicate submit rejected |
| Grim Dawn exit during multi-supply delivery | simulated offline deposited/rejected receipts | Passed: one delivered and one rejected receipt reconciled to one committed operation; rejected receipt copied before acknowledgement |
| Repeated multi-item live ingest | simulated durable incoming receipts | Passed: two exact copies committed on first sync and zero duplicated on repeat sync |
| Stale or mismatched live receipt | simulated `unknown` semantic receipt state | Passed: operation and copy remain pending for audit; no write is unblocked |
| Database integrity after uncertain outcome | `PRAGMA quick_check` in desktop smoke | Passed |
| Archive backup, rotation, and restart restore | disposable on-disk archive in desktop smoke | Verified snapshot hashes and manifests; selected prior state restored; emergency pre-restore copy retained; invalid pending request quarantined without replacing the current archive |
| Archive roll cache and pinned-best persistence | desktop smoke | Passed |
| All discovered stash serializer round trips | desktop smoke | 6 passed |
| Representative ingest plans | desktop smoke | 5 passed without writing game files |
| Representative ingest/retrieval round trips | desktop smoke | 5 passed in memory |
| Packaged helper with external .NET lookup disabled | packaged-helper smoke | Passed |
| Empty Cairn user profile | packaged screenshot diagnostic | Passed 2026-08-30 |
| Missing game and missing saves | isolated helper discovery roots | Passed; host environment did not leak into result |
| Non-default Steam library and GOG install | synthetic filesystem discovery | Passed |
| Incomplete expansion layout | content-pack layout diagnostic | Safely ignored; recognized after required database and tags were present |
| Softcore-only, Hardcore-only, and mixed saves | isolated malformed-stash diagnostics | Passed; mode remained correctly classified without parsing unsafe bytes |
| Item Assistant migration | packaged app, synthetic GDIA database and queue, copied catalog seed | 4 copies imported (2 SC / 2 HC), 1 queue receipt retained, 1 unsupported record skipped, source unchanged |
| Repeated Item Assistant migration | packaged repeat gate plus isolated content-hash backup test | No duplicate vault item or journal; unchanged source reuses one fully rehashed backup; corrupted backup is rejected and replaced |
| Item Assistant source backup retention | generated source revisions and injected low-space result | Passed 2026-09-01: three distinct verified recovery points retained, latest always preserved, legacy and interrupted-publication backups adopted by hash, unmanaged files preserved, insufficient space rejected before copy |
| Cached startup and search | packaged app, isolated cached 5,525-item profile | **Passed 2026-09-01:** cached paint 1.668 s and interactive 1.724 s; background roll analysis settled at 2.706 s; ordinary search including its 120 ms debounce took 152.3 ms |
| Cold startup and indexing | packaged app, isolated stale-cache 5,525-item profile | **Passed 2026-09-01:** cache miss reported separately; collection scan settled at 42.820 s, first interactive collection at 43.143 s, and roll analysis settled at 44.054 s |
| 20k Item Assistant migration | packaged app, synthetic 20,000-copy mixed-mode database plus queue receipt | Passed 2026-09-01: 20,000 imported in 818 ms; repeat completed in 493 ms with no duplicates; source unchanged; two backups verified (historical baseline before content-hash deduplication) |
| 20k cached startup and archive renderer scale | packaged app, isolated cached 24,514-copy profile | **Passed 2026-09-01:** cached paint 2.544 s and interactive 2.597 s (automated 5 s budget); background roll analysis remained non-blocking; Transfers switches in 33.6 ms and mounts 100 archive rows plus 4 quarantine rows instead of 14,509; search including debounce took 164.5 ms |
| 20k archive roll hydration | packaged app, isolated 20,000 newly unscored copies across SC/HC | **Passed 2026-09-01:** all 24,509 applicable copies ended on roll model v4 with zero missing scores in 81.8 s; batches persisted 256 scores at a time and transmitted the full snapshot only at completion |
| Interrupted archive roll hydration | packaged app terminated during isolated 20k run | **Passed 2026-09-01:** 1,280 newly completed scores remained committed and the next run had exactly 8,720 active-mode copies left to process |
| Package personal-data/art audit | `scripts/audit-package.mjs` | Passed, 282 files |
| Installer install/first run/uninstall | `npm run test:installer` | Passed; app removed and isolated user data retained |
| Dependency vulnerability audit | `npm audit --audit-level=high` | Passed, 0 vulnerabilities |
| Tracked-file privacy/provenance audit | `npm run audit:repo` | Passed; native fingerprints verified |

The 2026-08-30 installed-game run indexed one installation, two save locations,
six transfer stashes, and 5,525 catalog items. It analyzed 97 owned copies and
withheld no roll scores as untrusted. The same run completed the isolated archive
backup/restore round trip without touching the user archive or game files.

The UI benchmark enforces the warm-start budget with
`node scripts/benchmark-ui.mjs --warm-budget-ms 5000`. Cold or stale-cache indexing is
measured as a separate scan phase and is not presented as cached startup latency.

## Manual live-transfer gates

These require Grim Dawn, deliberate sacrificial items, and human confirmation.
They are never inferred from a successful injection handshake.

| Scenario | Required observation | Result for release candidate |
| --- | --- | --- |
| Connect/disconnect | Exact fingerprint, ready handshake, clean disconnect, game survives | Pending |
| Epic/Legendary ingest | One exact item disappears, receipt commits, archive has seed/affixes | Pending |
| Same-copy retrieval | Exact copy returns and remains usable after game save/restart | Pending |
| MI with prefix/suffix and pet stats | Exact affixes, rolls, and pet stats survive round trip | Pending |
| Soulbound augment delivery | Exactly selected augment reaches active character | Pending |
| Multi-select delivery | Only selected records, one each, serialized acknowledgements | Pending |
| Full shared destination | Batch stops; unacknowledged archive copies remain stored | Automated rejected-retrieval rollback passed; live confirmation pending |
| Full character inventory | Personal delivery is rejected/returned without archive release | Automated generated-delivery rejection and partial-batch recovery passed; live confirmation pending |
| Repeated submit | UI/orchestrator produces no duplicate operation or duplicate item | Automated pending-copy and committed-ingest duplicate guards passed; live confirmation pending |
| Game exits mid-operation | Outcome remains pending/recoverable, queue payload retained | Passed live 2026-08-30 for five-item ingest; offline deposited/rejected retrieval and supply reconciliation passed 2026-09-01 |
| Cairn exits/restarts mid-operation | Journal and receipt reconcile without duplication | Automated on-disk close/reopen passed 2026-09-01; live timing confirmation pending |
| Stale or mismatched receipt | Semantic mismatch never commits or releases an archive copy | Automated fail-closed helper and desktop cases passed 2026-09-01 |
| Unsupported game rebuild | Live injection remains blocked; read-only tools still work | Automated fingerprint negative control passed; live confirmation on the next game update pending |
| Item Assistant migration | Verified backup; SC/HC multiplicity and queue receipts preserved; repeat creates no copies | Automated packaged-app gate passed; user-path confirmation remains optional |

Record the exact app version, game version/build, `Game.dll`, hook, and injector
hashes with the completed manual run. A different hash starts a new matrix.

## Recovery expectations

| Operation | Terminal evidence after interruption | Expected archive state |
| --- | --- | --- |
| Live ingestion, one or many | Incoming queue file copied and hash-verified | Each queue identity commits once; a repeated poll only acknowledges the already-committed receipt |
| Archive retrieval | Every retained queue has a matching deposited receipt | Exact pending copies become retrieved once; reusable supplies remain stored |
| Archive retrieval | Every retained queue has a matching rejected receipt | Rejection is copied and acknowledged; every pending copy returns to stored |
| Generated/supply delivery | Deposited and rejected receipts are mixed | Operation commits with exact deposited and rejected counts; no archive copy is released |
| Any live delivery | Outgoing file still exists | Operation stays pending and later writes remain blocked |
| Any live delivery | No matching semantic receipt, including stale content | Operation stays `needs_recovery`; no optimistic commit or rollback occurs |

The automated 2026-09-01 run used Cairn Codex `0.1.0-beta.1`, helper protocol 1,
hook SHA-256 `419b53fdff4e75dafb98f9066a0271da0f0c937b5b02e5beca2e39af527a34c5`,
and injector SHA-256 `569e6bdde51148b29aece0491366e9aa4c21cf2f11279a94c815e2b958cfe10c`.
The live confirmation row must additionally record the exact supported `Game.dll` hash
reported by the support bundle; compatibility remains fail-closed when that fingerprint differs.
