import { DatabaseSync } from 'node:sqlite'
import type { CollectionItem, CollectionSnapshot } from '@shared/contracts'

export class CollectionDatabase {
  private readonly database: DatabaseSync

  constructor(path: string) {
    this.database = new DatabaseSync(path)
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec('PRAGMA synchronous = FULL')
    if (path !== ':memory:') {
      this.database.exec('PRAGMA journal_mode = WAL')
    }
    this.migrate()
  }

  persistSnapshot(snapshot: CollectionSnapshot): CollectionSnapshot {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const scanResult = this.database
        .prepare(
          `INSERT INTO scan_run (scanned_at_utc, warning_count, source_count)
           VALUES (?, ?, ?)`
        )
        .run(snapshot.scannedAtUtc, snapshot.warnings.length, snapshot.scannedStashes.length)
      const scanId = Number(scanResult.lastInsertRowid)

      this.persistCatalog(snapshot.items)
      this.persistStashSnapshots(scanId, snapshot)
      this.persistDiscoveries(snapshot)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }

    return this.withLifetimeState(snapshot)
  }

  close(): void {
    this.database.close()
  }

  private migrate(): void {
    const version = this.database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version.user_version > 1) {
      throw new Error(
        'Collection database version ' + version.user_version + ' is newer than this app supports.'
      )
    }
    if (version.user_version === 1) return

    this.database.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE catalog_item (
        record TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        rarity TEXT NOT NULL CHECK (rarity IN ('epic', 'legendary')),
        item_class TEXT NOT NULL,
        slot TEXT NOT NULL,
        level_requirement INTEGER NOT NULL,
        item_level INTEGER NOT NULL,
        set_name TEXT,
        set_record TEXT,
        bitmap TEXT,
        content_pack TEXT NOT NULL,
        updated_at_utc TEXT NOT NULL
      ) STRICT;

      CREATE TABLE collection_entry (
        record TEXT PRIMARY KEY REFERENCES catalog_item(record) ON DELETE RESTRICT,
        first_discovered_at_utc TEXT NOT NULL,
        last_discovered_at_utc TEXT NOT NULL
      ) STRICT;

      CREATE TABLE scan_run (
        id INTEGER PRIMARY KEY,
        scanned_at_utc TEXT NOT NULL,
        warning_count INTEGER NOT NULL,
        source_count INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE stash_snapshot (
        id INTEGER PRIMARY KEY,
        scan_run_id INTEGER NOT NULL REFERENCES scan_run(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        is_hardcore INTEGER NOT NULL CHECK (is_hardcore IN (0, 1)),
        mod_label TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        last_write_utc TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        UNIQUE (scan_run_id, path)
      ) STRICT;

      CREATE TABLE observed_item (
        id INTEGER PRIMARY KEY,
        stash_snapshot_id INTEGER NOT NULL REFERENCES stash_snapshot(id) ON DELETE CASCADE,
        tab_index INTEGER NOT NULL,
        item_index INTEGER NOT NULL,
        base_record TEXT NOT NULL,
        prefix_record TEXT NOT NULL,
        suffix_record TEXT NOT NULL,
        modifier_record TEXT NOT NULL,
        transmute_record TEXT NOT NULL,
        seed INTEGER NOT NULL,
        materia_record TEXT NOT NULL,
        relic_completion_bonus_record TEXT NOT NULL,
        relic_seed INTEGER NOT NULL,
        enchantment_record TEXT NOT NULL,
        ascendant_record TEXT NOT NULL,
        ascendant_record_2h TEXT NOT NULL,
        enchantment_seed INTEGER NOT NULL,
        materia_combines INTEGER NOT NULL,
        stack_count INTEGER NOT NULL,
        rerolls INTEGER NOT NULL,
        affix_rerolls INTEGER NOT NULL,
        UNIQUE (stash_snapshot_id, tab_index, item_index)
      ) STRICT;

      CREATE TABLE vault_item (
        id TEXT PRIMARY KEY,
        base_record TEXT NOT NULL REFERENCES catalog_item(record) ON DELETE RESTRICT,
        state TEXT NOT NULL CHECK (state IN ('ingested', 'retrieval_pending', 'retrieved')),
        serialized_item BLOB NOT NULL,
        ingested_at_utc TEXT NOT NULL,
        retrieved_at_utc TEXT
      ) STRICT;

      CREATE TABLE operation_journal (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL CHECK (operation IN ('ingest', 'retrieve')),
        state TEXT NOT NULL,
        vault_item_id TEXT REFERENCES vault_item(id) ON DELETE RESTRICT,
        stash_path TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        backup_path TEXT,
        started_at_utc TEXT NOT NULL,
        completed_at_utc TEXT,
        detail_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX observed_item_base_record_idx ON observed_item(base_record);
      CREATE INDEX stash_snapshot_path_idx ON stash_snapshot(path, scan_run_id DESC);
      CREATE INDEX catalog_item_browse_idx ON catalog_item(rarity, slot, name);

      PRAGMA user_version = 1;
      COMMIT;
    `)
  }

  private persistCatalog(items: CollectionItem[]): void {
    const statement = this.database.prepare(`
      INSERT INTO catalog_item (
        record, name, rarity, item_class, slot, level_requirement, item_level,
        set_name, set_record, bitmap, content_pack, updated_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record) DO UPDATE SET
        name = excluded.name,
        rarity = excluded.rarity,
        item_class = excluded.item_class,
        slot = excluded.slot,
        level_requirement = excluded.level_requirement,
        item_level = excluded.item_level,
        set_name = excluded.set_name,
        set_record = excluded.set_record,
        bitmap = excluded.bitmap,
        content_pack = excluded.content_pack,
        updated_at_utc = excluded.updated_at_utc
    `)
    const now = new Date().toISOString()
    for (const item of items) {
      statement.run(
        item.record,
        item.name,
        item.rarity,
        item.itemClass,
        item.slot,
        item.levelRequirement,
        item.itemLevel,
        item.setName ?? null,
        item.setRecord ?? null,
        item.bitmap ?? null,
        item.contentPack,
        now
      )
    }
  }

  private persistStashSnapshots(scanId: number, snapshot: CollectionSnapshot): void {
    const snapshotStatement = this.database.prepare(`
      INSERT INTO stash_snapshot (
        scan_run_id, path, is_hardcore, mod_label, item_count, last_write_utc, sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const itemStatement = this.database.prepare(`
      INSERT INTO observed_item (
        stash_snapshot_id, tab_index, item_index, base_record, prefix_record, suffix_record,
        modifier_record, transmute_record, seed, materia_record, relic_completion_bonus_record,
        relic_seed, enchantment_record, ascendant_record, ascendant_record_2h,
        enchantment_seed, materia_combines, stack_count, rerolls, affix_rerolls
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const snapshotIds = new Map<string, number>()
    for (const source of snapshot.scannedStashes) {
      const result = snapshotStatement.run(
        scanId,
        source.path,
        source.isHardcore ? 1 : 0,
        source.modLabel,
        source.itemCount,
        source.lastWriteUtc,
        source.sha256
      )
      snapshotIds.set(source.path.toLowerCase(), Number(result.lastInsertRowid))
    }

    for (const item of snapshot.observedItems) {
      const snapshotId = snapshotIds.get(item.sourcePath.toLowerCase())
      if (snapshotId === undefined) {
        throw new Error('Observed item references an unknown stash: ' + item.sourcePath)
      }
      itemStatement.run(
        snapshotId,
        item.tabIndex,
        item.itemIndex,
        item.baseRecord,
        item.prefixRecord,
        item.suffixRecord,
        item.modifierRecord,
        item.transmuteRecord,
        item.seed,
        item.materiaRecord,
        item.relicCompletionBonusRecord,
        item.relicSeed,
        item.enchantmentRecord,
        item.ascendantRecord,
        item.ascendantRecord2H,
        item.enchantmentSeed,
        item.materiaCombines,
        item.stackCount,
        item.rerolls,
        item.affixRerolls
      )
    }
  }

  private persistDiscoveries(snapshot: CollectionSnapshot): void {
    const statement = this.database.prepare(`
      INSERT INTO collection_entry (record, first_discovered_at_utc, last_discovered_at_utc)
      VALUES (?, ?, ?)
      ON CONFLICT(record) DO UPDATE SET last_discovered_at_utc = excluded.last_discovered_at_utc
    `)
    for (const item of snapshot.items) {
      if (item.availableCount > 0) {
        statement.run(item.record, snapshot.scannedAtUtc, snapshot.scannedAtUtc)
      }
    }
  }

  private withLifetimeState(snapshot: CollectionSnapshot): CollectionSnapshot {
    const rows = this.database
      .prepare('SELECT record, first_discovered_at_utc FROM collection_entry')
      .all() as Array<{ record: string; first_discovered_at_utc: string }>
    const discovered = new Map(
      rows.map((row) => [row.record.toLowerCase(), row.first_discovered_at_utc])
    )
    const items = snapshot.items.map((item) => ({
      ...item,
      discovered: discovered.has(item.record.toLowerCase()),
      firstDiscoveredAt: discovered.get(item.record.toLowerCase()) ?? null
    }))
    const rarities = (['epic', 'legendary'] as const).map((rarity) => {
      const matching = items.filter((item) => item.rarity === rarity)
      return {
        rarity,
        total: matching.length,
        collected: matching.filter((item) => item.discovered).length,
        availableCopies: matching.reduce((count, item) => count + item.availableCount, 0)
      }
    })

    return { ...snapshot, items, rarities }
  }
}
