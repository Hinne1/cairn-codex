import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { WebContents } from 'electron'

export async function verifyTooltipScrolling(contents: WebContents): Promise<void> {
  const evaluate = (source: string) => contents.executeJavaScript(source)
  const wait = (milliseconds = 260) => new Promise(resolve => setTimeout(resolve, milliseconds))
  const move = async (point: { x: number; y: number }) => {
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  }
  const wheel = async (point: { x: number; y: number }, deltaY: number, modifiers = 0) => {
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY, modifiers })
    await wait()
  }
  const key = async (key: string) => {
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key })
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key })
    await wait()
  }
  const state = () => evaluate(`(() => { const tip = document.querySelector('.game-tooltip'); return {
    page: scrollY, top: tip?.scrollTop, maximum: tip ? tip.scrollHeight - tip.clientHeight : null,
    focus: document.activeElement?.getAttribute('data-result-key')
  } })()`)
  const point = (selector: string) => evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing wheel target: ' + ${JSON.stringify(selector)});
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + Math.min(24, rect.width / 2)), y: Math.round(rect.top + rect.height / 2) };
  })()`)
  const navigate = async (destination: string, journey = false) => {
    await move({ x: 0, y: 0 })
    await evaluate(`document.querySelector('[data-destination-id="${destination}"], [data-tool-id="${destination}"]').click()`)
    await wait()
    if (destination === 'planner') {
      await evaluate(`[...document.querySelectorAll('.planner-display button')].find(button => button.textContent.trim() === '${journey ? 'Journey' : 'Table'}').click()`)
      await wait()
    }
  }
  const selectSource = async (selector: string, long: boolean) => {
    await evaluate(`document.activeElement?.blur()`)
    await move({ x: 0, y: 0 })
    await key('Escape')
    await evaluate(`document.documentElement.classList.toggle('wheel-verification-overflow', ${long})`)
    await evaluate(`(() => {
      document.querySelector('[data-wheel-source]')?.removeAttribute('data-wheel-source');
      const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(element => {
        if (element.matches('.mi-table-row')) return true;
        const record = element.closest('[data-result-key]')?.getAttribute('data-result-key') ?? '';
        const index = Number(record.split('skill_support_')[1]?.split('.dbr')[0]);
        return Number.isFinite(index) && index % 2 === ${long ? 0 : 1};
      });
      const source = candidates[Math.min(5, candidates.length - 1)];
      if (!source) throw new Error('Missing ${long ? 'long' : 'short'} fixture source');
      source.setAttribute('data-wheel-source', '');
      source.scrollIntoView({ block: 'center', inline: 'start' });
    })()`)
    await wait(80)
    const location = await point('[data-wheel-source]')
    await move(location)
    await wait()
    assert.notEqual((await state()).top, undefined, 'Pointer hover opens the real global tooltip')
    if (long) {
      // Keep an exposed source below the fixed overlay at both viewport widths.
      // Only the verification profile changes this cap; contents are real fixture lines.
      await move({ x: location.x + 2, y: location.y })
      await wait()
      assert.ok((await state()).maximum > 0, 'Long fixture overflows its tooltip')
    } else {
      assert.equal((await state()).maximum, 0, 'Short fixture must have no tooltip scroll range')
    }
    return { x: location.x + (long ? 2 : 0), y: location.y }
  }

  contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await evaluate(`(() => { const style = document.createElement('style'); style.id = 'wheel-verification-cap'; style.textContent = '.wheel-verification-overflow .game-tooltip { max-height: 180px !important; }'; document.head.appendChild(style); })()`)
    const workspaces = [
      { destination: 'collection', source: '.item-card', journey: false },
      { destination: 'skills', source: '.research-item', journey: false },
      { destination: 'planner', source: '.research-item', journey: false },
      { destination: 'planner', source: '.planner-journey-picture', journey: true },
      { destination: 'mi-workshop', source: '.mi-table-row', journey: false }
    ]
    for (const boundary of ['page', 'contain']) {
      await navigate('settings')
      await evaluate(`document.querySelector('input[name="tooltip-boundary-scroll"][value="${boundary}"]').click()`)
      await wait(60)
      for (const workspace of workspaces) {
        await navigate(workspace.destination, workspace.journey)
        const context = `${workspace.destination}${workspace.journey ? ' Journey' : ''}/${boundary}`
        const sourcePoint = await selectSource(workspace.source, true)
        assert.equal(await evaluate(`Boolean(document.elementFromPoint(${sourcePoint.x}, ${sourcePoint.y})?.closest('[data-wheel-source]'))`), true, `${context}: real source receives wheel input`)
        const initial = await state()
        await wheel(sourcePoint, 80)
        const fromSource = await state()
        assert.ok(fromSource.top > initial.top, `${context}: source wheel scrolls the tooltip`)
        assert.equal(fromSource.page, initial.page, `${context}: source wheel keeps page still`)

        const tipPoint = await point('.game-tooltip')
        await move(tipPoint)
        await wait()
        const beforeDirect = await state()
        await wheel(tipPoint, 60)
        const direct = await state()
        assert.ok(direct.top > beforeDirect.top, `${context}: pointer enters tooltip through grace path and scrolls it`)
        assert.equal(direct.page, beforeDirect.page, `${context}: direct wheel keeps page still`)
        await wheel(tipPoint, -0.5)
        assert.ok((await state()).top <= direct.top, `${context}: trackpad-sized reverse input is accepted`)

        for (const direction of [-1, 1]) {
          await evaluate(`document.querySelector('.game-tooltip').scrollTop = ${direction < 0 ? '0' : 'document.querySelector(".game-tooltip").scrollHeight'}`)
          const before = await state()
          assert.ok(await evaluate(`scrollY > 100 && document.documentElement.scrollHeight - innerHeight - scrollY > 100`), `${context}: fixture has page room in both directions`)
          await wheel(tipPoint, direction * 60)
          const after = await state()
          assert.equal(after.top, before.top, `${context}: boundary input cannot move tooltip past its edge`)
          if (boundary === 'contain') assert.equal(after.page, before.page, `${context}: containment keeps page still`)
          else assert.ok((after.page - before.page) * direction > 0, `${context}: boundary input continues into page`)
        }

        // A keyboard description owns Page Up/Down without moving focus or page.
        await move({ x: 0, y: 0 })
        await wait(120)
        await evaluate(`document.activeElement?.blur()`)
        await evaluate(`document.querySelector('[data-wheel-source]').closest('[data-result-key]').focus()`)
        await wait()
        const focused = await state()
        assert.equal(focused.top, 0, `${context}: new source focus opens its description at the top`)
        await key('PageDown')
        const down = await state()
        assert.ok(down.top > focused.top, `${context}: PageDown scrolls the focused description`)
        assert.equal(down.page, focused.page)
        assert.equal(down.focus, focused.focus)
        await key('PageUp')
        assert.ok((await state()).top < down.top, `${context}: PageUp reverses keyboard scrolling`)

        // Source boundaries depend on native scroll chaining through local table wrappers.
        for (const direction of [-1, 1]) {
          const edgePoint = await selectSource(workspace.source, true)
          await evaluate(`document.querySelector('.game-tooltip').scrollTop = ${direction < 0 ? '0' : 'document.querySelector(".game-tooltip").scrollHeight'}`)
          const before = await state()
          await wheel(edgePoint, direction * 60)
          const after = await state()
          if (boundary === 'contain') assert.equal(after.page, before.page, `${context}: source edge honors containment`)
          else assert.ok((after.page - before.page) * direction > 0, `${context}: source edge hands off through its wrapper`)
        }

        const shortSource = await selectSource(workspace.source, false)
        const beforeShortSource = await state()
        await wheel(shortSource, 60)
        assert.ok((await state()).page > beforeShortSource.page, `${context}: short source tooltip leaves native page scrolling available`)

        await selectSource(workspace.source, false)
        const shortPoint = await point('.game-tooltip')
        await move(shortPoint)
        const shortBefore = await state()
        await wheel(shortPoint, 60)
        const shortAfter = await state()
        assert.equal(shortAfter.top, 0, `${context}: short tooltip remains unscrolled`)
        assert.ok(shortAfter.page > shortBefore.page, `${context}: short tooltip always leaves page scrolling available`)
        console.log(`Native tooltip scroll passed: ${context}`)
      }
    }

    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await navigate('collection')
    const sourcePoint = await selectSource('.item-card', true)
    const beforeReduced = await state()
    await wheel(sourcePoint, 120)
    const reduced = await state()
    assert.equal(reduced.top, beforeReduced.top + 120, 'Reduced motion applies the full wheel delta without interpolation')
    assert.equal(reduced.page, beforeReduced.page)
    await move({ x: 0, y: 0 })
    await key('Escape')
    await evaluate(`(() => { const input = document.querySelector('.explorer-search input'); input.value = 'no-tooltip-fixture-match'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await wait(400)
    assert.equal(await evaluate(`document.querySelectorAll('.item-card').length`), 0, 'Empty results do not leave a tooltip source mounted')
    assert.equal((await state()).top, undefined, 'Empty results retain no tooltip')
    await evaluate(`(() => { const input = document.querySelector('.explorer-search input'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await wait(400)
    const count = await evaluate(`document.querySelectorAll('.item-card').length`)
    assert.ok(count > 0 && count <= 48, 'Collection keeps the 126-item fixture bounded')
    await evaluate(`document.getElementById('wheel-verification-cap').remove(); document.documentElement.classList.remove('wheel-verification-overflow')`)
    console.log(`Native tooltip bounded fixture: 126 items, ${count} Collection cards mounted.`)
  } catch (error) {
    await writeFile(process.env.CAIRN_CODEX_SCREENSHOT_PATH!.replace(/\.png$/, '-failure.png'), (await contents.capturePage()).toPNG())
    throw error
  } finally {
    contents.debugger.detach()
  }
}
