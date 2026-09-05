# Verified Grim Dawn file transactions

Real Grim Dawn writes are available only through the journaled ingest and
retrieval orchestrators. Both use the reusable transaction primitive and a
replaceable safety gate; ordinary scans and browsing remain read-only.

The MVP safety gate refuses permission while either Grim Dawn or IAGrim is
running. This is checked in the helper immediately before each write, not
only in the UI. A later live-game integration may replace the gate without
changing transaction semantics.

The verified replacement sequence is:

1. Require a safety permit.
2. Hash the source and compare it with the hash captured by the operation.
3. Create a timestamped, independently retained backup and flush it to disk.
4. Verify the backup hash.
5. Write a unique temporary file beside the target and flush it to disk.
6. Run the format-specific parser/validator against the temporary file.
7. Rehash the source to reject changes during preparation.
8. Atomically replace the target while retaining the filesystem rollback copy.
9. Verify that the committed target hash matches the validated temporary file.

The desktop smoke test invokes a helper self-test that performs this sequence
only in a uniquely named temporary directory. It verifies the durable backup,
atomic rollback copy, and final bytes. It also proves that a stale source hash
and a rejected replacement leave the target unchanged.

The imported GDIA DataBuffer write methods are exposed only through the narrow
stash serializer and verified transaction boundary. They passed in-memory
semantic and deterministic round trips for all discovered v4, v5, and v11
files. A first journaled two-item v11 ingest was then accepted by Grim Dawn:
the game loaded the rewritten stash, the designated tab was empty, and all
other tabs remained intact. Its durable backup and filesystem rollback copy
were independently hash-verified and retained.

The in-memory ingest planner now proves the item-removal transformation
separately from the file transaction. The smoke suite successfully plans one
item from each of the five non-empty discovered stashes and verifies exact
item-count reduction, remaining-item equivalence, a complete vault payload,
and deterministic replacement bytes. The sixth discovered stash is empty.

Retrieval uses the same transaction. Before a write, the desktop loads complete
vault payloads from SQLite, requires each item to be in `ingested` state, and
persists both the journal entry and `retrieval_pending` transitions in one
transaction. The helper requires an empty target tab for the first milestone,
reconstructs every serialized field and coordinate, and validates the exact
item-count increase. After the stash commit is independently rescanned, SQLite
advances the items to `retrieved`. If file commit succeeds but database
finalization fails, the journal and item states remain marked
`needs_recovery`/`retrieval_pending` instead of falsely reporting failure or
making the items available twice. This conservative state is also used when a
commit request was sent but its response was lost, because the file outcome is
then unknown until hashes and stash contents are audited.

Live multi-selection prepares one operation and marks its selected archive copies
pending before enqueueing them. The service retains each returned queue receipt,
waits for terminal outcomes for the batch, and commits mixed deposited/rejected
outcomes atomically. Deposited copies become retrieved; rejected copies become
available only through receipt finalization. An uncertain batch stays pending
and prevents another transfer. The older per-item orchestration has no callers
and has been removed.

## Concrete desktop adapters

`src/main/transfers/` contains the production adapters, independently importable
without Electron startup: offline transactions, incoming ingestion, generated
deliveries, live retrieval service bindings, and retained-receipt recovery.
Their dependencies name the helper request capability, narrow repository methods,
backup/receipt directories, clock and diagnostic sink. Bootstrap supplies platform
paths and owns process lifetime; the adapters do not discover app directories.

The offline writer receives the complete approval from `ArchiveDomainService`:
source path/hash, selected indexes/seeds, and target tab or vault IDs. It snapshots
that approval and validates the helper plan against it before dispatch. It does
not run another staging-tab policy path that could silently approve newer data.
The explicit operational ingest, retrieval and planning commands use these same
adapters and retain their console result formats.

Both offline ingest and retrieval retain `needs_recovery` after a dispatched
commit loses its response or fails subsequent verification/finalization. Ingest
keeps exact payloads in `pending_ingest_item`; retrieval keeps archive copies
unavailable in `retrieval_pending`. A received commit transaction is persisted
before rescanning, including backup and rollback paths. Archive finalization
occurs after that rescan succeeds. Recovery requires an audit of retained hashes,
payloads and receipts; it never automatically repeats the save write.

`npm run test:transfer-adapters` exercises the actual adapters, domain policies
and SQLite implementation using generated payloads, disposable databases and
an injected helper/clock. It covers stale approvals, rejected writes, lost
responses, post-commit failures, repeated submission, mixed receipts, restart
and coordinator shutdown. Helper self-tests separately exercise atomic file
replacement. These checks do not replace the live release matrix in issue #8.
Additional pre-existing live dispatch/acknowledgement failure windows identified
during extraction are tracked in issue #165.

The matching two-item v11 retrieval has now also been accepted by Grim Dawn.
The game displayed both exact retrieved instances in the designated tab and
left every other tab intact. The committed stash contained 210 items, including
the two expected roll seeds; its pre-retrieval durable backup and atomic
rollback copy were independently verified against the original source hash and
retained.
