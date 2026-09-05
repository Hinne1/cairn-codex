import { createInterface } from 'node:readline'
import { appendFile } from 'node:fs/promises'

const lines = createInterface({ input: process.stdin })
let queue = Promise.resolve()
let healthCalls = 0
let writeCount = 0
// Match the production helper's serial request loop.
lines.on('line', line => { queue = queue.then(() => handle(line)) })
async function handle(line) {
  const request = JSON.parse(line)
  if (request.method === 'health') {
    healthCalls++
    if (process.argv[2] === 'exit-health') process.exit(7)
    process.stdout.write(JSON.stringify({ id: request.id, result: {
      service: 'CairnCodex.GrimDawn', protocolVersion: process.argv[2] === 'bad-version' ? 99 : 1,
      capabilities: process.argv[2] === 'bad-capabilities' ? [] : ['json-line-v1', 'live-lane-v1', 'worker-lane-v1'],
      processId: process.pid, healthCalls
    }, error: null }) + '\n')
    return
  }
  const delayMs = Number(request.params?.delayMs ?? 0)
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
  if (request.params?.recordPath) {
    writeCount++
    await appendFile(request.params.recordPath, 'committed\n')
  }
  const behavior = request.params?.behavior
  if (behavior === 'exit') process.exit(7)
  if (behavior === 'no-response') return
  if (behavior === 'malformed') { process.stdout.write('not-json\n'); return }
  if (behavior === 'null') { process.stdout.write('null\n'); return }
  if (behavior === 'array') { process.stdout.write('[]\n'); return }
  if (behavior === 'missing') { process.stdout.write(JSON.stringify({ id: request.id }) + '\n'); return }
  if (behavior === 'both') { process.stdout.write(JSON.stringify({ id: request.id, result: {}, error: { code: 'bad', message: 'bad' } }) + '\n'); return }
  if (behavior === 'oversized') { process.stdout.write('x'.repeat(2048)); return }
  if (behavior === 'invalid-utf8') { process.stdout.write(Buffer.from([255, 10])); return }
  if (behavior === 'error') { process.stdout.write(JSON.stringify({ id: request.id, result: null, error: { code: 'source_changed', message: 'Synthetic source changed.' } }) + '\n'); return }
  if (behavior === 'unknown') process.stdout.write(JSON.stringify({ id: '999999', result: 'unrelated' }) + '\n')
  const response = `${JSON.stringify({
    id: request.id,
    result: { method: request.method, processId: process.pid, healthCalls, writeCount, text: 'Grün' }, error: null
  })}\n`
  if (behavior === 'fragmented') {
    for (const byte of Buffer.from(response)) process.stdout.write(Buffer.from([byte]))
  } else {
    process.stdout.write(response)
    if (behavior === 'duplicate') process.stdout.write(response)
  }
}
