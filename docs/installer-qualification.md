# Installer qualification

Ordinary `test:release-local` prepares and audits artifacts without executing the
production installer. `test:installer-safety` exercises synthetic rejection cases.
Neither result qualifies installation on a clean machine.

The NSIS installer uses the production GUID, registry keys and shortcuts even
with `/D` set to a temporary directory. It can upgrade/uninstall an existing copy
and stop a running portable copy. Never use a normal contributor account for this
test. `-DisposableWindows` is an explicit operator assertion, not VM detection.

## Prepare the candidate

1. Finish independent review, full verification and Windows CI on the source head.
2. Run `npm.cmd run package:release` from its clean checkout. Keep the ZIP, Setup
   executable, manifest and SHA-256 file together. Packaging does not publish.
3. Record version, commit, artifact hashes and the qualification date. Do not
   substitute a previous build's results. The manifest establishes provenance;
   it does not declare the release qualified.

## Use a fresh Windows x64 VM

Use a disposable Windows 10 or 11 VM/account with no Cairn installation, profile,
shortcut, running portable copy, personal saves or shared writable host folders.
Start from a snapshot with no development SDKs or Visual C++ x64 runtime. Preserve
Defender and SmartScreen defaults. Copy the audited artifacts and matching source
checkout/test dependencies into the VM. Test both supported Windows versions.

The lifecycle harness needs Node 22+ to generate its isolated fixture. Separately
check ordinary first launch in the clean VM before installing developer tooling,
using another fresh snapshot for the scripted qualification below.

```powershell
# Optional read-only probe; never installs or cleans up anything.
powershell -NoProfile -File scripts/test-installer.ps1 -PreflightOnly

# Only inside the explicitly disposable Windows environment.
npm.cmd run test:installer -- -DisposableWindows
```

The script verifies the Setup hash against the clean release manifest and uses
explicit `/currentuser` scope. It refuses existing registration in either hive
or registry view, inaccessible probes, running CC processes, existing default
profile/install/shortcut paths, and paths through junctions or symbolic links.
It checks the installed registration and shortcut targets before running its own
uninstaller. An owned hash-verified copy outside the installation uses NSIS's
`_?=` mode so the waited process completes the actual uninstall; the entire
installation directory must disappear. HKCU Software keys are shared across Windows registry views; see
[Microsoft's WOW64 registry mapping](https://learn.microsoft.com/en-us/windows/win32/winprog64/shared-registry-keys).

Sentinels in the disposable account's real default Roaming and Local AppData
folders and the isolated fixture profile must survive uninstall unchanged.
The production GUID is pinned to electron-builder's existing derived GUID;
this change does not introduce a different upgrade identity.

Keep the `local-cache/installer-qualification-*` evidence, screenshot and retained
sentinels. A failed/interrupted run never invokes a previous uninstaller, kills a
process or recursively clears test evidence. Investigate failures and restore a
fresh VM snapshot before retrying; do not bypass the preflight to reuse it.
Any previous qualification root also blocks a new run, even when interruption
happened before registry or evidence creation.

## Record manual results for this exact artifact

- Windows version/build, runtime initially absent, and test date.
- Download/SmartScreen and Defender behavior with the default protections intact.
- Installer UI and VC++ prerequisite/UAC behavior, including cancellation.
- Ordinary first launch without a developer SDK, missing game guidance, and
  an isolated Settings diagnostic screenshot from the scripted run.
- Per-user shortcut and uninstall registration targets, successful uninstall,
  removed shortcuts/registration, and all retained data sentinels.
- ZIP/Setup SHA-256, source commit and any failure/evidence location.

Local synthetic safety tests do not cover these manual rows. A fully supported
release also needs the separate live-transfer recovery matrix in issue #8.
