# Security and data-safety reports

Cairn Codex reads Grim Dawn saves and can move items through either verified
offline stash transactions or an explicitly enabled live-game adapter. A defect
in either path may affect valuable local data, so please do not publish a save,
stash, character file, archive database, or diagnostic bundle in a public issue.

For now, report a suspected data-loss, item-duplication, arbitrary-file-write,
or injection-safety issue privately to `HinneStolzenberg@gmail.com`. Include the
Cairn Codex version, Grim Dawn version and Steam build, whether the character is
Hardcore, the operation shown in the UI, and the relevant operation identifier.
Redact character names if desired.

Stop using transfers until the report is resolved. Preserve the complete
`%APPDATA%\cairn-codex` directory and do not delete Cairn's automatic backups,
journal, queue receipts, or quarantine files. Ordinary collection browsing is
read-only.

Live injection is fail-closed: an unknown `Game.dll`, native hook, or injector
fingerprint must not be bypassed merely to make a transfer button available.
