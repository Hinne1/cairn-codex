import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { verificationEnvironment } from './verification-environment.mjs'

await mkdir(resolve('local-cache'), { recursive: true })
const root = await mkdtemp(resolve('local-cache/release-entry-'))
const profile = join(root, 'profile')
try {
  const seed = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning',
    'scripts/seed-verification-profile.mjs', profile], { stdio: 'inherit', windowsHide: true })
  assert.equal(seed.status, 0, 'seed isolated catalog')
  const result = spawnSync(process.execPath, ['scripts/benchmark-ui.mjs',
    '--electron-source', '--production-entry', '--diagnostic-only', '--base-profile', profile,
    '--route-hash', '#cc-route=1&view=settings', '--disable-gpu', '--allow-windows-sandbox-fallback',
    '--screenshot-name', 'production-settings'], {
    env: { ...verificationEnvironment(), CAIRN_CODEX_SCREENSHOT_FIXTURE: 'unknown-release-must-ignore' },
    stdio: 'inherit', windowsHide: true
  })
  assert.equal(result.status, 0, 'ordinary production entry must capture seeded Settings')
  const report = JSON.parse(await readFile(resolve('local-cache/ui-benchmark/performance.json'), 'utf8'))
  assert.equal(report.startup.cacheOutcome, 'hit')
  assert.equal(report.renderedState.activeWorkspace, 'Settings')
  assert.deepEqual(report.interactions, {})
  assert.ok((await stat(resolve('local-cache/ui-benchmark/production-settings.png'))).size > 10_000)
  console.log('Production Electron entry passed: externally seeded cache, Settings route, screenshot, and ignored fixture injection.')
} finally {
  await rm(root, { recursive: true, force: true })
}
