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
  const testRoot = await mkdtemp(resolve('local-cache/research-toolbar-test-'))
  const outDir = join(testRoot, 'page')
  await build({ configFile: false, logLevel: 'warn', plugins: [vue()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { outDir, lib: { entry: resolve('scripts/fixtures/research-toolbar-entry.js'), formats: ['es'], fileName: () => 'fixture.js', cssFileName: 'fixture' } }
  })
  await writeFile(join(outDir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Research toolbar regression fixture</title><link rel="stylesheet" href="./fixture.css"></head><body><div id="app"></div><script type="module" src="./fixture.js"></script></body></html>')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electronPath, [fileURLToPath(import.meta.url), testRoot], { stdio: 'inherit', windowsHide: true, env })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; void terminateBenchmarkProcessTree(child) }, 90_000)
  try {
    const code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit) })
    assert.equal(timedOut, false, 'Toolbar test timed out')
    assert.equal(code, 0, 'Toolbar Electron test failed')
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
      const timer = setTimeout(() => { window.webContents.removeListener('paint', listener); reject(new Error('Toolbar capture timed out')) }, 5000)
      window.webContents.on('paint', listener); window.webContents.invalidate()
    })
    try {
      await window.loadFile(join(testRoot, 'page/index.html'))
      window.webContents.debugger.attach('1.3')
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      for (const width of [1440, 520]) {
        window.setContentSize(width, 1000)
        for (const workspace of ['planner', 'skills']) {
          await act(`researchFixture.workspace.value = '${workspace}'; researchFixture.setCount(120)`)
          assert.equal(await run(`document.querySelectorAll('.research-toolbar').length`), 1)
          assert.equal(await run(`document.querySelectorAll('.explorer-result-count').length`), 1)
          assert.equal(await run(`document.documentElement.scrollWidth <= innerWidth`), true)
          assert.deepEqual(await run(`Array.from(document.querySelector('.research-toolbar').children).map(element => element.className)`), ['explorer-toolbar-before', 'explorer-search', 'explorer-toolbar-group explorer-toolbar-filters', 'explorer-toolbar-results', ...(workspace === 'planner' ? ['explorer-toolbar-summary'] : [])])
          assert.equal(await run(`Array.from(document.querySelectorAll('.research-toolbar input,.research-toolbar select,.research-toolbar button')).filter(el=>el.getClientRects().length).every(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})`), true, 'Every visible control stays inside viewport')
          assert.equal(await run(`Math.abs(document.querySelector('.explorer-toolbar-sort select').getBoundingClientRect().bottom-document.querySelector('.sort-direction-button').getBoundingClientRect().bottom)<1`), true, 'Sort direction must remain beside the sort selector')
          await capture(workspace + '-' + width)
          const sortBefore = await run(`document.querySelector('.sort-direction-button').getAttribute('aria-label')`)
          await act(`document.querySelector('.sort-direction-button').focus()`)
          await key('Enter')
          assert.notEqual(await run(`document.querySelector('.sort-direction-button').getAttribute('aria-label')`), sortBefore)
          await key('Enter')
          await input('.explorer-search input', 'no-such-fixture')
          assert.equal(await run(`document.querySelector('.explorer-result-count strong').textContent`), '0')
          await act(`document.querySelector('.explorer-search-input button').click()`)
          assert.equal(await run(`document.querySelector('.explorer-result-count strong').textContent`), '120')
          if (workspace === 'planner') {
            assert.equal(await run(`document.querySelector('#planner-skill-input').getClientRects().length > 0`), true)
            assert.equal(await run(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Edit build')`), false)
            await input('#planner-skill-input', 'Curse of Frailty')
            await act(`document.querySelector('#planner-skill-input').focus()`)
            await key('Enter')
            assert.equal(await run(`researchFixture.session.plannerSkills.value.includes('Curse of Frailty')`), true)
            await act(`document.querySelector('[aria-label="Remove Curse of Frailty"]').click()`)
            assert.deepEqual(await run(`[...researchFixture.session.plannerSkills.value]`), ['Wendigo Totem'])
            await input('.explorer-search input', 'Fixture 00001')
            for (const view of ['Journey', 'MI sources', 'Table']) {
              await act(`Array.from(document.querySelectorAll('.planner-display button')).find(button=>button.textContent==='${view}').focus()`)
              await key('Enter')
              assert.equal(await run(`document.activeElement.textContent`), view, 'View switch keeps keyboard focus')
              assert.equal(await run(`document.querySelector('#planner-skill-input').getClientRects().length > 0`), true)
              if (view === 'MI sources') await input('.explorer-search input', 'Fixture area')
            }
            assert.equal(await run(`document.querySelector('.explorer-search input').value`), 'Fixture 00001')
            assert.equal(await run(`researchFixture.session.atlasRegionQuery.value`), 'Fixture area')
            await act(`document.querySelector('.explorer-search-input button').click()`)
          } else {
            await act(`document.querySelector('#skill-picker-input').focus()`)
            await key('ArrowDown')
            assert.equal(await run(`document.querySelector('#skill-picker-input').getAttribute('aria-expanded')`), 'true')
            await key('Escape')
            assert.equal(await run(`document.querySelector('#skill-picker-input').getAttribute('aria-expanded')`), 'false')
          }
          await act(`researchFixture.setCount(0)`)
          assert.equal(await run(`document.querySelector('.explorer-result-count strong').textContent`), '0')
        }
      }
      window.webContents.setZoomFactor(1.25)
      for (const workspace of ['planner', 'skills']) {
        await act(`researchFixture.workspace.value='${workspace}';researchFixture.setCount(120)`)
        assert.equal(await run(`document.documentElement.scrollWidth <= innerWidth`), true, 'Compact 125% zoom must not widen the document')
        assert.equal(await run(`Array.from(document.querySelectorAll('.research-toolbar input,.research-toolbar select,.research-toolbar button')).filter(el=>el.getClientRects().length).every(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})`), true, 'Compact 125% zoom keeps all controls in view')
        await capture(workspace + '-520-zoom125')
      }
      window.webContents.setZoomFactor(1)
      window.setContentSize(1440, 1000)
      for (const workspace of ['planner', 'skills']) {
        const start = Date.now()
        await act(`researchFixture.workspace.value='${workspace}';researchFixture.setCount(20000)`)
        assert.equal(await run(`document.querySelector('.explorer-result-count strong').textContent.replaceAll(',','')`), '20000')
        const mounted = await run(`document.querySelectorAll('.research-table-row').length`)
        assert.equal(mounted, 50)
        assert.ok(Date.now()-start < 5000, '20k toolbar rendering stays within the five-second regression budget')
        console.log(`${workspace}: synthetic 20k rendered in ${Date.now()-start}ms including settle, ${mounted} mounted rows`)
      }
      await act(`researchFixture.workspace.value='probe'`)
      assert.equal(await run(`document.querySelector('.research-toolbar').getAttribute('aria-busy')`), 'true')
      assert.match(await run(`document.querySelector('output').textContent`), /Updating/)
      await act(`researchFixture.probeLoading.value=false;researchFixture.probeError.value='Invalid fixture query'`)
      assert.equal(await run(`document.querySelector('.explorer-search input').getAttribute('aria-invalid')`), 'true')
      assert.match(await run(`document.querySelector('[role="alert"]').textContent`), /Invalid fixture query/)
      assert.deepEqual(errors, [])
      console.log('Research toolbar gates passed: shared composition, inline skills, view/query/focus retention, sort keyboard activation, empty/loading/error, 20k bounded results, wide and compact controls. Screenshots: ' + testRoot)
      app.exit(0)
    } catch (error) { console.error(error); console.error(await run('document.body.innerHTML.slice(0, 2500)')); console.error(errors); app.exit(1) }
  })
}
