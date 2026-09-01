# Item Assistant import safety

Cairn imports Item Assistant data from an immutable, verified source backup. It never queries
`userdata.db` for item rows until the backup copy has been published and its SHA-256 digest
matches the digest recorded before copying.

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
