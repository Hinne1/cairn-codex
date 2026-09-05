import { resolve } from 'node:path'
import { startCairnApplication } from '../main/bootstrap.ts'
import { createScreenshotCollectionFixture } from './fixtures.ts'
import { presentScreenshotCollection } from './screenshot-collection.ts'
import { runSmokeTest } from './desktop-smoke.ts'
import { captureWindowWhenReady } from './window-driver.ts'

if (process.env.CAIRN_CODEX_SMOKE_TEST !== '1' && !process.argv.some(value => value.startsWith('--user-data-dir='))) {
  throw new Error('The verification entry requires an explicit isolated --user-data-dir.')
}

startCairnApplication({
  applicationRoot: resolve(__dirname, '../../..'),
  verification: {
    cachedCollection: () => process.env.CAIRN_CODEX_SCREENSHOT_PATH && process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE
      ? createScreenshotCollectionFixture(process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE) : null,
    presentCollection: (snapshot, basis) => presentScreenshotCollection(snapshot, basis,
      process.env.CAIRN_CODEX_SCREENSHOT_PATH, process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE, createScreenshotCollectionFixture),
    presentVaultSummary: summary => process.env.CAIRN_CODEX_SCREENSHOT_PATH && process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE === 'onboarding'
      ? { ...summary, total: 128, ingested: 128 } : summary,
    captureWindow: captureWindowWhenReady,
    smokeRequested: process.env.CAIRN_CODEX_SMOKE_TEST === '1',
    runSmokeTest
  }
})
