import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const captures = resolve('local-cache/item-context-verification')
await mkdir(captures, { recursive: true })
for (const [width, zoom] of [[1440, 1], [520, 1], [520, 1.25]]) {
  const name = `item-context-${width}${zoom === 1 ? '' : '-125'}`
  const result = spawnSync(process.execPath, [resolve('scripts/benchmark-ui.mjs'),
    '--allow-windows-sandbox-fallback', '--electron-source', '--fixture', 'item-context-menu', '--query', '',
    '--enable-all-tools', '--dismiss-onboarding', '--disable-gpu', '--assert-no-overflow',
    '--width', String(width), '--height', '1000', '--screenshot-name', name
  ], { cwd: resolve('.'), env: { ...process.env, CAIRN_CODEX_SCREENSHOT_VERIFY_ITEM_CONTEXT: '1', CAIRN_CODEX_SCREENSHOT_ITEM_MENU_ZOOM: String(zoom) }, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Native item menus at ${width}px`)
  for (const file of await readdir(resolve('local-cache/ui-benchmark'))) {
    if (file.startsWith(name) && file.endsWith('.png')) await copyFile(resolve('local-cache/ui-benchmark', file), resolve(captures, file))
  }
  await copyFile(resolve('local-cache/ui-benchmark/performance.json'), resolve(captures, `${name}.json`))
}
console.log('Native item menus passed: pointer/keyboard actions, focus, shared states and bounded 20k results at both widths and compact 125% zoom.')
