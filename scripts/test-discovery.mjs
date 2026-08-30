import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const helper = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(
      'src',
      'helper',
      'CairnCodex.GrimDawn',
      'bin',
      'Debug',
      'net10.0-windows',
      'CairnCodex.GrimDawn.exe'
    )
const testRoot = resolve('local-cache', 'discovery-environments')
await rm(testRoot, { recursive: true, force: true })
await mkdir(testRoot, { recursive: true })

const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
const lines = createInterface({ input: child.stdout })
const pending = new Map()
let nextId = 1

function request(params, method = 'discover-grim-dawn-at') {
  const id = String(nextId++)
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Helper timed out while testing isolated discovery.'))
    }, 30_000)
    pending.set(id, { resolvePromise, reject, timeout })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
}

lines.on('line', (line) => {
  const response = JSON.parse(line)
  const operation = pending.get(response.id)
  if (!operation) return
  clearTimeout(operation.timeout)
  pending.delete(response.id)
  if (response.error) operation.reject(new Error(`${response.error.code}: ${response.error.message}`))
  else operation.resolvePromise(response.result)
})

async function touch(path, contents = '') {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

try {
  const empty = await request({ steamRoots: [], localSaveRoots: [], gogInstallations: [] })
  if (empty.installations.length || empty.saveLocations.length) {
    throw new Error('Explicit empty roots leaked the host Grim Dawn environment.')
  }

  const steamRoot = join(testRoot, 'steam-root')
  const libraryRoot = join(testRoot, 'second-library')
  await touch(
    join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
    `"libraryfolders"\n{\n  "1"\n  {\n    "path" "${libraryRoot.replaceAll('\\', '\\\\')}"\n  }\n}`
  )
  await touch(join(libraryRoot, 'steamapps', 'common', 'Grim Dawn', 'database', 'database.arz'))
  const nonDefault = await request({
    steamRoots: [steamRoot],
    localSaveRoots: [],
    gogInstallations: []
  })
  if (nonDefault.installations.length !== 1 || nonDefault.installations[0].source !== 'steam') {
    throw new Error('A non-default Steam library was not discovered.')
  }

  const saveRoot = join(testRoot, 'documents-save')
  await touch(join(saveRoot, 'transfer.gst'), 'intentionally malformed SC fixture')
  await touch(join(saveRoot, 'transfer.gsh'), 'intentionally malformed HC fixture')
  const mixed = await request({ steamRoots: [], localSaveRoots: [saveRoot], gogInstallations: [] })
  const stashes = mixed.saveLocations.flatMap((location) => location.transferStashes)
  if (stashes.length !== 2 || !stashes.some((stash) => stash.isHardcore) || !stashes.some((stash) => !stash.isHardcore)) {
    throw new Error('Mixed SC/HC transfer-stash discovery failed.')
  }
  if (!stashes.every((stash) => stash.error)) {
    throw new Error('Malformed transfer stashes were not safely surfaced as diagnostics.')
  }
  const softcoreRoot = join(testRoot, 'softcore-save')
  const hardcoreRoot = join(testRoot, 'hardcore-save')
  await touch(join(softcoreRoot, 'transfer.gst'), 'isolated SC fixture')
  await touch(join(hardcoreRoot, 'transfer.gsh'), 'isolated HC fixture')
  const softcoreOnly = await request({ steamRoots: [], localSaveRoots: [softcoreRoot], gogInstallations: [] })
  const hardcoreOnly = await request({ steamRoots: [], localSaveRoots: [hardcoreRoot], gogInstallations: [] })
  if (softcoreOnly.saveLocations.flatMap((location) => location.transferStashes).some((stash) => stash.isHardcore)) {
    throw new Error('Softcore-only discovery was misclassified.')
  }
  if (hardcoreOnly.saveLocations.flatMap((location) => location.transferStashes).some((stash) => !stash.isHardcore)) {
    throw new Error('Hardcore-only discovery was misclassified.')
  }

  const gogRoot = join(testRoot, 'gog-install')
  await touch(join(gogRoot, 'database', 'database.arz'))
  const gog = await request({ steamRoots: [], localSaveRoots: [], gogInstallations: [gogRoot] })
  if (gog.installations.length !== 1 || gog.installations[0].source !== 'gog') {
    throw new Error('Explicit GOG installation discovery failed.')
  }

  const partialRoot = join(testRoot, 'partial-content')
  await touch(join(partialRoot, 'database', 'database.arz'))
  await touch(join(partialRoot, 'resources', 'Text_EN.arc'))
  await touch(join(partialRoot, 'gdx1', 'database', 'expansion.arz'))
  const baseOnly = await request({ installationPath: partialRoot }, 'inspect-content-packs')
  if (baseOnly.map((pack) => pack.id).join(',') !== 'base') {
    throw new Error('An incomplete expansion was not safely ignored.')
  }
  await touch(join(partialRoot, 'gdx1', 'resources', 'Text_EN.arc'))
  const withExpansion = await request({ installationPath: partialRoot }, 'inspect-content-packs')
  if (withExpansion.map((pack) => pack.id).join(',') !== 'base,gdx1') {
    throw new Error('A complete expansion layout was not recognized.')
  }

  console.log(JSON.stringify({
    passed: true,
    missingGame: empty.installations.length === 0,
    missingSaves: empty.saveLocations.length === 0,
    nonDefaultSteamLibrary: nonDefault.installations[0].path,
    softcoreAndHardcore: stashes.map((stash) => ({ hardcore: stash.isHardcore, diagnosed: Boolean(stash.error) })),
    softcoreOnly: softcoreOnly.saveLocations.length === 1,
    hardcoreOnly: hardcoreOnly.saveLocations.length === 1,
    gogInstallation: gog.installations[0].path,
    partialExpansionIgnored: baseOnly.map((pack) => pack.id),
    completeExpansionRecognized: withExpansion.map((pack) => pack.id),
    hostEnvironmentIsolated: true
  }, null, 2))
} finally {
  child.stdin.end()
  lines.close()
}
