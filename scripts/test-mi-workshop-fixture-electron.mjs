import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, mkdir, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const captures = resolve('local-cache/mi-fixture-verification')
await mkdir(captures, { recursive: true })
for (const width of [1440, 520]) {
  const name = `mi-fixture-${width}`
  const env = { ...process.env }
  delete env.CAIRN_CODEX_SCREENSHOT_VERIFY_GLOSSARY
  const result = spawnSync(process.execPath, [resolve('scripts/benchmark-ui.mjs'),
    '--allow-windows-sandbox-fallback', '--electron-source', '--fixture', 'mi-workshop',
    '--category', 'MI Workshop', '--query', 'synthetic', '--enable-all-tools',
    '--verify-mi-workshop-workspace', '--assert-no-overflow', '--disable-gpu',
    '--width', String(width), '--height', '1000', '--scroll-target', '.mi-table-wrap', '--screenshot-name', name
  ], { cwd: resolve('.'), env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `MI fixture ${width} interaction gate`)
  const report = JSON.parse(await readFile(resolve('local-cache/ui-benchmark/performance.json'), 'utf8'))
  assert.equal(report.renderedState.miRows.length, 50)
  assert.equal(Number(report.renderedState.results.replace(/[^0-9]/g, '')), 72)
  assert.equal(report.renderedState.horizontalOverflow, false)
  const database = new DatabaseSync(resolve('local-cache/ui-benchmark/profile/cairn-codex.sqlite3'), { readOnly: true })
  try {
    for (const table of ['vault_item', 'observed_item', 'stash_snapshot', 'operation_journal']) {
      assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, `${table} must not contain synthetic archive writes`)
    }
  } finally { database.close() }
  await copyFile(resolve(`local-cache/ui-benchmark/${name}.png`), resolve(captures, `${name}.png`))
}
console.log('MI fixture Electron passed: 72 synthetic combinations, 50 mounted rows, wide/compact interactions, no overflow, and zero persisted archive copies.')
