# Background jobs

Long-running CC work is owned by the Electron main process through one typed job coordinator.
Renderer workspaces observe job summaries through the preload API; they do not own job promises or
send archive/catalog snapshots as progress events.

## Contract

Every job has a UUID identity and correlation ID, a closed job kind and stage union, normalized
progress, a bounded result summary, a bounded structured error, and cancellation state. The current
kinds cover collection scans, game-data rebuilds, roll hydration, Item Assistant imports, archive
backups, icon extraction, and map indexing.

`dedupeKey` identifies equivalent work. A second request for an active key deliberately coalesces
onto the first promise, so the helper and durable stores see one operation. Keys must not combine
operations with different side effects; for example, creating and exporting backups use different
keys. Roll hydration deliberately analyzes the all-mode archive domain once, then each IPC caller
receives its own Softcore/Hardcore source projection after the shared work settles.

## Cancellation

Cancellation is cooperative. `canCancel` is true only before a side effect or between bounded
batches. Because a renderer click can cross an IPC boundary just after work enters an unsafe stage,
supported jobs retain the request and honor it at their next safe boundary. Once helper work, a
database commit, or a verified file publication starts, that bounded stage runs to completion.
Operations must call `throwIfCancellationRequested()` at each advertised boundary before continuing.

## Lifetime and payload bounds

The coordinator lives in the main process, so active and recent terminal jobs survive renderer
navigation, remounting, and renderer reloads during the current app session. The preload API first
lists current jobs and then streams changes. At most 50 terminal jobs are retained.

In-flight jobs are explicitly `discard-in-flight` on an app restart. Durable operations keep using
their existing transaction journals, receipts, verified backups, and startup reconciliation; the job
display itself is not treated as a recovery log or resumed after restart.

Progress messages contain only counts, percentages, labels, and short detail text. Result metadata is
limited to 8 KiB. Full collection or archive snapshots continue to travel only as the typed result of
the foreground IPC request, never as job progress.
