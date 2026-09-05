import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { releaseVerificationBoundary } from './scripts/release-entry-boundary.mjs'

export default defineConfig(({ mode }) => {
  const verification = mode === 'verification'
  const outputRoot = verification ? 'local-cache/verification-build' : 'out'
  return {
    main: {
      plugins: [externalizeDepsPlugin(), ...(!verification ? [releaseVerificationBoundary()] : [])],
      build: {
        outDir: `${outputRoot}/main`,
        rollupOptions: { input: resolve(verification ? 'src/verification/index.ts' : 'src/main/index.ts') }
      },
      resolve: {
        alias: {
          '@shared': resolve('src/shared')
        }
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin(), ...(!verification ? [releaseVerificationBoundary()] : [])],
      build: {
        outDir: `${outputRoot}/preload`,
        rollupOptions: {
          output: {
            format: 'cjs'
          }
        }
      },
      resolve: {
        alias: {
          '@shared': resolve('src/shared')
        }
      }
    },
    renderer: {
      build: { outDir: `${outputRoot}/renderer` },
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      plugins: [vue(), ...(!verification ? [releaseVerificationBoundary()] : [])]
    }
  }
})
