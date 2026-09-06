import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const captures = resolve('local-cache/accessibility-audit')
await mkdir(captures, { recursive: true })
for (const [width, recovery] of [[1440, false], [520, false], [520, true]]) {
  const name = `accessibility-${recovery ? 'recovery-' : ''}${width}`
  const result = spawnSync(process.execPath, [resolve('scripts/benchmark-ui.mjs'),
    '--allow-windows-sandbox-fallback', '--electron-source', '--fixture', 'accessibility-audit', '--query', '',
    ...(recovery ? ['--safe-mode-suggested'] : ['--enable-all-tools', '--dismiss-onboarding']),
    '--disable-gpu', '--assert-no-overflow', '--width', String(width), '--height', '1000', '--screenshot-name', name
  ], { cwd: resolve('.'), env: { ...process.env, CAIRN_CODEX_SCREENSHOT_VERIFY_A11Y_AUDIT: '1' }, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Accessibility audit: ${name}`)
  // Each benchmark resets its working directory; preserve every modal capture
  // before the next viewport starts.
  for (const file of await readdir(resolve('local-cache/ui-benchmark'))) {
    if (file.startsWith(name) && file.endsWith('.png')) {
      await copyFile(resolve('local-cache/ui-benchmark', file), resolve(captures, file))
    }
  }
}
console.log('Core keyboard, modal, accessibility-tree and motion audit passed at wide and compact widths.')
