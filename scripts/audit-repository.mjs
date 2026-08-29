import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { extname, resolve } from 'node:path'

const root = resolve('.')
const git = spawnSync(
  'git',
  ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'ls-files', '-z'],
  { cwd: root, encoding: 'utf8' }
)
if (git.status !== 0) throw new Error(git.stderr || 'git ls-files failed.')
const files = git.stdout.split('\0').filter(Boolean)
const forbiddenExtensions = new Set([
  '.db', '.sqlite', '.sqlite3', '.gsh', '.gst', '.dmp', '.pdb', '.csv', '.arz', '.arc', '.tex'
])
const allowedBinaries = new Map([
  ['src/helper/CairnCodex.GrimDawn/native/ItemAssistantHook_x64.dll', '419b53fdff4e75dafb98f9066a0271da0f0c937b5b02e5beca2e39af527a34c5'],
  ['src/helper/CairnCodex.GrimDawn/native/DllInjector64.exe', '569e6bdde51148b29aece0491366e9aa4c21cf2f11279a94c815e2b958cfe10c']
])

for (const file of files) {
  const extension = extname(file).toLowerCase()
  if (forbiddenExtensions.has(extension)) {
    throw new Error(`Forbidden game or personal-data file is tracked: ${file}`)
  }
  const info = await stat(resolve(root, file))
  if (info.size > 10 * 1024 * 1024) throw new Error(`Tracked file exceeds 10 MiB: ${file}`)
  if (extension === '.dll' || extension === '.exe') {
    const expected = allowedBinaries.get(file)
    if (!expected) throw new Error(`Unreviewed executable binary is tracked: ${file}`)
    const actual = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex')
    if (actual !== expected) throw new Error(`Tracked native binary fingerprint changed: ${file}`)
    continue
  }
  if (!/\.(?:cs|ts|vue|css|js|mjs|json|md|ps1|yml|yaml|xml|html|gitignore|svg|patch)$/i.test(file) && !['LICENSE'].includes(file)) {
    continue
  }
  const text = await readFile(resolve(root, file), 'utf8')
  if (/C:\\Users\\Hinne|Hinne\\AppData|Documents\\My Games\\Grim Dawn/i.test(text)) {
    throw new Error(`Personal machine path is tracked in ${file}.`)
  }
  if (/github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    throw new Error(`Possible credential or private key is tracked in ${file}.`)
  }
}

for (const required of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'native/patches/iagd-cairn.patch']) {
  if (!files.includes(required)) throw new Error(`Required release/provenance file is not tracked: ${required}`)
}

console.log(`Repository audit passed: ${files.length} tracked files; native fingerprints verified.`)
