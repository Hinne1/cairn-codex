import { execFileSync, spawn } from 'node:child_process'
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

const electronSource = process.argv.includes('--electron-source')
const appPath = resolve(argument('--app') ?? (
  electronSource ? 'node_modules/electron/dist/electron.exe' : 'dist/win-unpacked/Cairn Codex.exe'
))
const baseDatabase = argument('--base-db')
const baseProfile = argument('--base-profile')
const fixture = argument('--fixture')
const query = argument('--query') ?? 'wendigo'
const category = argument('--category')
const miAffixFilter = argument('--mi-affix-filter')
const expectedMiRows = argument('--expected-mi-rows')
const expectedMiTotal = argument('--expected-mi-total')
const expectedMiMounted = argument('--expected-mi-mounted')
const warmBudgetMs = argument('--warm-budget-ms')
const miNativeRestore = process.argv.includes('--mi-native-restore')
const waitForBackgroundJobs = process.argv.includes('--wait-for-background-jobs')
const hydrateAllModes = process.argv.includes('--hydrate-all-modes')
const openSearchHelp = process.argv.includes('--open-search-help')
const collapseTrackers = process.argv.includes('--collapse-trackers')
const screenshotWidth = argument('--width')
const screenshotHeight = argument('--height')
const scrollTarget = argument('--scroll-target')
const gdiaResultFixture = process.argv.includes('--gdia-result-fixture')
const onboardingStep = argument('--onboarding-step')
const dismissOnboarding = process.argv.includes('--dismiss-onboarding')
const transferSection = argument('--transfer-section')
const verifyNavigation = process.argv.includes('--verify-navigation')
const openPlannerSetup = process.argv.includes('--open-planner-setup')
const verifyPlannerNavigation = process.argv.includes('--verify-planner-navigation')
const verifyBoundedKeyboard = process.argv.includes('--verify-bounded-keyboard')
const simulateWorkspaceError = process.argv.includes('--simulate-workspace-error')
const safeMode = process.argv.includes('--safe-mode')
const safeModeSuggested = process.argv.includes('--safe-mode-suggested')
const disableGpu = process.argv.includes('--disable-gpu')
const screenshotName = (argument('--screenshot-name') ?? category ?? 'collection')
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
const sourceCount = [baseDatabase, baseProfile, fixture].filter(Boolean).length
if (sourceCount !== 1) {
  throw new Error('Pass exactly one of --base-profile, --base-db, or --fixture with an isolated data source.')
}
if (screenshotWidth !== null && (!Number.isInteger(Number(screenshotWidth)) || Number(screenshotWidth) < 480 || Number(screenshotWidth) > 1920)) {
  throw new Error(`--width must be an integer from 480 through 1920; received ${screenshotWidth}.`)
}
if (screenshotHeight !== null && (!Number.isInteger(Number(screenshotHeight)) || Number(screenshotHeight) < 720 || Number(screenshotHeight) > 2400)) {
  throw new Error(`--height must be an integer from 720 through 2400; received ${screenshotHeight}.`)
}
if (onboardingStep !== null && (!Number.isInteger(Number(onboardingStep)) || Number(onboardingStep) < 0 || Number(onboardingStep) > 3)) {
  throw new Error(`--onboarding-step must be an integer from 0 through 3; received ${onboardingStep}.`)
}

const testRoot = resolve('local-cache', 'ui-benchmark')
const profileRoot = resolve(testRoot, 'profile')
const screenshotPath = resolve(testRoot, `${screenshotName || 'collection'}.png`)
const reportPath = resolve(testRoot, 'performance.json')
await rm(testRoot, { recursive: true, force: true })
if (fixture) {
  await mkdir(profileRoot, { recursive: true })
} else if (baseProfile) {
  await cp(resolve(baseProfile), profileRoot, { recursive: true, force: true })
} else {
  await mkdir(profileRoot, { recursive: true })
  await copyFile(resolve(baseDatabase), resolve(profileRoot, 'cairn-codex.sqlite3'))
}
if (gdiaResultFixture) {
  if (!fixture) throw new Error('--gdia-result-fixture requires an isolated --fixture source.')
  const receiptDirectory = resolve(profileRoot, 'migrations', 'gdia')
  await mkdir(receiptDirectory, { recursive: true })
  await writeFile(resolve(receiptDirectory, 'last-import.json'), `${JSON.stringify({
    receiptVersion: 1,
    result: {
      canceled: false,
      sourcePath: 'C:\\Synthetic QA\\ItemAssistant\\data\\userdata.db',
      sourceItems: 20001,
      sourceDatabaseItems: 20000,
      sourceQueueItems: 1,
      sourceHardcoreItems: 10000,
      sourceSoftcoreItems: 10001,
      importedItems: 20000,
      duplicateItems: 0,
      unsupportedItems: 1,
      backupPath: 'C:\\Synthetic QA\\backups\\userdata.verified.bak',
      backupReused: false,
      receiptPersisted: true,
      completedAtUtc: '2026-09-01T03:30:00.000Z',
      durationMs: 995
    }
  }, null, 2)}\n`, 'utf8')
}

const env = {
  ...process.env,
  CAIRN_CODEX_SCREENSHOT_PATH: screenshotPath,
  CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN: waitForBackgroundJobs ? '1' : '0',
  CAIRN_CODEX_SCREENSHOT_QUERY: query,
  CAIRN_CODEX_SCREENSHOT_FIXTURE: fixture ?? '',
  ...(openSearchHelp ? { CAIRN_CODEX_SCREENSHOT_OPEN_SEARCH_HELP: '1' } : {}),
  ...(collapseTrackers ? { CAIRN_CODEX_SCREENSHOT_COLLAPSE_TRACKERS: '1' } : {}),
  ...(screenshotWidth ? { CAIRN_CODEX_SCREENSHOT_WIDTH: screenshotWidth } : {}),
  ...(screenshotHeight ? { CAIRN_CODEX_SCREENSHOT_HEIGHT: screenshotHeight } : {}),
  ...(scrollTarget ? { CAIRN_CODEX_SCREENSHOT_SCROLL_TARGET: scrollTarget } : {}),
  ...(onboardingStep !== null ? { CAIRN_CODEX_SCREENSHOT_ONBOARDING_STEP: onboardingStep } : {}),
  ...(dismissOnboarding ? { CAIRN_CODEX_SCREENSHOT_DISMISS_ONBOARDING: '1' } : {}),
  ...(category ? { CAIRN_CODEX_SCREENSHOT_CATEGORY: category } : {}),
  ...(transferSection ? { CAIRN_CODEX_SCREENSHOT_TRANSFER_SECTION: transferSection } : {}),
  ...(verifyNavigation ? { CAIRN_CODEX_SCREENSHOT_VERIFY_NAVIGATION: '1' } : {}),
  ...(openPlannerSetup ? { CAIRN_CODEX_SCREENSHOT_OPEN_PLANNER_SETUP: '1' } : {}),
  ...(verifyPlannerNavigation ? { CAIRN_CODEX_SCREENSHOT_VERIFY_PLANNER_NAVIGATION: '1' } : {}),
  ...(verifyBoundedKeyboard ? { CAIRN_CODEX_SCREENSHOT_VERIFY_BOUNDED_KEYBOARD: '1' } : {}),
  ...(simulateWorkspaceError ? { CAIRN_CODEX_SCREENSHOT_RENDER_ERROR: '1' } : {}),
  ...(safeMode ? { CAIRN_CODEX_SCREENSHOT_SAFE_MODE: '1' } : {}),
  ...(safeModeSuggested ? {
    CAIRN_CODEX_SCREENSHOT_SAFE_MODE_SUGGESTED: '1',
    CAIRN_CODEX_SCREENSHOT_FAILED_STARTS: '3'
  } : {}),
  ...(miAffixFilter ? { CAIRN_CODEX_SCREENSHOT_MI_AFFIX_FILTER: miAffixFilter } : {}),
  ...(miNativeRestore ? { CAIRN_CODEX_SCREENSHOT_MI_NATIVE_RESTORE: '1' } : {}),
  ...(hydrateAllModes ? { CAIRN_CODEX_SCREENSHOT_HYDRATE_ALL_MODES: '1' } : {}),
  ...(category && category !== 'Collection' ? { CAIRN_CODEX_SCREENSHOT_COLLAPSE_TRACKERS: '1' } : {}),
  CAIRN_CODEX_PERF_REPORT_PATH: reportPath
}
const child = spawn(appPath, [
  ...(disableGpu ? ['--disable-gpu', '--disable-gpu-sandbox', '--in-process-gpu'] : []),
  ...(electronSource ? ['.'] : []),
  `--user-data-dir=${profileRoot}`
], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})
let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => { stdout += chunk })
child.stderr.on('data', (chunk) => { stderr += chunk })

let report
for (let attempt = 0; attempt < (hydrateAllModes ? 480 : 240); attempt += 1) {
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
const requestedViewport = {
  width: screenshotWidth ? Number(screenshotWidth) : 1440,
  height: screenshotHeight ? Number(screenshotHeight) : 1000
}
if (
  report.renderedState?.viewport?.width !== requestedViewport.width ||
  report.renderedState?.viewport?.height !== requestedViewport.height
) {
  throw new Error(
    `Screenshot viewport mismatch: requested ${requestedViewport.width}x${requestedViewport.height}, ` +
    `rendered ${report.renderedState?.viewport?.width ?? 'unknown'}x` +
    `${report.renderedState?.viewport?.height ?? 'unknown'}.`
  )
}
if (scrollTarget && !report.renderedState?.scrollTargetFound) {
  throw new Error(`Screenshot scroll target was not rendered: ${scrollTarget}.`)
}
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
if (expectedMiTotal !== null) {
  const expected = Number(expectedMiTotal)
  if (!Number.isInteger(expected) || expected < 0) {
    throw new Error(`--expected-mi-total must be a non-negative integer; received ${expectedMiTotal}.`)
  }
  if (itemCount !== expected) {
    throw new Error(`MI total mismatch: counter reported ${itemCount}; expected ${expected}.`)
  }
}
if (expectedMiMounted !== null) {
  const expected = Number(expectedMiMounted)
  const rendered = report.renderedState?.miRows?.length ?? 0
  if (!Number.isInteger(expected) || expected < 0) {
    throw new Error(`--expected-mi-mounted must be a non-negative integer; received ${expectedMiMounted}.`)
  }
  if (rendered !== expected) {
    throw new Error(`MI mounted-row mismatch: rendered ${rendered}; expected ${expected}.`)
  }
}
if (warmBudgetMs !== null) {
  const budget = Number(warmBudgetMs)
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error(`--warm-budget-ms must be a positive number; received ${warmBudgetMs}.`)
  }
  if (report.startup?.cacheOutcome !== 'hit') {
    throw new Error(`Warm-start budget requires a cache hit; observed ${report.startup?.cacheOutcome ?? 'missing status'}.`)
  }
  if (!Number.isFinite(report.startup?.interactiveMs) || report.startup.interactiveMs > budget) {
    throw new Error(
      `Warm startup exceeded ${budget} ms: interactive at ${report.startup?.interactiveMs ?? 'unknown'} ms.`
    )
  }
}
console.log(JSON.stringify({
  passed: true,
  source: fixture ? `fixture:${fixture}` : resolve(baseProfile ?? baseDatabase),
  readyMs: report.readyMs,
  startup: report.startup,
  warmBudgetMs: warmBudgetMs === null ? null : Number(warmBudgetMs),
  searchMsIncludingDebounce: report.interactions?.searchMs,
  query,
  category: category ?? 'Collection',
  miAffixFilter: miAffixFilter ?? null,
  miNativeRestore,
  waitForBackgroundJobs,
  hydrateAllModes,
  openSearchHelp,
  verifyNavigation,
  openPlannerSetup,
  verifyPlannerNavigation,
  verifyBoundedKeyboard,
  screenshotWidth: report.renderedState.viewport.width,
  screenshotHeight: report.renderedState.viewport.height,
  scrollTarget,
  scrollY: report.renderedState.scrollY,
  fixture,
  gdiaResultFixture,
  matchedItems: itemCount,
  renderedCards: report.renderedState?.cards,
  renderedVaultRows: report.renderedState?.vaultRows,
  renderedOperationRows: report.renderedState?.operationRows,
  renderedPlannerRows: report.renderedState?.plannerRows,
  screenshotPath,
  reportPath
}, null, 2))
