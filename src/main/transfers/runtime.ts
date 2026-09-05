import { randomInt, randomUUID } from 'node:crypto';
import type { GrimDawnHelperClient } from '../grim-dawn/helper-client.ts';

export type HelperRequester = Pick<GrimDawnHelperClient, 'request'>

export interface TransferClock {
  now(): number
  nowUtc(): string
  wait(milliseconds: number): Promise<void>
  operationId(): string
  seed(): number
}

export interface TransferPorts {
  helper: HelperRequester
  paths: { backups: string; receipts: string }
  clock: TransferClock
}

export const systemTransferClock: TransferClock = {
  now: () => Date.now(),
  nowUtc: () => new Date().toISOString(),
  wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  operationId: () => randomUUID(),
  seed: () => randomInt(1, 0xffff_ffff)
}

export function isHardcoreStashPath(path: string): boolean {
  return path.toLocaleLowerCase().endsWith('.gsh')
}
