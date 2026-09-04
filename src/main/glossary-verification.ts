import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { WebContents } from 'electron'

// Used only by the isolated screenshot benchmark, never by normal startup.
export async function verifyGlossary(contents: WebContents): Promise<void> {
  const evaluate = (source: string) => contents.executeJavaScript(source)
  const settle = () => new Promise(resolve => setTimeout(resolve, 100))
  const click = async (selector: string) => {
    await evaluate(`(() => { const target = document.querySelector(${JSON.stringify(selector)}); if (!target) throw new Error('Missing glossary test control: ' + ${JSON.stringify(selector)}); target.click() })()`)
    await settle()
  }
  const check = async (expression: string, message: string) => assert.ok(await evaluate(expression), message)
  const key = async (selector: string, name: 'Enter' | 'Space' | 'Tab') => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
    const event = { key: name === 'Space' ? ' ' : name, code: name, windowsVirtualKeyCode: { Enter: 13, Space: 32, Tab: 9 }[name] }
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...event, text: name === 'Enter' ? '\r' : name === 'Space' ? ' ' : '' })
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
    await settle()
  }
  const back = async () => {
    await evaluate(`new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Glossary Back timed out')), 3000); window.addEventListener('popstate', () => { clearTimeout(timer); resolve(true) }, { once: true }); history.back() })`)
    await settle()
  }
  const assertEntry = async () => {
    await check(`document.querySelector('.workspace-sidebar [data-destination-id="glossary"]').getAttribute('aria-current') === 'page'`, 'Glossary destination must be selected')
    await check(`document.querySelector('#glossary-entry-title')?.textContent === 'Item rolls & ratings'`, 'Item-roll entry must render')
    await check(`document.activeElement?.id === 'glossary-entry-title'`, 'Entry heading must receive focus')
    await check(`history.state.route.workspace === 'glossary' && history.state.route.itemRecord === null && history.state.route.controls.entry === 'item-rolls'`, 'Glossary route must close the drawer without losing source history')
  }
  contents.debugger.attach('1.3')
  try {
    // These isolated profiles can report an unavailable archive operation.
    // Dismiss only that known notification, not unexpected renderer errors.
    await evaluate(`(() => { const notice = document.querySelector('.growl'); if (notice?.textContent.includes('The archive operation failed safely.')) notice.querySelector('[aria-label="Dismiss notification"]')?.click() })()`)
    await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await key('[data-destination-id="glossary"]', 'Enter')
    await assertEntry()
    await key('#glossary-calculation summary', 'Space')
    await check(`document.querySelector('#glossary-calculation').open`, 'Space expands calculation details')
    await check(`getComputedStyle(document.querySelector('#glossary-calculation summary')).outlineStyle === 'solid'`, 'Keyboard focus must be visible')
    await key('#glossary-ties summary', 'Enter')
    await check(`document.querySelector('#glossary-ties').open && document.querySelector('#glossary-ties table').innerText.includes('83rd')`, 'Tie example must be readable')
    await key('#glossary-ties summary', 'Tab')
    await check(`document.activeElement !== document.querySelector('#glossary-ties summary')`, 'Tab must leave the disclosure')
    await check(`document.documentElement.scrollWidth <= innerWidth`, 'Expanded glossary must fit compact width')
    await evaluate(`document.querySelector('#glossary-ties').scrollIntoView({ block: 'start' })`)
    await settle()
    const screenshotPath = process.env.CAIRN_CODEX_SCREENSHOT_PATH!
    await writeFile(screenshotPath.replace(/\.png$/, '-details.png'), (await contents.capturePage()).toPNG())
    await back()
    await check(`history.state.route.workspace === 'collection'`, 'Back must restore Collection')
    await click('.collection-materials-workspace .roll-help-link')
    await assertEntry()
    await back()

    // The populated fixture proves help does not overwrite the exact scored-copy reference.
    const hasScoredCopy = await evaluate(`Boolean(document.querySelector('.card-roll-score strong'))`)
    if (process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE === 'mi-workshop') assert.ok(hasScoredCopy, 'Populated fixture must exercise reference restoration: ' + await evaluate(`JSON.stringify({ state: history.state, cards: document.querySelectorAll('.item-card').length, text: document.querySelector('.collection-materials-workspace')?.innerText?.slice(-2000) })`))
    if (hasScoredCopy) {
      await evaluate(`document.querySelector('.card-roll-score strong').closest('[data-result-key]').click()`)
      await settle()
      const source = await evaluate('JSON.stringify(history.state)')
      await check(`Boolean(history.state.referenceInstanceKey) && Boolean(document.querySelector('.copy-card.reference'))`, 'Fixture must open an exact scored reference')
      await click('.comparison-heading .roll-help-link')
      await assertEntry()
      await back()
      assert.equal(await evaluate('JSON.stringify(history.state)'), source, 'Back must preserve item, controls, and exact reference')
      await check(`Boolean(document.querySelector('.copy-card.reference'))`, 'Reference comparison must reopen')
      await click('.drawer-close')
      await click('[data-tool-id="mi-workshop"]')
      await check(`history.state.route.workspace === 'mi-workshop'`, 'MI navigation must commit before opening help: ' + await evaluate('JSON.stringify(history.state)'))
      const miSource = await evaluate('JSON.stringify(history.state)')
      await click('.mi-workshop .roll-help-link')
      await assertEntry()
      await back()
      assert.equal(await evaluate('JSON.stringify(history.state)'), miSource, 'MI Workshop must return intact')
    }
    await key('[data-destination-id="glossary"]', 'Enter')
    await assertEntry()
    // Forward should use the same typed entry after leaving and returning.
    await back()
    await evaluate(`history.forward()`)
    await settle()
    await assertEntry()
    await check(`document.querySelectorAll('.glossary-sources a[target="_blank"][rel="noopener noreferrer"]').length === 3`, 'Sources must be accessible external links')
    if (await evaluate('innerWidth <= 900')) {
      await key('[data-destination-id="glossary"]', 'Tab')
      await evaluate(`document.querySelector('[data-destination-id="glossary"]').focus()`)
      await settle()
      await check(`document.querySelector('.workspace-nav-tooltip')?.textContent === 'Glossary'`, 'Compact navigation must name the glossary on focus')
    }
    await evaluate(`document.querySelector('#glossary-entry-title').focus(); window.scrollTo(0, 0)`)
    await settle()
    console.log(JSON.stringify({ glossaryPassed: true, scoredReferenceRestored: hasScoredCopy, width: await evaluate('innerWidth') }))
  } finally {
    contents.debugger.detach()
  }
}
