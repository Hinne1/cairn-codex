import { writeFile } from "node:fs/promises";
import { app, BrowserWindow } from "electron";
import { type StartupStatus } from "@shared/contracts";
import { verifyWorkspaceQueries } from './workspace-query-verification.ts'

export async function verifyNativeSkillExplorerWheelInput(window: BrowserWindow): Promise<void> {
  let stage = 'locate item cell'
  try {
  window.show()
  window.focus()
  await new Promise((resolve) => setTimeout(resolve, 80))
  const itemPoint = await window.webContents.executeJavaScript(`
    (async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
      const cell = document.querySelector('.skill-explorer .research-table-row .research-item')
      const table = document.querySelector('.skill-explorer .research-item-table')
      if (!(cell instanceof HTMLElement) || !(table instanceof HTMLElement)) {
        throw new Error('Native wheel verification could not find the Skill Explorer table.')
      }
      cell.scrollIntoView({ block: 'center' })
      table.scrollLeft = 0
      await wait(80)
      const rect = cell.getBoundingClientRect()
      return { x: Math.round(rect.left + Math.min(24, rect.width / 2)), y: Math.round(rect.top + rect.height / 2) }
    })()
  `) as { x: number, y: number }
  window.webContents.sendInputEvent({ type: 'mouseMove', x: itemPoint.x, y: itemPoint.y })
  await new Promise((resolve) => setTimeout(resolve, 260))
  const nativePointerOpenedTooltip = await window.webContents.executeJavaScript(`Boolean(document.querySelector('.game-tooltip'))`) as boolean
  if (!nativePointerOpenedTooltip) {
    await window.webContents.executeJavaScript(`
      (() => {
        const cell = document.querySelector('.skill-explorer .research-table-row .research-item')
        if (!(cell instanceof HTMLElement)) return
        const rect = cell.getBoundingClientRect()
        cell.dispatchEvent(new MouseEvent('mouseenter', {
          bubbles: true,
          clientX: rect.left + Math.min(24, rect.width / 2),
          clientY: rect.top + rect.height / 2
        }))
      })()
    `)
    await new Promise((resolve) => setTimeout(resolve, 260))
  }
  stage = 'prepare tooltip overflow'
  const tooltipPoint = await window.webContents.executeJavaScript(`
    (() => {
      const tooltip = document.querySelector('.game-tooltip')
      if (!(tooltip instanceof HTMLElement)) return { error: 'Item cell did not open its tooltip.' }
      const probe = document.createElement('div')
      probe.className = 'native-wheel-probe'
      probe.setAttribute('aria-hidden', 'true')
      probe.style.cssText = 'height:640px;min-height:640px'
      tooltip.appendChild(probe)
      tooltip.style.height = '150px'
      tooltip.style.maxHeight = '150px'
      tooltip.scrollTop = 0
      tooltip.addEventListener('wheel', (event) => {
        tooltip.dataset.nativeWheelDelta = String(event.deltaY)
      }, { once: true })
      const rect = tooltip.getBoundingClientRect()
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + Math.min(60, rect.height / 2)) }
    })()
  `) as { x?: number, y?: number, error?: string }
  if (tooltipPoint.error || tooltipPoint.x === undefined || tooltipPoint.y === undefined) {
    throw new Error(tooltipPoint.error ?? 'Tooltip point was invalid.')
  }
  stage = 'native tooltip scroll'
  window.webContents.sendInputEvent({ type: 'mouseMove', x: tooltipPoint.x, y: tooltipPoint.y })
  window.webContents.sendInputEvent({ type: 'mouseWheel', x: tooltipPoint.x, y: tooltipPoint.y, deltaY: -120, wheelTicksY: -1, canScroll: true })
  await new Promise((resolve) => setTimeout(resolve, 120))
  const nativeTooltipState = await window.webContents.executeJavaScript(`
    (() => {
      const tooltip = document.querySelector('.game-tooltip')
      return tooltip instanceof HTMLElement
        ? { scrollTop: tooltip.scrollTop, delta: tooltip.dataset.nativeWheelDelta ?? null, scrollHeight: tooltip.scrollHeight, clientHeight: tooltip.clientHeight }
        : null
    })()
  `) as { scrollTop: number, delta: string | null, scrollHeight: number, clientHeight: number } | null
  if (!nativeTooltipState || nativeTooltipState.scrollTop <= 0) {
    throw new Error(`Real mouse-wheel input did not natively scroll the overflowing tooltip: ${JSON.stringify(nativeTooltipState)}`)
  }

  stage = 'proxied item-cell scroll'
  window.webContents.sendInputEvent({ type: 'mouseMove', x: itemPoint.x, y: itemPoint.y })
  await new Promise((resolve) => setTimeout(resolve, 220))
  await window.webContents.executeJavaScript(`(() => { const tooltip = document.querySelector('.game-tooltip'); if (tooltip instanceof HTMLElement) tooltip.scrollTop = 0 })()`)
  window.webContents.sendInputEvent({ type: 'mouseWheel', x: itemPoint.x, y: itemPoint.y, deltaY: -120, wheelTicksY: -1, canScroll: true })
  await new Promise((resolve) => setTimeout(resolve, 180))
  const proxiedTooltipScroll = await window.webContents.executeJavaScript(`document.querySelector('.game-tooltip')?.scrollTop ?? 0`) as number
  if (proxiedTooltipScroll <= 0) throw new Error('Real mouse-wheel input over the item cell did not smoothly proxy into its tooltip.')

  stage = 'tooltip boundary handoff'
  const boundaryState = await window.webContents.executeJavaScript(`
    (() => {
      const tooltip = document.querySelector('.game-tooltip')
      if (!(tooltip instanceof HTMLElement)) throw new Error('Tooltip disappeared before the native boundary-handoff check.')
      tooltip.scrollTop = tooltip.scrollHeight
      tooltip.addEventListener('wheel', (event) => {
        tooltip.dataset.boundaryWheel = JSON.stringify({ delta: event.deltaY, top: tooltip.scrollTop, maximum: tooltip.scrollHeight - tooltip.clientHeight, prevented: event.defaultPrevented })
      }, { once: true })
      const maximumPageScroll = document.documentElement.scrollHeight - window.innerHeight
      if (window.scrollY >= maximumPageScroll - 10) window.scrollTo(0, Math.max(0, maximumPageScroll - 300))
      return window.scrollY
    })()
  `) as number
  window.webContents.sendInputEvent({ type: 'mouseMove', x: tooltipPoint.x, y: tooltipPoint.y })
  window.webContents.sendInputEvent({ type: 'mouseWheel', x: tooltipPoint.x, y: tooltipPoint.y, deltaY: -120, wheelTicksY: -1, canScroll: true })
  await new Promise((resolve) => setTimeout(resolve, 120))
  const boundaryPageScroll = await window.webContents.executeJavaScript(`window.scrollY`) as number
  if (boundaryPageScroll <= boundaryState) {
    const boundaryDiagnostic = await window.webContents.executeJavaScript(`(() => {
      const tooltip = document.querySelector('.game-tooltip')
      return { before: ${boundaryState}, after: window.scrollY, pageMaximum: document.documentElement.scrollHeight - innerHeight,
        pointTarget: document.elementFromPoint(${tooltipPoint.x}, ${tooltipPoint.y})?.className,
        wheel: tooltip?.dataset.boundaryWheel, top: tooltip?.scrollTop, height: tooltip?.clientHeight, scrollHeight: tooltip?.scrollHeight,
        rect: tooltip?.getBoundingClientRect().toJSON() }
    })()`)
    throw new Error('Real tooltip-boundary wheel input did not continue into the workspace in the default mode: ' + JSON.stringify(boundaryDiagnostic))
  }

  stage = 'tooltip top boundary handoff'
  await new Promise((resolve) => setTimeout(resolve, 300))
  const topBoundaryState = await window.webContents.executeJavaScript(`(() => {
    const tooltip = document.querySelector('.game-tooltip')
    if (!(tooltip instanceof HTMLElement)) throw new Error('Tooltip disappeared before the top-boundary check.')
    tooltip.scrollTop = 0
    if (window.scrollY < 120) throw new Error('Top-boundary check requires upward page scroll room.')
    return window.scrollY
  })()`) as number
  window.webContents.sendInputEvent({ type: 'mouseWheel', x: tooltipPoint.x, y: tooltipPoint.y, deltaY: 120, wheelTicksY: 1, canScroll: true })
  await new Promise((resolve) => setTimeout(resolve, 180))
  const topBoundaryPageScroll = await window.webContents.executeJavaScript('window.scrollY') as number
  if (topBoundaryPageScroll >= topBoundaryState) throw new Error('Real tooltip-top wheel input did not scroll the workspace upward in page mode.')

  stage = 'ordinary and horizontal table scroll'
  const tablePoint = await window.webContents.executeJavaScript(`
    (async () => {
      const level = document.querySelector('.skill-explorer .research-table-row .research-level')
      const table = document.querySelector('.skill-explorer .research-item-table')
      if (!(level instanceof HTMLElement) || !(table instanceof HTMLElement)) throw new Error('Native table wheel verification lost its targets.')
      level.scrollIntoView({ block: 'center' })
      table.scrollLeft = 0
      await new Promise((resolve) => setTimeout(resolve, 80))
      const rect = level.getBoundingClientRect()
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
    })()
  `) as { x: number, y: number }
  window.webContents.sendInputEvent({ type: 'mouseMove', x: tablePoint.x, y: tablePoint.y })
  await new Promise((resolve) => setTimeout(resolve, 120))
  const pageBeforeTableWheel = await window.webContents.executeJavaScript(`window.scrollY`) as number
  window.webContents.sendInputEvent({ type: 'mouseWheel', x: tablePoint.x, y: tablePoint.y, deltaY: -120, wheelTicksY: -1, canScroll: true })
  await new Promise((resolve) => setTimeout(resolve, 120))
  const pageAfterTableWheel = await window.webContents.executeJavaScript(`window.scrollY`) as number
  if (pageAfterTableWheel <= pageBeforeTableWheel) throw new Error('Real wheel input over an ordinary table cell did not scroll the workspace.')
  const horizontalPoint = await window.webContents.executeJavaScript(`
    (async () => {
      const level = document.querySelector('.skill-explorer .research-table-row .research-level')
      const table = document.querySelector('.skill-explorer .research-item-table')
      if (!(level instanceof HTMLElement) || !(table instanceof HTMLElement)) throw new Error('Horizontal wheel verification lost its table target.')
      level.scrollIntoView({ block: 'center' })
      table.scrollLeft = Math.min(100, table.scrollWidth - table.clientWidth)
      await new Promise((resolve) => setTimeout(resolve, 80))
      const rect = level.getBoundingClientRect()
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), scrollLeft: table.scrollLeft }
    })()
  `) as { x: number, y: number, scrollLeft: number }
  window.webContents.sendInputEvent({ type: 'mouseMove', x: horizontalPoint.x, y: horizontalPoint.y })
  window.webContents.sendInputEvent({ type: 'mouseWheel', x: horizontalPoint.x, y: horizontalPoint.y, deltaY: -120, wheelTicksY: -1, canScroll: true, modifiers: ['shift'] })
  await new Promise((resolve) => setTimeout(resolve, 120))
  const horizontalScroll = await window.webContents.executeJavaScript(`document.querySelector('.skill-explorer .research-item-table')?.scrollLeft ?? 0`) as number
  if (horizontalScroll === horizontalPoint.scrollLeft) throw new Error('Real horizontal wheel input did not scroll the dense table.')
  await window.webContents.executeJavaScript(`
    (() => {
      document.querySelector('.native-wheel-probe')?.remove()
      const table = document.querySelector('.skill-explorer .research-item-table')
      if (table instanceof HTMLElement) table.scrollLeft = 0
    })()
  `)

  stage = 'enable contained tooltip scrolling'
  await window.webContents.executeJavaScript(`
    (async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
      const settings = document.querySelector('[data-destination-id="settings"]')
      if (!(settings instanceof HTMLButtonElement)) throw new Error('Could not open Settings for contained tooltip verification.')
      settings.click()
      for (let attempt = 0; attempt < 50 && !document.querySelector('.settings-workspace'); attempt += 1) await wait(20)
      const contained = document.querySelector('input[name="tooltip-boundary-scroll"][value="contain"]')
      if (!(contained instanceof HTMLInputElement)) throw new Error('Contained tooltip setting was unavailable.')
      contained.click()
      await wait(40)
      if (!contained.checked) throw new Error('Contained tooltip setting did not become active.')
      window.history.back()
      for (let attempt = 0; attempt < 50 && !document.querySelector('.skill-explorer .research-table-row .research-item'); attempt += 1) await wait(20)
    })()
  `)

  stage = 'prepare contained tooltip overflow'
  const containedItemPoint = await window.webContents.executeJavaScript(`
    (async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
      const cell = document.querySelector('.skill-explorer .research-table-row .research-item')
      if (!(cell instanceof HTMLElement)) throw new Error('Skill Explorer did not return after enabling contained tooltip scrolling.')
      cell.scrollIntoView({ block: 'center' })
      await wait(60)
      const rect = cell.getBoundingClientRect()
      return { x: Math.round(rect.left + Math.min(24, rect.width / 2)), y: Math.round(rect.top + rect.height / 2) }
    })()
  `) as { x: number, y: number }
  window.webContents.sendInputEvent({ type: 'mouseMove', x: containedItemPoint.x, y: containedItemPoint.y })
  await new Promise((resolve) => setTimeout(resolve, 260))
  const containedTooltipPoint = await window.webContents.executeJavaScript(`
    (() => {
      const tooltip = document.querySelector('.game-tooltip')
      if (!(tooltip instanceof HTMLElement)) throw new Error('Contained-mode item hover did not open its tooltip.')
      const probe = document.createElement('div')
      probe.className = 'native-wheel-probe'
      probe.setAttribute('aria-hidden', 'true')
      probe.style.cssText = 'height:640px;min-height:640px'
      tooltip.appendChild(probe)
      tooltip.style.height = '150px'
      tooltip.style.maxHeight = '150px'
      tooltip.scrollTop = tooltip.scrollHeight
      const maximumPageScroll = document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo(0, Math.min(Math.max(120, window.scrollY), Math.max(0, maximumPageScroll - 120)))
      const rect = tooltip.getBoundingClientRect()
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + Math.min(60, rect.height / 2)), pageScroll: window.scrollY }
    })()
  `) as { x: number, y: number, pageScroll: number }

  stage = 'contained direct-tooltip boundary'
  window.webContents.sendInputEvent({ type: 'mouseMove', x: containedTooltipPoint.x, y: containedTooltipPoint.y })
  window.webContents.sendInputEvent({ type: 'mouseWheel', x: containedTooltipPoint.x, y: containedTooltipPoint.y, deltaY: -120, wheelTicksY: -1, canScroll: true })
  await new Promise((resolve) => setTimeout(resolve, 120))
  const pageAfterContainedTooltipWheel = await window.webContents.executeJavaScript(`window.scrollY`) as number
  if (pageAfterContainedTooltipWheel !== containedTooltipPoint.pageScroll) {
    throw new Error('Contained-mode wheel input escaped from the tooltip boundary into the workspace.')
  }

  stage = 'contained item-cell boundary'
  window.webContents.sendInputEvent({ type: 'mouseMove', x: containedItemPoint.x, y: containedItemPoint.y })
  await new Promise((resolve) => setTimeout(resolve, 220))
  const containedItemBoundaryState = await window.webContents.executeJavaScript(`
    (() => {
      const tooltip = document.querySelector('.game-tooltip')
      if (!(tooltip instanceof HTMLElement)) throw new Error('Contained-mode tooltip disappeared before the item-cell boundary check.')
      tooltip.scrollTop = 0
      return window.scrollY
    })()
  `) as number
  window.webContents.sendInputEvent({ type: 'mouseWheel', x: containedItemPoint.x, y: containedItemPoint.y, deltaY: 120, wheelTicksY: 1, canScroll: true })
  await new Promise((resolve) => setTimeout(resolve, 120))
  const pageAfterContainedItemWheel = await window.webContents.executeJavaScript(`window.scrollY`) as number
  if (pageAfterContainedItemWheel !== containedItemBoundaryState) {
    throw new Error('Contained-mode wheel input escaped from the item cell at the tooltip boundary.')
  }

  stage = 'restore page tooltip scrolling'
  await window.webContents.executeJavaScript(`
    (async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
      document.querySelector('.native-wheel-probe')?.remove()
      const settings = document.querySelector('[data-destination-id="settings"]')
      if (!(settings instanceof HTMLButtonElement)) throw new Error('Could not reopen Settings after contained tooltip verification.')
      settings.click()
      for (let attempt = 0; attempt < 50 && !document.querySelector('.settings-workspace'); attempt += 1) await wait(20)
      const page = document.querySelector('input[name="tooltip-boundary-scroll"][value="page"]')
      if (!(page instanceof HTMLInputElement)) throw new Error('Page tooltip setting was unavailable.')
      page.click()
      await wait(40)
      if (!page.checked) throw new Error('Page tooltip setting did not become active again.')
      window.history.back()
      for (let attempt = 0; attempt < 50 && !document.querySelector('.skill-explorer .research-table-row .research-item'); attempt += 1) await wait(20)
    })()
  `)
  } catch (error) {
    throw new Error(`Native Skill Explorer wheel verification failed during ${stage}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function captureWindowWhenReady(window: BrowserWindow, path: string): Promise<void> {
  const captureStartedAt = Date.now()
  const interactionTimings: Record<string, number> = {}
  let expectedRouteControls: Record<string, unknown> = {}
  try {
    const routeParameters = new URLSearchParams(
      (process.env.CAIRN_CODEX_SCREENSHOT_ROUTE_HASH ?? '').replace(/^#/, '')
    )
    const controls = routeParameters.get('controls')
    if (controls) expectedRouteControls = JSON.parse(controls) as Record<string, unknown>
  } catch {
    expectedRouteControls = {}
  }
  try {
    const requestedWidth = Number.parseInt(
      process.env.CAIRN_CODEX_SCREENSHOT_WIDTH ?? '',
      10
    )
    const requestedHeight = Number.parseInt(
      process.env.CAIRN_CODEX_SCREENSHOT_HEIGHT ?? '',
      10
    )
    const screenshotWidth = Number.isFinite(requestedWidth)
      ? Math.min(Math.max(requestedWidth, 480), 1920)
      : 1440
    const screenshotHeight = Number.isFinite(requestedHeight)
      ? Math.min(Math.max(requestedHeight, 720), 2400)
      : 1000
    window.setContentSize(screenshotWidth, screenshotHeight)
    const [actualContentWidth, actualContentHeight] = window.getContentSize()
    if (actualContentWidth !== screenshotWidth || actualContentHeight !== screenshotHeight) {
      throw new Error(
        `Screenshot viewport mismatch: requested ${screenshotWidth}x${screenshotHeight}, ` +
        `received ${actualContentWidth}x${actualContentHeight}.`
      )
    }
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const scanError = await window.webContents.executeJavaScript(
        "document.querySelector('.scan-error')?.textContent"
      )
      if (scanError) throw new Error('Renderer collection scan failed: ' + scanError)
      const ready = await window.webContents.executeJavaScript(
        `(Boolean(document.querySelector('.workspace-error, .root-recovery, .safe-mode-offer')) ||
          Boolean(document.querySelector([
            '.catalog-grid', '.catalog-results', '.set-results', '.settings-workspace', '.vault-workspace',
            '.leveling-planner', '.mi-workshop', '.collection-materials-workspace', '.skill-explorer',
            '.supplies-workspace', '.farming-workspace', '.stash-oracle', '.dismantling-workspace', '.glossary-workspace'
          ].join(', ')))) &&
         (!document.querySelector('.primary-action')?.disabled ||
          Boolean(document.querySelector('.workspace-error, .root-recovery, .safe-mode-offer')) ||
          Boolean(document.querySelector('.background-scan'))) &&
         (${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN === '1')}
           ? !document.querySelector('.background-scan')
           : true)`
      )
      if (ready) {
        window.webContents.setZoomFactor(1)
        await new Promise((resolve) => setTimeout(resolve, 50))
        const onboardingStep = Number.parseInt(
          process.env.CAIRN_CODEX_SCREENSHOT_ONBOARDING_STEP ?? '0',
          10
        )
        if (
          process.env.CAIRN_CODEX_SCREENSHOT_ONBOARDING_STEP !== undefined ||
          process.env.CAIRN_CODEX_SCREENSHOT_DISMISS_ONBOARDING === '1'
        ) {
          for (let attempt = 0; attempt < 40; attempt += 1) {
            const mounted = await window.webContents.executeJavaScript(
              "Boolean(document.querySelector('.onboarding-dialog'))"
            )
            if (mounted) break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
        }
        for (let step = 0; step < onboardingStep; step += 1) {
          const advanced = await window.webContents.executeJavaScript(`
            (() => {
              const button = [...document.querySelectorAll('.onboarding-footer button')]
                .find((candidate) => ['Continue', 'Continue without importing'].includes(candidate.textContent?.trim() ?? ''))
              button?.click()
              return Boolean(button)
            })()
          `)
          if (!advanced) throw new Error(`Onboarding could not advance from step ${step}.`)
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_ONBOARDING_STEP !== undefined) {
          const renderedOnboardingStep = await window.webContents.executeJavaScript(
            "document.querySelector('.onboarding-dialog')?.getAttribute('data-onboarding-step')"
          )
          if (renderedOnboardingStep === null || Number(renderedOnboardingStep) !== onboardingStep) {
            throw new Error(
              `Onboarding screenshot requested step ${onboardingStep}, rendered ${renderedOnboardingStep ?? 'none'}.`
            )
          }
          if (
            onboardingStep === 1 &&
            process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE === 'onboarding'
          ) {
            let retainedCopyText = ''
            for (let attempt = 0; attempt < 40; attempt += 1) {
              retainedCopyText = await window.webContents.executeJavaScript(
                "document.querySelector('.retained-count')?.textContent?.trim() ?? ''"
              )
              if (retainedCopyText) break
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
            if (retainedCopyText !== '128 archived copies') {
              throw new Error(`Onboarding retained-copy evidence was not rendered; received ${retainedCopyText || 'none'}.`)
            }
          }
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_DISMISS_ONBOARDING === '1') {
          await window.webContents.executeJavaScript(`
            [...document.querySelectorAll('.onboarding-footer button')]
              .find((button) => button.textContent?.trim() === 'Recovery & diagnostics')
              ?.click()
          `)
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_HYDRATE_ALL_MODES === '1') {
          interactionTimings.allModeHydrationMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const cached = await window.cairnCodex.getCachedCollection([], 'archive')
              const sourcePaths = (cached?.availableStashes ?? cached?.scannedStashes ?? [])
                .map((stash) => stash.path)
              let pending = 1
              while (pending > 0) {
                const result = await window.cairnCodex.hydrateArchiveRolls(sourcePaths)
                if (!result) throw new Error('Archive hydration returned no result.')
                pending = result.pending
                if (result.processed === 0 && pending > 0) {
                  throw new Error('Archive hydration made no progress.')
                }
                if (pending > 0) await new Promise((resolve) => setTimeout(resolve, 0))
              }
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_ENABLE_ALL_TOOLS === '1') {
          const enabledAllTools = await window.webContents.executeJavaScript(`
            (async () => {
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const button = (selector, label) => [...document.querySelectorAll(selector)]
                .find((candidate) => candidate.textContent?.trim() === label)
              button('.workspace-sidebar [data-destination-id]', 'Settings')?.click()
              await frames()
              const experimental = document.querySelector('.experimental-tools-toggle input')
              if (experimental instanceof HTMLInputElement && !experimental.checked) experimental.click()
              await frames()
              button('.workspace-tool-presets button', 'Show all')?.click()
              await frames()
              const collection = button('.workspace-sidebar [data-destination-id]', 'Collection')
              collection?.click()
              await frames()
              return Boolean(collection)
            })()
          `)
          if (!enabledAllTools) throw new Error('Could not enable all tools in the isolated screenshot profile.')
        }
        const category = process.env.CAIRN_CODEX_SCREENSHOT_CATEGORY
        if (category) {
          const categoryResult = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              await new Promise((resolve) => setTimeout(resolve, 100))
              document.querySelector('.onboarding-skip')?.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const destination = [...document.querySelectorAll('.workspace-sidebar [data-tool-id], .workspace-sidebar [data-destination-id], .category-tabs button')]
                .find((button) =>
                  (button.querySelector('.workspace-nav-label')?.textContent ?? button.querySelector('span')?.textContent ?? button.textContent)?.trim() === ${JSON.stringify(category)})
              destination?.click()
              await new Promise((resolve) => setTimeout(resolve, 100))
              return { elapsedMs: performance.now() - started, opened: Boolean(destination) }
            })()
          `)
          if (!categoryResult.opened) throw new Error(`Screenshot category was not available: ${category}.`)
          interactionTimings.categoryMs = categoryResult.elapsedMs
        }
        const plannerDisplay = process.env.CAIRN_CODEX_SCREENSHOT_PLANNER_DISPLAY
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_WORKSPACE_SIDEBAR === '1') {
          interactionTimings.workspaceSidebarMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              await frames()
              const sidebar = document.querySelector('.workspace-sidebar')
              const collection = sidebar?.querySelector('[data-destination-id="collection"]')
              const active = sidebar?.querySelector('.workspace-nav-tools [aria-current="page"]')
              const transfers = sidebar?.querySelector('[data-destination-id="vault"]')
              const settings = sidebar?.querySelector('[data-destination-id="settings"]')
              const customize = sidebar?.querySelector('[aria-label="Customize visible tools"]')
              const toggle = sidebar?.querySelector('.workspace-sidebar-toggle')
              if (!sidebar || !(collection instanceof HTMLButtonElement) || !(transfers instanceof HTMLButtonElement) ||
                  !(settings instanceof HTMLButtonElement) || !active || !customize || !toggle) {
                throw new Error('The workspace sidebar did not render all required controls.')
              }
              const sidebarRect = sidebar.getBoundingClientRect()
              const activeRect = active.getBoundingClientRect()
              const navItems = [...sidebar.querySelectorAll('.workspace-nav-item')]
                .filter((item) => item.getClientRects().length > 0)
              const activeIconRect = active.querySelector('.workspace-nav-svg')?.getBoundingClientRect()
              const visibleControls = [collection, active, transfers, settings, customize, toggle]
                .filter((control) => control.getClientRects().length > 0)
              for (const control of visibleControls) {
                control.focus()
                if (document.activeElement !== control) throw new Error('A workspace sidebar control could not receive keyboard focus.')
              }
              if (
                Math.abs(sidebarRect.left) > 1 || sidebarRect.right > window.innerWidth ||
                activeRect.left < sidebarRect.left - 1 || activeRect.right > sidebarRect.right + 1 ||
                document.documentElement.scrollWidth > window.innerWidth + 1
              ) {
                throw new Error('The workspace sidebar is clipped or causing page-level overflow.')
              }
              if (
                navItems.some((item) => !item.querySelector('.workspace-nav-svg')) ||
                !activeIconRect || activeIconRect.width < 20 || activeIconRect.height < 20
              ) {
                throw new Error('The workspace sidebar did not render its complete legible icon set.')
              }
              const activeLabel = active.querySelector('.workspace-nav-label')?.textContent?.trim()
              const activeLabelElement = active.querySelector('.workspace-nav-label')
              const toggleVisible = toggle.getClientRects().length > 0
              const beganCollapsed = sidebar.classList.contains('collapsed')
              const assertControlTooltip = (control, context) => {
                const tooltip = document.querySelector('.workspace-nav-tooltip')
                const tooltipRect = tooltip?.getBoundingClientRect()
                if (
                  !(tooltip instanceof HTMLElement) || tooltip.textContent?.trim() !== control.getAttribute('aria-label') ||
                  !tooltipRect || tooltipRect.left < sidebar.getBoundingClientRect().right - 1
                ) {
                  throw new Error('Compact workspace navigation lost its destination label during ' + context + '.')
                }
              }
              if (toggleVisible) {
                toggle.focus()
                toggle.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
                toggle.dispatchEvent(new MouseEvent('mouseenter'))
                await frames()
                if (beganCollapsed) assertControlTooltip(toggle, 'initial compact toggle focus')
                else if (document.querySelector('.workspace-nav-tooltip')) {
                  throw new Error('Expanded workspace navigation exposed a redundant tooltip.')
                }
                if (beganCollapsed) {
                  toggle.click()
                  await frames()
                  if (document.querySelector('.workspace-nav-tooltip')) {
                    throw new Error('Expanding workspace navigation retained its compact tooltip.')
                  }
                  toggle.click()
                  await frames()
                } else {
                  toggle.click()
                  await frames()
                  assertControlTooltip(toggle, 'collapse with retained hover and focus')
                  toggle.click()
                  await frames()
                  if (document.querySelector('.workspace-nav-tooltip')) {
                    throw new Error('Re-expanding workspace navigation retained its compact tooltip.')
                  }
                  toggle.click()
                  await frames()
                }
                assertControlTooltip(toggle, 'return to compact navigation')
                toggle.dispatchEvent(new MouseEvent('mouseleave'))
                toggle.blur()
                toggle.dispatchEvent(new FocusEvent('blur'))
                await frames()
              }
              if (!(activeLabelElement instanceof HTMLElement) || getComputedStyle(activeLabelElement).display !== 'none') {
                throw new Error('The workspace sidebar did not reach an icon-only state for label verification.')
              }
              active.blur()
              active.dispatchEvent(new FocusEvent('blur'))
              await frames()
              active.focus()
              active.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
              await frames()
              assertControlTooltip(active, 'keyboard focus')
              active.dispatchEvent(new MouseEvent('mouseenter'))
              active.blur()
              active.dispatchEvent(new FocusEvent('blur'))
              await frames()
              assertControlTooltip(active, 'pointer hover after focus left')
              active.focus()
              active.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
              active.dispatchEvent(new MouseEvent('mouseleave'))
              await frames()
              assertControlTooltip(active, 'keyboard focus after pointer left')
              active.blur()
              active.dispatchEvent(new FocusEvent('blur'))
              await frames()
              if (document.querySelector('.workspace-nav-tooltip')) {
                throw new Error('Compact workspace navigation retained a tooltip after hover and focus both left.')
              }
              if (toggleVisible && !beganCollapsed) {
                toggle.click()
                await frames()
                if (sidebar.classList.contains('collapsed')) throw new Error('The workspace sidebar did not leave compact mode.')
              }
              customize.click()
              await frames()
              const activeSetting = [...document.querySelectorAll('.tool-settings-options label')]
                .find((label) => label.querySelector('strong')?.textContent?.trim().startsWith(activeLabel))
                ?.querySelector('input')
              if (!(activeSetting instanceof HTMLInputElement) || !activeSetting.checked) {
                throw new Error('The active specialist was not represented in tool customization.')
              }
              activeSetting.click()
              await frames()
              if (
                !document.querySelector('.hero') ||
                !document.querySelector('.workspace-sidebar') ||
                collection.getAttribute('aria-current') !== 'page'
              ) {
                throw new Error('Hiding the active specialist did not return to the Collection dashboard.')
              }
              activeSetting.click()
              document.querySelector('.tool-settings-done')?.click()
              await frames()
              const restoredDestination = [...document.querySelectorAll('.workspace-sidebar [data-tool-id]')]
                .find((button) => button.querySelector('.workspace-nav-label')?.textContent?.trim() === activeLabel)
              restoredDestination?.click()
              await frames()
              if (document.querySelector('.workspace-sidebar .workspace-nav-tools [aria-current="page"] .workspace-nav-label')?.textContent?.trim() !== activeLabel) {
                throw new Error('The restored specialist did not reopen in the focused shell.')
              }
              return performance.now() - started
            })()
          `)
        }
        if (plannerDisplay) {
          const plannerDisplayLabel = ({ table: 'Table', cards: 'Journey', journey: 'Journey', map: 'MI sources' } as Record<string, string>)[plannerDisplay] ?? ''
          await window.webContents.executeJavaScript(`
            (async () => {
              const label = ${JSON.stringify(plannerDisplayLabel)}
              ;[...document.querySelectorAll('.planner-display button')]
                .find((button) => button.textContent?.trim() === label)
                ?.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            })()
          `)
        }
        const transferSection = process.env.CAIRN_CODEX_SCREENSHOT_TRANSFER_SECTION
        if (transferSection) {
          await window.webContents.executeJavaScript(`
            (async () => {
              ;[...document.querySelectorAll('.transfer-section-tabs button')]
                .find((button) => button.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(transferSection)})
                ?.click()
              await new Promise((resolve) => setTimeout(resolve, 250))
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_TRANSFERS_WORKSPACE === '1') {
          interactionTimings.transfersWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const workspace = document.querySelector('.vault-workspace')
              if (!workspace || document.querySelector('.workspace-sidebar [data-destination-id="vault"]')?.getAttribute('aria-current') !== 'page') {
                throw new Error('Transfers lost the persistent application navigation or active destination.')
              }
              const sectionButtons = [...workspace.querySelectorAll('.transfer-section-tabs button')]
              if (sectionButtons.length !== 3) throw new Error('Transfers did not retain its three section controls.')
              const activeSection = () => workspace.querySelector('.transfer-section-tabs button.active strong')?.textContent?.trim()
              if (activeSection() !== 'Dispense history') throw new Error('Transfers section model did not accept the requested history route.')
              const historyInput = workspace.querySelector('.vault-explorer-toolbar input')
              if (!(historyInput instanceof HTMLInputElement) || historyInput.value !== 'failed') {
                throw new Error('Transfers history query model did not restore its typed route value.')
              }
              const outcome = workspace.querySelector('.vault-explorer-toolbar select')
              if (!(outcome instanceof HTMLSelectElement)) throw new Error('Transfers outcome control was not rendered.')
              outcome.value = 'failed'
              outcome.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              if (outcome.value !== 'failed') throw new Error('Transfers history outcome model did not update.')

              const quarantine = sectionButtons.find((button) => button.textContent?.includes('Quarantined items'))
              if (!(quarantine instanceof HTMLButtonElement)) throw new Error('Transfers quarantine control was not rendered.')
              quarantine.click()
              await frames()
              if (!workspace.querySelector('.quarantine-workspace') || workspace.querySelector('.operation-history')) {
                throw new Error('Transfers section switch did not replace history with quarantine.')
              }
              const modeButtons = [...workspace.querySelectorAll('.transfer-mode-tabs button')]
              if (modeButtons.length !== 2) throw new Error('Transfers quarantine did not retain both return modes.')
              modeButtons[1].click()
              await frames()
              if (!workspace.querySelector('.vault-target') || !modeButtons[1].classList.contains('active')) {
                throw new Error('Transfers offline return-mode model did not update its presentation.')
              }
              const returnButton = workspace.querySelector('.quarantine-actions button')
              if (!(returnButton instanceof HTMLButtonElement) || !returnButton.disabled) {
                throw new Error('Empty quarantine unexpectedly enabled a destructive return action.')
              }

              const dispense = sectionButtons.find((button) => button.textContent?.includes('Dispense history'))
              dispense?.click()
              await frames()
              if (activeSection() !== 'Dispense history' || historyInput.value !== 'failed') {
                throw new Error('Transfers session did not preserve history controls across section remounts.')
              }
              const controls = window.history.state?.route?.controls
              if (
                window.history.state?.route?.workspace !== 'vault' ||
                controls?.section !== 'dispense-history' ||
                controls?.historyQuery !== 'failed' ||
                controls?.historyOutcome !== 'failed' ||
                controls?.mode !== 'offline'
              ) {
                throw new Error('Transfers session changes were not reflected in typed route state.')
              }
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_COLLAPSE_TRACKERS === '1') {
          await window.webContents.executeJavaScript(`
            (() => {
              const toggle = document.querySelector('.completion-tracker > header button')
              if (toggle?.getAttribute('aria-expanded') === 'true') toggle.click()
            })()
          `)
        } else if (process.env.CAIRN_CODEX_SCREENSHOT_EXPAND_TRACKERS === '1') {
          await window.webContents.executeJavaScript(`
            (() => {
              const toggle = document.querySelector('.completion-tracker > header button')
              if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_PLANNER_ACTIONS === '1') {
          const keyboardFavoriteState = await window.webContents.executeJavaScript(`
            (async () => {
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const favorite = document.querySelector('.leveling-planner .research-item-actions button, .leveling-planner .planner-journey-actions button')
              if (!(favorite instanceof HTMLButtonElement)) throw new Error('Planner keyboard verification could not find the favorite control.')
              favorite.focus()
              if (document.activeElement !== favorite) throw new Error('Planner favorite control did not accept keyboard focus.')
              const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
              favorite.dispatchEvent(enter)
              if (enter.defaultPrevented) throw new Error('Planner row intercepted Enter from its nested favorite control.')
              favorite.click()
              await frames()
              const state = {
                active: favorite.classList.contains('active'),
                drawer: Boolean(document.querySelector('.item-drawer')),
                focused: document.activeElement === favorite
              }
              favorite.click()
              await frames()
              return { ...state, cleared: !favorite.classList.contains('active') }
            })()
          `) as { active: boolean, drawer: boolean, focused: boolean, cleared: boolean }
          if (!keyboardFavoriteState.active || keyboardFavoriteState.drawer || !keyboardFavoriteState.cleared) {
            throw new Error(`Planner nested favorite keyboard contract failed: ${JSON.stringify(keyboardFavoriteState)}`)
          }
          interactionTimings.plannerActionsMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const resultCount = () => Number((document.querySelector('.planner-explorer-toolbar .explorer-result-count')?.textContent ?? '').replace(/[^0-9]/g, ''))
              const buttons = document.querySelectorAll('.leveling-planner .research-item-actions button, .leveling-planner .planner-journey-actions button')
              const favorite = buttons?.[0]
              const ignore = buttons?.[1]
              if (!(favorite instanceof HTMLButtonElement) || !(ignore instanceof HTMLButtonElement)) {
                throw new Error('Planner action verification could not find favorite and ignore controls.')
              }
              favorite.click()
              await frames()
              if (!favorite.classList.contains('active') || document.querySelector('.item-drawer')) {
                throw new Error('Planner favorite did not toggle independently of item activation.')
              }
              favorite.click()
              await frames()
              if (favorite.classList.contains('active')) throw new Error('Planner favorite did not toggle off.')
              ignore.click()
              await frames()
              if (resultCount() !== 119 || document.querySelector('.item-drawer')) {
                throw new Error('Planner ignore did not remove exactly one result without opening the item.')
              }
              const profileSelect = document.querySelector('#planner-profile-select')
              const originalProfile = profileSelect.value
              document.querySelector('.planner-new-plan').click()
              await frames()
              ;[...document.querySelectorAll('.planner-setup-dialog [role="radio"]')].find(button => button.textContent.includes('Clone')).click()
              await frames()
              for (let step = 0; step < 4; step++) {
                document.querySelector('.planner-setup-dialog footer button:not(.secondary)').click()
                await frames()
              }
              if (profileSelect.value === originalProfile || resultCount() !== 120) throw new Error("A new plan inherited another plan's ignored base.")
              const newProfile = profileSelect.value
              profileSelect.value = originalProfile
              profileSelect.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              if (resultCount() !== 119) throw new Error("Switching back lost the original plan's ignored base.")
              profileSelect.value = newProfile
              profileSelect.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              if (resultCount() !== 120) throw new Error('Ignored bases leaked during plan switching.')
              profileSelect.value = originalProfile
              profileSelect.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              const listFilter = document.querySelectorAll('.planner-explorer-toolbar .explorer-toolbar-filters select')[1]
              if (!(listFilter instanceof HTMLSelectElement)) throw new Error('Planner ignored-list filter was not available.')
              listFilter.value = 'true'
              listFilter.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              if (resultCount() !== 1) throw new Error('Planner ignored-list filter did not reveal the ignored base.')
              const restore = document.querySelectorAll('.leveling-planner .research-item-actions button, .leveling-planner .planner-journey-actions button')[1]
              if (!(restore instanceof HTMLButtonElement) || restore.textContent?.trim() !== 'Restore') {
                throw new Error('Planner ignored result did not expose Restore.')
              }
              restore.click()
              await frames()
              if (resultCount() !== 0) throw new Error('Planner Restore did not remove the base from the ignored list.')
              listFilter.value = 'false'
              listFilter.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              if (resultCount() !== 120) throw new Error('Planner shopping list did not recover after restoring the base.')
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_PLANNER_SCROLLING === '1') {
          interactionTimings.plannerScrollingMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const waitFor = async (predicate, failure) => {
                for (let attempt = 0; attempt < 80; attempt += 1) {
                  if (predicate()) return
                  await wait(25)
                }
                throw new Error(failure)
              }
              const buttons = [...document.querySelectorAll('.planner-display button')]
              const list = buttons.find((button) => button.textContent?.trim() === 'Table')
              const grid = buttons.find((button) => button.textContent?.trim() === 'Journey')
              if (!(list instanceof HTMLButtonElement) || !(grid instanceof HTMLButtonElement)) {
                throw new Error('Planner scrolling verification could not find Table and Journey views.')
              }
              if (!list.classList.contains('active')) list.click()
              await frames()
              let surface = document.querySelector('.research-item-table')
              if (!(surface instanceof HTMLElement)) throw new Error('Planner table surface was not rendered.')
              const levelHeader = [...surface.querySelectorAll('[role="columnheader"]')].find(header => header.textContent.trim().startsWith('Level'))
              const levelSort = levelHeader.querySelector('button')
              const originalDirection = levelHeader.getAttribute('aria-sort')
              levelSort.click()
              await frames()
              if (levelHeader.getAttribute('aria-sort') === originalDirection) throw new Error('Clicking the active Planner header did not reverse sorting.')
              const sortedLevels = [...surface.querySelectorAll('.research-level')].map(cell => Number(cell.textContent.trim()))
              const descending = levelHeader.getAttribute('aria-sort') === 'descending'
              if (sortedLevels.some((level, index) => index > 0 && (descending ? level > sortedLevels[index - 1] : level < sortedLevels[index - 1]))) throw new Error('Planner header arrow changed without sorting rows.')
              levelSort.click()
              await frames()
              if (!surface.textContent.includes('30% Weapon Damage (Fixture Talons)')) throw new Error("Planner hid its selected skill's granted-ability weapon modifier.")
              if (getComputedStyle(surface).maxHeight !== 'none' || surface.clientHeight <= innerHeight) {
                throw new Error('Planner table still creates a bottom-bounded vertical viewport.')
              }
              const initialRows = [...surface.querySelectorAll('.bounded-results-item')]
              const tableStyle = getComputedStyle(surface)
              const gutter = surface.offsetWidth - surface.clientWidth - parseFloat(tableStyle.borderLeftWidth) - parseFloat(tableStyle.borderRightWidth)
              if (gutter > 1) throw new Error('Planner table reserves a blank right-hand scrollbar gutter: ' + gutter)
              const fx = surface.querySelector('.research-skill-fx')
              if (!fx?.querySelector('.tone-fx') || !fx.textContent.includes('Alternate crimson spirit effect') || !fx.textContent.includes('Alternate azure storm effect')) {
                throw new Error('Planner table did not render all item-wide Skill FX transformations.')
              }
              if (initialRows.length !== 50) throw new Error('Planner continuous window started with ' + initialRows.length + ' mounted rows instead of 50.')
              initialRows[0]?.focus()
              initialRows[0]?.dispatchEvent(new FocusEvent('focus'))
              await waitFor(() => document.querySelector('.game-tooltip'), 'Focused planner row did not open its tooltip.')
              if (document.activeElement !== initialRows[0]) throw new Error('The initial planner row did not receive DOM focus.')
              const tooltip = document.querySelector('.game-tooltip')
              if (!(tooltip instanceof HTMLElement)) throw new Error('Planner tooltip was not rendered.')
              const tooltipInlineStyle = tooltip.style.cssText
              const tooltipScrollTop = tooltip.scrollTop
              const tooltipScrollProbe = document.createElement('div')
              tooltipScrollProbe.setAttribute('aria-hidden', 'true')
              tooltipScrollProbe.style.cssText = 'height:480px;min-height:480px;flex:0 0 480px'
              tooltip.appendChild(tooltipScrollProbe)
              tooltip.style.height = '120px'
              tooltip.style.maxHeight = '120px'
              tooltip.style.overflowY = 'auto'
              await frames()
              if (tooltip.scrollHeight <= tooltip.clientHeight) {
                throw new Error('Planner tooltip scroll verification could not create deterministic overflow.')
              }
              tooltip.scrollTop = 0
              const wheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
              tooltip.dispatchEvent(wheel)
              await frames()
              if (!wheel.defaultPrevented || tooltip.scrollTop <= 0) {
                throw new Error('Ordinary mouse-wheel input did not scroll the overflowing planner tooltip.')
              }
              const pageWheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
              window.dispatchEvent(pageWheel)
              if (pageWheel.defaultPrevented) {
                throw new Error('A visible planner tooltip captured ordinary wheel input targeted outside it.')
              }
              tooltipScrollProbe.remove()
              tooltip.style.cssText = tooltipInlineStyle
              tooltip.scrollTop = tooltipScrollTop

              const firstText = initialRows[0]?.textContent?.replace(/\\s+/g, ' ').trim()
              const firstBottom = surface.querySelector('.bounded-results-continuation.is-next')
              if (!(firstBottom instanceof HTMLElement)) throw new Error('Planner continuous-scroll sentinel was not rendered.')
              firstBottom.scrollIntoView({ block: 'end' })
              await waitFor(
                () => surface.querySelectorAll('.bounded-results-item').length > 50,
                'Scrolling to the planner boundary did not append the second bounded page.'
              )
              await frames(); await frames()
              let rows = [...surface.querySelectorAll('.bounded-results-item')]
              if (rows.length > 100 || document.activeElement !== initialRows[0]) {
                throw new Error('The second planner window exceeded its DOM bound or lost focus prematurely.')
              }
              const secondBottom = surface.querySelector('.bounded-results-continuation.is-next')
              if (!(secondBottom instanceof HTMLElement)) throw new Error('Planner did not expose the next continuous boundary.')
              secondBottom.scrollIntoView({ block: 'end' })
              await waitFor(
                () => surface.querySelector('.bounded-results-item')?.textContent?.replace(/\\s+/g, ' ').trim() !== firstText,
                'Observer-driven planner scrolling did not advance its bounded two-page window.'
              )
              await frames(); await frames()
              rows = [...surface.querySelectorAll('.bounded-results-item')]
              const focusedAfterEviction = document.activeElement
              if (
                rows.length > 100 ||
                !(focusedAfterEviction instanceof HTMLElement) ||
                !focusedAfterEviction.classList.contains('bounded-results-item') ||
                focusedAfterEviction.textContent?.replace(/\\s+/g, ' ').trim() === firstText ||
                !surface.querySelector('.bounded-results-continuation.is-previous button')
              ) {
                throw new Error('Planner continuous scrolling did not advance its bounded two-page window.')
              }
              const listCount = surface.querySelectorAll('.bounded-results-item').length
              const focusedKey = focusedAfterEviction.dataset.resultKey
              const unobscuredTop = () => {
                const topbar = document.querySelector('.topbar')
                return topbar instanceof HTMLElement ? Math.max(0, topbar.getBoundingClientRect().bottom) : 0
              }
              // Chromium can place adjacent layout edges a fractional pixel apart at some
              // display scales. Treat a one-pixel overlap as the same visible boundary.
              const viewportTolerance = 1
              grid.click()
              await frames(); await frames()
              const gridCards = document.querySelectorAll('.planner-journey-results .bounded-results-item').length
              const journeyFx = document.querySelector('.planner-journey-results .research-skill-fx')
              if (!journeyFx?.textContent.includes('Alternate crimson spirit effect') || !journeyFx.textContent.includes('Alternate azure storm effect')) {
                throw new Error('Planner Journey dropped item-wide Skill FX transformations behind its first modifier.')
              }
              const gridFocus = document.activeElement
              const gridFocusRect = gridFocus instanceof HTMLElement ? gridFocus.getBoundingClientRect() : null
              if (
                gridCards !== listCount ||
                !grid.classList.contains('active') ||
                !(gridFocus instanceof HTMLElement) ||
                gridFocus.dataset.resultKey !== focusedKey ||
                !gridFocusRect ||
                gridFocusRect.top < unobscuredTop() - viewportTolerance ||
                gridFocusRect.top >= innerHeight + viewportTolerance
              ) {
                throw new Error('Planner Journey view did not preserve the focused visible result and continuous window: ' + JSON.stringify({
                  gridCards, listCount, active: grid.classList.contains('active'), focusedKey,
                  gridFocusKey: gridFocus instanceof HTMLElement ? gridFocus.dataset.resultKey : null,
                  top: gridFocusRect?.top, bottom: gridFocusRect?.bottom, unobscuredTop: unobscuredTop(), innerHeight
                }))
              }
              list.click()
              await frames(); await frames()
              const restoredSurface = document.querySelector('.research-item-table')
              const restoredFocus = document.activeElement
              const restoredFocusRect = restoredFocus instanceof HTMLElement ? restoredFocus.getBoundingClientRect() : null
              if (
                !(restoredSurface instanceof HTMLElement) ||
                !list.classList.contains('active') ||
                !(restoredFocus instanceof HTMLElement) ||
                restoredFocus.dataset.resultKey !== focusedKey ||
                !restoredFocusRect ||
                restoredFocusRect.top < unobscuredTop() - viewportTolerance ||
                restoredFocusRect.top >= innerHeight + viewportTolerance
              ) {
                throw new Error('Planner Table view did not restore the focused visible result and continuous window: ' + JSON.stringify({
                  focusedKey, restoredFocusKey: restoredFocus instanceof HTMLElement ? restoredFocus.dataset.resultKey : null,
                  top: restoredFocusRect?.top, bottom: restoredFocusRect?.bottom, unobscuredTop: unobscuredTop(), innerHeight
                }))
              }
              surface = restoredSurface
              const trailingFocus = [...surface.querySelectorAll('.bounded-results-item')].at(-1)
              if (!(trailingFocus instanceof HTMLElement)) throw new Error('Planner trailing-page focus target was not rendered.')
              trailingFocus.focus()
              trailingFocus.dispatchEvent(new FocusEvent('focus'))
              const trailingKey = trailingFocus.dataset.resultKey
              if (document.activeElement !== trailingFocus) throw new Error('Planner trailing-page item did not receive focus.')
              const previousBoundary = surface.querySelector('.bounded-results-continuation.is-previous')
              if (!(previousBoundary instanceof HTMLElement)) throw new Error('Planner previous-window boundary was not rendered.')
              previousBoundary.scrollIntoView({ block: 'start' })
              await waitFor(
                () => surface.querySelector('.bounded-results-item')?.textContent?.replace(/\\s+/g, ' ').trim() === firstText,
                'Planner backward restoration did not recover the first result window.'
              )
              await frames(); await frames()
              const backwardFocus = document.activeElement
              if (
                surface.querySelectorAll('.bounded-results-item').length > 100 ||
                !(backwardFocus instanceof HTMLElement) ||
                !backwardFocus.classList.contains('bounded-results-item') ||
                backwardFocus.dataset.resultKey === trailingKey ||
                !surface.contains(backwardFocus)
              ) {
                throw new Error('Planner backward restoration exceeded its DOM bound or lost trailing-page focus.')
              }
              return performance.now() - started
            })()
          `)
        }
        const supplyCategory = process.env.CAIRN_CODEX_SCREENSHOT_SUPPLY_CATEGORY
        if (supplyCategory) {
          await window.webContents.executeJavaScript(`
            (async () => {
              const select = document.querySelector('.supplies-workspace .explorer-toolbar-filters select')
              if (!(select instanceof HTMLSelectElement)) throw new Error('Supply category control was not rendered.')
              select.value = ${JSON.stringify(supplyCategory)}
              select.dispatchEvent(new Event('change', { bubbles: true }))
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_BOUNDED_GRID_SEMANTICS === '1') {
          interactionTimings.boundedGridSemanticsMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const workspaceButton = (label) => [...document.querySelectorAll('.workspace-sidebar [data-tool-id]')]
                .find((button) => button.querySelector('.workspace-nav-label')?.textContent?.trim() === label)
              const openWorkspace = async (label) => {
                const button = workspaceButton(label)
                if (!(button instanceof HTMLButtonElement)) throw new Error(label + ' workspace control was not available.')
                button.click()
                await frames()
              }
              const assertGrid = (selector, label, expectedCount) => {
                const root = document.querySelector(selector)
                const collection = root?.querySelector(':scope > .bounded-results-collection')
                if (!(root instanceof HTMLElement) || collection?.getAttribute('role') !== 'grid') {
                  throw new Error(label + ' did not expose a grid result collection.')
                }
                const rows = [...collection.children]
                if (rows.length !== expectedCount || rows.some((row) => row.getAttribute('role') !== 'row')) {
                  throw new Error(label + ' did not expose exactly ' + expectedCount + ' direct grid rows.')
                }
                const cells = rows.map((row) => row.querySelector(':scope > .bounded-results-item[role="gridcell"]'))
                if (cells.some((cell) => !(cell instanceof HTMLElement))) {
                  throw new Error(label + ' grid rows did not each own one direct gridcell.')
                }
                if (cells[0]?.tabIndex !== 0 || cells.slice(1).some((cell) => cell.tabIndex !== -1)) {
                  throw new Error(label + ' did not retain one roving gridcell tab stop.')
                }
                return cells
              }
              const verifyGridNavigation = async (cells, label) => {
                if (cells.length < 2) throw new Error(label + ' needs at least two cells for keyboard verification.')
                const first = cells[0]
                const firstTop = first.getBoundingClientRect().top
                const expectedDown = cells.find((cell) => cell.getBoundingClientRect().top > firstTop + 1) ?? first
                first.focus()
                first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
                await frames()
                if (document.activeElement !== expectedDown) {
                  throw new Error(label + ' ArrowDown did not follow the visual grid after semantic row wrapping: ' + JSON.stringify({
                    first: { key: first.dataset.resultKey, left: first.getBoundingClientRect().left, top: firstTop },
                    expected: {
                      key: expectedDown.dataset.resultKey,
                      left: expectedDown.getBoundingClientRect().left,
                      top: expectedDown.getBoundingClientRect().top
                    },
                    actual: document.activeElement instanceof HTMLElement
                      ? {
                          key: document.activeElement.dataset.resultKey,
                          className: document.activeElement.className,
                          left: document.activeElement.getBoundingClientRect().left,
                          top: document.activeElement.getBoundingClientRect().top
                        }
                      : null
                  }))
                }
                expectedDown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
                await frames()
                if (document.activeElement !== first) {
                  throw new Error(label + ' ArrowUp did not return through the visual grid after semantic row wrapping.')
                }
              }

              const collectionCells = assertGrid('.catalog-results', 'Collection', 48)
              const ownedCollectionCards = document.querySelectorAll('.item-card:not(.missing)').length
              if (ownedCollectionCards < 2) throw new Error('The bounded-grid fixture did not preserve seeded archive evidence.')
              await verifyGridNavigation(collectionCells, 'Collection')
              collectionCells[0].click()
              await frames()
              if (!document.querySelector('.item-drawer')) throw new Error('Collection gridcell activation did not open its item drawer.')
              document.querySelector('.drawer-close')?.click()
              await frames()

              await openWorkspace('Stash Oracle')
              const oracleRoot = document.querySelector('.oracle-results')
              const oracleCount = oracleRoot?.querySelectorAll('.bounded-results-row').length ?? 0
              if (oracleCount < 2 || oracleCount > 12) {
                throw new Error('Stash Oracle rendered ' + oracleCount + ' rows after Collection showed ' + ownedCollectionCards + ' owned cards.')
              }
              const oracleCells = assertGrid('.oracle-results', 'Stash Oracle', oracleCount)
              await verifyGridNavigation(oracleCells, 'Stash Oracle')

              await openWorkspace('Supplies')
              for (let attempt = 0; attempt < 100 && !document.querySelector('.supply-results .bounded-results-state.is-empty'); attempt++) {
                await new Promise(resolve => setTimeout(resolve, 50))
              }
              if (!document.querySelector('.supply-results .bounded-results-state.is-empty')) {
                throw new Error('Supplies did not retain its shared empty state before selecting augments.')
              }
              const category = document.querySelector('.supplies-workspace .explorer-toolbar-filters select')
              if (!(category instanceof HTMLSelectElement)) throw new Error('Supplies category control was not rendered.')
              category.value = 'augments'
              category.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              for (let attempt = 0; attempt < 100 && document.querySelectorAll('.supply-results .bounded-results-row').length !== 6; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 50))
              }
              const supplyCells = assertGrid('.supply-results', 'Supplies', 6)
              if (supplyCells.some((cell) => cell.getAttribute('aria-selected') !== 'false' || cell.getAttribute('aria-disabled') !== 'true')) {
                throw new Error('Supplies selection and disabled semantics did not remain on each gridcell.')
              }
              supplyCells[0].focus()
              supplyCells[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
              await frames()
              if (supplyCells[0].getAttribute('aria-selected') !== 'false') {
                throw new Error('Disabled Supplies gridcell changed selection after keyboard activation.')
              }
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_BOUNDED_KEYBOARD === '1') {
          interactionTimings.boundedKeyboardMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const rows = [...document.querySelectorAll('.bounded-tooltip-results .bounded-results-item')]
              if (rows.length < 2) throw new Error('Bounded keyboard verification needs at least two mounted rows.')
              rows[0].focus()
              rows[0].dispatchEvent(new FocusEvent('focus'))
              for (let attempt = 0; attempt < 20 && !document.querySelector('.game-tooltip'); attempt += 1) {
                await wait(25)
              }
              if (document.activeElement !== rows[0]) throw new Error('The first bounded row did not receive focus.')
              if (!document.querySelector('.game-tooltip')) throw new Error('Focused MI row did not open the shared item tooltip.')
              const firstTop = rows[0].offsetTop
              const expectedDown = rows.find((row) => row.offsetTop > firstTop) ?? rows[1]
              rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              await wait(20)
              if (document.activeElement !== expectedDown) throw new Error('ArrowDown did not move focus to the next bounded row.')
              expectedDown.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
              await wait(20)
              if (document.activeElement !== rows.at(-1)) throw new Error('End did not move focus to the last mounted row.')
              rows.at(-1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
              await wait(20)
              if (document.activeElement !== rows[0]) throw new Error('Home did not restore focus to the first mounted row.')
              const firstPageFirstRow = rows[0].textContent?.replace(/\s+/g, ' ').trim()
              const nextPage = document.querySelector('.bounded-tooltip-results .bounded-results-footer nav button:last-of-type')
              if (!(nextPage instanceof HTMLButtonElement) || nextPage.disabled) {
                throw new Error('Bounded keyboard verification needs an enabled next-page control.')
              }
              nextPage.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const nextRows = [...document.querySelectorAll('.bounded-tooltip-results .bounded-results-item')]
              const nextPageFirstRow = nextRows[0]?.textContent?.replace(/\s+/g, ' ').trim()
              if (nextRows.length === 0 || nextRows.length > rows.length || nextPageFirstRow === firstPageFirstRow) {
                throw new Error('Next did not replace the mounted bounded page.')
              }
              const previousPage = document.querySelector('.bounded-tooltip-results .bounded-results-footer nav button:first-of-type')
              if (!(previousPage instanceof HTMLButtonElement) || previousPage.disabled) {
                throw new Error('The bounded previous-page control did not enable on page two.')
              }
              previousPage.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const restoredFirstRow = document.querySelector('.bounded-tooltip-results .bounded-results-item')?.textContent?.replace(/\s+/g, ' ').trim()
              if (restoredFirstRow !== firstPageFirstRow) throw new Error('Previous did not restore the first bounded page.')
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_SETS_PAGING === '1') {
          interactionTimings.setsPagingMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const root = document.querySelector('.set-results')
              const cards = () => [...document.querySelectorAll('.set-results .set-card')]
              const firstRecord = () => cards()[0]?.getAttribute('data-set-record')
              const pageText = () => root?.querySelector('.bounded-results-footer nav span')?.textContent?.trim() ?? ''
              const rangeText = () => root?.querySelector('.bounded-results-footer > span')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
              const nextButton = () => root?.querySelector('.bounded-results-footer nav button:last-of-type')
              const goToSecondPage = async () => {
                const next = nextButton()
                if (!(next instanceof HTMLButtonElement) || next.disabled) {
                  throw new Error('Sets did not expose an enabled next-page control.')
                }
                next.click()
                await frames()
                if (!pageText().includes('Page 2')) throw new Error('Sets did not advance to page two.')
              }
              const changeSelect = async (select, value, label) => {
                if (!(select instanceof HTMLSelectElement)) throw new Error('Sets ' + label + ' control was not available.')
                select.value = value
                select.dispatchEvent(new Event('change', { bubbles: true }))
                await frames()
                if (!pageText().includes('Page 1') && !rangeText().startsWith('1–')) {
                  throw new Error(
                    'Sets paging did not reset after ' + label + ' changed; page=' + pageText() +
                    ', range=' + rangeText() + ', cards=' + cards().length + ', value=' + select.value + '.'
                  )
                }
              }
              if (!root || cards().length !== 50) {
                throw new Error('The 202-set fixture did not mount exactly 50 set cards on page one.')
              }
              const collection = root.querySelector('.bounded-results-collection')
              const semanticItems = [...root.querySelectorAll('.bounded-results-item')]
              if (collection?.getAttribute('role') !== 'list' || semanticItems.some((item) => item.getAttribute('role') !== 'listitem')) {
                throw new Error('Passive Set cards did not retain valid list/listitem semantics inside their visual grid.')
              }
              const firstPageRecord = firstRecord()
              if (!firstPageRecord) throw new Error('Sets did not expose stable set identity.')
              const next = nextButton()
              if (!(next instanceof HTMLButtonElement)) throw new Error('Sets paging control was not rendered.')
              next.focus()
              if (document.activeElement !== next) throw new Error('The Sets next-page control was not keyboard reachable.')
              await goToSecondPage()
              if (cards().length !== 50 || !firstRecord() || firstRecord() === firstPageRecord) {
                throw new Error('Sets did not replace page one with the next 50 stable set cards.')
              }

              const sort = document.querySelector('.collection-explorer-toolbar .explorer-toolbar-sort select')
              await changeSelect(sort, 'name', 'sorting')
              await goToSecondPage()
              const filters = document.querySelectorAll('.collection-explorer-toolbar .explorer-toolbar-filters select')
              await changeSelect(filters[0], 'unstarted', 'progress filter')
              await changeSelect(filters[0], 'all', 'progress filter restoration')
              await goToSecondPage()
              await changeSelect(filters[1], 'epic', 'rarity filter')
              await changeSelect(filters[1], 'all', 'rarity filter restoration')
              await goToSecondPage()
              await changeSelect(filters[2], 'visual', 'feature filter')
              await changeSelect(filters[2], 'all', 'feature filter restoration')

              const input = document.querySelector('.collection-explorer-toolbar .explorer-search input')
              if (!(input instanceof HTMLInputElement)) throw new Error('Sets search control was not available.')
              input.value = 'no-such-bounded-set'
              input.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(175)
              await frames()
              if (cards().length !== 0 || !root.querySelector('.bounded-results-state.is-empty')) {
                throw new Error('Sets search did not render the shared zero-result state.')
              }
              input.value = ''
              input.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(175)
              await frames()
              if (cards().length !== 50 || !pageText().includes('Page 1')) {
                throw new Error('Clearing Sets search did not restore the first bounded page.')
              }

              const item = root.querySelector('.set-card li > button')
              if (!(item instanceof HTMLButtonElement)) throw new Error('Set member controls were not retained.')
              item.focus()
              item.dispatchEvent(new FocusEvent('focus'))
              for (let attempt = 0; attempt < 20 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(25)
              if (!document.querySelector('.game-tooltip')) throw new Error('Set member focus did not retain the global item tooltip.')
              const expectedItemName = item.querySelector('strong')?.textContent?.trim()
              item.click()
              await frames()
              if (!expectedItemName || document.querySelector('.item-drawer h2')?.textContent?.trim() !== expectedItemName) {
                throw new Error('Set member activation did not retain the matching item drawer.')
              }
              document.querySelector('.drawer-close')?.click()
              await frames()
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_FARMING_PAGING === '1') {
          interactionTimings.farmingPagingMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const root = document.querySelector('.farming-route-results')
              const mountedRows = () => [...document.querySelectorAll('.farming-route-results .bounded-results-item')]
              const firstRank = () => document.querySelector('.farming-route-results .farm-rank')?.textContent?.trim()
              const firstRouteKey = () => document.querySelector('.farming-route-results article')?.getAttribute('data-route-key')
              const setSearch = async (value) => {
                const input = document.querySelector('.farming-workspace .explorer-search input')
                if (!(input instanceof HTMLInputElement)) {
                  throw new Error('Collection Farming search control was not available.')
                }
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await new Promise((resolve) => setTimeout(resolve, 175))
                await frames()
              }
              if (!root || mountedRows().length !== 50 || firstRank() !== '1') {
                throw new Error('The first Collection Farming page did not mount ranks 1–50.')
              }
              const firstPageRouteKey = firstRouteKey()
              if (!firstPageRouteKey) throw new Error('Collection Farming did not expose stable route identity.')
              const next = root.querySelector('.bounded-results-footer nav button:last-of-type')
              if (!(next instanceof HTMLButtonElement) || next.disabled) {
                throw new Error('Collection Farming did not expose an enabled next-page control.')
              }
              next.focus()
              if (document.activeElement !== next) {
                throw new Error('The Collection Farming next-page control was not keyboard reachable.')
              }
              next.click()
              await frames()
              const secondPageRouteKey = firstRouteKey()
              if (mountedRows().length !== 50 || firstRank() !== '51' || !secondPageRouteKey || secondPageRouteKey === firstPageRouteKey) {
                throw new Error('Collection Farming did not replace page one with global ranks 51–100.')
              }
              await setSearch('route 001')
              if (mountedRows().length !== 1 || firstRank() !== '1' || !firstRouteKey()?.includes(':synthetic route 001:')) {
                throw new Error('Collection Farming search did not reset to the matching stable route on page one.')
              }
              await setSearch('no-such-farming-route')
              if (mountedRows().length !== 0 || !root.querySelector('.bounded-results-state.is-empty')) {
                throw new Error('Collection Farming search did not render the shared zero-result state.')
              }
              await setSearch('')
              if (mountedRows().length !== 50 || firstRank() !== '1' || firstRouteKey() !== firstPageRouteKey) {
                throw new Error('Clearing Collection Farming search did not restore the original first page and route identity.')
              }
              root.querySelector('.bounded-results-footer nav button:last-of-type')?.click()
              await frames()
              if (firstRank() !== '51') throw new Error('Collection Farming could not return to page two before filter reset.')
              const rarity = document.querySelector('.farming-workspace .explorer-toolbar-filters select')
              if (!(rarity instanceof HTMLSelectElement)) {
                throw new Error('Collection Farming rarity control was not available.')
              }
              rarity.value = 'mi'
              rarity.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              if (firstRank() !== '1') {
                throw new Error('Collection Farming did not reset paging after a rarity change.')
              }
              rarity.value = 'all'
              rarity.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              const item = document.querySelector('.farming-route-results .farm-items button')
              if (!(item instanceof HTMLButtonElement)) {
                throw new Error('Collection Farming item snippets were not retained.')
              }
              const rect = item.getBoundingClientRect()
              item.dispatchEvent(new MouseEvent('mouseenter', {
                bubbles: true,
                clientX: rect.left + Math.min(8, rect.width / 2),
                clientY: rect.top + Math.min(8, rect.height / 2)
              }))
              for (let attempt = 0; attempt < 20 && !document.querySelector('.game-tooltip'); attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 25))
              }
              if (!document.querySelector('.game-tooltip')) {
                throw new Error('Collection Farming item snippets did not retain the global tooltip.')
              }
              const expectedItemName = item.textContent?.trim()
              item.click()
              await frames()
              const drawerItemName = document.querySelector('.item-drawer h2')?.textContent?.trim()
              if (!expectedItemName || drawerItemName !== expectedItemName) {
                throw new Error('Collection Farming item activation did not open the matching item drawer.')
              }
              document.querySelector('.drawer-close')?.click()
              await frames()
              item.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_SUPPLY_SELECTION === '1') {
          await window.webContents.executeJavaScript(`
            (async () => {
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const rows = () => [...document.querySelectorAll('.supply-results .bounded-results-item')]
              for (let attempt = 0; attempt < 40 && rows().length === 0; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 50))
              }
              const firstRows = rows()
              const eligible = firstRows.find((row) => row.getAttribute('aria-disabled') !== 'true')
              if (!(eligible instanceof HTMLElement)) {
                const disabled = firstRows.find((row) => row.getAttribute('aria-disabled') === 'true')
                if (!(disabled instanceof HTMLElement)) throw new Error('No supply was available for selection verification.')
                disabled.click()
                await frames()
                if (disabled.getAttribute('aria-selected') === 'true' || disabled.querySelector('input:checked')) {
                  throw new Error('An ineligible supply was selected.')
                }
                return
              }
              const identity = eligible.textContent?.replace(/\s+/g, ' ').trim()
              eligible.click()
              await frames()
              if (eligible.getAttribute('aria-selected') !== 'true' || !eligible.querySelector('input:checked')) {
                throw new Error('Eligible supply selection did not synchronize card and checkbox state.')
              }
              const disabled = firstRows.find((row) => row.getAttribute('aria-disabled') === 'true')
              if (disabled instanceof HTMLElement) {
                disabled.click()
                await frames()
                if (disabled.getAttribute('aria-selected') === 'true') throw new Error('An ineligible supply was selected.')
              }
              const next = document.querySelector('.supply-results .bounded-results-footer nav button:last-of-type')
              if (!(next instanceof HTMLButtonElement) || next.disabled) throw new Error('Supply selection verification needs a second page.')
              next.click()
              await frames()
              const previous = document.querySelector('.supply-results .bounded-results-footer nav button:first-of-type')
              if (!(previous instanceof HTMLButtonElement) || previous.disabled) throw new Error('Supply page did not advance.')
              previous.click()
              await frames()
              const restored = rows().find((row) => row.textContent?.replace(/\s+/g, ' ').trim() === identity)
              if (!(restored instanceof HTMLElement) || restored.getAttribute('aria-selected') !== 'true') {
                throw new Error('Keyed supply selection did not survive paging.')
              }
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_SUPPLIES_WORKSPACE === '1') {
          interactionTimings.suppliesWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const root = document.querySelector('.supplies-workspace')
              const resultRoot = document.querySelector('.supply-results')
              const rows = () => [...document.querySelectorAll('.supply-results .bounded-results-item')]
              const resultCount = () => Number((document.querySelector('.supplies-workspace .explorer-result-count')?.textContent ?? '').replace(/[^0-9]/g, ''))
              const setQuery = async (value) => {
                const input = document.querySelector('.supplies-workspace .explorer-search input')
                if (!(input instanceof HTMLInputElement)) throw new Error('Supplies search control was not rendered.')
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(175)
                await frames()
              }
              for (let attempt = 0; attempt < 40 && rows().length === 0; attempt += 1) await wait(50)
              if (!root || !root.querySelector('.tool-header') || !root.querySelector('.explorer-toolbar')) {
                throw new Error('Supplies did not render the shared workspace shell.')
              }
              if (!resultRoot || rows().length < 2 || rows().length > 60) {
                throw new Error('Supplies did not mount a bounded non-empty result page.')
              }
              const originalTotal = resultCount()
              const originalFirst = rows()[0]?.textContent?.replace(/\s+/g, ' ').trim()
              if (!Number.isFinite(originalTotal) || originalTotal < rows().length) throw new Error('Supplies result count was invalid.')
              const first = rows()[0]
              const second = rows()[1]
              const searchInput = document.querySelector('.supplies-workspace .explorer-search input')
              if (!(searchInput instanceof HTMLInputElement)) throw new Error('Supplies search control was not rendered.')
              first.dispatchEvent(new FocusEvent('blur'))
              searchInput.focus()
              await wait(120)
              if (document.querySelector('.game-tooltip')) throw new Error('Supplies tooltip did not settle before keyboard verification.')
              let nativeFocusEvents = 0
              first.addEventListener('focus', () => { nativeFocusEvents += 1 })
              first.focus()
              if (document.activeElement !== first) throw new Error('The first Supply card was not keyboard focusable.')
              if (nativeFocusEvents === 0) first.dispatchEvent(new FocusEvent('focus'))
              if (document.querySelector('.game-tooltip')) throw new Error('Supply focus bypassed the established delayed tooltip queue.')
              for (let attempt = 0; attempt < 40 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(25)
              if (!document.querySelector('.game-tooltip')) throw new Error('Supply keyboard focus did not use the global item tooltip.')
              first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
              await wait(20)
              if (document.activeElement !== second) throw new Error('ArrowRight did not move to the next Supply card.')
              const next = resultRoot.querySelector('.bounded-results-footer nav button:last-of-type')
              if (next instanceof HTMLButtonElement && !next.disabled) {
                next.click()
                await frames()
                if (rows().length > 60 || rows()[0]?.textContent?.replace(/\s+/g, ' ').trim() === originalFirst) {
                  throw new Error('Supplies paging did not replace its bounded cards.')
                }
              }
              await setQuery('zz-no-supply-result-zz')
              if (rows().length !== 0 || !resultRoot.querySelector('.bounded-results-state.is-empty')) {
                throw new Error('Supplies did not render the shared empty state after an impossible search.')
              }
              await setQuery('')
              if (rows().length < 2 || rows().length > 60 || resultCount() !== originalTotal) {
                throw new Error('Supplies search reset did not restore the original bounded result set.')
              }
              const pageText = resultRoot.querySelector('.bounded-results-footer nav span')?.textContent ?? 'Page 1'
              if (!pageText.includes('Page 1')) throw new Error('Editing Supplies search did not reset paging to page one.')
              rows()[0]?.dispatchEvent(new FocusEvent('blur'))
              searchInput.focus()
              await wait(100)
              const navigationButton = (label) => [...document.querySelectorAll('.workspace-sidebar [data-destination-id], .workspace-sidebar [data-tool-id]')]
                .find((button) => button.querySelector('.workspace-nav-label')?.textContent?.trim() === label)
              const waitForPopState = () => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Supplies mode verification did not emit popstate.')), 1500)
                window.addEventListener('popstate', () => {
                  clearTimeout(timer)
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                }, { once: true })
              })
              const initialLiveSupply = document.querySelector('.supplies-workspace .segmented-control button:first-child')
              if (!(initialLiveSupply instanceof HTMLButtonElement)) throw new Error('Live Supplies mode was unavailable to history verification.')
              initialLiveSupply.click()
              await frames()
              const transfers = navigationButton('Transfers')
              if (!(transfers instanceof HTMLButtonElement)) throw new Error('Transfers navigation was unavailable to Supplies mode verification.')
              transfers.click()
              await frames()
              const quarantine = [...document.querySelectorAll('.transfer-section-tabs button')]
                .find((button) => button.textContent?.includes('Quarantined items'))
              if (!(quarantine instanceof HTMLButtonElement)) throw new Error('Quarantine section was unavailable to Supplies mode verification.')
              quarantine.click()
              await frames()
              const offlineTransfer = document.querySelector('.transfer-mode-tabs button:last-child')
              if (!(offlineTransfer instanceof HTMLButtonElement)) throw new Error('Offline transfer mode was unavailable to Supplies mode verification.')
              offlineTransfer.click()
              await frames()
              const backToTransfers = waitForPopState()
              history.back()
              await backToTransfers
              if (!document.querySelector('.vault-workspace')) {
                throw new Error('Back did not restore the prior Transfers section.')
              }
              const backToSupplies = waitForPopState()
              history.back()
              await backToSupplies
              if (!document.querySelector('.supplies-workspace .segmented-control button:first-child.active')) {
                throw new Error('Back did not restore the original live Supplies mode.')
              }
              const forwardToTransfers = waitForPopState()
              history.forward()
              await forwardToTransfers
              if (!document.querySelector('.vault-workspace')) {
                throw new Error('Forward did not restore the prior Transfers section.')
              }
              const forwardToOffline = waitForPopState()
              history.forward()
              await forwardToOffline
              if (!document.querySelector('.transfer-mode-tabs button:last-child.active')) {
                throw new Error('Forward did not restore the offline Transfers mode.')
              }
              const collection = navigationButton('Collection')
              if (!(collection instanceof HTMLButtonElement)) throw new Error('Collection navigation was unavailable to Supplies mode verification.')
              collection.click()
              await frames()
              const supplies = navigationButton('Supplies')
              if (!(supplies instanceof HTMLButtonElement)) throw new Error('Supplies navigation was unavailable after Transfers restoration.')
              supplies.click()
              await frames()
              const restoredOffline = document.querySelector('.supplies-workspace .segmented-control button:last-child')
              if (!(restoredOffline instanceof HTMLButtonElement) || !restoredOffline.classList.contains('active')) {
                throw new Error('Supplies did not inherit the restored offline transfer mode.')
              }
              const liveSupply = document.querySelector('.supplies-workspace .segmented-control button:first-child')
              if (liveSupply instanceof HTMLButtonElement) liveSupply.click()
              await frames()
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_DISMANTLING_PREVIEW === '1') {
          await window.webContents.executeJavaScript(`
            [...document.querySelectorAll('.dismantling-toolbar button')]
              .find((button) => button.textContent?.trim() === 'Select safe duplicates')
              ?.click()
          `)
          await new Promise((resolve) => setTimeout(resolve, 100))
          await window.webContents.executeJavaScript(
            "document.querySelector('.dismantling-run')?.click()"
          )
          let previewCompleted = false
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const previewError = await window.webContents.executeJavaScript(
              "document.querySelector('.dismantling-error')?.textContent"
            )
            if (previewError) throw new Error('Dismantling preview failed: ' + previewError)
            const previewReady = await window.webContents.executeJavaScript(
              "Boolean(document.querySelector('.dismantling-costs'))"
            )
            if (previewReady) {
              previewCompleted = true
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
          }
          if (!previewCompleted) throw new Error('Dismantling preview timed out.')
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_PLANNER_MAP === '1') {
          await window.webContents.executeJavaScript(
            "document.querySelector('.planner-display button:last-child')?.click()"
          )
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_PLANNER_NAVIGATION === '1') {
          interactionTimings.plannerNavigationMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const activePlan = () => document.querySelector('#planner-profile-select option:checked')?.textContent?.trim() ?? ''
              const originalPlan = activePlan()
              document.querySelector('.planner-new-plan')?.click()
              await wait(50)
              document.querySelector('.planner-setup-dialog footer button:not(.secondary)')?.click()
              await wait(75)
              const name = document.querySelector('.planner-setup-dialog input[type="text"]')
              if (name) {
                name.value = 'Synthetic Conjurer'
                name.dispatchEvent(new Event('input', { bubbles: true }))
              }
              document.querySelector('.planner-setup-dialog footer button:not(.secondary)')?.click()
              await wait(75)
              document.querySelector('.planner-setup-suggestions button')?.click()
              await wait(50)
              document.querySelector('.planner-setup-dialog footer button:not(.secondary)')?.click()
              await wait(75)
              document.querySelector('.planner-setup-dialog footer button:not(.secondary)')?.click()
              await wait(100)
              if (!activePlan().startsWith('Synthetic Conjurer')) {
                const dialogState = document.querySelector('.planner-setup-dialog')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 240) ?? 'closed'
                throw new Error('New planner profile did not become active: ' + activePlan() + ' · ' + dialogState)
              }
              history.back()
              await wait(100)
              if (activePlan() !== originalPlan) throw new Error('Back did not restore the previous planner profile.')
              history.forward()
              await wait(100)
              if (!activePlan().startsWith('Synthetic Conjurer')) throw new Error('Forward did not restore the new planner profile.')
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_OPEN_PLANNER_SETUP === '1') {
          const openedPlannerSetup = await window.webContents.executeJavaScript(`
            (async () => {
              document.querySelector('.planner-new-plan')?.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              return Boolean(document.querySelector('.planner-setup-dialog'))
            })()
          `)
          if (!openedPlannerSetup) throw new Error('New plan dialog was not available for screenshot capture.')
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_ACCESSIBLE_MODAL === '1') {
          const verifiedAccessibleModal = await window.webContents.executeJavaScript(`
            (async () => {
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              document.querySelector('.onboarding-skip')?.click()
              for (let attempt = 0; attempt < 20 && document.querySelector('.onboarding-dialog'); attempt += 1) {
                await wait(25)
              }
              if (document.querySelector('.onboarding-dialog')) {
                throw new Error('Persisted onboarding could not be dismissed before custom-dialog verification.')
              }
              await frames()
              if (!document.querySelector('.planner-new-plan')) {
                const collection = [...document.querySelectorAll('.workspace-sidebar [data-destination-id]')]
                  .find((button) => button.querySelector('.workspace-nav-label')?.textContent?.trim() === 'Collection')
                collection?.click()
                await frames()
                const planner = [...document.querySelectorAll('.workspace-sidebar [data-tool-id]')]
                  .find((button) => button.querySelector('.workspace-nav-label')?.textContent?.trim() === 'Leveling Planner')
                planner?.click()
                await frames()
              }
              const opener = document.querySelector('.planner-new-plan')
              const outside = document.querySelector('.topbar-actions button:not([disabled]), .history-nav button:not([disabled])')
              if (!(opener instanceof HTMLButtonElement) || !(outside instanceof HTMLButtonElement)) return false
              const originalAddEventListener = document.addEventListener
              const originalRemoveEventListener = document.removeEventListener
              const registeredModalFocusListeners = []
              const removedModalFocusListeners = new Set()
              document.addEventListener = function (type, listener, options) {
                if (type === 'focusin' && options === true) registeredModalFocusListeners.push(listener)
                return originalAddEventListener.call(this, type, listener, options)
              }
              document.removeEventListener = function (type, listener, options) {
                if (type === 'focusin' && options === true && registeredModalFocusListeners.includes(listener)) {
                  removedModalFocusListeners.add(listener)
                }
                return originalRemoveEventListener.call(this, type, listener, options)
              }
              opener.focus()
              opener.click()
              await frames()
              let dialog = document.querySelector('.planner-setup-dialog')
              for (let attempt = 0; attempt < 20 && dialog instanceof HTMLElement && !dialog.contains(document.activeElement); attempt += 1) {
                await wait(25)
                dialog = document.querySelector('.planner-setup-dialog')
              }
              if (!(dialog instanceof HTMLElement) || !dialog.contains(document.activeElement)) {
                throw new Error('Planner setup did not open with focus inside its custom dialog: ' + JSON.stringify({
                  dialog: dialog instanceof HTMLElement,
                  activeTag: document.activeElement?.tagName,
                  activeClass: document.activeElement instanceof HTMLElement ? document.activeElement.className : null,
                  bodyClass: document.body.className
                }))
              }
              outside.focus()
              outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
              await frames()
              if (!dialog.contains(document.activeElement)) {
                throw new Error('The custom Planner setup dialog allowed programmatic focus to escape.')
              }
              const historyState = JSON.stringify(history.state)
              const historyShortcut = new KeyboardEvent('keydown', {
                key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true
              })
              let historyShortcutReachedWindow = false
              const recordWindowHistoryShortcut = () => { historyShortcutReachedWindow = true }
              window.addEventListener('keydown', recordWindowHistoryShortcut, { once: true })
              document.activeElement?.dispatchEvent(historyShortcut)
              window.removeEventListener('keydown', recordWindowHistoryShortcut)
              await wait(200)
              if (
                !historyShortcut.defaultPrevented ||
                historyShortcutReachedWindow ||
                JSON.stringify(history.state) !== historyState ||
                document.querySelector('.onboarding-dialog')
              ) {
                throw new Error('An application-history shortcut escaped the active modal: ' + JSON.stringify({
                  defaultPrevented: historyShortcut.defaultPrevented,
                  reachedWindow: historyShortcutReachedWindow,
                  stateChanged: JSON.stringify(history.state) !== historyState,
                  onboardingPresent: Boolean(document.querySelector('.onboarding-dialog'))
                }))
              }
              document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', bubbles: true, cancelable: true
              }))
              await frames()
              if (document.querySelector('.planner-setup-dialog') || document.activeElement !== opener) {
                throw new Error('Planner setup did not close and restore focus to its opener.')
              }
              document.addEventListener = originalAddEventListener
              document.removeEventListener = originalRemoveEventListener
              if (
                registeredModalFocusListeners.length !== 1 ||
                removedModalFocusListeners.size !== registeredModalFocusListeners.length
              ) {
                throw new Error('Planner setup did not remove its exact captured focus listener: ' + JSON.stringify({
                  registered: registeredModalFocusListeners.length,
                  removed: removedModalFocusListeners.size
                }))
              }
              outside.focus()
              outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
              await frames()
              if (document.activeElement !== outside) {
                throw new Error('Planner setup retained its focus listener after unmount: ' + JSON.stringify({
                  activeTag: document.activeElement?.tagName,
                  activeClass: document.activeElement instanceof HTMLElement ? document.activeElement.className : null,
                  activeConnected: document.activeElement instanceof HTMLElement ? document.activeElement.isConnected : null,
                  onboardingPresent: Boolean(document.querySelector('.onboarding-dialog')),
                  plannerPresent: Boolean(document.querySelector('.planner-setup-dialog')),
                  outsideClass: outside.className
                }))
              }

              opener.focus()
              opener.click()
              await frames()
              dialog = document.querySelector('.planner-setup-dialog')
              if (!(dialog instanceof HTMLElement)) throw new Error('Planner setup did not reopen for detached-target verification.')
              document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', bubbles: true, cancelable: true
              }))
              opener.remove()
              await frames()
              await frames()
              if (!(document.activeElement instanceof HTMLElement) || !document.activeElement.isConnected || document.activeElement === document.body) {
                throw new Error('Detached opener did not restore focus to a connected application fallback.')
              }
              return true
            })()
          `)
          if (!verifiedAccessibleModal) throw new Error('Planner setup custom-dialog verification controls were unavailable.')
        }
        const oracleMinimumLevel = process.env.CAIRN_CODEX_SCREENSHOT_ORACLE_MIN_LEVEL
        const oracleMaximumLevel = process.env.CAIRN_CODEX_SCREENSHOT_ORACLE_MAX_LEVEL
        if (process.env.CAIRN_CODEX_SCREENSHOT_ORACLE_SURPRISE === '1') {
          const surprised = await window.webContents.executeJavaScript(`
            (async () => {
              const button = [...document.querySelectorAll('.oracle-explorer-toolbar .explorer-toolbar-actions button')]
                .find((candidate) => candidate.textContent?.trim() === 'Surprise me')
              button?.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              return Boolean(button)
            })()
          `)
          if (!surprised) throw new Error('Stash Oracle Surprise me action was not available.')
        }
        if (oracleMinimumLevel || oracleMaximumLevel) {
          await window.webContents.executeJavaScript(`
            (async () => {
              const setLevel = (label, value) => {
                const input = document.querySelector('.oracle-explorer-toolbar input[aria-label="' + label + '"]')
                if (!(input instanceof HTMLInputElement) || !value) return
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                input.dispatchEvent(new Event('change', { bubbles: true }))
              }
              setLevel('Minimum item level', ${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_ORACLE_MIN_LEVEL ?? '')})
              setLevel('Maximum item level', ${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_ORACLE_MAX_LEVEL ?? '')})
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            })()
          `)
        }
        const skillScope = process.env.CAIRN_CODEX_SCREENSHOT_SKILL_SCOPE
        if (skillScope) {
          await window.webContents.executeJavaScript(`
            (() => {
              const select = document.querySelector('.skill-explorer-toolbar .explorer-toolbar-filters select')
              if (!select) return
              select.value = ${JSON.stringify(skillScope === 'My Archive' ? 'archive' : 'all')}
              select.dispatchEvent(new Event('change', { bubbles: true }))
            })()
          `)
        }
        const skillQuery = process.env.CAIRN_CODEX_SCREENSHOT_SKILL_QUERY
        if (skillQuery) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          await window.webContents.executeJavaScript(`
            (() => {
              const input = document.querySelector('.skill-combobox input')
              if (!input) return
              input.value = ${JSON.stringify(skillQuery)}
              input.dispatchEvent(new Event('input', { bubbles: true }))
              input.focus()
              if (${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_SKILL_SELECT_FIRST === '1')}) {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
              }
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_SKILL_EXPLORER_WORKSPACE === '1') {
          window.show()
          window.focus()
          await new Promise((resolve) => setTimeout(resolve, 80))
          interactionTimings.skillExplorerWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const root = document.querySelector('.skill-explorer .research-item-table')
              const rows = () => [...document.querySelectorAll('.skill-explorer .research-item-table .bounded-results-item')]
              const resultCount = () => Number((document.querySelector('.skill-explorer-toolbar .explorer-result-count')?.textContent ?? '').replace(/[^0-9]/g, ''))
              const setQuery = async (value) => {
                const input = document.querySelector('.skill-explorer-toolbar .explorer-search input')
                if (!(input instanceof HTMLInputElement)) throw new Error('Skill Explorer result search was not rendered.')
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(175)
                await frames()
              }
              if (!document.querySelector('.skill-explorer')) throw new Error('Skill Explorer workspace was not rendered.')
              if (!root || rows().length < 2 || rows().length > 50) {
                throw new Error('Skill Explorer did not mount a bounded non-empty result page.')
              }
              const originalTotal = resultCount()
              const originalFirst = rows()[0]?.textContent?.replace(/\s+/g, ' ').trim()
              if (!Number.isFinite(originalTotal) || originalTotal < rows().length) throw new Error('Skill Explorer result count was invalid.')
              const toolbarSelects = [...document.querySelectorAll('.skill-explorer-toolbar select')]
              const sortSelect = toolbarSelects.at(-2)
              const directionSelect = toolbarSelects.at(-1)
              if (!(sortSelect instanceof HTMLSelectElement) || sortSelect.value !== 'level' ||
                  !(directionSelect instanceof HTMLSelectElement) || directionSelect.value !== 'asc') {
                throw new Error('Skill Explorer did not start with level ascending sorting.')
              }
              const initialLevels = rows().map((row) => Number(row.querySelector('.research-level')?.textContent?.trim()))
              if (initialLevels.some((level, index) => !Number.isFinite(level) || (index > 0 && level < initialLevels[index - 1]))) {
                throw new Error('Skill Explorer rows were not initially ordered by ascending level.')
              }
              const initialLevelColumn = [...document.querySelectorAll('.skill-explorer .research-table-header [role="columnheader"]')]
                .find((column) => column.textContent?.trim().startsWith('Level'))
              if (initialLevelColumn?.getAttribute('aria-sort') !== 'ascending') {
                throw new Error('Skill Explorer did not expose its default ascending level sort.')
              }
              const modifierColumn = [...document.querySelectorAll('.skill-explorer .research-table-header [role="columnheader"]')]
                .find((column) => column.textContent?.trim().startsWith('Skill modifiers'))
              const tableStyle = getComputedStyle(root)
              const gutter = root.offsetWidth - root.clientWidth - parseFloat(tableStyle.borderLeftWidth) - parseFloat(tableStyle.borderRightWidth)
              if (gutter > 1) throw new Error('Skill Explorer table reserves a blank right-hand scrollbar gutter: ' + gutter)
              const fx = root.querySelector('.research-skill-fx')
              if (!fx?.querySelector('.tone-fx') || !fx.textContent.includes('Alternate crimson spirit effect') || !fx.textContent.includes('Alternate azure storm effect')) {
                throw new Error('Skill Explorer did not render all item-wide Skill FX transformations.')
              }
              if (!modifierColumn || !rows().some((row) => row.querySelector('.research-modifiers')?.textContent?.includes('Alternate crimson spirit effect'))) {
                throw new Error('Skill Explorer did not render visual transformation data.')
              }
              if (!root.textContent.includes('30% Weapon Damage (Fixture Talons)')) throw new Error('Skill Explorer hid a granted-ability modifier.')
              const firstItem = rows()[0]?.querySelector('.research-item-identity')
              const firstIcon = firstItem?.querySelector('img')
              const firstItemCell = firstItem?.closest('[role="gridcell"]')
              const firstLevel = rows()[0]?.querySelector('.research-level')
              if (!(firstItem instanceof HTMLElement) || !(firstItemCell instanceof HTMLElement) ||
                  firstItemCell.getBoundingClientRect().height < 70 ||
                  (firstIcon instanceof HTMLImageElement && firstIcon.getBoundingClientRect().height < 50) ||
                  !(firstLevel instanceof HTMLElement) || getComputedStyle(firstLevel).textAlign !== 'center') {
                throw new Error('Skill Explorer item and level cells did not use the polished table geometry.')
              }
              if (getComputedStyle(root).overscrollBehaviorY !== 'auto') {
                throw new Error('Skill Explorer table blocks vertical wheel chaining to the workspace.')
              }
              for (const rarity of ['epic', 'legendary']) {
                const name = root.querySelector('.gd-rarity-name.rarity-' + rarity)
                if (!(name instanceof HTMLElement)) throw new Error('Skill Explorer did not render a ' + rarity + ' item name.')
                for (const unavailable of [false, true]) {
                  const row = root.querySelector('.research-table-row' + (unavailable ? '.is-unavailable' : ':not(.is-unavailable)') + ':has(.rarity-' + rarity + ')')
                  const rowName = row?.querySelector('.gd-rarity-name')
                  if (!(rowName instanceof HTMLElement)) throw new Error('Missing ' + rarity + ' unavailable=' + unavailable + ' fixture.')
                  if (Number(getComputedStyle(rowName).opacity) !== (unavailable ? .96 : 1)) throw new Error('Availability did not control the subtle name fade.')
                  const modifiers = row.querySelector('.research-modifiers')
                  if (getComputedStyle(row).opacity !== '1' || getComputedStyle(modifiers).opacity !== '1') throw new Error('Unavailable styling faded the row or skill modifiers.')
                }
                const colorProbe = document.createElement('span')
                colorProbe.style.color = 'var(--gd-rarity-' + rarity + ')'
                document.body.appendChild(colorProbe)
                const expectedColor = getComputedStyle(colorProbe).color
                colorProbe.remove()
                if (getComputedStyle(name).color !== expectedColor) {
                  throw new Error('Skill Explorer did not apply the semantic ' + rarity + ' name color.')
                }
              }
              const resultCounter = document.querySelector('.skill-explorer-toolbar .explorer-result-count')
              for (const availabilityLabel of ['Recipe learned', 'Available by awakening', 'Previously archived']) {
                const row = [...root.querySelectorAll('.research-table-row')].find(row => row.querySelector('.research-archive')?.textContent.includes(availabilityLabel))
                if (!row) throw new Error('Missing availability-state fixture: ' + availabilityLabel)
                if (row.classList.contains('is-unavailable') !== (availabilityLabel === 'Previously archived')) throw new Error('Crafting, awakening, or history received the wrong availability styling: ' + availabilityLabel)
              }
              if (!(resultCounter instanceof HTMLElement)) throw new Error('Skill Explorer result count was unavailable.')
              const resultCounterStyle = getComputedStyle(resultCounter)
              if (window.innerWidth > 1180
                ? resultCounterStyle.borderLeftStyle === 'none' || resultCounterStyle.textAlign === 'right'
                : resultCounterStyle.flexDirection !== 'row' || resultCounterStyle.borderTopStyle === 'none') {
                throw new Error('Skill Explorer result count did not use the balanced wide/compact treatment.')
              }
              const first = rows()[0]
              const second = rows()[1]
              let nativeFocusEvents = 0
              first.addEventListener('focus', () => { nativeFocusEvents += 1 })
              const activeBeforeFocus = document.activeElement === first
              if (activeBeforeFocus) {
                const picker = document.querySelector('.skill-combobox input')
                if (picker instanceof HTMLInputElement) picker.focus()
                await frames()
              }
              first.focus()
              if (document.activeElement !== first) throw new Error('The first Skill Explorer row was not keyboard focusable.')
              // Hidden screenshot windows can update activeElement without dispatching focus.
              // Exercise the same event that a foreground keyboard focus transition produces.
              if (nativeFocusEvents === 0) first.dispatchEvent(new FocusEvent('focus'))
              for (let attempt = 0; attempt < 8 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(10)
              const focusedTooltip = document.querySelector('.game-tooltip')
              if (!(focusedTooltip instanceof HTMLElement)) throw new Error('Keyboard focus did not immediately use the global Skill Explorer tooltip.')
              const tooltipInlineStyle = focusedTooltip.style.cssText
              const tooltipScrollProbe = document.createElement('div')
              tooltipScrollProbe.setAttribute('aria-hidden', 'true')
              tooltipScrollProbe.style.cssText = 'height:480px;min-height:480px'
              focusedTooltip.appendChild(tooltipScrollProbe)
              focusedTooltip.style.height = '150px'
              focusedTooltip.style.maxHeight = '150px'
              focusedTooltip.scrollTop = 0
              if (focusedTooltip.hasAttribute('aria-label')) {
                throw new Error('The item tooltip replaced its detailed accessible description with a generic label.')
              }
              const keyboardScroll = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true })
              first.dispatchEvent(keyboardScroll)
              if (!keyboardScroll.defaultPrevented || focusedTooltip.scrollTop <= 0 || document.activeElement !== first) {
                throw new Error('Page Down did not scroll the overflowing tooltip while retaining focus on its item row.')
              }
              focusedTooltip.scrollTop = 0
              const ordinaryWheel = new WheelEvent('wheel', { deltaY: 90, bubbles: true, cancelable: true })
              focusedTooltip.dispatchEvent(ordinaryWheel)
              await wait(150)
              if (!ordinaryWheel.defaultPrevented || focusedTooltip.scrollTop <= 0) {
                throw new Error('Direct tooltip wheel input did not use the smooth tooltip scroll path: ' + JSON.stringify({
                  defaultPrevented: ordinaryWheel.defaultPrevented,
                  scrollTop: focusedTooltip.scrollTop,
                  scrollHeight: focusedTooltip.scrollHeight,
                  clientHeight: focusedTooltip.clientHeight,
                  classes: focusedTooltip.className
                }))
              }
              focusedTooltip.dispatchEvent(new MouseEvent('mouseenter'))
              await wait(120)
              if (!document.body.contains(focusedTooltip)) throw new Error('Entering the tooltip did not cancel its pending dismissal.')
              tooltipScrollProbe.remove()
              focusedTooltip.style.cssText = tooltipInlineStyle
              focusedTooltip.scrollTop = 0
              first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              await wait(20)
              if (document.activeElement !== second) throw new Error('ArrowDown did not move to the next Skill Explorer row.')
              second.blur()
              second.dispatchEvent(new FocusEvent('blur'))
              for (let attempt = 0; attempt < 20 && document.querySelector('.game-tooltip'); attempt += 1) await wait(20)
              if (document.querySelector('.game-tooltip')) throw new Error('Skill Explorer keyboard tooltip did not dismiss after row blur.')
              const firstRow = first.querySelector('.research-table-row')
              if (!(firstRow instanceof HTMLElement)) throw new Error('Skill Explorer row content was unavailable.')
              const rowRect = firstRow.getBoundingClientRect()
              firstRow.dispatchEvent(new MouseEvent('mouseenter', {
                clientX: rowRect.left + Math.min(12, rowRect.width / 2),
                clientY: rowRect.top + Math.min(12, rowRect.height / 2)
              }))
              await wait(220)
              if (document.querySelector('.game-tooltip')) {
                throw new Error('Skill Explorer opened an item tooltip from ordinary table content instead of the picture.')
              }
              const itemRect = firstItemCell.getBoundingClientRect()
              firstItemCell.dispatchEvent(new MouseEvent('mouseenter', {
                bubbles: true,
                clientX: itemRect.right - 12,
                clientY: itemRect.top + itemRect.height / 2
              }))
              for (let attempt = 0; attempt < 40 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(25)
              const pointerTooltip = document.querySelector('.game-tooltip')
              if (!(pointerTooltip instanceof HTMLElement)) throw new Error('Skill Explorer item cell did not use the global item tooltip.')
              const pointerScrollProbe = document.createElement('div')
              pointerScrollProbe.setAttribute('aria-hidden', 'true')
              pointerScrollProbe.style.cssText = 'height:480px;min-height:480px'
              pointerTooltip.appendChild(pointerScrollProbe)
              pointerTooltip.style.height = '150px'
              pointerTooltip.style.maxHeight = '150px'
              pointerTooltip.scrollTop = 0
              const triggerWheel = new WheelEvent('wheel', { deltaY: 90, bubbles: true, cancelable: true })
              firstItemCell.dispatchEvent(triggerWheel)
              await wait(150)
              if (!triggerWheel.defaultPrevented) {
                throw new Error('Wheel input over the item cell was not routed to its overflowing tooltip.')
              }
              // Exercise both preferences regardless of the desktop runner's animation setting.
              const originalMatchMedia = window.matchMedia
              try {
                for (const reducedMotion of [false, true]) {
                  window.matchMedia = (query) => {
                    const media = originalMatchMedia.call(window, query)
                    if (query === '(prefers-reduced-motion: reduce)') {
                      Object.defineProperty(media, 'matches', { value: reducedMotion })
                    }
                    return media
                  }
                  pointerTooltip.scrollTop = 0
                  pointerTooltip.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true }))
                  const fillWheel = new WheelEvent('wheel', { deltaY: pointerTooltip.scrollHeight, bubbles: true, cancelable: true })
                  firstItemCell.dispatchEvent(fillWheel)
                  const queuedBoundaryWheel = new WheelEvent('wheel', { deltaY: 90, bubbles: true, cancelable: true })
                  firstItemCell.dispatchEvent(queuedBoundaryWheel)
                  const visiblyAtBoundary = pointerTooltip.scrollTop >= pointerTooltip.scrollHeight - pointerTooltip.clientHeight - 1
                  if (!fillWheel.defaultPrevented || queuedBoundaryWheel.defaultPrevented === reducedMotion || visiblyAtBoundary !== reducedMotion) {
                    throw new Error('Tooltip burst boundary behavior did not match the motion preference: ' + JSON.stringify({
                      reducedMotion, fillPrevented: fillWheel.defaultPrevented,
                      queuedPrevented: queuedBoundaryWheel.defaultPrevented, visiblyAtBoundary
                    }))
                  }
                  await wait(150)
                }
              } finally {
                window.matchMedia = originalMatchMedia
              }
              pointerTooltip.scrollTop = pointerTooltip.scrollHeight
              pointerTooltip.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true }))
              const boundaryWheel = new WheelEvent('wheel', { deltaY: 90, bubbles: true, cancelable: true })
              firstItemCell.dispatchEvent(boundaryWheel)
              if (boundaryWheel.defaultPrevented) {
                throw new Error('The item cell retained wheel input at the tooltip boundary instead of returning it to the workspace: ' + JSON.stringify({
                  scrollTop: pointerTooltip.scrollTop,
                  maximumScrollTop: pointerTooltip.scrollHeight - pointerTooltip.clientHeight
                }))
              }
              const tableWheel = new WheelEvent('wheel', { deltaY: 90, bubbles: true, cancelable: true })
              firstLevel.dispatchEvent(tableWheel)
              if (tableWheel.defaultPrevented) {
                throw new Error('Ordinary table content captured vertical workspace scrolling.')
              }
              const horizontalWheel = new WheelEvent('wheel', { deltaY: 90, shiftKey: true, bubbles: true, cancelable: true })
              const horizontalScrollBefore = root.scrollLeft
              firstItemCell.dispatchEvent(horizontalWheel)
              if (!horizontalWheel.defaultPrevented || root.scrollLeft === horizontalScrollBefore) {
                throw new Error('Shift+wheel did not use the research table horizontal-scroll path.')
              }
              pointerScrollProbe.remove()
              firstItemCell.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
              const levelSort = [...document.querySelectorAll('.skill-explorer .research-table-header button')]
                .find((button) => button.textContent?.trim().startsWith('Level'))
              if (!(levelSort instanceof HTMLButtonElement)) throw new Error('Skill Explorer level sort was unavailable.')
              levelSort.focus()
              levelSort.click()
              await frames()
              if (!levelSort.textContent?.includes('↓')) throw new Error('Skill Explorer level sort did not select descending order.')
              const levelColumn = levelSort.closest('[role="columnheader"]')
              if (levelColumn?.getAttribute('aria-sort') !== 'descending') {
                throw new Error('Skill Explorer level sort did not expose descending aria-sort state.')
              }
              const sortedColumns = [...document.querySelectorAll('.skill-explorer .research-table-header [role="columnheader"][aria-sort]')]
              if (sortedColumns.length !== 1 || sortedColumns[0] !== levelColumn) {
                throw new Error('Skill Explorer exposed sort state on more than the active column.')
              }
              if (levelSort.querySelector('[aria-hidden="true"]')?.textContent?.trim() !== '↓') {
                throw new Error('Skill Explorer sort direction glyph was not decorative.')
              }
              const next = root.querySelector('.bounded-results-footer nav button:last-of-type')
              if (next instanceof HTMLButtonElement && !next.disabled) {
                next.click()
                await frames()
                if (rows().length > 50 || rows()[0]?.textContent?.replace(/\s+/g, ' ').trim() === originalFirst) {
                  throw new Error('Skill Explorer paging did not replace its bounded rows.')
                }
              }
              await setQuery('zz-no-skill-result-zz')
              if (rows().length !== 0 || !root.querySelector('.bounded-results-state.is-empty')) {
                throw new Error('Skill Explorer did not render the shared empty state after an impossible search.')
              }
              await setQuery('')
              if (rows().length < 2 || rows().length > 50 || resultCount() !== originalTotal) {
                throw new Error('Skill Explorer search reset did not restore the original bounded result set.')
              }
              const picker = document.querySelector('.skill-combobox input')
              if (!(picker instanceof HTMLInputElement)) throw new Error('Skill picker was unavailable.')
              picker.focus()
              picker.value = ''
              picker.dispatchEvent(new Event('input', { bubbles: true }))
              await frames()
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              await frames()
              if (picker.hasAttribute('aria-controls') || picker.hasAttribute('aria-activedescendant')) {
                throw new Error('Closed Skill picker retained a dangling ARIA popup reference.')
              }
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              await frames()
              const listbox = document.querySelector('.skill-suggestions')
              let options = [...document.querySelectorAll('.skill-suggestions [role="option"]')]
              const activeOption = document.querySelector('.skill-suggestions [role="option"].active')
              if (!(activeOption instanceof HTMLButtonElement)) throw new Error('Skill picker keyboard traversal did not expose an active option.')
              const activeOptionId = picker.getAttribute('aria-activedescendant')
              if (
                document.activeElement !== picker ||
                !(listbox instanceof HTMLElement) ||
                picker.getAttribute('aria-controls') !== listbox.id ||
                !activeOptionId ||
                activeOption.id !== activeOptionId ||
                document.getElementById(activeOptionId) !== activeOption ||
                activeOption.tabIndex !== -1 ||
                activeOption.getAttribute('aria-selected') !== 'true'
              ) {
                throw new Error('Skill picker did not keep input focus on its active-descendant option.')
              }
              const optionIds = options.map((option) => option.id)
              if (
                options.length < 20 ||
                optionIds.some((id) => !id) ||
                new Set(optionIds).size !== options.length ||
                options.some((option) => !(option instanceof HTMLButtonElement) || option.tabIndex !== -1)
              ) {
                throw new Error('Skill picker options did not expose unique IDs without extra Tab stops.')
              }
              const stableOption = options[10]
              const stableSkill = stableOption?.textContent?.trim()
              const stableOptionId = stableOption?.id
              if (!stableSkill || !stableOptionId) throw new Error('Skill picker stable-ID option was unavailable.')
              picker.value = stableSkill
              picker.dispatchEvent(new Event('input', { bubbles: true }))
              await frames()
              const filteredStableOption = [...document.querySelectorAll('.skill-suggestions [role="option"]')]
                .find((option) => option.textContent?.trim() === stableSkill)
              if (filteredStableOption?.id !== stableOptionId) {
                throw new Error('Skill picker option ID changed when its suggestion list was filtered.')
              }
              picker.value = ''
              picker.dispatchEvent(new Event('input', { bubbles: true }))
              await frames()
              options = [...document.querySelectorAll('.skill-suggestions [role="option"]')]
              const initialScrollTop = listbox.scrollTop
              for (let index = 0; index < 20; index += 1) {
                picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              }
              await frames()
              const traversedOptionId = picker.getAttribute('aria-activedescendant')
              const traversedOption = traversedOptionId ? document.getElementById(traversedOptionId) : null
              if (!(traversedOption instanceof HTMLButtonElement) || document.activeElement !== picker) {
                throw new Error('Repeated Skill picker traversal lost its input-owned active descendant.')
              }
              const listboxRect = listbox.getBoundingClientRect()
              const traversedRect = traversedOption.getBoundingClientRect()
              if (
                listbox.scrollTop <= initialScrollTop ||
                traversedRect.top < listboxRect.top - 1 ||
                traversedRect.bottom > listboxRect.bottom + 1
              ) {
                throw new Error('Skill picker did not scroll its keyboard-active option into view.')
              }
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
              await frames()
              if (picker.getAttribute('aria-activedescendant') === traversedOptionId || document.activeElement !== picker) {
                throw new Error('Arrow Up did not move the Skill picker active descendant backward.')
              }
              const pointerOption = options[10]
              if (!(pointerOption instanceof HTMLButtonElement)) throw new Error('Skill picker pointer option was unavailable.')
              const pointerSkill = pointerOption.textContent?.trim()
              const mousedownAllowed = pointerOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
              if (mousedownAllowed || document.activeElement !== picker) {
                throw new Error('Pointer interaction moved focus away from the Skill picker input.')
              }
              pointerOption.click()
              await frames()
              if (
                !pointerSkill ||
                picker.value !== pointerSkill ||
                document.querySelector('.skill-suggestions') ||
                picker.hasAttribute('aria-controls') ||
                picker.hasAttribute('aria-activedescendant')
              ) {
                throw new Error('Pointer selection did not select and close the Skill picker option.')
              }
              picker.value = ''
              picker.dispatchEvent(new Event('input', { bubbles: true }))
              await frames()
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              await frames()
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
              await frames()
              const keyboardOptionId = picker.getAttribute('aria-activedescendant')
              const keyboardOption = keyboardOptionId ? document.getElementById(keyboardOptionId) : null
              const reopenedOptions = [...document.querySelectorAll('.skill-suggestions [role="option"]')]
              if (!(keyboardOption instanceof HTMLButtonElement) || keyboardOption !== reopenedOptions.at(-1)) {
                throw new Error('Arrow Up did not open the Skill picker on its final option: ' + JSON.stringify({
                  activeId: keyboardOptionId,
                  activeText: keyboardOption?.textContent?.trim() ?? null,
                  finalId: reopenedOptions.at(-1)?.id ?? null,
                  finalText: reopenedOptions.at(-1)?.textContent?.trim() ?? null,
                  optionCount: reopenedOptions.length,
                  value: picker.value
                }))
              }
              const selectedSkill = keyboardOption.textContent?.trim()
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
              await frames()
              if (!selectedSkill || picker.value !== selectedSkill || document.querySelector('.skill-suggestions')) {
                throw new Error('Enter did not select and close the active Skill picker option.')
              }
              picker.dispatchEvent(new Event('input', { bubbles: true }))
              await frames()
              if (!document.querySelector('.skill-suggestions')) throw new Error('Skill picker did not reopen for Escape verification.')
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              await frames()
              if (
                document.querySelector('.skill-suggestions') ||
                picker.value !== selectedSkill ||
                picker.hasAttribute('aria-controls') ||
                picker.hasAttribute('aria-activedescendant')
              ) {
                throw new Error('Escape did not close the Skill picker without changing its value.')
              }
              return performance.now() - started
            })()
          `)
          if (skillQuery) {
            await window.webContents.executeJavaScript(`
              (async () => {
                const input = document.querySelector('.skill-combobox input')
                if (!(input instanceof HTMLInputElement)) return
                input.value = ${JSON.stringify(skillQuery)}
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                if (${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_SKILL_SELECT_FIRST === '1')}) {
                  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
                  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                }
              })()
            `)
          }
          await verifyNativeSkillExplorerWheelInput(window)
        }
        const query = process.env.CAIRN_CODEX_SCREENSHOT_QUERY
        if (query) {
          interactionTimings.searchMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const input = document.querySelector('.explorer-search input, .search-field input')
              if (input) {
                input.value = ${JSON.stringify(query)}
                input.dispatchEvent(new Event('input', { bubbles: true }))
              }
              await new Promise((resolve) => setTimeout(resolve, 150))
              await new Promise((resolve) => setTimeout(resolve, 0))
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_ORACLE_WORKSPACE === '1') {
          interactionTimings.oracleWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const root = document.querySelector('.oracle-results')
              const rows = () => [...document.querySelectorAll('.oracle-results .bounded-results-item')]
              const firstIdentity = () => rows()[0]?.textContent?.replace(/\s+/g, ' ').trim()
              const setQuery = async (value) => {
                const input = document.querySelector('.oracle-explorer-toolbar .explorer-search input')
                if (!(input instanceof HTMLInputElement)) throw new Error('Oracle search control was not rendered.')
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(175)
                await frames()
              }
              const minimum = document.querySelector('.oracle-explorer-toolbar input[aria-label="Minimum item level"]')
              const maximum = document.querySelector('.oracle-explorer-toolbar input[aria-label="Maximum item level"]')
              if (!root || rows().length !== 12) throw new Error('Oracle did not mount its bounded 12-card page.')
              if (!(minimum instanceof HTMLInputElement) || minimum.value !== '1' ||
                  !(maximum instanceof HTMLInputElement) || maximum.value !== '100') {
                throw new Error('Oracle level controls did not retain the requested 1–100 range.')
              }
              const firstPageIdentity = firstIdentity()
              const first = rows()[0]
              const second = rows()[1]
              first.focus()
              if (document.activeElement !== first) throw new Error('The first Oracle card was not keyboard focusable.')
              first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              await wait(20)
              if (document.activeElement !== second) throw new Error('ArrowDown did not move to the next Oracle card.')
              const evidence = first.querySelector('.oracle-evidence button')
              if (!(evidence instanceof HTMLButtonElement)) throw new Error('Oracle evidence did not expose an item action.')
              const evidenceRect = evidence.getBoundingClientRect()
              evidence.dispatchEvent(new MouseEvent('mouseenter', {
                clientX: evidenceRect.left + Math.min(12, evidenceRect.width / 2),
                clientY: evidenceRect.top + Math.min(12, evidenceRect.height / 2)
              }))
              for (let attempt = 0; attempt < 40 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(25)
              if (!document.querySelector('.game-tooltip')) throw new Error('Oracle evidence did not use the global item tooltip.')
              evidence.dispatchEvent(new MouseEvent('mouseleave'))
              const next = root.querySelector('.bounded-results-footer nav button:last-of-type')
              if (!(next instanceof HTMLButtonElement) || next.disabled) throw new Error('Oracle next-page control was unavailable.')
              next.click()
              await frames()
              if (rows().length !== 12 || firstIdentity() === firstPageIdentity) throw new Error('Oracle paging did not replace the mounted cards.')
              await setQuery('zz-no-oracle-result-zz')
              if (rows().length !== 0 || !root.querySelector('.bounded-results-state.is-empty')) {
                throw new Error('Oracle did not render the shared empty state after an impossible search.')
              }
              await setQuery(${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_QUERY ?? '')})
              if (rows().length !== 12 || firstIdentity() !== firstPageIdentity) {
                throw new Error('Oracle search reset did not restore page one and its original first result.')
              }
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_WORKSPACE_QUERIES === '1') {
          Object.assign(interactionTimings, await verifyWorkspaceQueries(window))
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_DISMANTLING_WORKSPACE === '1') {
          interactionTimings.dismantlingWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const rows = () => [...document.querySelectorAll('.dismantling-row')]
              const setQuery = async (value) => {
                const input = document.querySelector('.dismantling-workspace .explorer-search input')
                if (!(input instanceof HTMLInputElement)) throw new Error('Dismantling search control was not rendered.')
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(175)
                await frames()
              }
              if (!document.querySelector('.dismantling-workspace')) throw new Error('Dismantling workspace was not rendered.')
              for (let attempt = 0; attempt < 120 && rows().length !== 120; attempt += 1) await wait(250)
              if (rows().length !== 120) throw new Error('Dismantling did not mount its initial 120-copy window.')
              const firstCheckbox = rows()[0]?.querySelector('input[type="checkbox"]')
              if (!(firstCheckbox instanceof HTMLInputElement)) throw new Error('Dismantling copy selection was unavailable.')
              firstCheckbox.focus()
              if (document.activeElement !== firstCheckbox) throw new Error('Dismantling copy selection was not keyboard focusable.')
              firstCheckbox.click()
              await frames()
              const run = document.querySelector('.dismantling-run')
              if (!(run instanceof HTMLButtonElement) || run.disabled || !run.textContent?.includes('Preview 1 selected')) {
                throw new Error('Dismantling selection did not enable the read-only preview action.')
              }
              run.click()
              let previewReady = false
              for (let attempt = 0; attempt < 120; attempt += 1) {
                const previewError = document.querySelector('.dismantling-preview .vault-notice.error')?.textContent
                if (previewError) throw new Error('Dismantling preview failed: ' + previewError)
                if (document.querySelector('.dismantling-costs')) {
                  previewReady = true
                  break
                }
                await wait(250)
              }
              if (!previewReady) throw new Error('Dismantling preview did not complete.')
              const waitForPopState = () => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Dismantling history navigation timed out.')), 2_000)
                window.addEventListener('popstate', () => {
                  clearTimeout(timer)
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                }, { once: true })
              })
              const back = waitForPopState()
              history.back()
              await back
              if (document.querySelector('.dismantling-workspace')) throw new Error('Back did not leave Dismantling Lab.')
              const forward = waitForPopState()
              history.forward()
              await forward
              for (let attempt = 0; attempt < 100 && !document.querySelector('.dismantling-run')?.disabled; attempt++) await wait(50)
              const restoredRun = document.querySelector('.dismantling-run')
              if (!(restoredRun instanceof HTMLButtonElement) || !restoredRun.disabled) {
                throw new Error('Dismantling archive refresh did not invalidate the old preview selection.')
              }
              await setQuery('zz-no-dismantling-result-zz')
              if (rows().length !== 0 || !document.querySelector('.dismantling-candidates .bounded-results-state.is-empty')) {
                throw new Error('Dismantling did not render its empty state after an impossible search.')
              }
              await setQuery(${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_QUERY ?? '')})
              if (rows().length !== 120) throw new Error('Dismantling search did not restore its initial 120-copy window.')
              const firstIdentity = rows()[0]?.textContent
              const more = [...document.querySelectorAll('.dismantling-list .bounded-results-footer button')].find(button => button.textContent.trim() === 'Next')
              if (!(more instanceof HTMLButtonElement)) throw new Error('Dismantling next-page control was unavailable.')
              more.focus()
              if (document.activeElement !== more) throw new Error('Dismantling paging was not keyboard focusable.')
              more.click()
              for (let attempt = 0; attempt < 100 && rows()[0]?.textContent === firstIdentity; attempt++) await wait(50)
              if (rows().length !== 120 || rows()[0]?.textContent === firstIdentity) throw new Error('Dismantling did not replace its bounded 120-copy page.')
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_OPEN_SEARCH_HELP === '1') {
          const openedSearchHelp = await window.webContents.executeJavaScript(`
            (() => {
              const details = document.querySelector('.explorer-search-help')
              if (!(details instanceof HTMLDetailsElement)) return false
              details.open = true
              details.querySelector('summary')?.focus()
              return true
            })()
          `)
          if (!openedSearchHelp) throw new Error('Search help control was not available for screenshot capture.')
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_RESPONSIVE_TOOLS === '1') {
          await window.webContents.executeJavaScript(`
            (async () => {
              const waitForFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const details = document.querySelector('.explorer-search-help')
              const summary = details?.querySelector('summary')
              if (!(details instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement)) {
                throw new Error('Search tips were not rendered for responsive verification.')
              }
              summary.scrollIntoView({ block: 'center', inline: 'nearest' })
              await waitForFrames()
              details.open = true
              await waitForFrames()
              await new Promise((resolve) => setTimeout(resolve, 50))
              const panel = document.querySelector('.explorer-search-help-panel')
              if (!(panel instanceof HTMLElement)) throw new Error('Search tips panel did not open.')
              const panelRect = panel.getBoundingClientRect()
              if (
                panelRect.left < 0 || panelRect.right > window.innerWidth + 1 ||
                panelRect.top < 0 || panelRect.bottom > window.innerHeight + 1
              ) {
                throw new Error('Search tips escaped the viewport: ' + JSON.stringify({
                  left: panelRect.left, right: panelRect.right, top: panelRect.top, bottom: panelRect.bottom,
                  viewport: { width: window.innerWidth, height: window.innerHeight }
                }))
              }
              panel.focus()
              panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              await waitForFrames()
              if (details.open || document.activeElement !== summary) {
                throw new Error('Escape did not close Search tips and restore focus to its trigger.')
              }

              const advancedTrigger = document.querySelector('.advanced-search-trigger')
              if (!(advancedTrigger instanceof HTMLButtonElement)) {
                throw new Error('Advanced search trigger was not rendered for responsive verification.')
              }
              advancedTrigger.click()
              await waitForFrames()
              const dialog = document.querySelector('.advanced-search-dialog')
              if (!(dialog instanceof HTMLDialogElement) || !dialog.open) {
                throw new Error('Advanced search dialog did not open.')
              }
              const dialogRect = dialog.getBoundingClientRect()
              if (
                dialogRect.left < 0 || dialogRect.right > window.innerWidth + 1 ||
                dialogRect.top < 0 || dialogRect.bottom > window.innerHeight + 1 ||
                !dialog.contains(document.activeElement)
              ) {
                throw new Error('Advanced search is clipped or did not receive focus: ' + JSON.stringify({
                  left: dialogRect.left, right: dialogRect.right, top: dialogRect.top, bottom: dialogRect.bottom,
                  focused: document.activeElement?.tagName,
                  viewport: { width: window.innerWidth, height: window.innerHeight }
                }))
              }
              const dialogControls = [...dialog.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled]):not([type="hidden"]), [tabindex]:not([tabindex="-1"])')]
                .filter((control) => control instanceof HTMLElement && control.offsetParent !== null)
              const firstDialogControl = dialogControls[0]
              const lastDialogControl = dialogControls[dialogControls.length - 1]
              if (!(firstDialogControl instanceof HTMLElement) || !(lastDialogControl instanceof HTMLElement)) {
                throw new Error('Advanced search did not expose a keyboard focus cycle.')
              }
              lastDialogControl.focus()
              lastDialogControl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
              if (document.activeElement !== firstDialogControl) {
                throw new Error('Tab did not wrap from the last Advanced search control to the first.')
              }
              firstDialogControl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
              if (document.activeElement !== lastDialogControl) {
                throw new Error('Shift+Tab did not wrap from the first Advanced search control to the last.')
              }
              advancedTrigger.focus()
              advancedTrigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
              await waitForFrames()
              if (!dialog.contains(document.activeElement)) {
                throw new Error('Advanced search allowed programmatic focus to escape the modal.')
              }
              document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              await waitForFrames()
              if (dialog.open || document.activeElement !== advancedTrigger) {
                throw new Error('Escape did not close Advanced search and restore focus to its trigger.')
              }
              const localScroller = [...document.querySelectorAll('.research-item-table, .mi-table-wrap')]
                .find((element) => element instanceof HTMLElement && element.offsetParent !== null)
              if (localScroller instanceof HTMLElement && localScroller.scrollWidth > localScroller.clientWidth) {
                const descriptionId = localScroller.getAttribute('aria-describedby')
                const description = descriptionId ? document.getElementById(descriptionId) : null
                if (
                  localScroller.tabIndex < 0 ||
                  !(description instanceof HTMLElement) ||
                  (window.innerWidth <= 1180 && getComputedStyle(description).display === 'none')
                ) {
                  throw new Error('Wide result table is not exposed as a labeled, keyboard-focusable local scroller.')
                }
                localScroller.focus()
                if (document.activeElement !== localScroller) {
                  throw new Error('Wide result table could not receive keyboard focus.')
                }
              }
              if (${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_OPEN_SEARCH_HELP === '1')}) {
                details.open = true
                await waitForFrames()
              }
            })()
          `)
        }
        const miWorkshopQuery = process.env.CAIRN_CODEX_SCREENSHOT_MI_QUERY
        const miAffixFilter = process.env.CAIRN_CODEX_SCREENSHOT_MI_AFFIX_FILTER
        const miNativeRestore = process.env.CAIRN_CODEX_SCREENSHOT_MI_NATIVE_RESTORE === '1'
        if (miWorkshopQuery || miAffixFilter) {
          await window.webContents.executeJavaScript(`
            (async () => {
              const input = document.querySelector('.mi-explorer-toolbar .explorer-search input')
              if (input && ${JSON.stringify(Boolean(miWorkshopQuery))}) {
                input.value = ${JSON.stringify(miWorkshopQuery ?? '')}
                if (!${JSON.stringify(miNativeRestore)}) input.dispatchEvent(new Event('input', { bubbles: true }))
              }
              const select = document.querySelector('.mi-explorer-toolbar .explorer-toolbar-filters select')
              if (select && ${JSON.stringify(Boolean(miAffixFilter))}) {
                select.value = ${JSON.stringify(miAffixFilter ?? 'all')}
                if (!${JSON.stringify(miNativeRestore)}) select.dispatchEvent(new Event('change', { bubbles: true }))
              }
              if (${JSON.stringify(miNativeRestore)}) window.dispatchEvent(new PageTransitionEvent('pageshow'))
              await new Promise((resolve) => setTimeout(resolve, 150))
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_MI_WORKSHOP_WORKSPACE === '1') {
          interactionTimings.miWorkshopWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const root = document.querySelector('.mi-workshop')
              const resultRoot = document.querySelector('.mi-table-results')
              const rows = () => [...document.querySelectorAll('.mi-table-results .bounded-results-item')]
              const resultCount = () => Number((document.querySelector('.mi-explorer-toolbar .explorer-result-count')?.textContent ?? '').replace(/[^0-9]/g, ''))
              const selects = () => [...document.querySelectorAll('.mi-explorer-toolbar select')]
              const setQuery = async (value) => {
                const input = document.querySelector('.mi-explorer-toolbar .explorer-search input')
                if (!(input instanceof HTMLInputElement)) throw new Error('MI Workshop search control was not rendered.')
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(175)
                await frames()
              }
              if (!root || !root.querySelector('.tool-header') || !root.querySelector('.explorer-toolbar')) {
                throw new Error('MI Workshop did not render the shared workspace shell.')
              }
              if (!resultRoot || rows().length < 2 || rows().length > 50) {
                throw new Error('MI Workshop did not mount a bounded non-empty result page.')
              }
              const originalTotal = resultCount()
              const originalFirst = rows()[0]?.textContent?.replace(/\s+/g, ' ').trim()
              if (!Number.isFinite(originalTotal) || originalTotal < rows().length) throw new Error('MI Workshop result count was invalid.')
              const first = rows()[0]
              const second = rows()[1]
              const affixed = rows().find((row) => row.querySelectorAll('.affix-name.rare, .affix-name.magical').length === 2)
              if (!(affixed instanceof HTMLElement)) throw new Error('MI Workshop fixture did not expose an affixed copy for tooltip verification.')
              let nativeFocusEvents = 0
              affixed.addEventListener('focus', () => { nativeFocusEvents += 1 })
              affixed.focus()
              if (document.activeElement !== affixed) throw new Error('An affixed MI Workshop row was not keyboard focusable.')
              if (nativeFocusEvents === 0) affixed.dispatchEvent(new FocusEvent('focus'))
              for (let attempt = 0; attempt < 8 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(10)
              const tooltipName = document.querySelector('.game-tooltip h3')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
              const rowAffixes = [...affixed.querySelectorAll('.affix-name')].map((node) => node.textContent?.trim()).filter(Boolean)
              // Older imported catalog tags contain a few singular/plural label variants (for
              // example, "of Spine" versus "of Spines") for the same serialized affix record.
              const tooltipIncludesAffix = (affix) => tooltipName.includes(affix) ||
                (affix.endsWith('s') && tooltipName.includes(affix.slice(0, -1)))
              if (!tooltipName || rowAffixes.some((affix) => !tooltipIncludesAffix(affix))) {
                throw new Error('MI Workshop keyboard tooltip did not immediately preserve the selected copy affixes: ' + JSON.stringify({ tooltipName, rowAffixes }))
              }
              first.focus()
              first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              await wait(20)
              if (document.activeElement !== second) throw new Error('ArrowDown did not move to the next MI Workshop row.')
              const searchInput = document.querySelector('.mi-explorer-toolbar .explorer-search input')
              second.dispatchEvent(new FocusEvent('blur'))
              if (searchInput instanceof HTMLInputElement) searchInput.focus()
              await wait(120)
              if (document.querySelector('.game-tooltip')) throw new Error('MI Workshop tooltip did not settle before pointer-delay verification.')
              const affixedRow = affixed.querySelector('.mi-table-row')
              if (!(affixedRow instanceof HTMLElement)) throw new Error('MI Workshop row content was unavailable.')
              affixedRow.dispatchEvent(new MouseEvent('mouseenter', { clientX: 20, clientY: 20 }))
              if (document.querySelector('.game-tooltip')) throw new Error('MI Workshop pointer hover bypassed the established tooltip delay.')
              for (let attempt = 0; attempt < 40 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(25)
              if (!document.querySelector('.game-tooltip')) throw new Error('MI Workshop pointer hover did not use the global tooltip.')
              affixedRow.dispatchEvent(new MouseEvent('mouseleave'))
              const [affixSelect, metricSelect, sortSelect, orderSelect] = selects()
              if (![affixSelect, metricSelect, sortSelect, orderSelect].every((select) => select instanceof HTMLSelectElement)) {
                throw new Error('MI Workshop typed filter and sort controls were incomplete.')
              }
              affixSelect.value = 'double-rare'
              affixSelect.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              if (rows().length === 0 || rows().some((row) => row.querySelectorAll('.affix-name.rare').length !== 2 || row.querySelector('.affix-name.magical'))) {
                throw new Error('MI Workshop double-rare filter admitted a non-rare affix pair.')
              }
              affixSelect.value = 'all'
              affixSelect.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              sortSelect.value = 'level'
              sortSelect.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              orderSelect.value = 'asc'
              orderSelect.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              const levels = rows().map((row) => Number(row.querySelector('.mi-table-row > [role="gridcell"]:nth-child(2)')?.textContent))
              if (levels.some((level, index) => index > 0 && level < levels[index - 1])) {
                throw new Error('MI Workshop required-level sort did not produce ascending results: ' + JSON.stringify({
                  levels,
                  sort: sortSelect.value,
                  order: orderSelect.value
                }))
              }
              const next = resultRoot.querySelector('.bounded-results-footer nav button:last-of-type')
              if (!(next instanceof HTMLButtonElement) || next.disabled) throw new Error('MI Workshop verification needs a second bounded page.')
              next.click()
              await frames()
              if (rows().length > 50 || rows()[0]?.textContent?.replace(/\s+/g, ' ').trim() === originalFirst) {
                throw new Error('MI Workshop paging did not replace its bounded rows.')
              }
              await setQuery('zz-no-mi-result-zz')
              if (rows().length !== 0 || !resultRoot.querySelector('.bounded-results-state.is-empty')) {
                throw new Error('MI Workshop did not render the shared empty state after an impossible search.')
              }
              await setQuery('')
              if (rows().length < 2 || rows().length > 50 || resultCount() !== originalTotal) {
                throw new Error('MI Workshop search reset did not restore the original bounded result set.')
              }
              const pageText = resultRoot.querySelector('.bounded-results-footer nav span')?.textContent ?? 'Page 1'
              if (!pageText.includes('Page 1')) throw new Error('Editing MI Workshop search did not reset paging to page one.')
              const scroller = document.querySelector('.mi-table-wrap')
              if (!(scroller instanceof HTMLElement) || scroller.tabIndex < 0 || scroller.getAttribute('aria-describedby') !== 'mi-table-scroll-help') {
                throw new Error('MI Workshop comparison table is not a labeled keyboard-focusable local scroller.')
              }
              if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
                throw new Error('MI Workshop escaped its local scroller and overflowed the document.')
              }
              return performance.now() - started
            })()
          `)
        }
        const scrollTarget = process.env.CAIRN_CODEX_SCREENSHOT_SCROLL_TARGET
        if (scrollTarget) {
          await window.webContents.executeJavaScript(`
            (() => {
              const target = document.querySelector(${JSON.stringify(scrollTarget)})
              if (!target) return window.scrollTo(0, 0)
              const topbar = document.querySelector('.topbar')
              const offset = (topbar?.getBoundingClientRect().height ?? 0) + 12
              window.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset))
            })()
          `)
        } else {
          await window.webContents.executeJavaScript('window.scrollTo(0, 0)')
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_OPEN_FIRST === '1') {
          await new Promise((resolve) => setTimeout(resolve, 250))
          await window.webContents.executeJavaScript(
            "document.querySelector('.item-card[role=button], .set-card li button')?.click()"
          )
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_HOVER_FIRST === '1') {
          await new Promise((resolve) => setTimeout(resolve, 250))
          await window.webContents.executeJavaScript(`
            (() => {
              const card = document.querySelector('.item-card[role=button], .set-card li button, .planner-results .bounded-results-item, .atlas-item-list button')
              if (!card) return
              const rect = card.getBoundingClientRect()
              card.dispatchEvent(new MouseEvent('mouseenter', {
                bubbles: false,
                clientX: rect.right - 20,
                clientY: rect.top + 30
              }))
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_TYPED_ROUTES === '1') {
          interactionTimings.typedRoutesMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const waitForPopState = () => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Typed route navigation did not emit popstate.')), 1500)
                window.addEventListener('popstate', () => {
                  clearTimeout(timer)
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                }, { once: true })
              })
              const navigationButton = (label) => [...document.querySelectorAll('.workspace-sidebar [data-destination-id], .workspace-sidebar [data-tool-id]')]
                .find((button) => button.querySelector('.workspace-nav-label')?.textContent?.trim() === label)
              const workspaceButton = navigationButton
              const openCollectionWorkspace = async () => {
                const collection = navigationButton('Collection')
                if (!(collection instanceof HTMLButtonElement) || !collection.isConnected) {
                  throw new Error('Stable Collection application route was unavailable.')
                }
                collection.click()
                await frames()
              }
              const activeWorkspace = () => document.querySelector('.workspace-sidebar [aria-current="page"] .workspace-nav-label')?.textContent?.trim()
              const expectedInitialControls = ${JSON.stringify(expectedRouteControls)}
              const assertInitialControls = (state) => {
                for (const [key, expected] of Object.entries(expectedInitialControls)) {
                  if (key === 'profileId' && expected === null) continue
                  if (JSON.stringify(state.route.controls[key]) !== JSON.stringify(expected)) {
                    throw new Error('Initial typed route control was overwritten: ' + JSON.stringify({
                      key, expected, actual: state.route.controls[key], controls: state.route.controls
                    }))
                  }
                }
              }
              const assertTypedEntry = (workspace, itemExpected) => {
                const state = window.history.state
                if (
                  state?.cairnCodex !== true || state?.routeVersion !== 1 ||
                  state?.route?.version !== 1 || state?.route?.workspace !== workspace ||
                  typeof state?.index !== 'number' || 'view' in state || 'selectedRecord' in state
                ) {
                  throw new Error('History entry is not the versioned typed route for ' + workspace + ': ' + JSON.stringify(state))
                }
                if (itemExpected && !state.route.itemRecord) throw new Error('Item route omitted its stable record identity.')
                if (!itemExpected && state.route.itemRecord !== null) throw new Error('Workspace route retained a transient item selection.')
                const serialized = JSON.stringify(state.route)
                for (const forbidden of ['snapshot', 'results', 'observedItems', 'payload']) {
                  if (serialized.includes('"' + forbidden + '"')) {
                    throw new Error('Typed route serialized forbidden transient data: ' + forbidden + '.')
                  }
                }
                const hash = new URL(window.location.href).hash
                const params = new URLSearchParams(hash.slice(1))
                if (params.get('cc-route') !== '1' || params.get('view') !== workspace) {
                  throw new Error('URL deep link and typed history state disagree: ' + hash)
                }
                return state
              }

              document.querySelector('.onboarding-skip')?.click()
              await frames()
              if (window.history.state?.route?.workspace === 'planner') {
                const initialPlanner = assertTypedEntry('planner', false)
                assertInitialControls(initialPlanner)
                if (!document.querySelector('.leveling-planner')) throw new Error('Direct Planner deep link did not restore its workspace.')
                const activeRegion = document.querySelector('.mi-atlas-regions button.active')
                if (
                  !(activeRegion instanceof HTMLButtonElement) ||
                  activeRegion.dataset.regionKey !== expectedInitialControls.atlasRegion
                ) {
                  throw new Error('Direct Planner map route did not preserve its selected atlas region.')
                }
                return performance.now() - started
              }
              if (window.history.state?.route?.workspace === 'sets') {
                const initialSet = assertTypedEntry('sets', false)
                assertInitialControls(initialSet)
                if (activeWorkspace() !== 'Sets') throw new Error('Direct Sets deep link did not restore its workspace.')
                const setsRoot = document.querySelector('.set-results')
                const currentSetPage = () => setsRoot?.querySelector('.bounded-results-footer nav span')?.textContent?.trim() ?? ''
                if (!currentSetPage().includes('Page 2')) throw new Error('Direct Sets deep link did not restore page two.')
                const setItem = document.querySelector('.set-card li button')
                if (!(setItem instanceof HTMLButtonElement)) throw new Error('Deep-linked Sets route did not render an item link.')
                setItem.click()
                await frames()
                const setItemState = assertTypedEntry('sets', true)
                if (!document.querySelector('.item-drawer')) throw new Error('Set item link did not open its typed item route.')

                const closeDrawer = document.querySelector('.drawer-close')
                if (!(closeDrawer instanceof HTMLButtonElement)) throw new Error('Set item drawer did not expose its close action.')
                closeDrawer.click()
                await frames()
                assertTypedEntry('sets', false)
                if (!currentSetPage().includes('Page 2')) throw new Error('Closing the Set item drawer did not retain page two.')

                const search = document.querySelector('.collection-explorer-toolbar .explorer-search input')
                if (!(search instanceof HTMLInputElement)) throw new Error('Sets search was unavailable for route restoration.')
                search.value = 'no-such-route-restoration-set'
                search.dispatchEvent(new Event('input', { bubbles: true }))
                await new Promise((resolve) => setTimeout(resolve, 175))
                await frames()
                const restrictedState = assertTypedEntry('sets', false)
                if (restrictedState.route.controls.page !== 1 || !document.querySelector('.set-results .bounded-results-state.is-empty')) {
                  throw new Error('Restrictive Sets search did not replace history with its page-one empty state.')
                }

                const backToSetItem = waitForPopState()
                window.history.back()
                await backToSetItem
                await new Promise((resolve) => setTimeout(resolve, 175))
                const restoredItem = assertTypedEntry('sets', true)
                if (
                  restoredItem.route.itemRecord !== setItemState.route.itemRecord ||
                  !currentSetPage().includes('Page 2') ||
                  !document.querySelector('.item-drawer')
                ) {
                  throw new Error('Back did not restore the Set item route on page two after a restrictive search.')
                }

                const forwardToRestrictedSet = waitForPopState()
                window.history.forward()
                await forwardToRestrictedSet
                await new Promise((resolve) => setTimeout(resolve, 175))
                if (
                  document.querySelector('.item-drawer') ||
                  window.history.state.route.itemRecord !== null ||
                  window.history.state.route.controls.query !== 'no-such-route-restoration-set' ||
                  window.history.state.route.controls.page !== 1 ||
                  !document.querySelector('.set-results .bounded-results-state.is-empty')
                ) {
                  throw new Error('Forward did not restore the restrictive Sets search route.')
                }
                return performance.now() - started
              }
              const initial = assertTypedEntry('collection', false)
              assertInitialControls(initial)
              if (activeWorkspace() !== 'Collection' || typeof initial.route.controls.query !== 'string') {
                throw new Error('Direct Collection deep link did not restore its workspace and query.')
              }
              const card = document.querySelector('.catalog-results .bounded-results-item[tabindex]')
              if (!(card instanceof HTMLElement)) throw new Error('Deep-linked Collection route did not render an activatable MI item.')
              card.click()
              await frames()
              const itemState = assertTypedEntry('collection', true)
              const drawer = document.querySelector('.item-drawer')
              const openWorkshop = document.querySelector('.drawer-mi-tools button')
              if (!(drawer instanceof HTMLElement) || !(openWorkshop instanceof HTMLButtonElement)) {
                throw new Error('Collection item route did not open the MI comparison drawer and return action.')
              }
              const itemName = drawer.querySelector('h2')?.textContent?.trim()
              if (!itemName || !itemState.route.itemRecord) throw new Error('MI item route lacked stable identity.')
              openWorkshop.click()
              await frames()
              const workshopState = assertTypedEntry('mi-workshop', false)
              if (workshopState.route.controls.query !== itemName || document.querySelector('.item-drawer')) {
                throw new Error('Open in MI Workshop did not create a serializable return destination.')
              }
              const backToItem = waitForPopState()
              window.history.back()
              await backToItem
              if (!document.querySelector('.item-drawer') || window.history.state.route.itemRecord !== itemState.route.itemRecord) {
                throw new Error('Back did not restore the MI item drawer route: ' + JSON.stringify({
                  state: window.history.state,
                  expectedRecord: itemState.route.itemRecord,
                  drawer: document.querySelector('.item-drawer h2')?.textContent?.trim() ?? null,
                  workspace: activeWorkspace()
                }))
              }
              const forwardToWorkshop = waitForPopState()
              window.history.forward()
              await forwardToWorkshop
              if (document.querySelector('.item-drawer') || window.history.state.route.controls.query !== itemName) {
                throw new Error('Forward did not restore the MI Workshop return route.')
              }

              const search = document.querySelector('.mi-explorer-toolbar .explorer-search input')
              const affix = document.querySelector('.mi-explorer-toolbar .explorer-toolbar-filters select')
              if (!(search instanceof HTMLInputElement) || !(affix instanceof HTMLSelectElement)) {
                throw new Error('MI route controls were not rendered for native restoration verification.')
              }
              const restoredWorkshopState = assertTypedEntry('mi-workshop', false)
              search.value = 'native-restoration-disagreement'
              affix.value = 'double-rare'
              window.dispatchEvent(new PageTransitionEvent('pageshow'))
              await frames()
              await new Promise((resolve) => setTimeout(resolve, 20))
              if (
                search.value !== restoredWorkshopState.route.controls.query ||
                affix.value !== restoredWorkshopState.route.controls.affix
              ) {
                throw new Error('Native form restoration disagreed with application route state.')
              }

              await openCollectionWorkspace()
              assertTypedEntry('collection', false)
              const workshop = workspaceButton('MI Workshop')
              if (!(workshop instanceof HTMLButtonElement)) throw new Error('MI Workshop child route was unavailable from Collection.')
              workshop.click()
              await frames()
              assertTypedEntry('mi-workshop', false)
              const backToCollection = waitForPopState()
              window.history.back()
              await backToCollection
              const collectionBeforeMaterials = assertTypedEntry('collection', false)
              const materials = workspaceButton('Components & Consumables')
              if (!(materials instanceof HTMLButtonElement)) throw new Error('Materials child route was unavailable from Collection.')
              materials.click()
              await frames()
              assertTypedEntry('materials', false)
              const materialsSearch = document.querySelector('.collection-materials-workspace .explorer-search input')
              if (!(materialsSearch instanceof HTMLInputElement)) throw new Error('Materials search control was not rendered.')
              materialsSearch.value = 'materials-only-query'
              materialsSearch.dispatchEvent(new Event('input', { bubbles: true }))
              await frames()
              if (window.history.state.route.controls.query !== 'materials-only-query') {
                throw new Error('Materials did not own its typed query state.')
              }
              await openCollectionWorkspace()
              const restoredCollection = assertTypedEntry('collection', false)
              if (JSON.stringify(restoredCollection.route.controls) !== JSON.stringify(collectionBeforeMaterials.route.controls)) {
                throw new Error('Materials controls leaked into Collection: ' + JSON.stringify({
                  before: collectionBeforeMaterials.route.controls,
                  after: restoredCollection.route.controls
                }))
              }
              const materialsAgain = workspaceButton('Components & Consumables')
              materialsAgain?.click()
              await frames()
              const restoredMaterials = assertTypedEntry('materials', false)
              if (restoredMaterials.route.controls.query !== 'materials-only-query') {
                throw new Error('Returning to Materials did not preserve its independent typed query.')
              }
              await openCollectionWorkspace()
              assertTypedEntry('collection', false)
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_NAVIGATION === '1' && transferSection) {
          interactionTimings.navigationMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const activeSection = () => document.querySelector('.transfer-section-tabs button.active strong')?.textContent?.trim()
              const waitForPopState = () => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Navigation did not emit popstate.')), 1500)
                window.addEventListener('popstate', () => {
                  clearTimeout(timer)
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                }, { once: true })
              })
              const back = waitForPopState()
              window.history.back()
              await back
              if (activeSection() !== 'Ingest history') throw new Error('Back did not restore Ingest history.')
              const forward = waitForPopState()
              window.history.forward()
              await forward
              if (activeSection() !== ${JSON.stringify(transferSection)}) {
                throw new Error('Forward did not restore the requested transfer section.')
              }
              const restoredQuery = document.querySelector('.vault-explorer-toolbar input')?.value ?? ''
              if (restoredQuery !== ${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_QUERY ?? '')}) {
                throw new Error('Forward did not restore the transfer-history query.')
              }
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_NAVIGATION === '1' && !transferSection) {
          if (process.env.CAIRN_CODEX_SCREENSHOT_ONBOARDING_STEP === undefined) {
            await window.webContents.executeJavaScript(`
              (async () => {
                document.querySelector('.onboarding-skip')?.click()
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              })()
            `)
          }
          window.setOpacity(0)
          window.showInactive()
          window.webContents.invalidate()
          await new Promise((resolve) => setTimeout(resolve, 100))
          interactionTimings.navigationMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const navigationButton = (label) => [...document.querySelectorAll('.workspace-sidebar [data-destination-id], .workspace-sidebar [data-tool-id]')]
                .find((button) => button.querySelector('.workspace-nav-label')?.textContent?.trim() === label)
              const workspaceButton = navigationButton
              const activeWorkspace = () => document.querySelector('.workspace-sidebar [aria-current="page"] .workspace-nav-label')?.textContent?.trim()
              const sidebar = document.querySelector('.workspace-sidebar')
              if (!(sidebar instanceof HTMLElement)) throw new Error('Persistent application navigation was not rendered.')
              const initialSidebarRect = sidebar.getBoundingClientRect()
              const assertStableSidebarGeometry = () => {
                const current = document.querySelector('.workspace-sidebar')
                const rect = current?.getBoundingClientRect()
                if (!(current instanceof HTMLElement) || !rect ||
                    Math.abs(rect.left - initialSidebarRect.left) > 1 ||
                    Math.abs(rect.width - initialSidebarRect.width) > 1) {
                  throw new Error('Application navigation moved or changed width across routes.')
                }
              }
              const assertSettings = () => {
                if (
                  activeWorkspace() !== 'Settings' ||
                  !document.querySelector('.settings-workspace') ||
                  !navigationButton('Collection')
                ) {
                  throw new Error('Settings destination and content were not restored together.')
                }
                assertStableSidebarGeometry()
              }
              const assertTransfers = () => {
                if (
                  activeWorkspace() !== 'Transfers' ||
                  !document.querySelector('.vault-workspace') ||
                  !navigationButton('Collection')
                ) {
                  throw new Error('Transfers destination and content were not restored together.')
                }
                assertStableSidebarGeometry()
              }
              const assertCollection = () => {
                if (
                  activeWorkspace() !== 'Collection' ||
                  !document.querySelector('.category-tabs') ||
                  !navigationButton('Collection') ||
                  document.querySelector('.workspace-shortcuts, .workspace-launcher-heading')
                ) {
                  throw new Error('Collection destination was not stable on the dashboard.')
                }
                assertStableSidebarGeometry()
              }
              const waitForFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const waitForPopState = () => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Application navigation did not emit popstate.')), 1500)
                window.addEventListener('popstate', () => {
                  clearTimeout(timer)
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                }, { once: true })
              })
              assertSettings()
              const collection = navigationButton('Collection')
              if (!collection) throw new Error('Persistent Collection navigation was not rendered.')
              const destinationButtons = [...sidebar.querySelectorAll('[data-destination-id]')]
              const destinationIds = destinationButtons.map((button) => button.getAttribute('data-destination-id'))
              if (destinationIds.join('|') !== 'collection|glossary|vault|settings') {
                throw new Error('Application destination order was not deterministic: ' + destinationIds.join('|') + '.')
              }
              const navRect = sidebar.getBoundingClientRect()
              if (
                navRect.left < 0 || navRect.right > window.innerWidth ||
                navRect.top < 0 || navRect.bottom > window.innerHeight ||
                navRect.width <= 0 || navRect.height <= 0 ||
                sidebar.scrollWidth > sidebar.clientWidth ||
                document.documentElement.scrollWidth > window.innerWidth
              ) {
                throw new Error('Persistent application navigation is clipped or overflowing.')
              }
              const navButtons = [...sidebar.querySelectorAll('button:not([disabled])')]
                .filter((button) => button.getClientRects().length > 0)
              for (const button of navButtons) {
                const rect = button.getBoundingClientRect()
                const style = getComputedStyle(button)
                const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
                if (
                  button.disabled || button.tabIndex < 0 ||
                  style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 ||
                  rect.width <= 0 || rect.height <= 0 ||
                  rect.left < navRect.left || rect.right > navRect.right ||
                  rect.top < navRect.top || rect.bottom > navRect.bottom ||
                  rect.left < 0 || rect.right > window.innerWidth ||
                  rect.top < 0 || rect.bottom > window.innerHeight ||
                  !hit || (hit !== button && !button.contains(hit))
                ) {
                  throw new Error(
                    (button.textContent?.trim() || 'Unknown') + ' is clipped, obscured, or unavailable: ' +
                    JSON.stringify({
                      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
                      navRect: { left: navRect.left, right: navRect.right, top: navRect.top, bottom: navRect.bottom },
                      viewport: { width: window.innerWidth, height: window.innerHeight },
                      display: style.display,
                      visibility: style.visibility,
                      opacity: style.opacity,
                      hit: hit ? { tag: hit.tagName, className: hit.className } : null
                    })
                  )
                }
                button.focus()
                if (document.activeElement !== button) {
                  throw new Error((button.textContent?.trim() || 'Unknown') + ' could not receive keyboard focus.')
                }
              }
              collection.focus()
              if (document.activeElement !== collection) throw new Error('Collection could not receive keyboard focus.')
              collection.click()
              await waitForFrames()
              assertCollection()
              const brandHome = document.querySelector('.brand-lockup[href="#collection"]')
              if (!(brandHome instanceof HTMLAnchorElement) || brandHome.getAttribute('aria-label') !== 'Collection home') {
                throw new Error('The app brand did not expose conventional Collection-home link semantics.')
              }
              const transfers = navigationButton('Transfers')
              if (!(transfers instanceof HTMLButtonElement)) throw new Error('Transfers application destination was unavailable.')
              transfers.focus()
              if (document.activeElement !== transfers) throw new Error('Transfers could not receive keyboard focus.')
              transfers.click()
              await waitForFrames()
              assertTransfers()
              brandHome.click()
              await waitForFrames()
              assertCollection()
              const settings = navigationButton('Settings')
              if (!(settings instanceof HTMLButtonElement)) throw new Error('Settings application destination was unavailable.')
              settings.focus()
              if (document.activeElement !== settings) throw new Error('Settings could not receive keyboard focus.')
              settings.click()
              await waitForFrames()
              assertSettings()
              navigationButton('Collection')?.click()
              await waitForFrames()
              assertCollection()
              const sets = workspaceButton('Sets')
              if (!sets) throw new Error('Sets child workspace was not rendered for navigation verification.')
              sets.click()
              await waitForFrames()
              if (
                activeWorkspace() !== 'Sets' ||
                document.querySelector('.category-tabs') ||
                !navigationButton('Collection') ||
                !navigationButton('Transfers') ||
                !navigationButton('Settings')
              ) {
                throw new Error('Specialist workspace lost its persistent application navigation.')
              }
              assertStableSidebarGeometry()
              const backToCollection = waitForPopState()
              window.history.back()
              await backToCollection
              assertCollection()
              const backToSettings = waitForPopState()
              window.history.back()
              await backToSettings
              assertSettings()
              const forward = waitForPopState()
              window.history.forward()
              await forward
              assertCollection()
              const returnToSettings = waitForPopState()
              window.history.back()
              await returnToSettings
              assertSettings()
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_SETTINGS_WORKSPACE === '1') {
          interactionTimings.settingsWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (duration = 100) => new Promise((resolve) => setTimeout(resolve, duration))
              const preferences = () => JSON.parse(localStorage.getItem('cairn-codex-preferences') || '{}')
              const expectedSafeMode = ${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_EXPECT_SAFE_SETTINGS === '1')}
              if (expectedSafeMode) {
                const settingsButton = document.querySelector('.workspace-sidebar [data-destination-id="settings"]')
                if (!(settingsButton instanceof HTMLButtonElement)) {
                  throw new Error('Safe-mode Settings navigation control was not rendered.')
                }
                settingsButton.click()
                await frames()
              }
              const workspace = document.querySelector('.settings-workspace')
              if (!workspace || document.querySelector('.workspace-sidebar [data-destination-id="settings"]')?.getAttribute('aria-current') !== 'page') {
                throw new Error('Settings lost the persistent application navigation or active destination.')
              }
              if (workspace.querySelectorAll('.settings-card').length !== 14) {
                throw new Error('Settings extraction did not retain all fourteen cards.')
              }

              const autoConnect = workspace.querySelector('.settings-card input[type="checkbox"]')
              const experimental = workspace.querySelector('.experimental-tools-toggle input')
              if (!(autoConnect instanceof HTMLInputElement) || !(experimental instanceof HTMLInputElement)) {
                throw new Error('Settings safety toggles were not rendered.')
              }
              if (expectedSafeMode) {
                if (!autoConnect.disabled || !experimental.disabled || experimental.checked) {
                  throw new Error('Safe mode did not disable auto-connect and experimental tools.')
                }
                return performance.now() - started
              }
              if (autoConnect.disabled || experimental.disabled) {
                throw new Error('Ordinary Settings unexpectedly inherited safe-mode gating.')
              }

              experimental.click()
              await frames()
              if (!experimental.checked || preferences().workspace?.experimentalToolsEnabled !== true) {
                throw new Error('Experimental-tools emit did not update the persisted shell preference.')
              }
              const oracleLabel = [...workspace.querySelectorAll('.workspace-tool-options label')]
                .find((label) => label.textContent?.includes('Stash Oracle'))
              const oracleToggle = oracleLabel?.querySelector('input')
              if (!(oracleToggle instanceof HTMLInputElement) || oracleToggle.disabled) {
                throw new Error('Enabling experimental tools did not enable the Stash Oracle control.')
              }
              const triviaLabel = [...workspace.querySelectorAll('.workspace-tool-options label')]
                .find((label) => label.textContent?.includes('Collection Trivia'))
              const triviaToggle = triviaLabel?.querySelector('input')
              if (!(triviaToggle instanceof HTMLInputElement)) throw new Error('Tool visibility control was not rendered.')
              const triviaInitiallyVisible = triviaToggle.checked
              triviaToggle.click()
              await frames()
              if (preferences().workspace?.visibleTools?.includes('trivia') === triviaInitiallyVisible) {
                throw new Error('Tool visibility emit did not persist the requested boolean argument.')
              }

              const tierMode = workspace.querySelector('input[type="radio"][value="tier"]')
              if (!(tierMode instanceof HTMLInputElement)) throw new Error('MI counting model was not rendered.')
              tierMode.click()
              await frames()
              if (!tierMode.checked || preferences().workspace?.miCountingMode !== 'tier') {
                throw new Error('MI counting v-model did not update the persisted parent ref.')
              }

              const containedTooltipScroll = workspace.querySelector('input[name="tooltip-boundary-scroll"][value="contain"]')
              const pageTooltipScroll = workspace.querySelector('input[name="tooltip-boundary-scroll"][value="page"]')
              if (!(containedTooltipScroll instanceof HTMLInputElement) || !(pageTooltipScroll instanceof HTMLInputElement)) {
                throw new Error('Tooltip edge scrolling choices were not rendered.')
              }
              containedTooltipScroll.click()
              await frames()
              if (!containedTooltipScroll.checked || preferences().appearance?.tooltipBoundaryScroll !== 'contain') {
                throw new Error('Contained tooltip-edge scrolling did not persist through Settings.')
              }
              pageTooltipScroll.click()
              await frames()
              if (!pageTooltipScroll.checked || preferences().appearance?.tooltipBoundaryScroll !== 'page') {
                throw new Error('Page tooltip-edge scrolling did not persist through Settings.')
              }

              const stashTarget = workspace.querySelector('.retrieval-settings select')
              if (!(stashTarget instanceof HTMLSelectElement) || stashTarget.options.length !== 2) {
                throw new Error('Settings fixture did not expose both retrieval targets.')
              }
              const nextStash = stashTarget.options[1].value
              stashTarget.value = nextStash
              stashTarget.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              await wait()
              if (stashTarget.value !== nextStash || preferences().sources?.retrievalStash !== nextStash) {
                throw new Error('Retrieval-target v-model did not update the persisted parent ref.')
              }

              const modeToggles = [...workspace.querySelectorAll('.archive-mode-options input')]
              if (modeToggles.length !== 2 || !modeToggles.every((input) => input instanceof HTMLInputElement)) {
                throw new Error('Settings fixture did not expose both archive-mode controls.')
              }
              for (const modeToggle of modeToggles) {
                if (!modeToggle.checked) {
                  modeToggle.click()
                  await frames()
                  await wait()
                }
              }
              if (!modeToggles.every((input) => input.checked) || preferences().sources?.archivePaths?.length !== 2) {
                throw new Error('Archive-mode enable events did not establish the two-mode test state.')
              }
              const [softcore, hardcore] = modeToggles
              softcore.click()
              await frames()
              await wait()
              if (softcore.checked || !hardcore.checked || !hardcore.disabled || preferences().sources?.archivePaths?.length !== 1) {
                throw new Error('Disabling one archive mode did not protect the remaining mode.')
              }
              hardcore.click()
              await frames()
              if (!hardcore.checked) throw new Error('The disabled final archive mode was changed programmatically through the UI.')
              softcore.click()
              await frames()
              await wait()
              if (!softcore.checked || !hardcore.checked || hardcore.disabled || preferences().sources?.archivePaths?.length !== 2) {
                throw new Error('Re-enabling the second archive mode did not restore both-mode state.')
              }
              return performance.now() - started
            })()
          `)
        }
        await window.webContents.executeJavaScript(`
          (async () => {
            if (${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_ONBOARDING_STEP === undefined)}) {
              document.querySelector('.onboarding-skip')?.click()
            }
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          })()
        `)
        window.setOpacity(0)
        window.showInactive()
        window.webContents.invalidate()
        await new Promise((resolve) => setTimeout(resolve, 1000))
        if (scrollTarget) {
          await window.webContents.executeJavaScript(`
            (() => {
              const target = document.querySelector(${JSON.stringify(scrollTarget)})
              if (!target) return
              const topbar = document.querySelector('.topbar')
              const offset = (topbar?.getBoundingClientRect().height ?? 0) + 12
              window.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset))
            })()
          `)
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_GLOSSARY === '1') {
          const { verifyGlossary } = await import('./glossary-verification')
          await verifyGlossary(window.webContents)
        }
        const renderedState = await window.webContents.executeJavaScript(`({
          heading: document.querySelector('.hero h2')?.textContent,
          results: document.querySelector('.explorer-result-count, .result-count')?.textContent,
          cards: document.querySelectorAll('.item-card').length,
          sets: document.querySelectorAll('.set-card').length,
          copyCards: document.querySelectorAll('.copy-card').length,
          vaultRows: document.querySelectorAll('.quarantine-results .vault-row, .vault-item-list .vault-row').length,
          operationRows: document.querySelectorAll('.operation-history-row').length,
          plannerRows: document.querySelectorAll('.research-item-table .research-table-row').length,
          plannerCards: document.querySelectorAll('.planner-journey-results .planner-journey-row').length,
          boundedRows: document.querySelectorAll('.bounded-results .bounded-results-item').length,
          skillRows: document.querySelectorAll('.skill-explorer .research-item-table .research-table-row').length,
          dismantlingRows: document.querySelectorAll('.dismantling-row').length,
          farmingRows: document.querySelectorAll('.farm-list .bounded-results-item > article').length,
          oracleCards: document.querySelectorAll('.oracle-card').length,
          supplyCards: document.querySelectorAll('.supply-card').length,
          materialCards: document.querySelectorAll('.materials-grid .item-card').length,
          toolHeaders: document.querySelectorAll('.tool-header').length,
          explorerToolbars: document.querySelectorAll('.explorer-toolbar').length,
          boundedSurfaces: document.querySelectorAll('.bounded-results').length,
          miRows: [...document.querySelectorAll('.mi-table-results .mi-table-row')].map((row) => ({
            text: row.textContent?.replace(/\s+/g, ' ').trim(),
            prefixClass: row.children[2]?.className,
            suffixClass: row.children[3]?.className
          })),
          miQuery: document.querySelector('.mi-explorer-toolbar .explorer-search input')?.value,
          miAffixFilter: document.querySelector('.mi-explorer-toolbar .explorer-toolbar-filters select')?.value,
          drawer: document.querySelector('.item-drawer h2')?.textContent?.trim(),
          tooltip: document.querySelector('.game-tooltip')?.textContent?.trim(),
          tooltipRect: (() => {
            const tooltip = document.querySelector('.game-tooltip')
            if (!tooltip) return null
            const rect = tooltip.getBoundingClientRect()
            return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
          })(),
          cacheIssue: document.querySelector('.app-shell')?.getAttribute('data-cache-issue'),
          cacheApi: typeof window.cairnCodex?.getCachedCollection,
          icons: [...document.querySelectorAll('.item-mark img')].map((image) => ({
            src: image.getAttribute('src'),
            complete: image.complete,
            width: image.naturalWidth,
            height: image.naturalHeight
          })),
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          scrollTargetFound: Boolean(document.querySelector(${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_SCROLL_TARGET ?? 'body')})),
          activeWorkspace: document.querySelector('.workspace-sidebar [aria-current="page"] .workspace-nav-label')?.textContent?.trim(),
          documentWidth: document.documentElement.scrollWidth,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          overflowingElements: [...document.querySelectorAll('body *')]
            .filter((element) => {
              const rect = element.getBoundingClientRect()
              return rect.right > window.innerWidth + 1 || rect.left < -1
            })
            .slice(0, 12)
            .map((element) => {
              const rect = element.getBoundingClientRect()
              return {
                tag: element.tagName.toLocaleLowerCase(),
                className: typeof element.className === 'string' ? element.className : '',
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width)
              }
            }),
          titleX: document.querySelector('.topbar > div')?.getBoundingClientRect().x,
          mainX: document.querySelector('main')?.getBoundingClientRect().x,
          viewport: { width: window.innerWidth, height: window.innerHeight }
        })`)
        const startup = await window.webContents.executeJavaScript(
          'window.cairnCodex.getStartupStatus()'
        ) as StartupStatus
        const performanceReport = {
          readyMs: Date.now() - captureStartedAt,
          startup,
          interactions: interactionTimings,
          renderedState
        }
        const image = await window.webContents.capturePage()
        await writeFile(path, image.toPNG())
        if (process.env.CAIRN_CODEX_PERF_REPORT_PATH) {
          await writeFile(
            process.env.CAIRN_CODEX_PERF_REPORT_PATH,
            JSON.stringify(performanceReport, null, 2)
          )
        }
        console.log(
          JSON.stringify({
            screenshotPath: path,
            width: actualContentWidth,
            height: actualContentHeight,
            ...performanceReport
          })
        )
        app.quit()
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    const diagnostic = await window.webContents.executeJavaScript(`({
      heading: document.querySelector('.hero h2')?.textContent,
      scanError: document.querySelector('.scan-error')?.textContent,
      scanDisabled: document.querySelector('.primary-action')?.disabled,
          backgroundScan: document.querySelector('.background-scan')?.textContent,
          cacheIssue: document.querySelector('.app-shell')?.getAttribute('data-cache-issue'),
          cacheApi: typeof window.cairnCodex?.getCachedCollection,
      cards: document.querySelectorAll('.item-card').length,
      text: document.body.innerText.slice(0, 500)
    })`)
    throw new Error(
      'Renderer did not finish its collection scan before screenshot timeout: ' +
        JSON.stringify(diagnostic)
    )
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}
