import { spawnSync } from 'node:child_process'
import electron from 'electron'

const result = spawnSync(electron, ['.'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CAIRN_CODEX_SMOKE_TEST: '1'
  },
  stdio: 'inherit',
  windowsHide: true
})

process.exit(result.status ?? 1)
