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

The default Windows SDK is `10.0.22621.0`, matching the documented shipping build
inputs. Install Visual Studio 2022's v143 x64 tools and ATL, that SDK, and the
Boost 1.78.0 v143 x64 libraries. `-PreflightOnly` checks these inputs and patch
applicability without changing the upstream checkout. Missing prerequisites fail
before patch application, so installing the missing component does not require
cleaning up a partially prepared checkout.
The native patch is checked out with LF line endings so Git can preserve the
upstream files' explicit no-final-newline context even on an autocrlf Windows host.

The script prints and pins the selected v143 compiler version for MSBuild. Use
`-VCToolsVersion` to select an installed 14.3x/14.4x compiler explicitly. The
2026-09-06 compile-only check used `14.43.34808`; it is not a new live qualification.
`-WindowsSdkVersion` and `-WindowsSdkRoot` permit explicit SDK selection for
investigation. Different build inputs do not change the expected shipping hash:
the script still rejects a differing output. It never copies a candidate into
release resources, injects it, or changes compatibility allowlists.
The compiler/ATL/SDK/Boost include and library lists override upstream's old
machine-specific lists; Universal CRT uses the same explicitly selected SDK.

The build reproduces the tracked source inputs; byte-for-byte reproduction of the
old DLL is additionally subject to the output hash guard (including linker/debug
metadata). A successfully compiled candidate with a different hash still needs
documented provenance and a complete compatibility round trip before replacement.

## Injector

`DllInjector64.exe` is the unmodified pinned-upstream dependency at
`Dependencies/DllInjector64.exe`. Its expected SHA-256 is
`569e6bdde51148b29aece0491366e9aa4c21cf2f11279a94c815e2b958cfe10c`.
Its source is present in the same upstream repository under `DllInjector`.
