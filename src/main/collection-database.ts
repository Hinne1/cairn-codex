import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import type { CollectionItem, CollectionSnapshot, VaultListItem } from '@shared/contracts'

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
    snapshot = this.withInstanceKeys(snapshot)
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

  prepareIngestOperation(input: PreparedIngestOperation): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database
        .prepare(`
          INSERT INTO operation_journal (
            id, operation, state, vault_item_id, stash_path, source_sha256,
            backup_path, started_at_utc, completed_at_utc, detail_json
          ) VALUES (?, 'ingest', 'prepared', NULL, ?, ?, NULL, ?, NULL, ?)
        `)
        .run(
          input.operationId,
          input.stashPath,
          input.sourceSha256,
          input.startedAtUtc,
          JSON.stringify(input.detail)
        )
      const statement = this.database.prepare(`
        INSERT INTO pending_ingest_item (
          operation_id, vault_item_id, ordinal, base_record, payload_json
        ) VALUES (?, ?, ?, ?, ?)
      `)
      input.items.forEach((item, ordinal) => {
        statement.run(
          input.operationId,
          item.vaultItemId,
          ordinal,
          item.baseRecord,
          JSON.stringify(item.payload)
        )
      })
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  completeIngestOperation(input: CompletedIngestOperation): string[] {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const pending = this.database
        .prepare(`
          SELECT vault_item_id, base_record, payload_json
          FROM pending_ingest_item
          WHERE operation_id = ?
          ORDER BY ordinal
        `)
        .all(input.operationId) as Array<{
        vault_item_id: string
        base_record: string
        payload_json: string
      }>
      if (pending.length === 0) {
        throw new Error('Prepared ingest operation has no persisted item payloads.')
      }

      const insertVault = this.database.prepare(`
        INSERT INTO vault_item (
          id, base_record, state, serialized_item, ingested_at_utc, retrieved_at_utc
        ) VALUES (?, ?, 'ingested', ?, ?, NULL)
      `)
      for (const item of pending) {
        insertVault.run(
          item.vault_item_id,
          item.base_record,
          Buffer.from(item.payload_json, 'utf8'),
          input.completedAtUtc
        )
      }
      this.database
        .prepare(`
          UPDATE operation_journal
          SET state = 'committed', backup_path = ?, completed_at_utc = ?, detail_json = ?
          WHERE id = ? AND state = 'prepared'
        `)
        .run(
          input.backupPath,
          input.completedAtUtc,
          JSON.stringify(input.detail),
          input.operationId
        )
      this.database
        .prepare('DELETE FROM pending_ingest_item WHERE operation_id = ?')
        .run(input.operationId)
      this.database.exec('COMMIT')
      return pending.map((item) => item.vault_item_id)
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  failIngestOperation(operationId: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    this.database
      .prepare(`
        UPDATE operation_journal
        SET state = 'failed', completed_at_utc = ?, detail_json = ?
        WHERE id = ? AND state = 'prepared'
      `)
      .run(new Date().toISOString(), JSON.stringify({ error: detail }), operationId)
  }

  getVaultItems(vaultItemIds: string[]): VaultItem[] {
    if (vaultItemIds.length === 0) {
      throw new Error('At least one vault item ID is required.')
    }
    if (new Set(vaultItemIds).size !== vaultItemIds.length) {
      throw new Error('Duplicate vault item IDs are not allowed.')
    }

    const placeholders = vaultItemIds.map(() => '?').join(', ')
    const rows = this.database
      .prepare(`
        SELECT id, base_record, state, serialized_item
        FROM vault_item
        WHERE id IN (${placeholders})
      `)
      .all(...vaultItemIds) as Array<{
      id: string
      base_record: string
      state: VaultItemState
      serialized_item: Uint8Array
    }>
    const byId = new Map(rows.map((row) => [row.id, row]))
    return vaultItemIds.map((id) => {
      const row = byId.get(id)
      if (!row) {
        throw new Error('Vault item does not exist: ' + id)
      }
      return {
        id: row.id,
        baseRecord: row.base_record,
        state: row.state,
        payload: JSON.parse(Buffer.from(row.serialized_item).toString('utf8')) as unknown
      }
    })
  }

  listVaultItems(): VaultListItem[] {
    const rows = this.database
      .prepare(`
        SELECT
          vault_item.id,
          vault_item.base_record,
          vault_item.state,
          vault_item.serialized_item,
          vault_item.ingested_at_utc,
          vault_item.retrieved_at_utc,
          catalog_item.name,
          catalog_item.rarity
        FROM vault_item
        JOIN catalog_item ON catalog_item.record = vault_item.base_record
        ORDER BY vault_item.ingested_at_utc DESC, vault_item.id
      `)
      .all() as Array<{
      id: string
      base_record: string
      state: VaultItemState
      serialized_item: Uint8Array
      ingested_at_utc: string
      retrieved_at_utc: string | null
      name: string
      rarity: 'epic' | 'legendary'
    }>

    return rows.map((row) => {
      const payload = JSON.parse(Buffer.from(row.serialized_item).toString('utf8')) as {
        seed?: number
      }
      return {
        id: row.id,
        baseRecord: row.base_record,
        name: row.name,
        rarity: row.rarity,
        state: row.state,
        seed: payload.seed ?? 0,
        ingestedAtUtc: row.ingested_at_utc,
        retrievedAtUtc: row.retrieved_at_utc
      }
    })
  }

  getCatalogNames(records: string[]): Map<string, string> {
    const uniqueRecords = [...new Set(records)]
    if (uniqueRecords.length === 0) return new Map()
    const placeholders = uniqueRecords.map(() => '?').join(', ')
    const rows = this.database
      .prepare(`SELECT record, name FROM catalog_item WHERE record IN (${placeholders})`)
      .all(...uniqueRecords) as Array<{ record: string; name: string }>
    return new Map(rows.map((row) => [row.record.toLowerCase(), row.name]))
  }

  prepareRetrievalOperation(input: PreparedRetrievalOperation): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database
        .prepare(`
          INSERT INTO operation_journal (
            id, operation, state, vault_item_id, stash_path, source_sha256,
            backup_path, started_at_utc, completed_at_utc, detail_json
          ) VALUES (?, 'retrieve', 'prepared', NULL, ?, ?, NULL, ?, NULL, ?)
        `)
        .run(
          input.operationId,
          input.stashPath,
          input.sourceSha256,
          input.startedAtUtc,
          JSON.stringify(input.detail)
        )
      const update = this.database.prepare(`
        UPDATE vault_item
        SET state = 'retrieval_pending'
        WHERE id = ? AND state = 'ingested'
      `)
      for (const vaultItemId of input.vaultItemIds) {
        if (Number(update.run(vaultItemId).changes) !== 1) {
          throw new Error('Vault item is not available for retrieval: ' + vaultItemId)
        }
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  completeRetrievalOperation(input: CompletedRetrievalOperation): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const update = this.database.prepare(`
        UPDATE vault_item
        SET state = 'retrieved', retrieved_at_utc = ?
        WHERE id = ? AND state = 'retrieval_pending'
      `)
      for (const vaultItemId of input.vaultItemIds) {
        if (Number(update.run(input.completedAtUtc, vaultItemId).changes) !== 1) {
          throw new Error('Vault item is not pending retrieval: ' + vaultItemId)
        }
      }
      const journal = this.database
        .prepare(`
          UPDATE operation_journal
          SET state = 'committed', backup_path = ?, completed_at_utc = ?, detail_json = ?
          WHERE id = ? AND operation = 'retrieve' AND state = 'prepared'
        `)
        .run(
          input.backupPath,
          input.completedAtUtc,
          JSON.stringify(input.detail),
          input.operationId
        )
      if (Number(journal.changes) !== 1) {
        throw new Error('Prepared retrieval journal entry is missing.')
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  failRetrievalOperation(operationId: string, vaultItemIds: string[], error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const reset = this.database.prepare(`
        UPDATE vault_item SET state = 'ingested'
        WHERE id = ? AND state = 'retrieval_pending'
      `)
      for (const vaultItemId of vaultItemIds) {
        reset.run(vaultItemId)
      }
      this.database
        .prepare(`
          UPDATE operation_journal
          SET state = 'failed', completed_at_utc = ?, detail_json = ?
          WHERE id = ? AND operation = 'retrieve' AND state = 'prepared'
        `)
        .run(new Date().toISOString(), JSON.stringify({ error: detail }), operationId)
      this.database.exec('COMMIT')
    } catch (failure) {
      this.database.exec('ROLLBACK')
      throw failure
    }
  }

  markRetrievalNeedsRecovery(operationId: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    const row = this.database
      .prepare('SELECT detail_json FROM operation_journal WHERE id = ?')
      .get(operationId) as { detail_json: string } | undefined
    const previous = row ? (JSON.parse(row.detail_json) as Record<string, unknown>) : {}
    this.database
      .prepare(`
        UPDATE operation_journal
        SET state = 'needs_recovery', detail_json = ?
        WHERE id = ? AND operation = 'retrieve' AND state = 'prepared'
      `)
      .run(
        JSON.stringify({ ...previous, error: detail, phase: 'commit_outcome_unknown' }),
        operationId
      )
  }

  setPinnedBest(record: string, instanceKey: string | null): void {
    if (instanceKey === null) {
      this.database.prepare('DELETE FROM pinned_best WHERE record = ?').run(record)
      return
    }
    this.database
      .prepare(`
        INSERT INTO pinned_best (record, instance_key, pinned_at_utc)
        VALUES (?, ?, ?)
        ON CONFLICT(record) DO UPDATE SET
          instance_key = excluded.instance_key,
          pinned_at_utc = excluded.pinned_at_utc
      `)
      .run(record, instanceKey, new Date().toISOString())
  }

  close(): void {
    this.database.close()
  }

  private migrate(): void {
    let version = (this.database.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version
    if (version > 4) {
      throw new Error(
        'Collection database version ' + version + ' is newer than this app supports.'
      )
    }
    if (version === 0) {
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
      version = 1
    }

    if (version === 1) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE pending_ingest_item (
          operation_id TEXT NOT NULL REFERENCES operation_journal(id) ON DELETE RESTRICT,
          vault_item_id TEXT NOT NULL UNIQUE,
          ordinal INTEGER NOT NULL,
          base_record TEXT NOT NULL REFERENCES catalog_item(record) ON DELETE RESTRICT,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (operation_id, ordinal)
        ) STRICT;
        PRAGMA user_version = 2;
        COMMIT;
      `)
      version = 2
    }

    if (version === 2) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE observed_item ADD COLUMN roll_json TEXT;
        PRAGMA user_version = 3;
        COMMIT;
      `)
      version = 3
    }

    if (version === 3) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE observed_item ADD COLUMN instance_key TEXT;
        CREATE INDEX observed_item_instance_key_idx ON observed_item(base_record, instance_key);
        CREATE TABLE pinned_best (
          record TEXT PRIMARY KEY REFERENCES catalog_item(record) ON DELETE CASCADE,
          instance_key TEXT NOT NULL,
          pinned_at_utc TEXT NOT NULL
        ) STRICT;
        PRAGMA user_version = 4;
        COMMIT;
      `)
    }
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
        enchantment_seed, materia_combines, stack_count, rerolls, affix_rerolls, roll_json,
        instance_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        item.affixRerolls,
        item.rollAnalysis === null ? null : JSON.stringify(item.rollAnalysis),
        item.instanceKey ?? null
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
    const pinned = new Map(
      (this.database.prepare('SELECT record, instance_key FROM pinned_best').all() as Array<{
        record: string
        instance_key: string
      }>).map((row) => [row.record.toLowerCase(), row.instance_key])
    )
    const items = snapshot.items.map((item) => ({
      ...item,
      discovered: discovered.has(item.record.toLowerCase()),
      firstDiscoveredAt: discovered.get(item.record.toLowerCase()) ?? null,
      pinnedInstanceKey: pinned.get(item.record.toLowerCase()) ?? null
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

  private withInstanceKeys(snapshot: CollectionSnapshot): CollectionSnapshot {
    return {
      ...snapshot,
      observedItems: snapshot.observedItems.map((item) => ({
        ...item,
        instanceKey: createHash('sha256')
          .update(
            JSON.stringify([
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
            ])
          )
          .digest('hex')
      }))
    }
  }
}

export interface PreparedIngestOperation {
  operationId: string
  stashPath: string
  sourceSha256: string
  startedAtUtc: string
  items: Array<{
    vaultItemId: string
    baseRecord: string
    payload: unknown
  }>
  detail: unknown
}

export interface CompletedIngestOperation {
  operationId: string
  backupPath: string
  completedAtUtc: string
  detail: unknown
}

export type VaultItemState = 'ingested' | 'retrieval_pending' | 'retrieved'

export interface VaultItem {
  id: string
  baseRecord: string
  state: VaultItemState
  payload: unknown
}

export interface PreparedRetrievalOperation {
  operationId: string
  stashPath: string
  sourceSha256: string
  startedAtUtc: string
  vaultItemIds: string[]
  detail: unknown
}

export interface CompletedRetrievalOperation {
  operationId: string
  backupPath: string
  completedAtUtc: string
  vaultItemIds: string[]
  detail: unknown
}
