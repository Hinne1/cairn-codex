import { writeFile } from 'node:fs/promises'
import { app, type BrowserWindow } from 'electron'
import type { StartupStatus } from '../shared/contracts.ts'

/** Read-only capture for isolated installed-package diagnostics. Interaction tests
 * and fixture injection belong to the separate verification entry. */
export async function captureDiagnosticScreenshot(window: BrowserWindow, path: string): Promise<void> {
  const startedAt = Date.now()
  try {
    const dimension = (value: string | undefined, fallback: number, min: number, max: number) => {
      const parsed = Number.parseInt(value ?? '', 10)
      return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback
    }
    window.setContentSize(
      dimension(process.env.CAIRN_CODEX_SCREENSHOT_WIDTH, 1440, 480, 1920),
      dimension(process.env.CAIRN_CODEX_SCREENSHOT_HEIGHT, 1000, 720, 2400)
    )
    window.webContents.setZoomFactor(1)
    for (let attempt = 0; attempt < 240; attempt++) {
      if (window.isDestroyed() || window.webContents.isCrashed()) throw new Error('Diagnostic renderer is unavailable.')
      const startup = await window.webContents.executeJavaScript('window.cairnCodex.getStartupStatus()') as StartupStatus
      const renderedState = await window.webContents.executeJavaScript(`({
        ready: Boolean(document.querySelector('.workspace-layout, .root-recovery, .safe-mode-offer')),
        scanError: document.querySelector('.scan-error')?.textContent,
        backgroundScan: Boolean(document.querySelector('.background-scan')),
        cards: document.querySelectorAll('.item-card').length,
        results: document.querySelector('.results-count')?.textContent,
        activeWorkspace: document.querySelector('.workspace-sidebar [aria-current="page"] .workspace-nav-label')?.textContent?.trim(),
        cacheIssue: document.querySelector('.app-shell')?.getAttribute('data-cache-issue'),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        viewport: { width: window.innerWidth, height: window.innerHeight }
      })`)
      if (renderedState.scanError) throw new Error('Diagnostic scan failed: ' + renderedState.scanError)
      if (renderedState.ready && startup.interactiveMs !== null &&
        (process.env.CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN !== '1' || !renderedState.backgroundScan)) {
        await writeFile(path, (await window.webContents.capturePage()).toPNG())
        const report = { readyMs: Date.now() - startedAt, startup, interactions: {}, renderedState }
        if (process.env.CAIRN_CODEX_PERF_REPORT_PATH) {
          await writeFile(process.env.CAIRN_CODEX_PERF_REPORT_PATH, JSON.stringify(report, null, 2))
        }
        console.log(JSON.stringify({ screenshotPath: path, ...report }))
        app.quit()
        return
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('Diagnostic renderer did not become interactive before the capture timeout.')
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}
