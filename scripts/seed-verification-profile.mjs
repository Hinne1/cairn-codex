import { mkdir, readdir } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { createScreenshotCollectionFixture } from '../src/verification/fixtures.ts'
import { writeCollectionSnapshotCache } from '../src/main/collection-snapshot-cache.ts'

const requested = process.argv[2]
if (!requested) throw new Error('Pass a new isolated profile directory beneath local-cache.')
const root = resolve('local-cache')
const profile = resolve(requested)
const within = relative(root, profile)
if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('Verification profiles must be beneath local-cache.')
await mkdir(profile, { recursive: true })
const entries = await readdir(profile)
if (entries.some(name => name !== 'preserve-on-uninstall.txt')) throw new Error('Refusing to seed an existing application profile.')
await writeCollectionSnapshotCache(resolve(profile, 'collection-snapshot.json'), createScreenshotCollectionFixture('onboarding'))
console.log('Seeded a synthetic catalog in the isolated profile.')
