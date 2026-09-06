import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const ci = await readFile(new URL('.github/workflows/ci.yml', root), 'utf8')
const release = await readFile(new URL('.github/workflows/release.yml', root), 'utf8')
const securityCommands = [
  'npm ci --no-audit --fetch-retries=1 --fetch-timeout=15000',
  'npm run test:dependency-audit',
  'npm run test:dependency-audit:live',
  'npm run audit:dependencies',
  'npm run verify'
]

function assertBlockingAudit(workflow, isRelease = false) {
  // Deliberately constrain these two small workflows: required commands occupy
  // unconditional, single-command run steps, so shell/step guards cannot skip them.
  assert.doesNotMatch(workflow, /continue-on-error|^\s+if:|\|\|/m)
  const runs = [...workflow.matchAll(/^\s*(?:- )?run: ([^\r\n]+)\r?$/gm)].map((match) => match[1])
  let previous = -1
  for (const command of securityCommands) {
    assert.equal(runs.filter((run) => run === command).length, 1, `One blocking step required: ${command}`)
    const index = runs.indexOf(command)
    assert.ok(index > previous, `Security phase order changed: ${command}`)
    previous = index
  }
  if (isRelease) {
    assert.equal(runs.filter((run) => run === 'npm run package:release').length, 1)
    assert.ok(runs.indexOf('npm run package:release') > previous, 'Package only after verification and live audit')
    assert.ok(workflow.indexOf('gh release create') > workflow.indexOf('run: npm run package:release'))
    assert.match(workflow, /if \(\$env:GITHUB_REF_NAME -ne "v\$version"\)/)
    assert.match(workflow, /gh release create[^\r\n]*--prerelease/)
    assert.match(workflow, /^    timeout-minutes: 60\r?$/m, 'Allow the full verification and audited packaging to complete within a bounded release job')
  }
}

function assertBuildOnly(script) {
  const commands = script.split(/\r?\n/).filter((line) => /^\s*& npx\.cmd electron-builder\b/.test(line))
  assert.equal(commands.length, 1, 'Expect one explicit builder invocation per package entry')
  assert.match(commands[0], /--publish never\s*$/)
}

assertBlockingAudit(ci)
assertBlockingAudit(release, true)
for (const command of securityCommands) {
  assert.throws(() => assertBlockingAudit(release.replace(`run: ${command}\n`, 'run: echo skipped\n').replace(`run: ${command}\r\n`, 'run: echo skipped\r\n'), true))
}
assert.throws(() => assertBlockingAudit(release.replace('run: npm run audit:dependencies', 'if: false\n        run: npm run audit:dependencies'), true))
assert.throws(() => assertBlockingAudit(release.replace('run: npm run audit:dependencies', 'continue-on-error: true\n        run: npm run audit:dependencies'), true))
assert.throws(() => assertBlockingAudit(release.replace('run: npm run audit:dependencies', 'run: npm run audit:dependencies || true'), true))
assert.throws(() => assertBlockingAudit(release.replace('run: npm run audit:dependencies', 'run: __audit__').replace('run: npm run package:release', 'run: npm run audit:dependencies').replace('run: __audit__', 'run: npm run package:release'), true))
for (const path of ['scripts/package-release.ps1', 'scripts/package-installer.ps1']) {
  const script = await readFile(new URL(path, root), 'utf8')
  assertBuildOnly(script)
  assert.throws(() => assertBuildOnly(script.replace(' --publish never', '')))
  assert.throws(() => assertBuildOnly(script.replace('--publish never', '--publish onTag')))
}
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
assert.ok(manifest.scripts.preverify.split(' && ').includes('npm run test:release-policy'))
console.log('Release policy passed: both workflows block on live security controls; packaging cannot infer publication; unsafe workflow mutations are rejected.')
