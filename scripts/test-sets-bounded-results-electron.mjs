import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

function runGate(label, args) {
  const result = spawnSync(process.execPath, [resolve('scripts/benchmark-ui.mjs'), ...args], {
    cwd: resolve('.'),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} Sets bounded-result gate exited ${result.status ?? 'without a status'}.`)
}

const common = ['--electron-source', '--category', 'Sets', '--disable-gpu', '--assert-no-overflow']

runGate('normal', [
  ...common, '--fixture', 'sets-semantics', '--query', ' ',
  '--expected-bounded-total', '3', '--expected-bounded-mounted', '3', '--expected-set-cards', '3',
  '--width', '1440', '--height', '1000', '--screenshot-name', 'sets-bounded-normal'
])

runGate('empty', [
  ...common, '--fixture', 'sets-bounded', '--query', 'no-such-bounded-set',
  '--expected-bounded-total', '0', '--expected-bounded-mounted', '0', '--expected-set-cards', '0',
  '--width', '1440', '--height', '1000', '--screenshot-name', 'sets-bounded-empty'
])

runGate('wide 202-set paging', [
  ...common, '--fixture', 'sets-bounded', '--query', ' ', '--verify-sets-paging',
  '--expected-bounded-total', '202', '--expected-bounded-mounted', '50', '--expected-set-cards', '50',
  '--width', '1440', '--height', '1000', '--screenshot-name', 'sets-bounded-wide'
])

runGate('compact 202-set paging', [
  ...common, '--fixture', 'sets-bounded', '--query', ' ', '--verify-sets-paging',
  '--expected-bounded-total', '202', '--expected-bounded-mounted', '50', '--expected-set-cards', '50',
  '--width', '520', '--height', '1000', '--screenshot-name', 'sets-bounded-compact'
])

console.log('Sets bounded-result Electron gates passed for normal, empty, 202-set, wide, compact, paging, reset, tooltip, and item-drawer states.')
