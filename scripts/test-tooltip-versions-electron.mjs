import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { copyFile, mkdir } from 'node:fs/promises'

const captures = resolve('local-cache/tooltip-version-verification')
await mkdir(captures, { recursive: true })
for (const width of [1440, 520]) {
  const name = `tooltip-versions-${width}`
  const result = spawnSync(process.execPath, [resolve('scripts/benchmark-ui.mjs'),
    '--allow-windows-sandbox-fallback', '--electron-source', '--fixture', 'tooltip-versions',
    '--category', 'Collection', '--query', '', '--enable-all-tools', '--dismiss-onboarding',
    '--disable-gpu', '--assert-no-overflow', '--width', String(width), '--height', '1000',
    '--screenshot-name', name
  ], { cwd: resolve('.'), env: { ...process.env, CAIRN_CODEX_SCREENSHOT_VERIFY_TOOLTIP_VERSIONS: '1' }, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Tooltip version ${width} interaction gate`)
  await copyFile(resolve(`local-cache/ui-benchmark/${name}.png`), resolve(captures, `${name}.png`))
}
console.log('Tooltip version switching passed at wide and compact widths.')
