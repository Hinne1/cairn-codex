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
4. translates failures to an `IpcServiceError` while preserving the safe user-facing message.

Validation happens before filesystem, database, helper, dialog, or native work. Bounds cover path
and identifier lengths, batch sizes, paging limits, enums, booleans, preference JSON, and renderer
diagnostic payloads. Shared preload channel names and return shapes are unchanged by this split.

## Persistence and native serialization

`MainOperationCoordinator` owns the rejection-safe write queue used by imports, collection writes,
backups, and transfers. A failed operation does not poison later queued work. Transfer writes first
reconcile retained journals and receipts and fail closed while any earlier outcome still needs
attention. The same coordinator records correlated start/completion/failure diagnostics.

Shutdown flushes this coordinator, trailing backups, archive publication, and diagnostics before
closing the database or helper. `window-lifecycle.ts` deduplicates repeated quit events so only one
flush workflow can run, and isolates single-instance focus, activation, and platform close behavior.

## Testing and extension

`npm run test:ipc-services` uses fake IPC, service, diagnostics, window, and application adapters;
it does not import Electron or boot the app. It verifies all channel ownership, validation-before-
delegation, one-call delegation, error translation, queue serialization, post-failure recovery,
fail-closed transfer reconciliation, correlated diagnostics, single-instance focus, activation,
platform close, and repeated shutdown behavior.

When adding a request channel:

1. add or version its shared contract and preload method;
2. assign it to one domain in `MAIN_IPC_CHANNELS`;
3. provide a bounded validator for every input payload;
4. delegate to one operation through that domain; and
5. extend the deterministic service test for its new boundary or failure mode.
