import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { WebContents } from 'electron'

export async function verifyAccessibilityAudit(contents: WebContents): Promise<void> {
  const evaluate = (source: string) => contents.executeJavaScript(source)
  const wait = (milliseconds = 120) => new Promise(resolve => setTimeout(resolve, milliseconds))
  const key = async (key: string, modifiers = 0) => {
    const codes: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 }
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, modifiers, windowsVirtualKeyCode: codes[key] })
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
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-modal')`), 'true')
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
    await key('Tab')
    assert.equal(await evaluate(`document.activeElement?.hasAttribute('data-a11y-first')`), true, `${selector}: forward Tab wraps`)
    await evaluate(`document.querySelector('[data-destination-id="collection"]').focus()`)
    assert.equal(await within(selector), true, `${selector}: escaped focus returns inside`)
    const route = await evaluate('location.hash')
    await key('ArrowLeft', 1)
    assert.equal(await evaluate('location.hash'), route, `${selector}: modal blocks application Back`)
    assert.equal(await within(selector), true)
    await key('Escape')
    assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), false, `${selector}: Escape closes only the dialog`)
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
    await focus(search)
    await contents.debugger.sendCommand('Input.insertText', { text: 'no-a11y-fixture-match' })
    await wait(400)
    assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(rows)}).length`), 0, 'Search reaches the empty state without losing focus')
    assert.equal(await within(search), true)
    assert.equal(await evaluate(`document.querySelectorAll('.explorer-result-count').length`), 1, 'Search has one live result-count owner')
    await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(search)}); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await wait(400)
    assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(rows)}).length`), collectionRows)

    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    assert.equal(await evaluate(`getComputedStyle(document.documentElement).scrollBehavior`), 'auto', 'Reduced motion disables smooth page scrolling')
    assert.equal(await evaluate(`[...document.querySelectorAll('.workspace-sidebar svg')].every(icon => icon.getAttribute('aria-hidden') === 'true')`), true, 'Navigation glyphs are decorative')
    await openDialog('.advanced-search-trigger', '.advanced-search-dialog')
    console.log(`Native core accessibility audit passed: ${collectionRows} Collection cards; comparison, customization, to-do, trivia, search, Settings, Transfers, Sets and Planner.`)
  } catch (error) {
    await writeFile(process.env.CAIRN_CODEX_SCREENSHOT_PATH!.replace(/\.png$/, '-failure.png'), (await contents.capturePage()).toPNG())
    throw error
  } finally {
    contents.debugger.detach()
  }
}
