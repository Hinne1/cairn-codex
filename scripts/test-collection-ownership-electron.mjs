import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Real Vue workspaces, synthetic catalogs and isolated Electron user data only.
if (!process.versions.electron) {
  const { build } = await import('vite')
  const { default: vue } = await import('@vitejs/plugin-vue')
  const { default: electronPath } = await import('electron')
  const { spawn } = await import('node:child_process')
  const { terminateBenchmarkProcessTree } = await import('./benchmark-process.mjs')
  await mkdir(resolve('local-cache'), { recursive: true })
  const testRoot = await mkdtemp(resolve('local-cache/collection-owner-test-'))
  const outDir = join(testRoot, 'page')
  await build({ configFile: false, logLevel: 'warn', plugins: [vue()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { outDir, lib: { entry: resolve('scripts/fixtures/collection-owner-entry.js'), formats: ['es'], fileName: () => 'fixture.js', cssFileName: 'fixture' } }
  })
  await writeFile(join(outDir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Collection ownership regression fixture</title><link rel="stylesheet" href="./fixture.css"></head><body><div id="app"></div><script type="module" src="./fixture.js"></script></body></html>')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electronPath, [fileURLToPath(import.meta.url), testRoot], { stdio: 'inherit', windowsHide: true, env })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; void terminateBenchmarkProcessTree(child) }, 90_000)
  try {
    const code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit) })
    assert.equal(timedOut, false, 'Collection ownership test timed out')
    assert.equal(code, 0, 'Collection ownership Electron test failed')
  } finally { clearTimeout(timer); await terminateBenchmarkProcessTree(child) }
} else {
  const { app, BrowserWindow } = await import('electron')
  const testRoot = process.argv[2]
  app.setPath('userData', join(testRoot, 'profile'))
  app.disableHardwareAcceleration()
  void app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } })
    const errors = []
    window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
    const run = source => window.webContents.executeJavaScript(source)
    const settle = () => new Promise(done => setTimeout(done, 100))
    const act = async source => { await run(source); await settle() }
    const input = (selector, value) => act(`{ const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', {bubbles:true})); }`)
    const key = async keyCode => {
      const windowsVirtualKeyCode = { Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40 }[keyCode]
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: keyCode, code: keyCode, windowsVirtualKeyCode, text: keyCode === 'Enter' ? '\r' : '' })
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: keyCode, code: keyCode, windowsVirtualKeyCode })
      await settle()
    }
    const capture = name => new Promise((done, reject) => {
      const listener = async (_event, _rect, image) => {
        clearTimeout(timer); window.webContents.removeListener('paint', listener)
        try { assert.equal(image.isEmpty(), false); await writeFile(join(testRoot, name + '.png'), image.toPNG()); done() } catch (error) { reject(error) }
      }
      const timer = setTimeout(() => { window.webContents.removeListener('paint', listener); reject(new Error('Collection ownership capture timed out')) }, 5000)
      window.webContents.on('paint', listener); window.webContents.invalidate()
    })
    try {
      await window.loadFile(join(testRoot, 'page/index.html'))
      window.webContents.debugger.attach('1.3')
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })

      for (const [width, zoom] of [[1440, 1], [520, 1], [520, 1.25]]) {
        window.setContentSize(width, 1000)
        window.webContents.setZoomFactor(zoom)
        const captureSize = width + (zoom === 1 ? "" : "-zoom125")
        await act("collectionOwnerFixture.workspace.value='collection'; collectionOwnerFixture.setCount(120)")
        assert.equal(await run("document.querySelectorAll('.item-card').length"), 48)
        assert.equal(await run("document.documentElement.scrollWidth <= innerWidth"), true)
        await capture('collection-' + captureSize)
        await act("document.querySelector('.completion-tracker header button').focus()")
        await key('Enter')
        assert.equal(await run("document.querySelector('.metrics') === null"), true)
        await key('Enter')
        assert.equal(await run("document.querySelectorAll('.metrics > button').length"), 10)
        await act("collectionOwnerFixture.busy.value=true")
        assert.equal(await run("document.querySelector('.primary-action').disabled"), true)
        await act("collectionOwnerFixture.busy.value=false; document.querySelector('.catalog-results .bounded-results-item').focus()")
        await key('Enter')
        assert.equal(await run("document.querySelectorAll('.copy-card').length"), 3)
        assert.equal(await run("document.querySelector('.item-drawer').scrollWidth <= document.querySelector('.item-drawer').clientWidth"), true)
        await capture('inspection-' + captureSize)
        await act("document.querySelectorAll('.copy-card .copy-actions button')[1].focus()")
        await key('Enter')
        assert.equal(await run("collectionOwnerFixture.inspection.selectedReferenceInstanceKey.value"), 'copy-1')
        assert.equal(await run("collectionOwnerFixture.events.at(-1)[0]"), 'pin')
        await act("document.querySelector('.drawer-close').focus()")
        await key('Enter')
        assert.equal(await run("document.querySelector('.item-drawer') === null"), true)

        await act("collectionOwnerFixture.workspace.value='sets'; collectionOwnerFixture.setCount(1000); collectionOwnerFixture.sets.restoreRoute({query:'',progress:'all',feature:'all',sort:'name',direction:'asc',page:2})")
        assert.equal(await run("document.querySelectorAll('.set-card').length"), 50)
        assert.equal(await run("collectionOwnerFixture.sets.currentPage.value"), 2)
        assert.equal(await run("document.documentElement.scrollWidth <= innerWidth"), true)
        await act('window.scrollTo(0, 0)')
        await capture('sets-' + captureSize)
        await input('.explorer-search input', 'name:never-present')
        await new Promise(resolve => setTimeout(resolve, 150))
        assert.equal(await run("document.querySelectorAll('.set-card').length"), 0)
        await input('.explorer-search input', 'unknown:broken')
        await new Promise(resolve => setTimeout(resolve, 150))
        assert.equal(await run("document.querySelector('.explorer-search input').getAttribute('aria-invalid')"), 'true')
        assert.equal(await run("Boolean(document.querySelector('[role=alert]'))"), true)
        await act("collectionOwnerFixture.sets.restoreRoute({query:'',progress:'all',feature:'all',sort:'name',direction:'asc',page:1}); collectionOwnerFixture.setCount(0)")
        assert.equal(await run("document.querySelectorAll('.set-card').length"), 0)
        assert.match(await run("document.querySelector('.bounded-results-state').textContent"), /No sets/)
      }

      window.webContents.setZoomFactor(1)
      await act(`collectionOwnerFixture.openCopies(4); collectionOwnerFixture.copies.value = collectionOwnerFixture.copies.value.map((copy, index) => ({...copy, instanceKey:'identical-payload', sourcePath: index < 2 ? 'vault://copy-' + index : 'synthetic.gst', itemIndex: index < 2 ? 0 : index - 2})); collectionOwnerFixture.inspection.restore(collectionOwnerFixture.snapshot.value.items[0].record, 'identical-payload')`)
      assert.equal(await run("document.querySelectorAll('.copy-card').length"), 4, 'identical fingerprints must render distinct physical copies')
      assert.equal(await run("collectionOwnerFixture.inspection.comparisonReferenceCopy.value.instanceKey"), 'identical-payload')
      await act("collectionOwnerFixture.inspection.close()")
      for (const width of [1440, 520]) {
        window.setContentSize(width, 1000)
        for (const workspace of ['collection', 'sets']) {
          const start = Date.now()
          await act("collectionOwnerFixture.workspace.value=" + JSON.stringify(workspace) + "; collectionOwnerFixture.setCount(20000)")
          const selector = workspace === 'collection' ? '.item-card' : '.set-card'
          const mounted = await run("document.querySelectorAll(" + JSON.stringify(selector) + ").length")
          assert.equal(mounted, workspace === 'collection' ? 48 : 50)
          assert.equal(await run("document.documentElement.scrollWidth <= innerWidth"), true)
          assert.ok(Date.now() - start < 5000)
          console.log(workspace + ' ' + width + ': 20k archive, ' + mounted + ' mounted, ' + (Date.now() - start) + 'ms including settle')
        }
        const start = Date.now()
        await act("collectionOwnerFixture.openCopies(20000); collectionOwnerFixture.inspection.restore(collectionOwnerFixture.snapshot.value.items[0].record, 'copy-19999')")
        assert.equal(await run("document.querySelectorAll('.copy-card').length"), 50)
        assert.match(await run("document.querySelector('.copy-card.reference .copy-provenance').textContent"), /Seed 19999/)
        assert.equal(await run("document.querySelector('.item-drawer').scrollWidth <= document.querySelector('.item-drawer').clientWidth"), true)
        assert.ok(Date.now() - start < 5000)
        console.log('inspection ' + width + ': 20k copies, 50 mounted, ' + (Date.now() - start) + 'ms including settle')
        await capture('inspection-large-' + width)
        await act("Array.from(document.querySelectorAll('.inspection-copies .bounded-results-footer button')).find(button => button.textContent==='Next').focus()")
        await key('Enter')
        assert.equal(await run("document.querySelectorAll('.copy-card').length"), 50)
        assert.match(await run("document.querySelector('.inspection-copies .bounded-results-footer').textContent"), /Page 2 of 400/)
        assert.equal(await run("collectionOwnerFixture.inspection.selectedReferenceInstanceKey.value"), 'copy-19999')
        await act("document.querySelector('.drawer-close').click()")
      }
      assert.deepEqual(errors, [])
      console.log('Collection ownership UI passed: dashboard actions, empty/error states, typed Sets restoration, keyboard copy pinning, 20k catalog/copies, bounded pages, wide and compact. Captures: ' + testRoot)
      app.exit(0)
    } catch (error) { console.error(error); console.error(await run('document.body.innerHTML.slice(0, 2500)')); console.error(errors); app.exit(1) }
  })
}
