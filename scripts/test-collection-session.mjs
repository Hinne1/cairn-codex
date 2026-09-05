import assert from 'node:assert/strict'
import { CollectionSession } from '../src/renderer/src/collection-session.ts'
import { collectionRequestKey } from '../src/shared/collection-request.ts'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture() {
  let context = { basis: 'archive', sourcePaths: ['C:/fixtures/transfer.gst'] }
  let visible = null
  let pending = {}
  const errors = []
  const reloads = []
  const session = new CollectionSession({
    context: () => context,
    install: snapshot => { visible = snapshot },
    pendingChanged: value => { pending = value },
    reportError: (error, kind) => errors.push({ error, kind }),
    reload: () => reloads.push(true)
  })
  return {
    session, errors, reloads,
    select: value => { context = value; session.contextChanged() },
    read: (kind, response) => session.run(kind, async read => read.install(await response.promise)),
    get visible() { return visible },
    get pending() { return pending }
  }
}
const sc = { basis: 'archive', sourcePaths: ['C:/fixtures/transfer.gst'] }
const hc = { basis: 'archive', sourcePaths: ['C:/fixtures/transfer.gsh'] }
const stashes = { basis: 'stashes', sourcePaths: ['C:/fixtures/transfer.gst'] }
{
  const state = fixture(), initial = deferred(), stale = deferred(), recovery = deferred(), final = deferred()
  const installed = state.read('cache', initial)
  initial.resolve({ name: 'before recovery' }); await installed
  const oldRead = state.read('hydration', stale)
  state.session.invalidate()
  const recoveryRead = state.read('cache', recovery)
  // A regular ingest finishes while recovery's authoritative reload is pending.
  state.session.commit({ name: 'delta based on stale archive' })
  assert.equal(state.visible.name, 'before recovery', 'do not install a delta on an invalidated projection')
  assert.equal(state.reloads.length, 2)
  const finalRead = state.read('cache', final)
  final.resolve({ name: 'recovered plus regular ingest' }); await finalRead
  stale.resolve({ name: 'stale hydration' }); await oldRead
  recovery.resolve({ name: 'recovered only' }); await recoveryRead
  assert.equal(state.visible.name, 'recovered plus regular ingest')
  state.session.dispose()
  state.session.invalidate()
  assert.equal(state.reloads.length, 2, 'disposed sessions do not reload')
}
assert.equal(collectionRequestKey(sc), collectionRequestKey({ basis: 'archive', sourcePaths: ['c:\\fixtures\\TRANSFER.gst', 'C:/fixtures/transfer.gst'] }))
assert.notEqual(collectionRequestKey(sc), collectionRequestKey(hc))
assert.notEqual(collectionRequestKey(sc), collectionRequestKey(stashes))

for (const kind of ['cache', 'scan', 'rebuild', 'hydration']) {
  const state = fixture()
  const older = deferred(), newer = deferred()
  const first = state.read(kind, older)
  state.select(hc)
  const second = state.read('cache', newer)
  newer.resolve({ name: 'HC selection' })
  await second
  assert.equal(state.pending[kind], 1, 'older work still owns its busy count')
  older.resolve({ name: 'old SC response' })
  assert.equal(await first, false)
  assert.equal(state.visible.name, 'HC selection')
  assert.equal(Object.values(state.pending).reduce((a, b) => a + b, 0), 0)
}

// Same-context requests completing backwards and a rapid A -> B -> A are distinct.
for (const changeSelection of [false, true]) {
  const state = fixture()
  const older = deferred(), newer = deferred()
  const first = state.read('cache', older)
  if (changeSelection) { state.select(hc); state.select(sc) }
  const second = state.read('cache', newer)
  newer.resolve({ name: 'new A' }); await second
  older.resolve({ name: 'old A' }); await first
  assert.equal(state.visible.name, 'new A')
}
{
  const state = fixture(), older = deferred()
  const first = state.read('cache', older)
  state.select(stashes); state.select(sc)
  older.resolve({ name: 'A before context round trip' })
  assert.equal(await first, false, 'A -> B -> A invalidates even without starting another read')
  assert.equal(state.visible, null)
}
{
  const state = fixture(), older = deferred(), newer = deferred()
  const first = state.read('scan', older)
  const second = state.read('cache', newer)
  newer.resolve({ name: 'new success' }); await second
  older.reject(new Error('stale failure')); await first
  assert.equal(state.errors.length, 0)
  const currentFailure = deferred()
  const current = state.read('rebuild', currentFailure)
  currentFailure.reject(new Error('current failure')); await current
  assert.equal(state.errors[0].kind, 'rebuild')
}

// A receipt-backed live/archive update wins over every older snapshot read.
for (const kind of ['cache', 'scan', 'rebuild', 'hydration']) {
  const state = fixture(), delayed = deferred()
  await state.session.run('cache', async read => read.install({ name: 'initial SC' }))
  const request = state.read(kind, delayed)
  state.session.commit({ name: 'committed item update' })
  delayed.resolve({ name: 'before item update' }); await request
  assert.equal(state.visible.name, 'committed item update')
}
for (const target of [hc, stashes]) {
  const state = fixture(), beforeCommit = deferred(), afterCommit = deferred()
  await state.session.run('cache', async read => read.install({ name: 'initial SC archive' }))
  state.select(target)
  const stale = state.read('cache', beforeCommit)
  state.session.commit({ name: 'old-context delta' })
  assert.equal(state.reloads.length, 1, 'a commit during selection change requests a fresh projection')
  const fresh = state.read('cache', afterCommit)
  afterCommit.resolve({ name: 'selected context after commit' }); await fresh
  beforeCommit.resolve({ name: 'selected context before commit' }); await stale
  assert.equal(state.visible.name, 'selected context after commit')
}
{
  let context = { basis: 'archive', sourcePaths: [] }
  const session = new CollectionSession({
    context: () => context,
    install: snapshot => {
      context = { ...context, sourcePaths: snapshot.scannedStashes.map(stash => stash.path) }
      session.contextChanged()
    },
    reportError: error => { throw error }, pendingChanged: () => {}, reload: () => {}
  })
  assert.equal(await session.run('cache', async read => {
    assert.equal(read.install({ scannedStashes: [{ path: sc.sourcePaths[0] }] }), true)
    assert.deepEqual(read.context.sourcePaths, sc.sourcePaths)
  }), true, 'installing default sources must remain current for hydration and vault refresh')
}
{
  const state = fixture(), delayed = deferred()
  const request = state.read('cache', delayed)
  state.session.dispose()
  delayed.resolve({ name: 'unmounted' }); await request
  assert.equal(state.visible, null)
}
console.log('Collection session gates passed: selection identity, reversed completions, stale errors, busy counts and committed updates.')
