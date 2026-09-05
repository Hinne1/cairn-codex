import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CollectionDatabase } from '../main/collection-database.ts'
import type { CollectionSnapshot } from '../shared/contracts.ts'

export function seedWorkspaceQueryArchive(profile: string, collection: CollectionSnapshot): void {
  const expected = resolve('local-cache/ui-benchmark/profile')
  if (resolve(profile).toLowerCase() !== expected.toLowerCase()) throw new Error('Workspace query fixtures require the disposable benchmark profile.')
  const path = join(expected, 'cairn-codex.sqlite3')
  if (existsSync(path)) {
    // The benchmark may restart its own profile after a Chromium sandbox launch failure.
    // Only a completed fixture transaction can authorize reuse; never overwrite a database.
    const existing = new DatabaseSync(path, { readOnly: true })
    try {
      const marker = existing.prepare('SELECT name FROM verification_fixture').get() as { name: string } | undefined
      if (marker?.name !== 'workspace-queries-v1') throw new Error('Workspace query fixtures cannot reuse an unrecognized archive.')
    } finally { existing.close() }
    return
  }
  const database = new CollectionDatabase(path)
  try { database.persistSnapshot(collection) } finally { database.close() }
  const raw = new DatabaseSync(path)
  try {
    const insert = raw.prepare(`INSERT INTO vault_item (id, base_record, state, serialized_item,
      ingested_at_utc, is_hardcore, reusable, roll_json) VALUES (?, ?, 'ingested', ?, ?, ?, ?, ?)`)
    raw.exec('BEGIN')
    for (let index = 0; index < 20_000; index++) {
      const record = collection.items[index % collection.items.length]!.record
      insert.run(`gear-${index}`, record, Buffer.from(JSON.stringify({ baseRecord: record,
        seed: index, stackCount: 1, prefixRecord: 'synthetic', suffixRecord: '',
        materiaRecord: index % 11 === 0 ? 'synthetic-component' : '', enchantmentRecord: '' })),
      new Date(1700000000000 + index).toISOString(), Number(index >= 10_000), 0,
      JSON.stringify({ overallEstimatedPercentile: index % 101 }))
    }
    for (const [slot, count] of [['writ', 3], ['potion', 140], ['rune', 2]] as const) {
      const record = `records/synthetic/query_${slot}.dbr`
      for (let index = 0; index < count; index++) insert.run(`${slot}-${index}`, record,
        Buffer.from(JSON.stringify({ baseRecord: record, seed: index, stackCount: 1 })),
        new Date(1700000100000 + index).toISOString(), Number(slot !== 'potion' && index === count - 1),
        Number(slot !== 'potion'), null)
    }
    raw.exec("CREATE TABLE verification_fixture(name TEXT PRIMARY KEY); INSERT INTO verification_fixture VALUES ('workspace-queries-v1'); COMMIT; PRAGMA wal_checkpoint(TRUNCATE)")
  } finally { raw.close() }
}
