# Native live adapter provenance

Cairn Codex bundles two Windows binaries used only by the opt-in live-game
adapter. They are pinned and fingerprinted; an unknown binary is rejected.

## Hook DLL

`ItemAssistantHook_x64.dll` is built from Grim Dawn Item Assistant commit
`babced1cccd09c60ba0b36cf8c3cfe431910c754`, plus
`patches/iagd-cairn.patch`. The patch contains every Cairn-owned source change:
the Grim Dawn 1.3 replica layout, isolated queue directory, active-character
reporting, personal-inventory deliveries, exact special-item exceptions, stack
preservation, receipt naming, and Cairn notification text.

The checked-in release DLL remains the authority until a replacement has passed
the compatibility and live round-trip procedure in
`docs/live-hook-compatibility.md`. Merely compiling a new DLL does not authorize
injecting it.

To reproduce the currently bundled hook, prepare a clean clone of the pinned
upstream commit and Boost 1.78.0 with the x64 MSVC 14.x libraries, then run:

```powershell
.\scripts\build-live-hook.ps1 `
  -UpstreamRoot C:\src\iagd `
  -BoostRoot C:\src\boost_1_78_0
```

The script verifies the upstream commit, applies the tracked patch, builds with
the Visual Studio 2022 v143 toolset, and rejects an unexpected output hash.

## Injector

`DllInjector64.exe` is the unmodified pinned-upstream dependency at
`Dependencies/DllInjector64.exe`. Its expected SHA-256 is
`569e6bdde51148b29aece0491366e9aa4c21cf2f11279a94c815e2b958cfe10c`.
Its source is present in the same upstream repository under `DllInjector`.
