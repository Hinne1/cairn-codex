import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Mount the production Vue component, with production styles, in a disposable
// Electron profile. This test never opens the application or reads game data.
if (!process.versions.electron) {
  const { build } = await import('vite')
  const { default: vue } = await import('@vitejs/plugin-vue')
  const { default: electronPath } = await import('electron')
  const { spawn } = await import('node:child_process')
  const { terminateBenchmarkProcessTree } = await import('./benchmark-process.mjs')
  await mkdir(resolve('local-cache'), { recursive: true })
  const testRoot = await mkdtemp(resolve('local-cache/roll-profile-test-'))
  const outDir = join(testRoot, 'page')
  const entry = join(testRoot, 'fixture-entry.js').replaceAll('\\', '/')
  const component = resolve('src/renderer/src/components/RollCategoryProfile.vue').replaceAll('\\', '/')
  const tokens = resolve('src/renderer/src/semantic-tokens.css').replaceAll('\\', '/')
  const styles = resolve('src/renderer/src/styles.css').replaceAll('\\', '/')
  await writeFile(entry, `
          import { createApp, h } from 'vue'
          import Profile from ${JSON.stringify(component)}
          import ${JSON.stringify(tokens)}
          import ${JSON.stringify(styles)}
          const scores = ['fire', 'cold', 'lightning', 'elemental', 'defense', 'utility', 'pet'].map((key, index) => ({
            key, category: index < 4 ? 'offense' : key, damageType: index < 4 ? key : null,
            qualityPercent: 70 + index, estimatedPercentile: 70 + index, combinationPercentile: 90 + index, statCount: 2
          }))
          window.fixtureEvents = { activations: 0, escapes: 0 }
          const section = (id, props) => h('section', {
            id,
            onClick: () => window.fixtureEvents.activations++,
            onKeydown: (event) => { if (event.key === 'Escape') window.fixtureEvents.escapes++ }
          }, [h('h2', id), h(Profile, props)])
          createApp({ render: () => h('main', { style: 'padding: 24px; max-width: 960px' }, [
            section('empty', { scores: [] }),
            section('normal', { scores: scores.slice(0, 2) }),
            section('perfect', { scores: [{ ...scores[0], qualityPercent: 100, estimatedPercentile: 250 / 3, combinationPercentile: 250 / 3 }] }),
            section('overflow', { scores, maxVisible: 4 }),
            section('compact', { scores, maxVisible: 2, compact: true })
          ]) }).mount('#app')
        `)
  await build({
    configFile: false,
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [vue()],
    build: { outDir, lib: { entry, formats: ['es'], fileName: () => 'fixture.js', cssFileName: 'fixture' } }
  })
  await writeFile(join(outDir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Roll profile regression fixture</title><link rel="stylesheet" href="./fixture.css"></head><body><div id="app"></div><script type="module" src="./fixture.js"></script></body></html>')
  const testEnv = { ...process.env }
  delete testEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(electronPath, [fileURLToPath(import.meta.url), testRoot], {
    stdio: 'inherit', windowsHide: true, env: testEnv
  })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; void terminateBenchmarkProcessTree(child) }, 60_000)
  try {
    const code = await new Promise((resolveExit, reject) => {
      child.once('error', reject)
      child.once('close', resolveExit)
    })
    assert.equal(timedOut, false, 'Roll profile Electron test timed out')
    assert.equal(code, 0, 'Roll profile Electron test failed')
  } finally {
    clearTimeout(timer)
    await terminateBenchmarkProcessTree(child)
  }
} else {
  const { app, BrowserWindow } = await import('electron')
  const testRoot = process.argv[2]
  app.setPath('userData', join(testRoot, 'profile'))
  app.disableHardwareAcceleration()
  // Electron waits for ESM entry evaluation before emitting ready; do not await
  // whenReady at module scope or the fixture deadlocks before creating a window.
  void app.whenReady().then(async () => {
    // Render into a software bitmap: hosted Windows runners may have no usable
    // desktop compositor for capturePage(), even though DOM/input checks work.
    const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } })
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') console.error(event.message)
    })
    const evaluate = (source) => window.webContents.executeJavaScript(source)
    const settle = () => new Promise((resolveSettled) => setTimeout(resolveSettled, 50))
    const captureFrame = () => new Promise((resolveFrame, reject) => {
      const onPaint = (_event, _dirtyRect, image) => {
        clearTimeout(timer)
        window.webContents.removeListener('paint', onPaint)
        if (image.isEmpty()) reject(new Error('Roll profile rendered an empty screenshot'))
        else resolveFrame(image.toPNG())
      }
      const timer = setTimeout(() => {
        window.webContents.removeListener('paint', onPaint)
        reject(new Error('Roll profile screenshot paint timed out'))
      }, 5000)
      window.webContents.on('paint', onPaint)
      window.webContents.invalidate()
    })
    const key = async (keyCode) => {
      const windowsVirtualKeyCode = { Enter: 13, Space: 32, Escape: 27, Tab: 9 }[keyCode]
      const event = { key: keyCode === 'Space' ? ' ' : keyCode, code: keyCode, windowsVirtualKeyCode }
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown', ...event, text: keyCode === 'Enter' ? '\r' : keyCode === 'Space' ? ' ' : ''
      })
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
      await settle()
    }
    try {
      await window.loadFile(join(testRoot, 'page/index.html'))
      window.webContents.debugger.attach('1.3')
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      for (const width of [1440, 520]) {
        window.setContentSize(width, 1000)
        await settle()
        assert.equal(await evaluate("document.querySelectorAll('#empty .roll-category-profile').length"), 0)
        assert.equal(await evaluate("document.querySelectorAll('#normal .roll-category-score').length"), 2)
        assert.equal(await evaluate("document.querySelectorAll('#normal details').length"), 0)
        assert.match(await evaluate("document.querySelector('#perfect').innerText"), /100% \(83rd\)/,
          'a perfect discrete roll must show full quality, separately from rarity')
        for (const id of ['overflow', 'compact']) {
          await evaluate(`document.querySelector('#${id} summary').focus()`)
          assert.equal(await evaluate(`document.activeElement.matches('#${id} summary')`), true)
          await key('Enter')
          assert.equal(await evaluate(`document.querySelector('#${id} details').open`), true, 'Enter reveals hidden categories')
          assert.equal(await evaluate(`document.querySelector('#${id} .roll-category-overflow').getBoundingClientRect().height > 0`), true)
          assert.match(await evaluate(`document.querySelector('#${id} .roll-category-overflow').innerText`), /Lightning/i)
          assert.equal(await evaluate(`getComputedStyle(document.querySelector('#${id} summary')).outlineStyle`), 'solid', 'keyboard focus must be visible')
          assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'expanded profiles must fit the viewport')
          await key('Escape')
          assert.equal(await evaluate('window.fixtureEvents.escapes > 0'), true, 'Escape must still reach the containing dialog')
          await writeFile(join(testRoot, `profile-${id}-${width}.png`), await captureFrame())
          await key('Space')
          assert.equal(await evaluate(`document.querySelector('#${id} details').open`), false, 'Space collapses hidden categories')
          await key('Tab')
          assert.equal(await evaluate(`document.activeElement.matches('#${id} summary')`), false, 'Tab must leave the disclosure')
        }
        assert.equal(await evaluate('window.fixtureEvents.activations'), 0, 'disclosure activation must not open the containing item')
      }
      console.log(JSON.stringify({ passed: true, widths: [1440, 520], empty: true, keyboardDisclosure: true, focusVisible: true, noOverflow: true, screenshotDirectory: testRoot }))
      window.destroy()
      app.exit(0)
    } catch (error) {
      console.error(error)
      window.destroy()
      app.exit(1)
    }
  })
}
