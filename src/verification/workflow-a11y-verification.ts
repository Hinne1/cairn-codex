import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { ipcMain, type BrowserWindow } from 'electron'
import { IPC_CHANNELS, type DismantlingPreview } from '../shared/contracts'

/** Native checks against the existing disposable archive-query fixture. */
export async function verifyWorkflowAccessibility(window: BrowserWindow): Promise<Record<string, number>> {
  const contents = window.webContents
  const measurements: Record<string, number> = {}
  const run = (source: string) => contents.executeJavaScript(source)
  const wait = () => new Promise(resolve => setTimeout(resolve, 220))
  const focus = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).focus()`)
  const capture = async (name: string) => {
    // Readback wakes a hidden page; allow its compositor to catch up before retaining a frame.
    await contents.capturePage()
    await wait()
    await contents.capturePage()
    await wait()
    await writeFile(process.env.CAIRN_CODEX_SCREENSHOT_PATH!.replace(/\.png$/, `-${name}.png`), (await contents.capturePage()).toPNG())
  }
  const key = async (key: string) => {
    const code = { Enter: 13, Tab: 9, ' ': 32 }[key]
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : {}) })
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code })
    await wait()
  }
  const activate = async (selector: string) => { await focus(selector); await key('Enter') }
  const ax = async () => (await contents.debugger.sendCommand('Accessibility.getFullAXTree')).nodes as Array<{ ignored: boolean; role?: { value: string }; name?: { value: string }; properties?: Array<{ name: string; value: { value: unknown } }> }>
  const pressed = async (selector: string) => {
    const labels = await run(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}), button => ({name: button.innerText.replace(/\\s+/g, ' ').trim(), active: button.classList.contains('active'), pressed: button.getAttribute('aria-pressed')}))`)
    assert.equal(labels.filter((button: { pressed: string }) => button.pressed === 'true').length, 1)
    assert.ok(labels.every((button: { active: boolean; pressed: string }) => String(button.active) === button.pressed))
    const tree = await ax()
    for (const button of labels) assert.ok(tree.some(node => !node.ignored && node.role?.value === 'button' && node.name?.value === button.name && node.properties?.some(property => property.name === 'pressed' && String(property.value.value) === button.pressed)), `AX selected state: ${button.name}`)
  }
  const colors = (text: string): number[][] => [...text.matchAll(/rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/g)].map(match => {
    const values = (match[1] ?? match[2]!).split(/[\s,/]+/).filter(Boolean).map(Number)
    return [values[0]! * (match[2] ? 255 : 1), values[1]! * (match[2] ? 255 : 1), values[2]! * (match[2] ? 255 : 1), values[3] ?? 1]
  })
  const over = (front: number[], back: number[]) => front.slice(0, 3).map((value, index) => value * front[3]! + back[index]! * (1 - front[3]!)).concat(1)
  const luminance = (color: number[]) => color.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0)
  const contrast = async (selector: string) => {
    const samples = await run(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(element => element.getClientRects().length).map(element => {
      const layers = []; for (let node = element; node; node = node.parentElement) { const style = getComputedStyle(node); layers.unshift({color: style.backgroundColor, image: style.backgroundImage, opacity: Number(style.opacity)}); }
      return {text: element.textContent, color: getComputedStyle(element).color, layers};
    })`)
    assert.ok(samples.length, `Contrast target exists: ${selector}`)
    let minimum = Infinity
    for (const sample of samples) {
      let backgrounds = [[0, 0, 0, 1]]
      for (const layer of sample.layers) {
        assert.equal(layer.opacity, 1, 'Metadata must not be faded by an ancestor')
        const base = colors(layer.color)[0]!
        backgrounds = backgrounds.map(background => over(base, background))
        if (layer.image !== 'none') {
          const stops = colors(layer.image)
          assert.ok(stops.length, `Known gradient colors: ${layer.image}`)
          backgrounds = backgrounds.flatMap(background => stops.map(stop => over(stop, background)))
        }
      }
      for (const background of backgrounds) {
        const a = luminance(over(colors(sample.color)[0]!, background)), b = luminance(background)
        const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
        minimum = Math.min(minimum, ratio)
        assert.ok(ratio >= 4.5, `${selector}: ${ratio.toFixed(2)}:1 for ${sample.text}`)
      }
    }
    const metric = selector.includes('supply') ? 'supplyMetadataContrast' : 'dismantlingMetadataContrast'
    measurements[metric] = Math.min(measurements[metric] ?? Infinity, Math.round(minimum * 100) / 100)
  }

  contents.debugger.attach('1.3')
  // These handlers belong to the disposable verification process, which exits after capture.
  for (const channel of [IPC_CHANNELS.selectSupplyBoosts, IPC_CHANNELS.previewDismantling]) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async () => { throw new Error('Synthetic audit rejection') })
  }
  try {
    await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    assert.equal(await run(`Boolean(document.querySelector('.onboarding-dialog'))`), false, 'Dismiss onboarding before operating workspaces')
    await run(`document.querySelector('.supply-card input:not(:disabled)').scrollIntoView({block:'center'})`)
    const checkboxName = await run(`'Select ' + document.querySelector('.supply-card:has(input:not(:disabled)) strong').textContent`)
    await focus('.supply-card input:not(:disabled)')
    assert.ok((await ax()).some(node => !node.ignored && node.role?.value === 'checkbox' && node.name?.value === checkboxName))
    const checked = await run(`document.activeElement.checked`)
    await key(' ')
    assert.equal(await run(`document.activeElement.checked`), !checked)
    await contrast('.supply-card-copy > small')
    await contrast('.supply-effects .more')
    await capture('supply-selection')
    await key(' ')
    await run(`{ const select = document.querySelector('.supplies-workspace .explorer-toolbar-filters select'); select.value = 'augments'; select.dispatchEvent(new Event('change', {bubbles:true})); }`)
    await wait()
    await contrast('.supply-no-effects')
    await run(`{ const select = document.querySelector('.supplies-workspace .explorer-toolbar-filters select'); select.value = 'writs'; select.dispatchEvent(new Event('change', {bubbles:true})); }`)
    await wait()
    for (const index of [0, 1]) {
      await activate(`.supply-status .segmented-control button:nth-child(${index + 1})`)
      await pressed('.supply-status .segmented-control button')
    }
    await activate('.supplies-workspace .explorer-toolbar-actions button:last-child')
    assert.equal(await run(`document.querySelectorAll('.supplies-workspace [role="alert"]').length`), 1)
    assert.match(await run(`document.querySelector('.supplies-workspace [role="alert"]').textContent`), /Synthetic audit rejection/)
    await capture('supply-rejection')

    await activate('[data-tool-id="dismantling"]')
    await wait()
    await contrast('.dismantling-row small')
    await contrast('.dismantling-empty p')
    await focus('.dismantling-row input')
    // Checkbox activation uses Space, avoiding any form-submit semantics.
    await key(' ')
    const preview: DismantlingPreview = { ruleRecord: 'records/synthetic/audit-preview.dbr', contentPack: 'base', itemCount: 1,
      dynamiteCost: 1, ironCost: 100, scrapMinimum: 1, scrapMaximum: 2, scrapExpected: 1.5,
      scrapOutcomes: [{count: 1, probability: .5}, {count: 2, probability: .5}],
      rewards: [{ record: 'records/synthetic/audit-reward.dbr', name: 'Synthetic component', category: 'component', expectedCount: .5, chanceAtLeastOne: .5 }], items: [] }
    ipcMain.removeHandler(IPC_CHANNELS.previewDismantling)
    ipcMain.handle(IPC_CHANNELS.previewDismantling, async () => preview)
    await activate('.dismantling-run')
    await contrast('.dismantling-help, .dismantling-preview > header small, .dismantling-costs small, .dismantling-costs span, .scrap-distribution small, .dismantling-rewards > p, .dismantling-rewards small, .dismantling-preview > footer, .dismantling-preview code')
    await run(`document.querySelector('.dismantling-preview').scrollIntoView({block:'center'})`)
    await capture('dismantling-preview')
    ipcMain.removeHandler(IPC_CHANNELS.previewDismantling)
    ipcMain.handle(IPC_CHANNELS.previewDismantling, async () => { throw new Error('Synthetic audit rejection') })
    await activate('.dismantling-run')
    assert.equal(await run(`document.querySelectorAll('.dismantling-workspace [role="alert"]').length`), 1)
    assert.match(await run(`document.querySelector('.dismantling-workspace [role="alert"]').textContent`), /Synthetic audit rejection/)
    await capture('dismantling-rejection')

    await activate('[data-destination-id="vault"]')
    for (const index of [1, 2, 3]) {
      await activate(`.transfer-section-tabs button:nth-child(${index})`)
      await pressed('.transfer-section-tabs button')
    }
    for (const index of [1, 2]) {
      await activate(`.transfer-mode-tabs button:nth-child(${index})`)
      await pressed('.transfer-mode-tabs button')
    }
    await capture('transfer-modes')
    await activate('[data-destination-id="collection"]')
    for (const index of [2, 1]) {
      await activate(`.category-tabs button:nth-child(${index})`)
      await pressed('.category-tabs button')
    }
    await run(`{ const input = document.querySelector('.explorer-search input'); input.value = 'no-audit-match'; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); }`)
    await wait()
    await key('Tab')
    assert.match(await run(`document.activeElement.getAttribute('aria-label')`), /^Clear /)
    await key('Enter')
    assert.equal(await run(`document.activeElement === document.querySelector('.explorer-search input') && document.activeElement.value === ''`), true, 'Clear returns focus to its surviving search input')
    await capture('clear-focus')
    await activate('[data-tool-id="supplies"]')
    return measurements
  } finally {
    for (const channel of [IPC_CHANNELS.selectSupplyBoosts, IPC_CHANNELS.previewDismantling]) ipcMain.removeHandler(channel)
    contents.debugger.detach()
  }
}
