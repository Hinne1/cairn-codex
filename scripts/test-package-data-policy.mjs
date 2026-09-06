import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { createPackage, createPackageWithOptions } from '@electron/asar'
import { assertPackageDataPath, forbiddenDataExtensions, isForbiddenDataFile } from './artifact-data-policy.mjs'

const cacheRoot = resolve('local-cache')
await mkdir(cacheRoot, { recursive: true })
const root = await mkdtemp(join(cacheRoot, 'package-data-policy-'))
assert.ok(root.startsWith(cacheRoot + sep))
const auditScript = resolve('scripts/audit-package.mjs')
const nativeRoot = resolve('src/helper/CairnCodex.GrimDawn/native')
let sequence = 0
let passedPackages = 0
let rejectedPackages = 0
async function put(path, text = 'generated test bytes') {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}
async function seedPackage() {
  const packageRoot = join(root, `case-${sequence++}`)
  for (const path of ['Cairn Codex.exe', 'LICENSE.CAIRN-CODEX.txt', 'THIRD_PARTY_NOTICES.md',
    'README.md', 'LICENSE', 'resources/helper/CairnCodex.GrimDawn.exe',
    'resources/helper/coreclr.dll', 'resources/helper/CairnCodex.GrimDawn.pdb']) {
    await put(join(packageRoot, path))
  }
  await mkdir(join(packageRoot, 'resources/helper/native'), { recursive: true })
  for (const name of ['ItemAssistantHook_x64.dll', 'DllInjector64.exe']) {
    await copyFile(join(nativeRoot, name), join(packageRoot, 'resources/helper/native', name))
  }
  const prerequisite = 'synthetic prerequisite, never executed'
  await put(join(packageRoot, 'resources/prerequisites/vc_redist.x64.exe'), prerequisite)
  await put(join(packageRoot, 'resources/prerequisites/vc-redist-manifest.json'), JSON.stringify({
    schemaVersion: 1, version: '14.43.0.0', sha256: createHash('sha256').update(prerequisite).digest('hex')
  }))
  return packageRoot
}
async function appTree(packageRoot, asar, extraPath, body = 'generated test bytes', unpack = false) {
  const source = asar ? join(root, `app-${sequence}`) : join(packageRoot, 'resources/app')
  await put(join(source, 'package.json'), '{"name":"cairn-policy-fixture","main":"out/main/index.js"}')
  await put(join(source, 'out/main/index.js'), 'module.exports = {}')
  if (extraPath) await put(join(source, extraPath), body)
  if (asar) {
    const archive = join(packageRoot, 'resources/app.asar')
    if (unpack) await createPackageWithOptions(source, archive, { unpack: '**/*.SQLITE3' })
    else await createPackage(source, archive)
  }
  return source
}
function audit(packageRoot, rejection) {
  const result = spawnSync(process.execPath, [auditScript, packageRoot], { encoding: 'utf8', timeout: 15000 })
  assert.ifError(result.error)
  if (rejection) {
    assert.notEqual(result.status, 0, 'Contaminated package must fail its real audit entry')
    assert.match(result.stderr + result.stdout, rejection)
    rejectedPackages++
  } else {
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Package audit passed/)
    passedPackages++
  }
}

try {
  for (const extension of forbiddenDataExtensions) {
    assert.ok(isForbiddenDataFile(`nested/LEAK${extension.toUpperCase()}`))
    for (const asar of [false, true]) {
      const packageRoot = await seedPackage()
      await appTree(packageRoot, asar, `out/nested/LEAK${extension.toUpperCase()}`)
      audit(packageRoot, /Personal or game-state data/)
    }
  }
  for (const path of ['out/ARCHIVE.SQLITE3-WAL', 'out/archive.db-shm', 'out/archive.sqlite-journal',
    'out/BACKUPS/data.json', 'out/LIVE-ADAPTER/receipt.json', 'out/ITEM-ICONS/icon.png',
    'out/Quarantine/item.json', 'out/LOCAL-CACHE/catalog.json', 'out/SAVES/player.json']) {
    for (const asar of [false, true]) {
      const packageRoot = await seedPackage()
      await appTree(packageRoot, asar, path)
      audit(packageRoot, /Personal or game-state data/)
    }
  }
  for (const asar of [false, true]) {
    const clean = await seedPackage()
    await appTree(clean, asar, 'out/renderer/assets/icon.svg', '<svg/>')
    audit(clean)
    const marker = await seedPackage()
    await appTree(marker, asar, 'out/main/UPPER.JS', 'CAIRN_CODEX_SCREENSHOT_VERIFY_TYPED_ROUTES')
    audit(marker, /Verification body/)
    const nested = await seedPackage()
    await appTree(nested, asar, 'out/nested.asar')
    audit(nested, /Unexpected nested or unaudited ASAR/)
  }
  const unpacked = await seedPackage()
  await appTree(unpacked, true, 'out/LEAK.SQLITE3', 'generated database bytes', true)
  audit(unpacked, /Personal or game-state data/)
  for (const asar of [false, true]) {
    const linked = await seedPackage()
    const source = await appTree(linked, false)
    await put(join(source, 'target/readme.txt'))
    await symlink(join(source, 'target'), join(source, 'linked'), 'junction')
    if (asar) {
      await createPackage(source, join(linked, 'resources/app.asar'))
      await rm(join(source, 'linked'), { recursive: true })
    }
    audit(linked, /Linked (?:ASAR|package) entry/)
  }
  for (const path of ['../escape.db', '/../../escape.js', 'out/./main.js', 'C:/absolute.js']) {
    assert.throws(() => assertPackageDataPath(path, { inAsar: true }), /Invalid package entry/)
  }
  assert.doesNotThrow(() => assertPackageDataPath('resources/helper/CairnCodex.GrimDawn.pdb'))
  assert.throws(() => assertPackageDataPath('resources/helper/CairnCodex.GrimDawn.pdb', { inAsar: true }), /Personal or game-state data/)
} finally {
  // Only remove the fresh generated fixture root under this checkout's cache.
  assert.ok(resolve(root).startsWith(cacheRoot + sep))
  await rm(root, { recursive: true, force: true })
}
console.log(JSON.stringify({ passed: true, passedPackages, rejectedPackages, realAuditEntry: true,
  packedAndUnpacked: true, generatedFixturesOnly: true }))
