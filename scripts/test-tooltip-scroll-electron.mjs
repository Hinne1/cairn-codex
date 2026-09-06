import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const captures = resolve('local-cache/tooltip-scroll-verification')
await mkdir(captures, { recursive: true })
for (const width of [1440, 520]) {
  const name = `tooltip-scroll-${width}`
  const result = spawnSync(process.execPath, [resolve('scripts/benchmark-ui.mjs'),
    '--allow-windows-sandbox-fallback', '--electron-source', '--fixture', 'tooltip-scroll',
    '--category', 'Collection', '--query', '', '--enable-all-tools', '--dismiss-onboarding',
    '--disable-gpu', '--assert-no-overflow', '--width', String(width), '--height', '1000', '--screenshot-name', name
  ], { cwd: resolve('.'), env: { ...process.env, CAIRN_CODEX_SCREENSHOT_VERIFY_TOOLTIP_SCROLL: '1' }, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Cross-workspace tooltip scrolling at ${width}px`)
  await copyFile(resolve(`local-cache/ui-benchmark/${name}.png`), resolve(captures, `${name}.png`))
  const focusName = `tooltip-farming-focus-${width}`
  const focus = spawnSync(process.execPath, [resolve('scripts/benchmark-ui.mjs'),
    '--allow-windows-sandbox-fallback', '--electron-source', '--fixture', 'farming-routes',
    '--category', 'Collection Farming', '--query', '', '--enable-all-tools', '--dismiss-onboarding',
    '--verify-farming-paging', '--disable-gpu', '--assert-no-overflow',
    '--width', String(width), '--height', '1000', '--screenshot-name', focusName
  ], { cwd: resolve('.'), env: process.env, stdio: 'inherit', windowsHide: true })
  if (focus.error) throw focus.error
  assert.equal(focus.status, 0, `Farming focus tooltip placement at ${width}px`)
  await copyFile(resolve(`local-cache/ui-benchmark/${focusName}.png`), resolve(captures, `${focusName}.png`))
}
console.log('Cross-workspace native tooltip scrolling passed at wide and compact widths.')
