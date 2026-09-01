# Item Assistant import safety

Cairn imports Item Assistant data from an immutable, verified source backup. It never queries
`userdata.db` for item rows until the backup copy has been published and its SHA-256 digest
matches the digest recorded before copying.

## Preflight and progress contract

- File selection starts a read-only preflight. Cairn hashes the source, counts database and
  pending-queue copies, preserves the Softcore/Hardcore split, estimates unsupported records
  against the current catalog, verifies reusable backups, and reads destination free space.
- The confirmation surface identifies the exact source path, copy counts, unsupported estimate,
  backup bytes, required and available free space, and the archive destination mode. Canceling
  there is the final safe cancellation boundary and leaves both backup storage and the archive
  untouched.
- After confirmation, the source database hash and pending-queue fingerprint must still match
  preflight. The import then reports bounded named stages: source verification, backup protection,
  immutable-backup reading, archive commit, and durable-result finalization. Backup and archive
  mutation stages deliberately run to completion rather than exposing unsafe mid-write cancel.
- A versioned `last-import.json` receipt is atomically published beside the managed source
  backups. Settings restores the receipt after restart and shows completion time, duration,
  import/duplicate/unsupported counts, mode split, and backup reuse. Receipt publication failure
  is surfaced without misreporting the already committed archive transaction as rolled back.

## Source backup policy

- Each retained `.bak` has a sidecar manifest containing its full source SHA-256, byte length,
  creation time, and manifest version.
- Before copying, Cairn hashes the source and searches retained manifests for the same content.
  A candidate is reused only after its current bytes still match the recorded digest and length.
- Backups from older Cairn versions are adopted only after hashing their complete contents and
  confirming that digest against the hash prefix in their complete legacy Cairn filename, then
  writing a manifest. The same reconciliation completes a current-format backup whose process
  stopped between publishing the copy and its manifest, while stale managed temporary files are
  removed on the next import. An invalid or corrupted manifested backup is never adopted under a
  new identity; unrecognized `.bak` and temporary files are left untouched.
- When no identical verified backup exists, Cairn checks that the destination volume has room
  for the complete source, copies to a temporary sibling, rehashes both source and copy, and
  publishes the copy before import begins.
- Cairn retains up to three managed, verified, distinct source backups. Retention groups copies by
  their full SHA-256 so duplicate legacy files cannot displace unique recovery points. It runs only
  after the current source has a verified recovery copy, always preserves that copy, and removes
  invalid, duplicate, or older managed entries beyond the bound.

Pending Item Assistant queue CSVs keep their separate receipt-copy and verification behavior.
They are not folded into the database content identity.
