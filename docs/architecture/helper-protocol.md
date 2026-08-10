# Grim Dawn helper protocol

The Electron main process starts `CairnCodex.GrimDawn` as a child process. Each
request and response is a single JSON object on its own line. Standard output is
reserved for protocol messages; diagnostics go to standard error.

## Envelope

Request:

```json
{"id":"1","method":"health","params":{}}
```

Successful response:

```json
{"id":"1","result":{"service":"CairnCodex.GrimDawn","protocolVersion":1,"mode":"read-only"}}
```

Error response:

```json
{"id":"1","error":{"code":"method_not_found","message":"Unknown method: example"}}
```

The protocol is versioned independently of either executable. Binary item data
will be base64 encoded at this boundary unless profiling demonstrates that a
separate binary transport is necessary.

## Read-only transfer-stash scan

```json
{"id":"2","method":"scan-transfer-stash","params":{"path":"C:\\path\\to\\transfer.gst"}}
```

The result includes the source path, size, SHA-256 hash, modification time,
stash version and mode, tabs, and every serialized item field currently known
to the imported GDIA parser. A scan is rejected if the file metadata changes
while it is being read.
