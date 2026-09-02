import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

function runGate(label, width, height, screenshotName) {
  const result = spawnSync(process.execPath, [
    resolve('scripts/benchmark-ui.mjs'),
    '--allow-windows-sandbox-fallback',
    '--electron-source',
    '--fixture', 'skill-explorer',
    '--enable-all-tools',
    '--category', 'Skill Explorer',
    '--skill-query', 'Wendigo Totem',
    '--skill-select-first',
    '--verify-skill-explorer-workspace',
    '--assert-no-overflow',
    '--disable-gpu',
    '--width', String(width),
    '--height', String(height),
    '--screenshot-name', screenshotName
  ], {
    cwd: resolve('.'),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} Skill Explorer accessibility gate exited ${result.status ?? 'without a status'}.`)
  }
}

runGate('Wide', 1440, 1000, 'skill-explorer-a11y-wide')
runGate('Compact', 520, 1000, 'skill-explorer-a11y-compact')

console.log('Skill Explorer Electron accessibility passed at wide and compact widths.')
