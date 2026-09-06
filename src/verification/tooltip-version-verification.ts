import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { WebContents } from 'electron'

// Exercises the real shell tooltip and native keyboard/pointer events in an isolated profile.
export async function verifyTooltipVersions(contents: WebContents): Promise<void> {
  const evaluate = (source: string) => contents.executeJavaScript(source)
  const settle = () => new Promise(resolve => setTimeout(resolve, 250))
  const title = () => evaluate(`document.querySelector('.tooltip-header h3')?.textContent.trim()`)
  const card = (name: string) => `[data-result-key="records/items/synthetic/version_${name}.dbr"]`
  const key = async (key: string, modifiers = 0, autoRepeat = false) => {
    const event = { key, code: key.toLowerCase() === 'v' ? 'KeyV' : key, modifiers, autoRepeat }
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...event, text: key.length === 1 && modifiers === 0 ? key : '' })
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
    await settle()
  }
  const point = async (selector: string) => evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) throw new Error('Missing tooltip fixture target: ' + ${JSON.stringify(selector)});
    target.scrollIntoView({ block: 'center' });
    const rect = target.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`)
  const hover = async (selector: string) => {
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...await point(selector) })
    await settle()
  }
  const click = async (selector: string) => {
    await hover(selector)
    const location = await point(selector)
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...location, button: 'left', clickCount: 1 })
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...location, button: 'left', clickCount: 1 })
    await settle()
  }
  contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await evaluate(`document.activeElement?.blur()`)
    await hover(`${card('original')} .item-copy`)
    assert.equal(await title(), 'Version Test Original', 'Pointer opens the original tooltip')
    await key('v')
    assert.equal(await title(), 'Version Test Awakened', 'V switches a hovered tooltip to Awakened')
    await key('v')
    assert.equal(await title(), 'Version Test Original', 'V switches back to original')
    console.log('Tooltip native V round trip passed.')
    await click('.tooltip-version-summary')
    assert.equal(await title(), 'Version Test Awakened', 'Clicking the version row switches to Awakened')
    await click('.tooltip-version-summary')
    assert.equal(await title(), 'Version Test Original', 'Clicking the version row switches back')
    const summaryPoint = await point('.tooltip-version-summary')
    const dismissalPoint = { x: summaryPoint.x + 0.5, y: summaryPoint.y + 0.5 }
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...dismissalPoint })
    await settle()
    await key('Escape')
    await settle()
    assert.equal(await title(), undefined, 'Escape stays dismissed with a stationary pointer')
    const uncoveredCard = await evaluate(`document.elementFromPoint(${dismissalPoint.x}, ${dismissalPoint.y})?.closest('[data-result-key]')?.getAttribute('data-result-key')`)
    if (await evaluate('innerWidth <= 520')) {
      assert.equal(uncoveredCard, 'records/items/synthetic/version_original.dbr', 'Compact dismissal must uncover the hovered card')
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dismissalPoint.x + 2, y: dismissalPoint.y })
      await settle()
      assert.equal(await title(), 'Version Test Original', 'Intentional movement inside the uncovered card reopens its tooltip')
    } else {
      assert.equal(uncoveredCard, undefined, 'Wide dismissal must exercise ordinary non-overlapping placement')
      await hover(`${card('original')} .item-copy`)
      assert.equal(await title(), 'Version Test Original', 'Returning to the source reopens its tooltip')
      const sourcePoint = await point(`${card('original')} .item-copy`)
      for (let movement = 1; movement <= 2; movement += 1) {
        const previousLeft = await evaluate(`document.querySelector('.game-tooltip').getBoundingClientRect().left`)
        await key('Escape')
        assert.equal(await title(), undefined, 'Escape dismisses without leaving the original source')
        await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sourcePoint.x + movement * 2, y: sourcePoint.y })
        await settle()
        assert.equal(await title(), 'Version Test Original', 'Movement within an already-hovered source reopens after each dismissal')
        assert.ok(Math.abs(await evaluate(`document.querySelector('.game-tooltip').getBoundingClientRect().left`) - previousLeft) <= 3, 'Rearming preserves the pointer anchor rather than jumping to the source edge')
      }
    }
    await key('Escape')
    assert.equal(await title(), undefined, 'A reopened tooltip can be dismissed again')
    // Enter the first result using a native Tab event, without moving the pointer.
    await evaluate(`document.querySelector('.roll-help-link').focus()`)
    await key('Tab')
    assert.equal(await evaluate(`document.activeElement?.getAttribute('data-result-key')`), 'records/items/synthetic/version_unpaired.dbr', 'Tab moves keyboard focus to the first tooltip source')
    assert.equal(await title(), 'Version Test Unpaired', 'New keyboard focus reopens a dismissed tooltip')
    await key('Escape')
    await evaluate(`document.activeElement?.blur()`)
    await evaluate(`document.querySelector(${JSON.stringify(card('original'))}).focus()`)
    await settle()
    assert.equal(await title(), 'Version Test Original', 'Keyboard focus opens the original tooltip')
    await evaluate(`document.querySelector('.game-tooltip').scrollTop = 300`)
    assert.ok(await evaluate(`document.querySelector('.game-tooltip').scrollTop > 0`), 'Fixture must exercise an overflowing tooltip')
    await key('v')
    assert.equal(await title(), 'Version Test Awakened')
    assert.equal(await evaluate(`document.querySelector('.game-tooltip').scrollTop`), 0, 'Version switch resets tooltip scroll')
    await click('.tooltip-version-summary')
    assert.equal(await title(), 'Version Test Original')
    assert.equal(await evaluate(`document.activeElement?.getAttribute('data-result-key')`), 'records/items/synthetic/version_original.dbr', 'Click retains source focus')
    await click('.tooltip-version-summary')
    assert.equal(await title(), 'Version Test Awakened')
    assert.equal(await evaluate(`document.activeElement?.getAttribute('data-result-key')`), 'records/items/synthetic/version_original.dbr', 'Reverse click retains source focus')
    assert.ok(await evaluate(`(() => { const tip = document.querySelector('.game-tooltip'); return tip.getAttribute('role') === 'tooltip' && !tip.hasAttribute('aria-label') && !tip.querySelector('button, a[href], input, [tabindex]') && document.activeElement.getAttribute('aria-describedby') === tip.id })()`), 'Tooltip remains the full source description without a new Tab stop')
    await key('V', 8)
    assert.equal(await title(), 'Version Test Original', 'Shift+V also switches versions')
    await key('v')
    for (const modifiers of [2, 4, 1]) {
      await key('v', modifiers)
      assert.equal(await title(), 'Version Test Awakened', 'Ctrl/Meta/Alt shortcuts do not switch versions')
    }
    await key('v', 0, true)
    assert.equal(await title(), 'Version Test Awakened', 'Held V does not repeatedly toggle')
    for (const option of ['isComposing', 'prevented']) {
      await evaluate(`(() => { const event = new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true, isComposing: ${option === 'isComposing'} }); if (${option === 'prevented'}) event.preventDefault(); document.activeElement.dispatchEvent(event); })()`)
      await settle()
      assert.equal(await title(), 'Version Test Awakened', `${option} keyboard events do not toggle`)
    }
    await key('v')
    assert.equal(await title(), 'Version Test Original', 'Focused item switches back')
    assert.equal(await evaluate(`document.activeElement?.getAttribute('data-result-key')`), 'records/items/synthetic/version_original.dbr', 'Version switching retains source focus')
    await key('Escape')
    await evaluate(`document.querySelector('.explorer-toolbar input').focus()`)
    await hover(`${card('original')} .item-copy`)
    await key('v')
    assert.equal(await evaluate(`document.querySelector('.explorer-toolbar input').value`), 'v', 'Typing V edits the search field')
    assert.equal(await title(), 'Version Test Original', 'Typing must not change a hovered version')
    await click('.tooltip-version-summary')
    assert.equal(await title(), 'Version Test Awakened', 'Pointer switching still works while search has focus')
    assert.ok(await evaluate(`document.activeElement === document.querySelector('.explorer-toolbar input')`), 'Clicking the version summary does not blur the search field')
    await key('Escape')
    await evaluate(`document.querySelector(${JSON.stringify(card('unpaired'))}).focus()`)
    await settle()
    await key('v')
    assert.equal(await title(), 'Version Test Unpaired', 'Missing counterpart is a safe no-op')
    assert.equal(await evaluate(`Boolean(document.querySelector('.tooltip-version-summary'))`), false, 'Missing counterpart has no switch affordance')
    await key('Escape')
    await evaluate(`document.querySelector(${JSON.stringify(card('original'))}).focus()`)
    await key('v')
    assert.equal(await title(), 'Version Test Awakened')
    assert.ok(await evaluate(`(() => { const r = document.querySelector('.game-tooltip').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight })()`), 'Switched tooltip stays within the viewport')
    if (await evaluate('innerWidth <= 520')) {
      await key('Escape')
      contents.setZoomFactor(1.25)
      await evaluate(`document.activeElement.blur(); document.querySelector(${JSON.stringify(card('original'))}).focus()`)
      await settle()
      await key('v')
      assert.equal(await title(), 'Version Test Awakened', 'Switching works at 125% zoom')
      assert.ok(await evaluate(`(() => { const r = document.querySelector('.game-tooltip').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth })()`), 'Zoomed compact tooltip fits the viewport')
      await writeFile(process.env.CAIRN_CODEX_SCREENSHOT_PATH!.replace(/\.png$/, '-zoom.png'), (await contents.capturePage()).toPNG())
      // The outer benchmark validates its requested CSS viewport after this driver returns.
      contents.setZoomFactor(1)
      await evaluate(`document.activeElement.blur(); document.querySelector(${JSON.stringify(card('original'))}).focus()`)
      await settle()
      await key('v')
    }
  } catch (error) {
    await writeFile(process.env.CAIRN_CODEX_SCREENSHOT_PATH!.replace(/\.png$/, '-failure.png'), (await contents.capturePage()).toPNG())
    throw error
  } finally {
    contents.debugger.detach()
  }
}
