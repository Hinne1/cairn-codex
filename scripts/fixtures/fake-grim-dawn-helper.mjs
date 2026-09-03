import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })
lines.on('line', async (line) => {
  const request = JSON.parse(line)
  const delayMs = Number(request.params?.delayMs ?? 0)
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
  process.stdout.write(`${JSON.stringify({
    id: request.id,
    result: { method: request.method, processId: process.pid }
  })}\n`)
})
