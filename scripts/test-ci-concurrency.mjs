import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
// Keep this deliberately small: validate the supported two-expression contract,
// not a home-grown general YAML or GitHub Actions expression interpreter.
const concurrency = workflow.match(/^concurrency:\r?\n((?:[ \t]+[^\n]*\r?\n)+)/m)?.[1]
assert.ok(concurrency, 'CI must declare workflow-level concurrency')
assert.match(concurrency, /^  cancel-in-progress: true\r?$/m)
const group = concurrency.match(/^  group: (.+?)\r?$/m)?.[1]
assert.equal(group, '${{ github.workflow }}-${{ github.ref }}', 'Scope cancellation to the workflow and full ref, never a SHA/run ID or bare branch name')
assert.match(workflow, /^on:\r?\n  push:\r?\n  pull_request:/m, 'Preserve both existing trigger types')

function key(context) {
  return group.replace(/\$\{\{ github\.(workflow|ref) \}\}/g, (_, field) => context[field]).toLowerCase()
}
const push = { workflow: 'CI', ref: 'refs/heads/topic', sha: 'first', run_id: 1 }
const pr = { ...push, ref: 'refs/pull/150/merge' }
for (const context of [push, pr, { ...push, ref: 'refs/heads/main' }]) {
  assert.equal(key(context), key({ ...context, sha: 'next', run_id: 2 }), 'New commits must supersede earlier runs')
}
const independent = [
  push, pr,
  { ...pr, ref: 'refs/pull/151/merge' }, // Includes forks sharing a source branch name.
  { ...push, ref: 'refs/heads/other' },
  { ...push, ref: 'refs/heads/main' },
  { ...push, ref: 'refs/tags/topic' },
  { ...push, workflow: 'Release' }
]
assert.equal(new Set(independent.map(key)).size, independent.length, 'Unrelated PRs, refs, workflows and push/PR runs must not cancel each other')
assert.ok(!key(push).includes('${{'), 'All group expressions must resolve')
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(manifest.scripts['test:ci-concurrency'], 'node ./scripts/test-ci-concurrency.mjs')
assert.ok(manifest.scripts.preverify.split(' && ').includes('npm run test:ci-concurrency'), 'Full verification must run the concurrency regression gate')
console.log('CI concurrency contract passed: superseded commits share a group; PRs, branches, tags, workflows and trigger types remain isolated.')
