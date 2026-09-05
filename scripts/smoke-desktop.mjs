import { spawnSync } from 'node:child_process'
import electron from 'electron'
import { verificationEnvironment } from './verification-environment.mjs'

const result = spawnSync(electron, ['local-cache/verification-build/main/index.js'], {
  cwd: process.cwd(),
  env: {
    ...verificationEnvironment(),
    CAIRN_CODEX_SMOKE_TEST: '1'
  },
  stdio: 'inherit',
  windowsHide: true
})

process.exit(result.status ?? 1)
