import type { CairnCodexApi } from '@shared/contracts'

declare global {
  interface Window {
    cairnCodex: CairnCodexApi
  }
}

export {}
