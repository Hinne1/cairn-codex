import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

const appPath = argument('--app')
const baseDatabase = argument('--base-db')
if (!appPath || !baseDatabase) {
  throw new Error('Pass --app and --base-db (a closed/read-only Cairn archive snapshot).')
}

const testRoot = resolve('local-cache', 'dismantling-preview-test')
const profileRoot = resolve(testRoot, 'profile')
const databasePath = resolve(testRoot, 'archive.sqlite3')
const screenshotPath = resolve(testRoot, 'preview.png')
await rm(testRoot, { recursive: true, force: true })
await mkdir(profileRoot, { recursive: true })
await copyFile(resolve(baseDatabase), databasePath)

const child = spawn(resolve(appPath), [`--user-data-dir=${profileRoot}`], {
  env: {
    ...process.env,
    CAIRN_CODEX_SCREENSHOT_PATH: screenshotPath,
    CAIRN_CODEX_SCREENSHOT_CATEGORY: 'Dismantling Lab',
    CAIRN_CODEX_SCREENSHOT_DISMANTLING_PREVIEW: '1',
    CAIRN_CODEX_SCREENSHOT_HEIGHT: '1200',
    CAIRN_CODEX_SCREENSHOT_SCROLL_TARGET: '.dismantling-costs',
    CAIRN_CODEX_DATABASE_PATH: databasePath,
    CAIRN_CODEX_ARCHIVE_BACKUP_DIR: resolve(testRoot, 'backups')
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => { stdout += chunk })
child.stderr.on('data', (chunk) => { stderr += chunk })

let screenshot
for (let attempt = 0; attempt < 180; attempt += 1) {
  try {
    screenshot = await stat(screenshotPath)
    break
  } catch {
    if (child.exitCode !== null) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
}

if (!screenshot || child.exitCode > 0) {
  child.kill()
  throw new Error(
    `Dismantling preview QA failed${child.exitCode === null ? ' (timeout)' : ` (exit ${child.exitCode})`}.\n${stdout}\n${stderr}`
  )
}

const image = await readFile(screenshotPath)
console.log(JSON.stringify({
  passed: true,
  screenshotPath,
  screenshotBytes: image.byteLength,
  databasePath
}, null, 2))
