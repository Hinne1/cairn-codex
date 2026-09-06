import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { WebContents } from 'electron'

export async function verifyItemContextMenus(contents: WebContents): Promise<Record<string, number>> {
  const timings: Record<string, number> = {}
  const originalZoom = contents.getZoomFactor()
  const verificationZoom = process.env.CAIRN_CODEX_SCREENSHOT_ITEM_MENU_ZOOM === '1.25' ? 1.25 : originalZoom
  const wait = (ms = 180) => new Promise(resolve => setTimeout(resolve, ms))
  const evaluate = async (source: string) => {
    const result = await contents.executeJavaScript(`(() => { try { return { value: (${source}) }; } catch (error) { return { error: error.message }; } })()`)
    if (result.error) throw new Error(`Item menu renderer: ${result.error}`)
    return result.value
  }
  const key = async (key: string, modifiers = 0) => {
    const code: Record<string, number> = { Enter: 13, Escape: 27, Tab: 9, ' ': 32, ContextMenu: 93, F10: 121, Home: 36, End: 35, ArrowDown: 40, ArrowUp: 38 }
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key === ' ' ? 'Space' : key, modifiers, windowsVirtualKeyCode: code[key], ...(key === 'Enter' ? { text: '\r' } : {}) })
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === ' ' ? 'Space' : key, modifiers, windowsVirtualKeyCode: code[key] })
    await wait()
  }
  const focus = async (selector: string) => {
    await evaluate(`(() => { const target = document.querySelector(${JSON.stringify(selector)}); if (!(target instanceof HTMLElement)) throw new Error('Missing focus target: ' + ${JSON.stringify(selector)}); target.scrollIntoView({ block: 'center', inline: 'nearest' }); target.focus(); })()`)
    await wait()
  }
  const within = (selector: string) => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)})?.contains(document.activeElement))`)
  const exists = (selector: string) => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)
  const navigate = async (id: string) => {
    await focus(`[data-tool-id="${id}"], [data-destination-id="${id}"]`)
    const start = performance.now()
    await key('Enter')
    await wait(400)
    timings[`itemMenu${id}NavigationMs`] = Math.round(performance.now() - start)
  }
  const capture = async (name: string) => writeFile(process.env.CAIRN_CODEX_SCREENSHOT_PATH!.replace(/\.png$/, `-${name}.png`), (await contents.capturePage()).toPNG())
  const markSource = async (surface: string) => {
    await evaluate(`(() => {
      document.querySelector('[data-menu-source]')?.removeAttribute('data-menu-source');
      const source = document.querySelector(${JSON.stringify(surface)} + ' [data-result-key]');
      if (!source) throw new Error('No item rows');
      source.setAttribute('data-menu-source', '');
    })()`)
    await focus('[data-menu-source]')
    return evaluate(`document.querySelector('[data-menu-source]').getAttribute('data-result-key')`) as Promise<string>
  }
  const openKeyboard = async (shortcut = 'F10') => {
    const start = performance.now()
    await key(shortcut, shortcut === 'F10' ? 8 : 0)
    assert.equal(await within('.item-context-menu [data-item-action="inspect"]'), true, 'Opening focuses the first menu action')
    assert.equal(await exists('.game-tooltip'), false, 'Opening dismisses the global tooltip')
    timings.itemMenuOpenMs = Math.round(performance.now() - start)
  }
  const rightClick = async (selector: string) => {
    await focus(selector)
    await key('Escape')
    const cssPoint = await evaluate(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: rect.left + Math.min(20, rect.width / 2), y: rect.top + Math.min(20, rect.height / 2) }; })()`)
    // Electron's native input uses window DIPs; DOM bounds include page zoom.
    const point = { x: cssPoint.x * verificationZoom, y: cssPoint.y * verificationZoom }
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'right', clickCount: 1 })
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'right', clickCount: 1 })
    await wait()
    assert.equal(await within('.item-context-menu'), true, 'Right-click opens the same focused menu')
    assert.equal(await evaluate(`(() => { const r = document.querySelector('.item-context-menu').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`), true, 'The menu remains within the viewport')
  }
  const changeQuery = async (selector: string, text: string) => {
    await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await wait(450)
  }
  const listMode = async (ignored: boolean) => {
    await evaluate(`(() => { const select = [...document.querySelectorAll('.planner-explorer-toolbar select')].find(select => [...select.options].some(option => option.textContent.startsWith('Ignored bases'))); select.value = '${ignored}'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await wait()
  }

  contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    if (verificationZoom !== originalZoom) {
      contents.setZoomFactor(verificationZoom)
      await wait()
    }
    await navigate('skills')
    const table = '.research-item-table'
    const skillCount = await evaluate(`document.querySelectorAll('${table} [data-result-key]').length`)
    assert.equal(skillCount, 50, '20k Skills results mount one 50-row page')
    assert.equal(await evaluate(`Number(document.querySelector('.explorer-result-count strong').textContent.replace(/[^0-9]/g, ''))`), 20_000)
    timings.itemMenuSkillMountedRows = skillCount
    await markSource(table)
    await openKeyboard()
    assert.equal(await evaluate(`document.querySelectorAll('.item-context-menu [role="menuitem"]').length`), 1, 'Skills exposes only its supported action')
    const tree = await contents.debugger.sendCommand('Accessibility.getFullAXTree')
    assert.ok(tree.nodes.some((node: { ignored: boolean; role?: { value: string }; name?: { value: string } }) => !node.ignored && node.role?.value === 'menu' && node.name?.value.startsWith('Actions for ')))
    await key('Escape')
    assert.equal(await within('[data-menu-source]'), true)
    assert.equal(await exists('.item-context-menu'), false)
    await openKeyboard('ContextMenu')
    await key('Enter')
    assert.equal(await within('.item-drawer'), true, 'Inspect hands focus to comparison')
    assert.equal(await exists('.item-context-menu'), false)
    await key('Escape')
    assert.equal(await within('[data-menu-source]'), true, 'Comparison restores the original item')

    await rightClick('[data-menu-source] .research-item')
    await capture('skills-menu')
    await key('Escape')
    await focus('[data-menu-source] .item-more-actions')
    await key('Enter')
    assert.equal(await evaluate(`document.querySelector('[data-menu-source] .item-more-actions').getAttribute('aria-expanded')`), 'true')
    await key('Tab')
    assert.equal(await exists('.item-context-menu'), false, 'Tab dismisses the menu')
    assert.equal(await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement !== document.body && !document.querySelector('[data-menu-source]')?.contains(document.activeElement)`), true, 'Tab continues beyond the invoker')
    await focus('[data-menu-source] .item-more-actions')
    await key('Enter')
    await key('Tab', 8)
    assert.equal(await evaluate(`document.activeElement === document.querySelector('[data-menu-source]')`), true, 'Reverse Tab continues to the item row')
    await markSource(table)
    await openKeyboard()
    await changeQuery('.skill-explorer .explorer-search input', 'no-context-fixture-match')
    assert.equal(await exists('.item-context-menu'), false, 'Filtering out the source dismisses stale actions')
    assert.equal(await evaluate(`document.querySelectorAll('${table} [data-result-key]').length`), 0)
    assert.equal(await evaluate(`document.activeElement !== document.body`), true)
    await changeQuery('.skill-explorer .explorer-search input', '')

    await navigate('planner')
    const originalProfile = await evaluate(`document.querySelector('#planner-profile-select').value`)
    await evaluate(`document.querySelector('.planner-new-plan').click()`)
    await wait()
    await evaluate(`[...document.querySelectorAll('.planner-setup-dialog [role="radio"]')].find(button => button.textContent.includes('Clone')).click()`)
    for (let step = 0; step < 4; step++) {
      await evaluate(`document.querySelector('.planner-setup-dialog footer button:not(.secondary)').click()`)
      await wait()
    }
    const clonedProfile = await evaluate(`document.querySelector('#planner-profile-select').value`)
    assert.notEqual(clonedProfile, originalProfile)

    for (const [mode, surface] of [['Table', table], ['Journey', '.planner-journey-results']] as const) {
      await navigate('planner')
      await evaluate(`[...document.querySelectorAll('.planner-display button')].find(button => button.textContent === '${mode}').focus()`)
      await key('Enter')
      const count = await evaluate(`document.querySelectorAll('${surface} [data-result-key]').length`)
      assert.ok(count > 0 && count <= 100, '20k Planner results keep at most two continuous pages')
      timings[`itemMenu${mode}MountedRows`] = count
      const record = await markSource(surface!)
      await openKeyboard()
      assert.equal(await evaluate(`document.querySelectorAll('.item-context-menu [role="menuitem"]').length`), 3)
      await key('End')
      assert.equal(await within('[data-item-action="ignore"]'), true)
      await key('Home')
      await key('ArrowDown')
      assert.equal(await within('[data-item-action="favorite"]'), true)
      await key('Enter')
      assert.equal(await exists('[data-menu-source] .is-favorite .item-favorite-label'), true, 'Favorite state has the shared visible marker')
      const stateCell = mode === 'Table' ? '.research-item' : '.planner-journey-card'
      assert.equal(await evaluate(`(getComputedStyle(document.querySelector('[data-menu-source] ${stateCell}')).boxShadow.match(/inset/g) ?? []).length`), 1, 'Favorite stripe survives the rendered cell styles')
      assert.equal(await within('[data-menu-source]'), true)
      assert.equal(await exists('.item-drawer'), false, 'Favorite does not activate inspection')
      await rightClick('[data-menu-source]')
      await key('End')
      await key(' ')
      assert.equal(await evaluate(`Boolean(document.querySelector('[data-result-key="${record}"]'))`), false, 'Ignore removes the chosen base from the active plan')
      assert.equal(await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement !== document.body && document.activeElement.isConnected`), true, 'Removing the invoker focuses a surviving control')
      await listMode(true)
      await markSource(surface!)
      assert.equal(await exists('[data-menu-source] .is-favorite.is-ignored .item-ignored-label'), true, 'Favorite and ignored markers coexist')
      assert.equal(await evaluate(`(getComputedStyle(document.querySelector('[data-menu-source] ${stateCell}')).boxShadow.match(/inset/g) ?? []).length`), 2, 'Combined stripes survive the rendered cell styles')
      await openKeyboard()
      assert.match(await evaluate(`document.querySelector('[data-item-action="ignore"]').textContent`), /Restore base to this plan/)
      await capture(`${mode.toLowerCase()}-states-menu`)
      await key('Escape')
      await focus('[data-menu-source] button[aria-label^="Unfavorite "]')
      await key('Enter')
      assert.equal(await exists('[data-menu-source] .is-favorite'), false, 'Existing visible Favorite control remains usable')
      assert.equal(await evaluate(`(getComputedStyle(document.querySelector('[data-menu-source] ${stateCell}')).boxShadow.match(/inset/g) ?? []).length`), 1, 'Ignored-only stripe remains visible')
      await capture(`${mode.toLowerCase()}-ignored`)
      await focus('[data-menu-source]')
      await openKeyboard()
      await key('End')
      await key('Enter')
      assert.equal(await evaluate(`document.querySelectorAll('${surface} [data-result-key]').length`), 0, 'Restore removes the base from the ignored view')
      await listMode(false)
      assert.equal(await exists(`[data-result-key="${record}"] .is-favorite`), false)
      await markSource(surface)
      await openKeyboard()
      await evaluate(`(() => { const select = document.querySelector('#planner-profile-select'); select.value = select.value === ${JSON.stringify(originalProfile)} ? ${JSON.stringify(clonedProfile)} : ${JSON.stringify(originalProfile)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
      await wait()
      assert.equal(await exists('.item-context-menu'), false, 'Changing the current plan dismisses stale actions')
      assert.equal(await evaluate(`document.activeElement !== document.body`), true)
      await markSource(surface)
      await openKeyboard()
      const pageBefore = await evaluate('scrollY')
      const cssWheelPoint = await evaluate('({ x: innerWidth - 30, y: innerHeight - 40 })')
      const wheelPoint = { x: cssWheelPoint.x * verificationZoom, y: cssWheelPoint.y * verificationZoom }
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: 600 })
      await wait(300)
      assert.equal(await exists('.item-context-menu'), false, 'Scrolling away dismisses the menu')
      assert.ok(await evaluate(`scrollY > ${pageBefore + 200}`), 'Viewport dismissal does not jump back to the old invoker')
      await markSource(surface!)
      await openKeyboard()
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: 2, y: 2, button: 'left', clickCount: 1 })
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 2, button: 'left', clickCount: 1 })
      await wait()
      assert.equal(await exists('.item-context-menu'), false, 'Outside pointer dismisses the menu')
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true)
    }
    return timings
  } catch (error) {
    await capture('failure')
    throw error
  } finally {
    contents.setZoomFactor(originalZoom)
    contents.debugger.detach()
  }
}
