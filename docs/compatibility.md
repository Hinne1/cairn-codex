# Compatibility matrix

This document describes the supported public-beta boundary. “Catalog” means
read-only indexing and collection tools. “Offline transfer” means a verified,
atomic transfer-stash transaction while Grim Dawn is closed. “Live transfer”
means the explicitly enabled native adapter operating in the running game.

| Environment | Catalog | Offline transfer | Live transfer |
| --- | --- | --- | --- |
| Windows 10/11 x64 | Supported | Supported | Supported only for allowlisted binaries |
| Steam, local saves | Supported | Supported | Exact `Game.dll` fingerprint required |
| Steam Cloud saves | Supported when locally synchronized | Supported against discovered local files | Exact fingerprint required |
| GOG installation | Discovery implemented | Requires beta verification | Not yet verified |
| English game data | Supported | Supported | Supported |
| Other languages | Not yet supported | Not yet supported | Not yet supported |
| Base game and official expansions | Locally detected | Supported for discovered stash versions | Exact fingerprint required |
| Mods/custom databases | Best-effort diagnostic scanning | Not a public-beta promise | Unsupported |

## Allowlisted live targets

Live injection is fail-closed and requires the bundled hook and injector hashes
as well as an exact known `Game.dll` hash. The authoritative values and their
test history are in `live-hook-compatibility.md`.

- Grim Dawn 1.3.0.6 x64.
- Grim Dawn 1.3.0.7 x64, Steam build 24742013.
- Grim Dawn 1.3.0.7 x64, Steam build 24825149.

A matching version number is not sufficient: Steam can silently replace
`Game.dll` without changing the displayed version. Unknown builds remain useful
for catalog browsing and closed-game staging but cannot be injected until their
exact fingerprint passes the compatibility procedure.

## Current beta limitations

- The initial beta is deliberately unsigned and has no automatic updater. The release manifest
  records that policy; a future signing change must cover the installer, app, helper, injector,
  and hook under one publisher identity and deliberately refresh native fingerprints.
- Live transfer mutates a running process and is considered experimental.
- New game builds require a maintained compatibility update or the future guided
  compatibility lab; a generic “ignore safety” switch will not be added.
- Public clean-machine verification still needs to cover GOG and non-English
  environments before their status can be upgraded.
