import type { Plugin } from 'vite'
export function releaseVerificationBoundary(): Plugin
export function assertReleaseEntry(path: string, content: string): void
