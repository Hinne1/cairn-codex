import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import {
  BENCHMARK_RENDERER_FAILURE_PREFIX,
  BenchmarkRendererFailure,
  benchmarkRendererFailure,
  benchmarkProcessTermination,
  terminateBenchmarkProcessTree,
  shouldRetryWithoutSandbox
} from './benchmark-process.mjs'

const launchFailure = { reason: 'launch-failed', exitCode: 49 }
const parsed = benchmarkRendererFailure(
  `startup noise\n${BENCHMARK_RENDERER_FAILURE_PREFIX}${JSON.stringify(launchFailure)}\nmore noise`
)
assert.deepEqual(parsed, launchFailure)
assert.equal(benchmarkRendererFailure('ordinary renderer output'), null)

const error = new BenchmarkRendererFailure(launchFailure, 'stdout', 'stderr')
assert.equal(shouldRetryWithoutSandbox(error, true, 'win32'), true)
assert.equal(shouldRetryWithoutSandbox(error, false, 'win32'), false)
assert.equal(shouldRetryWithoutSandbox(error, true, 'linux'), false)
assert.equal(
  shouldRetryWithoutSandbox(
    new BenchmarkRendererFailure({ reason: 'crashed', exitCode: 1 }, '', ''),
    true,
    'win32'
  ),
  false
)

if (process.platform === 'win32') {
  const parentScript = [
    "const { spawn } = require('node:child_process')",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', windowsHide: true })",
    "process.stdout.write(String(child.pid) + '\\n')",
    'setInterval(() => {}, 1000)'
  ].join('; ')
  const parent = spawn(process.execPath, ['-e', parentScript], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true
  })
  const [pidChunk] = await once(parent.stdout, 'data')
  const descendantPid = Number(String(pidChunk).trim())
  assert.ok(Number.isInteger(descendantPid) && descendantPid > 0)
  try {
    parent.kill('SIGTERM')
    await once(parent, 'close')
    assert.deepEqual(benchmarkProcessTermination(parent), { exitCode: null, signalCode: 'SIGTERM' })
    await terminateBenchmarkProcessTree(parent)
    const deadline = Date.now() + 2_000
    let descendantAlive = true
    while (descendantAlive && Date.now() < deadline) {
      descendantAlive = spawnSync('tasklist.exe', ['/FI', `PID eq ${descendantPid}`, '/FO', 'CSV', '/NH'], {
        windowsHide: true,
        encoding: 'utf8'
      }).stdout.includes(`\"${descendantPid}\"`)
      if (descendantAlive) await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(descendantAlive, false, 'a descendant survived cleanup after its benchmark parent was signaled')
  } finally {
    spawnSync('taskkill.exe', ['/PID', String(descendantPid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  }
}

const [benchmark, main, routes, grids, sets, skills] = await Promise.all([
  readFile(new URL('./benchmark-ui.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('./test-app-routes-electron.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./test-bounded-grid-semantics-electron.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./test-sets-bounded-results-electron.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./test-skill-explorer-workspace-electron.mjs', import.meta.url), 'utf8')
])

assert.match(benchmark, /--allow-windows-sandbox-fallback/)
assert.match(benchmark, /benchmarkProcessTermination\(child\)[\s\S]*?terminated before producing a report/)
assert.match(benchmark, /shouldRetryWithoutSandbox[\s\S]*?noSandbox: true/)
assert.match(benchmark, /sandboxFallbackUsed/)
assert.match(main, /\[benchmark-renderer-gone\]/)
assert.match(main, /webContents\.isCrashed\(\)/)
for (const wrapper of [routes, grids, sets, skills]) {
  assert.match(wrapper, /--allow-windows-sandbox-fallback/)
}

console.log(JSON.stringify({
  passed: true,
  launchFailureDetected: true,
  exactWindowsFallback: true,
  crashFailuresPreserved: true,
  signaledProcessFailsFast: true,
  signaledProcessDescendantsCleaned: process.platform === 'win32',
  childExitFailsFast: true,
  electronGatesOptIn: true
}, null, 2))
