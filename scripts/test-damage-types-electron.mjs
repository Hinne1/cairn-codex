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
  const testRoot = await mkdtemp(resolve('local-cache/damage-types-test-'))
  const outDir = join(testRoot, 'page')
  await build({ configFile: false, logLevel: 'warn', plugins: [vue()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { outDir, lib: { entry: resolve('scripts/fixtures/damage-types-entry.js'), formats: ['es'], fileName: () => 'fixture.js', cssFileName: 'fixture' } }
  })
  await writeFile(join(outDir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Damage types regression fixture</title><link rel="stylesheet" href="./fixture.css"></head><body><div id="app"></div><script type="module" src="./fixture.js"></script></body></html>')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electronPath, [fileURLToPath(import.meta.url), testRoot], { stdio: 'inherit', windowsHide: true, env })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; void terminateBenchmarkProcessTree(child) }, 90_000)
  try {
    const code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit) })
    assert.equal(timedOut, false, 'Damage types test timed out')
    assert.equal(code, 0, 'Damage types Electron test failed')
  } finally { clearTimeout(timer); await terminateBenchmarkProcessTree(child) }
} else {
  const { app, BrowserWindow } = await import('electron')

  const testRoot = process.argv[2]
  app.setPath('userData', join(testRoot, 'profile'))
  app.disableHardwareAcceleration()
  void app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } })
    const run = source => window.webContents.executeJavaScript(source)
    const assertOpaqueDamage = async () => assert.equal(await run(`Array.from(document.querySelectorAll('[data-damage-family]')).every(node => {
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor)
        if (Number(style.opacity) !== 1 || style.filter !== 'none') return false
      }
      return true
    })`), true, 'ignored, unavailable and locked states must not fade or desaturate damage text')
    const act = async source => { await run(source); await run('window.damageFixture.settle()'); await new Promise(resolveSettled => setTimeout(resolveSettled, 50)) }
    const capture = name => new Promise((resolveCapture, reject) => {
      const timer = setTimeout(() => { window.webContents.removeListener('paint', paint); reject(new Error('Damage screenshot timed out')) }, 5000)
      const paint = async (_event, _rect, image) => {
        clearTimeout(timer); window.webContents.removeListener('paint', paint)
        try { assert.equal(image.isEmpty(), false); await writeFile(join(testRoot, name + '.png'), image.toPNG()); resolveCapture() } catch (error) { reject(error) }
      }
      window.webContents.on('paint', paint); window.webContents.invalidate()
    })
    try {
      await window.loadFile(join(testRoot, 'page/index.html'))
      window.webContents.debugger.attach('1.3')
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      for (const width of [1440, 520]) {
        window.setContentSize(width, 1000)
        for (const alternate of [false, true]) {
          await act('window.damageFixture.theme(' + alternate + '); window.damageFixture.view.value = "tooltip"')
          assert.deepEqual(await run('Array.from(document.querySelectorAll("[data-line]"), line => line.textContent)'), await run('window.damageFixture.original'))
          assert.equal(await run('document.querySelectorAll("[data-line=\'12\'] [data-damage-family], [data-line=\'13\'] [data-damage-family], [data-line=\'15\'] [data-damage-family]").length'), 0, 'skill names, Energy Burn and visual prose are not colored')
          assert.equal(await run('document.querySelectorAll("[data-line=\'14\'] [data-damage-family]").length'), 1, 'a suffix skill name must remain unchanged')
          assert.deepEqual(await run('Array.from(document.querySelectorAll("[data-conversion-role]"), node => [node.dataset.conversionRole,node.dataset.damageFamily])'), [['source','physical'],['target','fire']])
          const tooltipFire = await run('getComputedStyle(document.querySelector("[data-damage-family=fire]")).color')
          await capture('tooltip-' + width + '-' + alternate)
          await act('window.damageFixture.view.value = "surfaces"')
          await assertOpaqueDamage()
          assert.deepEqual(await run('Array.from(document.querySelectorAll(".supply-effects li"), node=>node.textContent).slice(0,5)'), await run('window.damageFixture.supply.effects'))
          assert.equal(await run('document.querySelectorAll(".supply-effects li:first-child [data-damage-family], .supply-effects li:nth-child(4) [data-damage-family], #legacy-supply [data-damage-family]").length'), 0, 'flavor, granted skill names and legacy untyped effects stay plain')
          assert.deepEqual(await run('Array.from(document.querySelectorAll(".supply-effects [data-damage-family]"), node=>node.dataset.damageFamily)'), ['fire','cold','aether'])
          assert.equal(await run('window.damageFixture.referenceContrasts().length'), 20)
          assert.equal(await run('window.damageFixture.referenceContrasts().every(ratio=>ratio>=4.5)'), true, 'all damage text must pass contrast at both rendered reference-gradient endpoints')
          await capture('surfaces-' + width + '-' + alternate)
          for (const view of ['table', 'journey']) {
            await act('window.damageFixture.view.value = "' + view + '"; window.damageFixture.setCount(2)')
            assert.equal(await run('getComputedStyle(document.querySelector("[data-damage-family=fire]")).color'), tooltipFire, 'shared colors must survive table tone and alternate theme')
            assert.equal(await run('document.querySelectorAll(".research-item [data-damage-family], .research-supports [data-damage-family], .planner-journey-copy > strong [data-damage-family]").length'), 0)
            await assertOpaqueDamage()
            if (view === 'table') {
              await act('document.querySelector(".research-item-table").scrollLeft = 600')
              assert.deepEqual(await run('Array.from(document.querySelectorAll("[data-conversion-role]")).slice(0,2).map(node=>node.dataset.damageFamily)'), ['physical','fire'])
            }
            assert.equal(await run('document.documentElement.scrollWidth <= window.innerWidth'), true)
            await capture(view + '-' + width + '-' + alternate)
          }
        }
        await act('window.damageFixture.view.value = "table"; window.damageFixture.setCount(0)')
        assert.match(await run('document.body.innerText'), /No synthetic items/)
        await capture('empty-' + width)
        const start = Date.now()
        await act('window.damageFixture.setCount(20000)')
        assert.equal(await run('document.querySelectorAll(".research-table-row").length'), 50)
        assert.ok(Date.now() - start < 5000)
        console.log('Damage research ' + width + ': 20k items, 50 rows, ' + (Date.now() - start) + 'ms')
        await act('window.damageFixture.view.value = "glossary"')
        assert.equal(await run('document.querySelectorAll(".damage-legend li").length'), 10)
        assert.equal(await run('document.querySelectorAll(".damage-legend-type").length'), 17)
        assert.equal(await run(`Array.from(document.querySelectorAll('.damage-legend li')).every(row => {
          const icons = Array.from(row.querySelectorAll('svg'));
          return icons.length === 1 || icons[0].innerHTML !== icons[1].innerHTML;
        })`), true, 'every same-color direct/DoT pair has distinct icon shapes')
        assert.match(await run('document.querySelector(".damage-legend").textContent'), /Internal Trauma[\s\S]*Bleeding[\s\S]*Frostburn[\s\S]*Burn[\s\S]*Poison[\s\S]*Electrocute[\s\S]*Vitality Decay/)
        assert.equal(await run('document.activeElement.id'), 'glossary-entry-title')
        assert.equal(await run('document.documentElement.scrollWidth <= window.innerWidth'), true)
        await act('document.querySelector(".damage-legend").scrollIntoView()')
        await capture('legend-' + width)
      }
      console.log('Damage presentation passed: original text, typed conversion spans, tooltip/table/journey parity, default/alternate themes, glossary, empty/narrow/20k. Captures: ' + testRoot)
      window.destroy(); app.exit(0)
    } catch (error) { console.error(error); window.destroy(); app.exit(1) }
  })
}
