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

console.log(JSON.stringify({
  passed: true,
  hookRuntimeImports: 3,
  injectorRuntimeImports: 1,
  minimumRuntime: '14.43',
  installerPrerequisite: true
}, null, 2))
