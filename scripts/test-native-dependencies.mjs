import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readPeImports } from './pe-imports.mjs'

const nativeRoot = new URL('../src/helper/CairnCodex.GrimDawn/native/', import.meta.url)
const hookImports = readPeImports(await readFile(new URL('ItemAssistantHook_x64.dll', nativeRoot)))
const injectorImports = readPeImports(await readFile(new URL('DllInjector64.exe', nativeRoot)))

assert.deepEqual(
  hookImports.filter((dependency) => /^(?:msvcp|vcruntime)/.test(dependency)),
  ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']
)
assert.deepEqual(
  injectorImports.filter((dependency) => /^(?:msvcp|vcruntime)/.test(dependency)),
  ['vcruntime140.dll']
)

const installerInclude = await readFile(new URL('installer-prerequisites.nsh', import.meta.url), 'utf8')
assert.match(installerInclude, /Minor"\s*\r?\n/)
assert.match(installerInclude, /\$2 >= 43/)
assert.match(installerInclude, /vc_redist\.x64\.exe.*\/install \/quiet \/norestart/)

const releaseScript = await readFile(new URL('package-release.ps1', import.meta.url), 'utf8')
assert.match(releaseScript, /authenticodePolicy = 'unsigned-beta'/)
for (const target of [
  'portableApp', 'portableHelper', 'portableHook', 'portableInjector',
  'installedApp', 'installedHelper', 'installedHook', 'installedInjector', 'installer'
]) {
  assert.match(releaseScript, new RegExp(`${target} = Get-UnsignedBetaSignatureStatus`))
}
assert.match(releaseScript, /Status -ne 'NotSigned'/)

const testerGuide = await readFile(new URL('../docs/external-testing.md', import.meta.url), 'utf8')
assert.match(testerGuide, /Windows Security > Protection history/)
assert.match(testerGuide, /Do not disable SmartScreen,[\s\S]*globally\./)

console.log(JSON.stringify({
  passed: true,
  hookRuntimeImports: 3,
  injectorRuntimeImports: 1,
  minimumRuntime: '14.43',
  installerPrerequisite: true,
  authenticodePolicy: 'unsigned-beta',
  endpointProtectionGuide: true
}, null, 2))
