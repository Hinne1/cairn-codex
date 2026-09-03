import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { copyFile, mkdir } from 'node:fs/promises'

const captureDirectory = resolve('local-cache/glossary-verification')
await mkdir(captureDirectory, { recursive: true })

for (const [fixture, width] of [['settings', 1440], ['mi-workshop', 520]]) {
  const result = spawnSync(process.execPath, [resolve('scripts/benchmark-ui.mjs'),
    '--allow-windows-sandbox-fallback', '--electron-source', '--fixture', fixture,
    '--category', 'Collection', '--query', '', '--enable-all-tools', '--dismiss-onboarding',
    '--disable-gpu', '--assert-no-overflow', '--width', String(width), '--height', '1000',
    '--screenshot-name', `glossary-${fixture}-${width}`
  ], { cwd: resolve('.'), env: { ...process.env, CAIRN_CODEX_SCREENSHOT_VERIFY_GLOSSARY: '1' }, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Glossary ${fixture}/${width} gate failed with ${result.status}`)
  for (const suffix of ['', '-details']) {
    const name = `glossary-${fixture}-${width}${suffix}.png`
    await copyFile(resolve('local-cache/ui-benchmark', name), resolve(captureDirectory, name))
  }
}
console.log('Glossary Electron gates passed: wide empty collection, compact populated collection, keyboard details, contextual help, exact reference Back/Forward, MI return, and source links.')
