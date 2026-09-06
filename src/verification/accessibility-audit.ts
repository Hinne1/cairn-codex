import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { WebContents } from 'electron'
import type { AnyBackgroundJobSnapshot } from '../shared/background-jobs'
import { IPC_CHANNELS } from '../shared/contracts'

export async function verifyAccessibilityAudit(contents: WebContents): Promise<void> {
  const originalZoom = contents.getZoomFactor()
  const evaluate = async (source: string) => {
    const result = await contents.executeJavaScript(`(() => { try { return { value: (${source}) }; } catch (error) { return { error: error.message }; } })()`)
    if (result.error) throw new Error(`Accessibility renderer: ${result.error}`)
    return result.value
  }
  const wait = (milliseconds = 120) => new Promise(resolve => setTimeout(resolve, milliseconds))
  const key = async (key: string, modifiers = 0) => {
    const codes: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, ' ': 32, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 }
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, modifiers, windowsVirtualKeyCode: codes[key], ...(key === 'Enter' ? { text: '\r' } : {}) })
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, modifiers, windowsVirtualKeyCode: codes[key] })
    await wait()
  }
  const focus = async (selector: string) => {
    await evaluate(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!(target instanceof HTMLElement)) throw new Error('Missing focus target: ' + ${JSON.stringify(selector)});
      target.scrollIntoView({ block: 'center' }); target.focus();
    })()`)
    await wait()
  }
  const within = (selector: string) => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)})?.contains(document.activeElement))`)
  const navigate = async (id: string) => {
    await focus(`[data-destination-id="${id}"], [data-tool-id="${id}"]`)
    await key('Enter')
    await wait()
  }
  const verifyOpenDialog = async (selector: string, restoreSelector?: string) => {
    assert.equal(await within(selector), true, `${selector}: opening owns focus`)
    assert.equal(await evaluate(`(() => { const root = document.querySelector(${JSON.stringify(selector)}); return root?.matches('dialog[open]') || root?.getAttribute('aria-modal') === 'true'; })()`), true)
    const tree = await contents.debugger.sendCommand('Accessibility.getFullAXTree')
    assert.ok(tree.nodes.some((node: { ignored: boolean; role?: { value: string }; name?: { value: string } }) =>
      !node.ignored && node.role?.value === 'dialog' && Boolean(node.name?.value)), `${selector}: accessibility tree exposes a named dialog`)
    await evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(selector)});
      const controls = [...root.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], summary')]
        .filter(element => element.getClientRects().length && !element.closest('[hidden], [inert]'));
      if (!controls.length) throw new Error('Audit dialog has no available actions');
      controls[0].setAttribute('data-a11y-first', ''); controls.at(-1).setAttribute('data-a11y-last', '');
    })()`)
    await focus(`${selector} [data-a11y-first]`)
    await key('Tab', 8)
    assert.equal(await evaluate(`document.activeElement?.hasAttribute('data-a11y-last')`), true, `${selector}: reverse Tab wraps`)
    assert.equal(await evaluate(`(() => { const rect = document.activeElement.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth; })()`), true, `${selector}: wrapped last control remains visible`)
    await key('Tab')
    assert.equal(await evaluate(`document.activeElement?.hasAttribute('data-a11y-first')`), true, `${selector}: forward Tab wraps`)
    assert.equal(await evaluate(`(() => { const rect = document.activeElement.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth; })()`), true, `${selector}: wrapped first control remains visible`)
    await evaluate(`document.querySelector('[data-destination-id="collection"]').focus()`)
    assert.equal(await within(selector), true, `${selector}: escaped focus returns inside`)
    const route = await evaluate('location.hash')
    await key('ArrowLeft', 1)
    assert.equal(await evaluate('location.hash'), route, `${selector}: modal blocks application Back`)
    assert.equal(await within(selector), true)
    await writeFile(process.env.CAIRN_CODEX_SCREENSHOT_PATH!.replace(/\.png$/, `-${selector.replace(/[^a-z-]/gi, '')}.png`), (await contents.capturePage()).toPNG())
    await key('Escape')
    assert.equal(await evaluate(`(() => { const root = document.querySelector(${JSON.stringify(selector)}); return Boolean(root && !(root instanceof HTMLDialogElement && !root.open)); })()`), false, `${selector}: Escape closes only the dialog`)
    if (restoreSelector) assert.equal(await within(restoreSelector), true, `${selector}: focus returns to the invoker`)
    else assert.equal(await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement !== document.body && document.activeElement.isConnected`), true, `${selector}: a connected fallback receives focus`)
    await focus('[data-destination-id="collection"]')
    assert.equal(await within('[data-destination-id="collection"]'), true, `${selector}: closed trap releases outside focus`)
  }
  const openDialog = async (opener: string, dialog: string) => {
    await focus(opener)
    await key('Enter')
    await verifyOpenDialog(dialog, opener)
  }

  contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    if (await evaluate('innerWidth <= 520')) {
      contents.setZoomFactor(1.25)
      await wait()
    }
    if (process.env.CAIRN_CODEX_SCREENSHOT_SAFE_MODE_SUGGESTED === '1') {
      await verifyOpenDialog('.safe-mode-offer')
      console.log('Native startup-recovery dialog audit passed.')
      return
    }
    await navigate('collection')
    const rows = '.catalog-results [data-result-key]'
    const collectionRows = await evaluate(`document.querySelectorAll(${JSON.stringify(rows)}).length`)
    assert.ok(collectionRows > 0 && collectionRows <= 48, 'Collection keeps a bounded keyboard grid')
    await focus(rows)
    const firstKey = await evaluate(`document.activeElement.getAttribute('data-result-key')`)
    await key('ArrowRight')
    assert.notEqual(await evaluate(`document.activeElement.getAttribute('data-result-key')`), firstKey, 'Collection arrow navigation reaches another item')
    await key('Home')
    assert.equal(await evaluate(`document.activeElement.getAttribute('data-result-key')`), firstKey)
    await openDialog(rows, '.item-drawer')
    await openDialog('.workspace-sidebar button[aria-label="Customize visible tools"]', '.tool-settings-dialog')
    await openDialog('[data-tool-id="todo"]', '.todo-dialog')
    await focus('[data-tool-id="todo"]')
    await key('Enter')
    await contents.debugger.sendCommand('Input.insertText', { text: 'Synthetic keyboard audit task' })
    await key('Enter')
    await focus('.todo-list button[aria-label="Delete to-do"]')
    await key('Enter')
    assert.equal(await within('.todo-dialog'), true, 'Deleting the focused task repairs focus inside its dialog')
    await verifyOpenDialog('.todo-dialog', '[data-tool-id="todo"]')
    await openDialog('[data-tool-id="trivia"]', '.trivia-dialog')

    // Closing Trivia while opening its item removes the original trigger from the DOM.
    await focus('[data-tool-id="trivia"]')
    await key('Enter')
    if (await evaluate(`Boolean(document.querySelector('.trivia-fact.actionable'))`)) {
      await focus('.trivia-fact.actionable')
      await key('Enter')
      assert.equal(await evaluate(`Boolean(document.querySelector('.trivia-dialog'))`), false)
      await verifyOpenDialog('.item-drawer')
    } else await key('Escape')

    for (const id of ['settings', 'vault', 'sets', 'planner', 'collection']) {
      await navigate(id)
      await key('Tab')
      assert.equal(await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement !== document.body`), true, `${id}: navigation remains keyboard reachable`)
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `${id}: compact document stays bounded`)
    }
    const search = '.collection-materials-workspace .explorer-search input'
    const setSearch = async (text: string) => {
      await focus(search)
      await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(search)}); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
      await wait(400)
    }
    await navigate('vault')
    for (const index of [1, 2, 3]) {
      await focus(`.transfer-section-tabs button:nth-child(${index})`)
      await key('Enter')
      assert.equal(await evaluate(`document.activeElement.classList.contains('active')`), true, 'Transfers sections activate from the keyboard')
    }
    await navigate('sets')
    await openDialog('.set-card li button', '.item-drawer')
    await navigate('planner')
    for (const index of [2, 3, 1]) {
      await focus(`.planner-display button:nth-child(${index})`)
      await key('Enter')
      assert.equal(await evaluate(`document.querySelector('.planner-display button:nth-child(${index})').getAttribute('aria-pressed')`), 'true', 'Planner views activate from the keyboard')
    }
    for (const [id, workspace] of [['supplies', '.supplies-workspace'], ['dismantling', '.dismantling-workspace']]) {
      await navigate(id!)
      await focus(`${workspace} .explorer-search input`)
      await contents.debugger.sendCommand('Input.insertText', { text: '"unterminated' })
      await wait(400)
      assert.equal(await evaluate(`document.querySelectorAll('${workspace} [role="alert"]').length`), 1, `${id}: invalid query has one announcement owner`)
      assert.equal(await evaluate(`Boolean(document.querySelector('${workspace} .bounded-results-state.is-error'))`), true, `${id}: error remains visible at the results`)
    }
    await navigate('collection')
    await setSearch('Accessible Awakened Item')
    await focus(rows)
    await key('Enter')
    await focus('.drawer-awakening-source button')
    await key('Enter')
    assert.match(await evaluate(`document.querySelector('.item-drawer h2').textContent`), /Accessible Epic Base/)
    assert.equal(await within('.item-drawer'), true, 'Replacing the inspected record repairs removed-control focus')
    await verifyOpenDialog('.item-drawer', rows)
    await setSearch('Bloodsworn Repeater')
    await focus(rows)
    await key('Enter')
    const summary = '.item-drawer .roll-category-profile summary'
    await focus(summary)
    await key('Enter')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(summary)}).parentElement.open`), true, 'Native roll disclosure opens from the keyboard')
    await evaluate(`(() => {
      const controls = [...document.querySelector('.item-drawer').querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length);
      const index = controls.indexOf(document.activeElement);
      if (index < 1 || index >= controls.length - 1) throw new Error('Expected a middle disclosure');
      controls[index + 1].setAttribute('data-a11y-after-summary', '');
      controls[index - 1].setAttribute('data-a11y-before-summary', '');
    })()`)
    await key('Tab')
    assert.equal(await within('[data-a11y-after-summary]'), true, 'Tab continues past the disclosure')
    await focus(summary)
    await key('Tab', 8)
    assert.equal(await within('[data-a11y-before-summary]'), true, 'Reverse Tab continues before the disclosure')
    await verifyOpenDialog('.item-drawer', rows)
    await setSearch('')
    await focus(search)
    await contents.debugger.sendCommand('Input.insertText', { text: 'no-a11y-fixture-match' })
    await wait(400)
    assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(rows)}).length`), 0, 'Search reaches the empty state without losing focus')
    assert.equal(await within(search), true)
    assert.equal(await evaluate(`document.querySelectorAll('.explorer-result-count').length`), 1, 'Search has one live result-count owner')
    await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(search)}); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await wait(400)
    assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(rows)}).length`), collectionRows)

    // Exercise a real Settings action in the disposable profile. Announcements
    // keep their live owners mounted, with one populated notification channel.
    await navigate('settings')
    // Fixture-only staging paths deliberately fail closed. Dismiss those earlier
    // higher-priority notices so the following real Settings success can surface.
    for (let remaining = 10; remaining > 0 && await evaluate(`Boolean(document.querySelector('.growl-stack'))`); remaining--) {
      await focus('.growl-stack button[aria-label="Dismiss notification"]')
      await key('Enter')
    }
    assert.equal(await evaluate(`Boolean(document.querySelector('.growl-stack'))`), false)
    await evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find(label => label.querySelector('strong')?.textContent === 'Debug logging');
      label.querySelector('input').setAttribute('data-a11y-debug', '');
      window.a11yLiveOwners = [...document.querySelectorAll('.notification-status, .notification-alert')];
    })()`)
    for (const enabled of [true, false]) {
      await focus('[data-a11y-debug]')
      await key(' ')
      await wait(600)
      assert.equal(await evaluate(`document.querySelector('[data-a11y-debug]').checked`), enabled)
      assert.equal(await evaluate(`window.a11yLiveOwners.every(node => node.isConnected)`), true, 'Announcement containers remain mounted')
      assert.equal(await evaluate(`window.a11yLiveOwners.filter(node => node.textContent.trim()).length`), 1, 'Notification has one announcement owner')
      assert.match(await evaluate(`document.querySelector('.notification-status').textContent`), new RegExp(`Debug logging ${enabled ? 'enabled' : 'disabled'}`))
      assert.equal(await evaluate(`document.querySelectorAll('.growl-stack [role="status"], .growl-stack [role="alert"], .growl-stack [aria-live]').length`), 0)
    }
    const job: AnyBackgroundJobSnapshot = {
      id: 'a11y-synthetic-job', correlationId: 'a11y-synthetic-job', dedupeKey: 'a11y-synthetic-job', kind: 'icon-extraction',
      stage: 'extracting', status: 'running', progress: { completed: 1, total: 10, percent: 10, unit: 'items', label: 'Reading synthetic index', detail: 'First item' },
      cancellation: { supported: false, requested: false, canCancel: false, boundary: null }, result: null, error: null,
      startedAtUtc: new Date().toISOString(), updatedAtUtc: new Date().toISOString(), completedAtUtc: null,
      persistence: { navigation: 'main-process-session', restart: 'discard-in-flight' }
    }
    contents.send(IPC_CHANNELS.backgroundJobChanged, job)
    await wait()
    assert.equal(await evaluate(`document.querySelector('.background-status').textContent`), job.progress.label)
    job.progress = { ...job.progress, completed: 2, percent: 20, detail: 'Second item' }
    contents.send(IPC_CHANNELS.backgroundJobChanged, job)
    await wait()
    assert.equal(await evaluate(`document.querySelector('.background-status').textContent`), job.progress.label, 'Per-item progress does not repeat the phase announcement')
    assert.equal(await evaluate(`document.querySelector('.background-scan').hasAttribute('aria-live')`), false, 'Visual progress has no duplicate live owner')
    contents.send(IPC_CHANNELS.backgroundJobChanged, { ...job, stage: 'complete', status: 'succeeded' })
    await wait()
    assert.equal(await evaluate(`document.querySelector('.background-status').textContent`), '')
    await navigate('collection')

    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    assert.equal(await evaluate(`getComputedStyle(document.documentElement).scrollBehavior`), 'auto', 'Reduced motion disables smooth page scrolling')
    assert.equal(await evaluate(`[...document.querySelectorAll('.workspace-sidebar svg')].every(icon => icon.getAttribute('aria-hidden') === 'true')`), true, 'Navigation glyphs are decorative')
    await openDialog('.advanced-search-trigger', '.advanced-search-dialog')
    console.log(`Native core accessibility audit passed: ${collectionRows} Collection cards; comparison, customization, to-do, trivia, search, Settings, Transfers, Sets and Planner.`)
  } catch (error) {
    await writeFile(process.env.CAIRN_CODEX_SCREENSHOT_PATH!.replace(/\.png$/, '-failure.png'), (await contents.capturePage()).toPNG())
    throw error
  } finally {
    contents.setZoomFactor(originalZoom)
    await wait()
    contents.debugger.detach()
  }
}
