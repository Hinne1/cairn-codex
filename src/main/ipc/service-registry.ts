import { encodeIpcErrorMessage } from '../../shared/ipc-error-transport.ts'
import {
  classifyIpcDomainError,
  type IpcErrorDomain
} from './domain-error-transport.ts'

export interface IpcEventLike {
  sender: {
    isDestroyed(): boolean
    send(channel: string, ...args: unknown[]): void
    setZoomFactor(factor: number): void
  }
}

export type IpcOperation = (event: IpcEventLike, ...args: unknown[]) => unknown

export interface IpcRegistrar {
  handle(channel: string, listener: IpcOperation): void
}

export type IpcInputValidator<T> = (input: unknown) => T

export function translateIpcServiceError(error: unknown, domain: IpcErrorDomain): Error {
  const classified = classifyIpcDomainError(domain, error)
  const translated = new Error(encodeIpcErrorMessage(classified))
  translated.stack = undefined
  return translated
}

/**
 * Owns one IPC domain. Electron handlers remain mechanical: validate the payload,
 * invoke exactly one injected service operation, and normalize the error crossing
 * the process boundary.
 */
export class IpcDomainService {
  readonly domain: IpcErrorDomain
  private readonly registrar: IpcRegistrar

  constructor(
    domain: IpcErrorDomain,
    registrar: IpcRegistrar
  ) {
    this.domain = domain
    this.registrar = registrar
  }

  handle<TInput>(
    channel: string,
    operation: (event: IpcEventLike, input: TInput) => unknown,
    validate: IpcInputValidator<TInput>
  ): void
  handle(
    channel: string,
    operation: (event: IpcEventLike) => unknown
  ): void
  handle<TInput>(
    channel: string,
    operation: (event: IpcEventLike, input?: TInput) => unknown,
    validate?: IpcInputValidator<TInput>
  ): void {
    this.registrar.handle(channel, async (event, rawInput) => {
      try {
        const input = validate ? validate(rawInput) : undefined
        return await operation(event, input)
      } catch (error) {
        throw translateIpcServiceError(error, this.domain)
      }
    })
  }
}

/** A rejection-safe serial boundary for persistence and native write workflows. */
export class SerializedServiceQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async flush(): Promise<void> {
    await this.tail
  }
}
