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

Collection scans and game-data rebuilds follow the same ownership rule through
`runCollectionRefresh`: only the committed, unfiltered catalog is coalesced. Each
caller projects its requested source paths and archive/stash basis afterward.
Scan and rebuild retain distinct dedupe keys; the collection service rejects a
different refresh while one is active. A scan keeps optional map-index failures
nonfatal, while an explicit rebuild requires successful forced map indexing.

The renderer's `CollectionSession` owns cached loads, scan/rebuild results and
hydration. Selection identity includes basis and a normalized set of source paths;
synchronous selection invalidation distinguishes A → B → A from the original A.
Each new read supersedes older reads, and only the current read can install a
snapshot or report a failure. A successful superseded scan/rebuild starts a fresh
cached projection for the current selection, so its committed catalog becomes
visible even when a selection load finished before the refresh. Superseded work
retains its busy count until it settles. A first load adopts default source paths
as part of its own installation. Live/archive changes install through `commit`,
invalidating earlier reads; when the visible snapshot belongs to a previous
selection, a new projection after the commit replaces the old-context delta. Responses
are discarded after unmount. None of this cancels an in-flight durable main-process
operation or replays a transfer.

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
