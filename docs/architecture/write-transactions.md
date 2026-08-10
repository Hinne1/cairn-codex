# Verified Grim Dawn file transactions

No real Grim Dawn write is enabled yet. Milestone 2 begins with a reusable
transaction primitive and a replaceable safety gate.

The MVP safety gate refuses permission while either Grim Dawn or IAGrim is
running. This is checked in the helper immediately before a future write, not
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

The imported GDIA DataBuffer write methods are not accepted as a serializer.
The narrow stash serializer remains quarantined from real-write IPC even after
passing in-memory semantic and deterministic round trips for all discovered v4,
v5, and v11 files. Enabling ingest still requires an app-owned item payload,
format validation inside the verified transaction, and an explicit journaled
operation orchestrator.
