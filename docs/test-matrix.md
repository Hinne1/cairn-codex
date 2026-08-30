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
| Bundled hook/injector fingerprints | helper and package audits | Passed |
| Duplicate vault selection | desktop smoke | Rejected |
| Rejected retrieval state rollback | desktop smoke | Passed |
| Generated personal/special delivery journal | desktop smoke | Committed and rejected outcomes retained; queue identity persisted before acknowledgement |
| Lost helper response after a queued write | desktop smoke | Retained as `needs_recovery`; later writes blocked |
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
| Repeated Item Assistant migration | second packaged import against same target | No duplicate vault item or journal; a second verified backup retained |
| Large-archive startup and search | packaged app, isolated copy of 5,525-item profile | 3.1–3.5 s to rendered collection; 153 ms structured / 164 ms ordinary full-text search including 120 ms debounce |
| Package personal-data/art audit | `scripts/audit-package.mjs` | Passed, 282 files |
| Installer install/first run/uninstall | `npm run test:installer` | Passed; app removed and isolated user data retained |
| Dependency vulnerability audit | `npm audit --audit-level=high` | Passed, 0 vulnerabilities |
| Tracked-file privacy/provenance audit | `npm run audit:repo` | Passed; native fingerprints verified |

The 2026-08-30 installed-game run indexed one installation, two save locations,
six transfer stashes, and 5,525 catalog items. It analyzed 97 owned copies and
withheld no roll scores as untrusted. The same run completed the isolated archive
backup/restore round trip without touching the user archive or game files.

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
| Full shared destination | Batch stops; unacknowledged archive copies remain stored | Pending |
| Full character inventory | Personal delivery is rejected/returned without archive release | Pending |
| Repeated submit | UI/orchestrator produces no duplicate operation or duplicate item | Pending |
| Game exits mid-operation | Outcome remains pending/recoverable, queue payload retained | Pending |
| Cairn exits/restarts mid-operation | Journal and receipt reconcile without duplication | Pending |
| Unsupported game rebuild | Live injection remains blocked; read-only tools still work | Pending |
| Item Assistant migration | Verified backup; SC/HC multiplicity and queue receipts preserved; repeat creates no copies | Automated packaged-app gate passed; user-path confirmation remains optional |

Record the exact app version, game version/build, `Game.dll`, hook, and injector
hashes with the completed manual run. A different hash starts a new matrix.
