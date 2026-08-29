import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'

const helper = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(
      'src',
      'helper',
      'CairnCodex.GrimDawn',
      'bin',
      'Debug',
      'net10.0-windows',
      'CairnCodex.GrimDawn.exe'
    )
const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
const lines = createInterface({ input: child.stdout })
const pending = new Map()
let nextId = 1

function request(method) {
  const id = String(nextId++)
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Helper timed out while handling ${method}.`))
    }, 30_000)
    pending.set(id, { method, resolvePromise, reject, timeout })
    child.stdin.write(`${JSON.stringify({ id, method, params: {} })}\n`)
  })
}

lines.on('line', (line) => {
  const response = JSON.parse(line)
  const operation = pending.get(response.id)
  if (!operation) return
  clearTimeout(operation.timeout)
  pending.delete(response.id)
  if (response.error) {
    operation.reject(new Error(`${operation.method}: ${response.error.code}: ${response.error.message}`))
  } else {
    operation.resolvePromise(response.result)
  }
})

try {
  const health = await request('health')
  if (health.protocolVersion !== 1) throw new Error('Unexpected helper protocol version.')

  const write = await request('self-test-write-transaction')
  if (!write.passed) throw new Error('Verified write transaction self-test failed.')

  const live = await request('self-test-live-queue')
  if (!live.passed || live.fields !== 18) throw new Error('Live queue self-test failed.')
  if (!/^[0-9a-f]{64}$/.test(live.hookSha256) || !/^[0-9a-f]{64}$/.test(live.injectorSha256)) {
    throw new Error('Native adapter fingerprints were not reported correctly.')
  }

  console.log(JSON.stringify({ health, write, live }, null, 2))
} finally {
  child.stdin.end()
  lines.close()
}
