# Main-process services and IPC

The Electron bootstrap is a composition root. Renderer requests still cross the existing typed
preload contract, but raw `ipcMain.handle` registration is not permitted in `src/main/index.ts`.
Each request belongs to exactly one main-process domain service.

## Domain ownership

`src/main/ipc/domains.ts` is the authoritative channel map:

- `backgroundJobs` owns job listing and cooperative cancellation.
- `diagnostics` owns status, logging, renderer/preference reports, recovery status, and exports.
- `backups` owns archive backup inspection, creation, export, restore staging, and directory access.
- `imports` owns Item Assistant progress, receipt lookup, and migration.
- `collection` owns discovery, cached/scanned catalog presentation, roll hydration, pins, and supplies.
- `archive` owns vault queries, history, dismantling previews, and offline ingest/retrieval.
- `liveTransfers` owns write-safety inspection, live adapter lifecycle, sync, retrieval, supplies, and recovery delivery.
- `windowLifecycle` owns safe-mode restart, startup reporting, zoom, and application data access.

Channel ownership is exclusive. A domain rejects registration of a channel that is not in its
allowlist, and startup rejects duplicate ownership. Event-only channels such as progress broadcasts
remain outputs and are not request handlers.

## Request boundary

`IpcDomainService` generates the Electron-facing handler. For requests with payloads it:

1. validates and narrows the untrusted input;
2. invokes exactly one concrete domain operation;
3. awaits its result; and
4. translates ordinary production failures to a fixed, redacted domain error.

Validation happens before filesystem, database, helper, dialog, or native work. Bounds cover path
and identifier lengths, batch sizes, paging limits, enums, booleans, preference JSON, and renderer
diagnostic payloads. Domain errors cross Electron as a schema-versioned JSON envelope encoded in
the ordinary error message and are decoded by preload to a typed client error. Neither side exposes
internal messages, paths, stacks, or causes. Shared preload channel names and successful return
shapes are unchanged by this split.

## Persistence and native serialization

`MainOperationCoordinator` owns the rejection-safe write queue used by imports, collection writes,
backups, and every offline/live transfer. A failed operation does not poison later queued work. Transfer writes first
reconcile retained journals and receipts and fail closed while any earlier outcome still needs
attention. The same coordinator records correlated start/completion/failure diagnostics.

Shutdown flushes this coordinator, trailing backups, archive publication, and diagnostics before
closing the database or helper. `window-lifecycle.ts` deduplicates repeated quit events so only one
flush workflow can run, and isolates single-instance focus, activation, and platform close behavior.

## Testing and extension

Collection presentation is a read capability in `collection-presentation.ts`.
It accepts only archive read methods, a committed catalog, basis and roll-model
version; it cannot invoke the helper or resolve quarantine metadata. Repeated
cached collection reads therefore do not hide metadata writes.

`QuarantineReconciliationService` runs after a committed catalog scan/rebuild and
after a completed Item Assistant import. It classifies at most 256 records per
helper request and commits each validated batch through `MainOperationCoordinator`.
Changed metadata queues a protective archive backup. The presenting refresh reads
that committed metadata afterward; reads during the job see the most recently
committed batch. There is no extra full-snapshot progress broadcast or cached
projection to invalidate.

Helper failure or an incomplete/mismatched result batch leaves that batch untouched;
earlier commits and backups remain valid. The job reports failure while the original
scan/import remains successful. Missing records remain unresolved and retry on a
later refresh. Resolved generic records retain quarantine eligibility and are not
updated again; exact vault payloads and mode/receipt/journal identity are untouched.
Shutdown stops admission, allows the active helper batch and serialized commit to
finish, then stops before another batch. Pending records are recovered from the
database after restart, without resuming an in-memory job promise.

`npm run test:ipc-services` and `npm run test:domain-services` use fake IPC, storage, helper,
diagnostics, window, and application adapters; neither imports Electron nor boots the app. Together
they verify channel ownership, validation-before-delegation, one-call delegation, error translation
and serialization, queue recovery after rejection, import cancellation and post-commit backups,
bounded collection hydration, archive write serialization, transfer timeout/restart/replay safety,
mixed-receipt atomic resolution, fail-closed recovery, correlated diagnostics, and deduplicated
shutdown behavior.

When adding a request channel:

1. add or version its shared contract and preload method;
2. assign it to one domain in `MAIN_IPC_CHANNELS`;
3. provide a bounded validator for every input payload;
4. delegate to one operation through that domain; and
5. extend the deterministic service test for its new boundary or failure mode.
