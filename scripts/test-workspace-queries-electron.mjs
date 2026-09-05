import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, mkdir, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const captures = resolve('local-cache/workspace-query-verification')
await mkdir(captures, { recursive: true })
for (const width of [1440, 520]) {
  const name = `workspace-queries-${width}`
  const result = spawnSync(process.execPath, [resolve('scripts/benchmark-ui.mjs'),
    '--allow-windows-sandbox-fallback', '--electron-source', '--fixture', 'workspace-queries',
    '--query', 'synthetic', '--enable-all-tools', '--verify-workspace-queries',
    '--assert-no-overflow', '--disable-gpu', '--width', String(width), '--height', '1000',
    '--scroll-target', '.supply-results', '--screenshot-name', name
  ], { cwd: resolve('.'), env: process.env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Workspace query ${width} interaction gate`)
  const report = JSON.parse(await readFile(resolve('local-cache/ui-benchmark/performance.json'), 'utf8'))
  assert.equal(report.interactions.dismantlingMountedRows, 120)
  assert.equal(report.interactions.suppliesMountedRows, 60)
  assert.equal(report.renderedState.horizontalOverflow, false)
  const database = new DatabaseSync(resolve('local-cache/ui-benchmark/profile/cairn-codex.sqlite3'), { readOnly: true })
  try {
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM vault_item').get().count, 20_145)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM vault_item WHERE state != 'ingested'").get().count, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM operation_journal').get().count, 0)
  } finally { database.close() }
  await copyFile(resolve(`local-cache/ui-benchmark/${name}.png`), resolve(captures, `${name}.png`))
  await copyFile(resolve('local-cache/ui-benchmark/performance.json'), resolve(captures, `${name}.json`))
  const dismantlingName = `dismantling-queries-${width}`
  const capture = spawnSync(process.execPath, [resolve('scripts/benchmark-ui.mjs'),
    '--allow-windows-sandbox-fallback', '--electron-source', '--fixture', 'workspace-queries',
    '--query', 'synthetic', '--enable-all-tools', '--category', 'Dismantling Lab',
    '--expected-bounded-total', '20000', '--expected-bounded-mounted', '120',
    '--assert-no-overflow', '--disable-gpu', '--width', String(width), '--height', '1000',
    '--scroll-target', '.dismantling-candidates', '--screenshot-name', dismantlingName
  ], { cwd: resolve('.'), env: process.env, stdio: 'inherit', windowsHide: true })
  if (capture.error) throw capture.error
  assert.equal(capture.status, 0, `Dismantling ${width} bounded capture`)
  await copyFile(resolve(`local-cache/ui-benchmark/${dismantlingName}.png`), resolve(captures, `${dismantlingName}.png`))
}
console.log('Workspace query Electron passed: 20k equipment copies, 120 candidate rows and 60 supply cards per page, wide/compact, modes, filters, empty states and keyboard selection; no archive mutations.')
