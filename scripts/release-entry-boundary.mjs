export function releaseVerificationBoundary() {
  return {
    name: 'release-verification-boundary',
    generateBundle() {
      for (const id of this.getModuleIds()) {
        if (id.replaceAll('\\', '/').includes('/src/verification/')) {
          this.error(`Verification module entered the release build: ${id}`)
        }
      }
    }
  }
}

export function assertReleaseEntry(path, content) {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  if (/(^|\/)(verification|verification-build)(\/|$)/.test(normalized)) {
    throw new Error(`Verification output entered the release artifact: ${path}`)
  }
  if (!/\.(js|cjs|mjs|map)$/.test(normalized)) return
  for (const marker of ['createScreenshotCollectionFixture', 'CAIRN_CODEX_SCREENSHOT_VERIFY_',
    'CAIRN_CODEX_SMOKE_TEST', 'Synthetic QA', 'Back did not restore the MI item drawer route',
    'Missing glossary test control']) {
    if (content.includes(marker)) throw new Error(`Verification body entered the release artifact ${path}: ${marker}`)
  }
}
