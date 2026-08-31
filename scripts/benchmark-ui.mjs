import { execFileSync, spawn } from 'node:child_process'
import { copyFile, cp, mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

const appPath = resolve(argument('--app') ?? 'dist/win-unpacked/Cairn Codex.exe')
const baseDatabase = argument('--base-db')
const baseProfile = argument('--base-profile')
const query = argument('--query') ?? 'wendigo'
const category = argument('--category')
const miAffixFilter = argument('--mi-affix-filter')
const expectedMiRows = argument('--expected-mi-rows')
const miNativeRestore = process.argv.includes('--mi-native-restore')
const screenshotName = (argument('--screenshot-name') ?? category ?? 'collection')
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
if (!baseDatabase && !baseProfile) {
  throw new Error('Pass --base-profile or --base-db with a closed/read-only Cairn snapshot.')
}

const testRoot = resolve('local-cache', 'ui-benchmark')
const profileRoot = resolve(testRoot, 'profile')
const screenshotPath = resolve(testRoot, `${screenshotName || 'collection'}.png`)
const reportPath = resolve(testRoot, 'performance.json')
await rm(testRoot, { recursive: true, force: true })
if (baseProfile) {
  await cp(resolve(baseProfile), profileRoot, { recursive: true, force: true })
} else {
  await mkdir(profileRoot, { recursive: true })
  await copyFile(resolve(baseDatabase), resolve(profileRoot, 'cairn-codex.sqlite3'))
}

const env = {
  ...process.env,
  CAIRN_CODEX_SCREENSHOT_PATH: screenshotPath,
  CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN: '0',
  CAIRN_CODEX_SCREENSHOT_QUERY: query,
  ...(category ? { CAIRN_CODEX_SCREENSHOT_CATEGORY: category } : {}),
  ...(miAffixFilter ? { CAIRN_CODEX_SCREENSHOT_MI_AFFIX_FILTER: miAffixFilter } : {}),
  ...(miNativeRestore ? { CAIRN_CODEX_SCREENSHOT_MI_NATIVE_RESTORE: '1' } : {}),
  ...(category && category !== 'Collection' ? { CAIRN_CODEX_SCREENSHOT_COLLAPSE_TRACKERS: '1' } : {}),
  CAIRN_CODEX_PERF_REPORT_PATH: reportPath
}
const child = spawn(appPath, [`--user-data-dir=${profileRoot}`], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})
let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => { stdout += chunk })
child.stderr.on('data', (chunk) => { stderr += chunk })

let report
for (let attempt = 0; attempt < 240; attempt += 1) {
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'))
    break
  } catch {
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(`Benchmark app exited ${child.exitCode}.\n${stdout}\n${stderr}`)
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
}
if (!report) throw new Error(`Benchmark timed out.\n${stdout}\n${stderr}`)
try {
  execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
} catch {
  child.kill()
}
const itemCount = Number(String(report.renderedState?.results ?? '').replace(/[^0-9]/g, ''))
if (expectedMiRows !== null) {
  const expected = Number(expectedMiRows)
  const rendered = report.renderedState?.miRows?.length ?? 0
  if (!Number.isInteger(expected) || expected < 0) {
    throw new Error(`--expected-mi-rows must be a non-negative integer; received ${expectedMiRows}.`)
  }
  if (rendered !== expected || itemCount !== expected) {
    throw new Error(
      `MI result mismatch: counter reported ${itemCount}, but ${rendered} rows rendered; expected ${expected}.`
    )
  }
}
console.log(JSON.stringify({
  passed: true,
  source: resolve(baseProfile ?? baseDatabase),
  readyMs: report.readyMs,
  searchMsIncludingDebounce: report.interactions?.searchMs,
  query,
  category: category ?? 'Collection',
  miAffixFilter: miAffixFilter ?? null,
  miNativeRestore,
  matchedItems: itemCount,
  renderedCards: report.renderedState?.cards,
  screenshotPath,
  reportPath
}, null, 2))
