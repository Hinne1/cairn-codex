import type { BrowserWindow } from 'electron'

/** Exercises real components and IPC against the disposable 20k archive fixture. */
export async function verifyWorkspaceQueries(window: BrowserWindow): Promise<Record<string, number>> {
  return window.webContents.executeJavaScript(`
    (async () => {
      const started = performance.now()
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
      const until = async (condition, message) => {
        for (let i = 0; i < 100; i++) { if (condition()) return; await wait(50) }
        throw new Error(message + ': ' + document.querySelector('main')?.textContent?.slice(-1000))
      }
      const check = (condition, message) => { if (!condition) throw new Error(message) }
      const button = (root, label) => [...root.querySelectorAll('button')].find(item => item.textContent.trim() === label)
      const open = async (label, selector) => {
        const target = [...document.querySelectorAll('.workspace-sidebar [data-tool-id]')]
          .find(item => item.querySelector('.workspace-nav-label')?.textContent.trim() === label)
        check(target, 'Missing workspace ' + label); target.click()
        await until(() => document.querySelector(selector), 'Workspace did not open')
        return document.querySelector(selector)
      }
      const rows = root => [...root.querySelectorAll('.bounded-results-item[data-result-key]')]
      const settled = root => root.querySelector('.bounded-results')?.getAttribute('aria-busy') === 'false'
      const query = async (root, value) => {
        const input = root.querySelector('.explorer-search input')
        input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(150); await until(() => settled(root), 'Query did not settle')
      }
      const select = async (element, value, root) => {
        element.value = value; element.dispatchEvent(new Event('change', { bubbles: true }))
        await wait(150); await until(() => settled(root), 'Filter did not settle')
      }
      const keyboardSelect = async (root) => {
        const first = rows(root).find(row => row.getAttribute('aria-disabled') !== 'true')
        check(first, 'No eligible keyboard target'); first.focus()
        first.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
        await wait(30)
        check(first.getAttribute('aria-selected') === 'true', 'Space did not select the focused copy')
        return first.dataset.resultKey
      }
      const nextPage = async root => {
        const identity = rows(root)[0].dataset.resultKey
        const next = button(root.querySelector('.bounded-results-footer'), 'Next')
        check(next && !next.disabled, 'Next page unavailable'); next.focus(); next.click()
        await until(() => settled(root) && rows(root).length > 0 && rows(root)[0].dataset.resultKey !== identity, 'Next page did not replace rows')
      }

      const dismantling = await open('Dismantling Lab', '.dismantling-workspace')
      await until(() => settled(dismantling) && rows(dismantling).length === 120, 'Dismantling initial page')
      const dismantlingMountedRows = rows(dismantling).length
      check(dismantling.querySelector('.bounded-results-footer').textContent.includes('20,000'), 'All-mode total')
      await keyboardSelect(dismantling)
      await nextPage(dismantling)
      check(rows(dismantling).length === 120, 'Dismantling DOM grew on page two')
      check(dismantling.querySelector('.dismantling-run').textContent.includes('Preview 1 selected'), 'Paging lost selection')
      const mode = dismantling.querySelectorAll('.explorer-toolbar-filters select')[0]
      for (const value of ['hardcore', 'softcore']) {
        await select(mode, value, dismantling)
        check(dismantling.querySelector('.bounded-results-footer').textContent.includes('10,000'), value + ' total')
        check(rows(dismantling).every(row => row.textContent.includes(value === 'hardcore' ? 'HC' : 'SC')), 'Mode leaked across page')
        check(dismantling.querySelector('.dismantling-run').disabled, 'Mode change retained stale selection')
      }
      button(dismantling, 'Select safe duplicates').click()
      await until(() => !dismantling.querySelector('.dismantling-run').disabled, 'Duplicate selection did not finish')
      check(!dismantling.querySelector('.dismantling-warning'), 'Automatic selection included attachments')
      await query(dismantling, 'name:absent')
      check(rows(dismantling).length === 0 && dismantling.querySelector('.is-empty'), 'Dismantling empty state')
      check(dismantling.querySelector('.dismantling-run').disabled, 'Query retained stale selection')
      await query(dismantling, 'name:')
      check(button(dismantling, 'Select visible').disabled && dismantling.querySelector('.dismantling-run').disabled, 'Invalid dismantling query left stale actions enabled')
      await query(dismantling, '')
      await select(dismantling.querySelectorAll('.explorer-toolbar-filters select')[1], 'epic', dismantling)
      check(rows(dismantling).every(row => row.className && row.textContent.includes('epic')), 'Rarity filter')
      await select(mode, 'all', dismantling)
      await select(dismantling.querySelectorAll('.explorer-toolbar-filters select')[1], 'all', dismantling)

      const supplies = await open('Supplies', '.supplies-workspace')
      await until(() => settled(supplies) && rows(supplies).length === 60, 'Supply initial page')
      button(supplies.querySelector('.segmented-control'), 'Offline').click()
      await wait(150); await until(() => settled(supplies), 'Offline mode query')
      const suppliesMountedRows = rows(supplies).length
      check(supplies.querySelector('.bounded-results-footer').textContent.includes('142'), 'Supply group total')
      await keyboardSelect(supplies)
      await nextPage(supplies)
      check(rows(supplies).length === 60, 'Supply DOM grew on page two')
      check(supplies.querySelector('.supply-dispense').textContent.includes('1 selected'), 'Supply paging lost selection')
      check(supplies.querySelector('.supply-dispense').disabled, 'Synthetic staging must stay locked')
      await query(supplies, 'mode:hardcore')
      check(rows(supplies).length === 1 && rows(supplies)[0].getAttribute('aria-disabled') === 'true', 'HC supply separation')
      check(supplies.querySelector('.supply-dispense').textContent.includes('0 selected'), 'Supply query retained selection')
      await query(supplies, 'name:absent')
      check(rows(supplies).length === 0 && supplies.querySelector('.is-empty'), 'Supply empty state')
      await query(supplies, 'name:')
      check(button(supplies, 'Select visible').disabled && button(supplies, 'Dispense all unlocked boosts').disabled && supplies.querySelector('.supply-dispense').disabled, 'Invalid supply query left stale actions enabled')
      await query(supplies, '')
      await select(supplies.querySelector('.explorer-toolbar-filters select'), 'augments', supplies)
      check(rows(supplies).length === 2, 'Archive rune page')
      await select(supplies.querySelectorAll('.explorer-toolbar-filters select')[1], 'jewelry', supplies)
      check(rows(supplies).length === 0, 'Supply compatible-slot empty state')
      await select(supplies.querySelectorAll('.explorer-toolbar-filters select')[1], 'all', supplies)
      await select(supplies.querySelector('.explorer-toolbar-filters select'), 'writs', supplies)
      document.querySelector('button[aria-label="Dismiss notification"]')?.click()
      return { workspaceQueriesMs: performance.now() - started, dismantlingMountedRows, suppliesMountedRows }
    })()
  `)
}
