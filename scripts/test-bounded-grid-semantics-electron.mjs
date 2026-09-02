import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

function runGate(label, width) {
  const result = spawnSync(process.execPath, [
    resolve('scripts/benchmark-ui.mjs'),
    '--allow-windows-sandbox-fallback',
    '--electron-source',
    '--fixture', 'bounded-grid-a11y',
    '--query', '',
    '--category', 'Collection',
    '--enable-all-tools',
    '--verify-bounded-grid-semantics',
    '--assert-no-overflow',
    '--disable-gpu',
    '--width', String(width),
    '--height', '1000',
    '--screenshot-name', `bounded-grid-semantics-${label}`
  ], {
    cwd: resolve('.'),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} bounded-grid semantics gate exited ${result.status ?? 'without a status'}.`)
}

runGate('wide', 1440)
runGate('compact', 520)

console.log('Bounded grid Electron semantics passed for populated Collection, Stash Oracle, and Supplies grids at wide and compact widths.')
