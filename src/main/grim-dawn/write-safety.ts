export interface WriteSafetyContext {
  targetPath: string
  operation: 'ingest' | 'retrieve'
}

export type WriteSafetyDecision =
  | {
      allowed: true
      gate: string
      evidence: Readonly<Record<string, string | boolean>>
      checkedAt: string
      expiresAt: string
    }
  | {
      allowed: false
      gate: string
      reason: string
      checkedAt: string
    }

export interface WriteSafetyGate {
  readonly id: string
  evaluate(context: WriteSafetyContext): Promise<WriteSafetyDecision>
}

export class DenyAllWriteSafetyGate implements WriteSafetyGate {
  readonly id = 'deny-all'

  async evaluate(_context: WriteSafetyContext): Promise<WriteSafetyDecision> {
    return {
      allowed: false,
      gate: this.id,
      reason: 'Write support has not been configured.',
      checkedAt: new Date().toISOString()
    }
  }
}
