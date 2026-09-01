import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import type {
  CollectionItem,
  CollectionSnapshot,
  ItemRollAnalysis,
  ObservedStashItem,
  VaultItemPage,
  VaultListItem,
  VaultPageRequest,
  VaultSummary
} from '@shared/contracts'

const collectionRarities = ['epic', 'legendary', 'mi'] as const
export const CURRENT_COLLECTION_SCHEMA_VERSION = 11

export interface ValidatedCollectionDatabase {
  schemaVersion: number
  vaultItemCount: number
}

export function validateCollectionDatabase(path: string): ValidatedCollectionDatabase {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const integrity = database.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>
    const messages = integrity.flatMap((row) => Object.values(row).map(String))
    if (messages.length !== 1 || messages[0]?.toLowerCase() !== 'ok') {
      throw new Error(`SQLite quick_check failed: ${messages.join('; ') || 'unknown error'}`)
    }
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (Number(version.user_version) > CURRENT_COLLECTION_SCHEMA_VERSION) {
      throw new Error(
        `Archive schema ${version.user_version} is newer than this Cairn Codex build supports.`
      )
    }
    const tables = database.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'vault_item'
    `).get() as { count: number }
    if (Number(tables.count) !== 1) {
      throw new Error('The selected file is not a Cairn Codex archive database.')
    }
    const vault = database.prepare('SELECT COUNT(*) AS count FROM vault_item').get() as {
      count: number
    }
    return {
      schemaVersion: Number(version.user_version),
      vaultItemCount: Number(vault.count)
    }
  } finally {
    database.close()
  }
}

export function checkpointClosedCollectionDatabase(path: string): void {
  const database = new DatabaseSync(path)
  try {
    const rows = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all() as Array<{
      busy?: number
    }>
    if (rows.some((row) => Number(row.busy ?? 0) !== 0)) {
      throw new Error('The current archive could not be checkpointed before restore.')
    }
  } finally {
    database.close()
  }
}

function summarizeSupplies(supplies: CollectionItem[]): CollectionSnapshot['supplySummary'] {
  return {
    rarity: 'supply',
    total: supplies.length,
    collected: supplies.filter((item) => item.discovered).length,
    availableCopies: supplies.reduce((count, item) => count + item.availableCount, 0)
  }
}

function withAffixAvailability(
  snapshot: CollectionSnapshot,
  observedItems: ObservedStashItem[]
): CollectionSnapshot {
  const counts = new Map<string, number>()
  for (const item of observedItems) {
    for (const record of [item.prefixRecord, item.suffixRecord]) {
      if (!record) continue
      const key = record.toLocaleLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const affixes = snapshot.affixes.map((affix) => ({
    ...affix,
    availableCount: affix.records.reduce(
      (count, record) => count + (counts.get(record.toLocaleLowerCase()) ?? 0),
      0
    )
  }))
  return {
    ...snapshot,
    affixes,
    affixSummary: {
      total: affixes.length,
      collected: affixes.filter((affix) => affix.availableCount > 0).length,
      availableCopies: affixes.reduce((count, affix) => count + affix.availableCount, 0)
    }
  }
}

function vaultPayloadFingerprint(payload: unknown): string {
  const item = payload as Record<string, unknown>
  return createHash('sha256')
    .update(
      JSON.stringify([
        item.baseRecord ?? '',
        item.prefixRecord ?? '',
        item.suffixRecord ?? '',
        item.modifierRecord ?? '',
        item.transmuteRecord ?? '',
        Number(item.seed ?? 0) >>> 0,
        item.materiaRecord ?? '',
        item.relicCompletionBonusRecord ?? '',
        Number(item.relicSeed ?? 0) >>> 0,
        item.enchantmentRecord ?? '',
        item.ascendantRecord ?? '',
        item.ascendantRecord2H ?? '',
        Number(item.enchantmentSeed ?? 0) >>> 0,
        Number(item.materiaCombines ?? 0) >>> 0,
        Number(item.stackCount ?? 1) >>> 0,
        Number(item.rerolls ?? 0) >>> 0,
        Number(item.affixRerolls ?? 0) >>> 0
      ])
    )
    .digest('hex')
}

export class CollectionDatabase {
  private readonly database: DatabaseSync
  private readonly path: string

  constructor(path: string) {
    this.path = path
    this.database = new DatabaseSync(path)
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec('PRAGMA synchronous = FULL')
    if (path !== ':memory:') {
      this.database.exec('PRAGMA journal_mode = WAL')
      // Archive backups checkpoint explicitly before copying the stable main file.
      // Keeping automatic checkpoints disabled prevents later writes from changing
      // that file while the asynchronous copy is in progress; they remain in WAL.
      this.database.exec('PRAGMA wal_autocheckpoint = 0')
    }
    this.migrate()
  }

  checkpointForArchiveBackup(): void {
    if (this.path === ':memory:') {
      throw new Error('An in-memory collection database cannot be backed up.')
    }
    const rows = this.database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all() as Array<{
      busy?: number
    }>
    if (rows.some((row) => Number(row.busy ?? 0) !== 0)) {
      throw new Error('The archive database is busy and could not be checkpointed safely.')
    }
  }

  getDiagnosticSummary(): CollectionDatabaseDiagnosticSummary {
    const schema = this.database.prepare('PRAGMA user_version').get() as { user_version: number }
    const integrity = this.database.prepare('PRAGMA quick_check').all() as Array<Record<string, string>>
    const vaultStates = this.database.prepare(`
      SELECT state, COUNT(*) AS count
      FROM vault_item
      GROUP BY state
      ORDER BY state
    `).all() as Array<{ state: string; count: number }>
    const journalStates = this.database.prepare(`
      SELECT operation, state, COUNT(*) AS count
      FROM operation_journal
      GROUP BY operation, state
      ORDER BY operation, state
    `).all() as Array<{ operation: string; state: string; count: number }>
    const recoveryOperations = this.database.prepare(`
      SELECT id, operation, state, started_at_utc, completed_at_utc,
             CASE WHEN backup_path IS NULL OR backup_path = '' THEN 0 ELSE 1 END AS has_backup
      FROM operation_journal
      WHERE state NOT IN ('committed', 'failed')
      ORDER BY started_at_utc DESC
      LIMIT 50
    `).all() as Array<{
      id: string
      operation: string
      state: string
      started_at_utc: string
      completed_at_utc: string | null
      has_backup: number
    }>
    return {
      schemaVersion: Number(schema.user_version),
      quickCheck: integrity.flatMap((row) => Object.values(row)),
      vaultStates: vaultStates.map((row) => ({ state: row.state, count: Number(row.count) })),
      journalStates: journalStates.map((row) => ({
        operation: row.operation,
        state: row.state,
        count: Number(row.count)
      })),
      recoveryOperations: recoveryOperations.map((row) => ({
        id: row.id,
        operation: row.operation,
        state: row.state,
        startedAtUtc: row.started_at_utc,
        completedAtUtc: row.completed_at_utc,
        hasBackup: Boolean(row.has_backup)
      }))
    }
  }

  getRecoveryOperationCount(): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM operation_journal
      WHERE state NOT IN ('committed', 'failed')
    `).get() as { count: number }
    return Number(row.count)
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

      this.persistCatalog([...snapshot.items, ...(snapshot.supplies ?? [])])
      this.persistStashSnapshots(scanId, snapshot)
      this.persistDiscoveries(snapshot)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }

    return this.withLifetimeState(snapshot)
  }

  presentSnapshot(snapshot: CollectionSnapshot, isHardcore?: boolean): CollectionSnapshot {
    const presented = this.withLifetimeState(snapshot, isHardcore)
    return withAffixAvailability(presented, presented.observedItems)
  }

  presentArchiveSnapshot(
    snapshot: CollectionSnapshot,
    observedItems: ObservedStashItem[],
    isHardcore?: boolean
  ): CollectionSnapshot {
    const rows = this.database
      .prepare(`
        SELECT
          base_record,
          MIN(ingested_at_utc) AS first_ingested_at_utc,
          SUM(CASE WHEN state = 'ingested' THEN 1 ELSE 0 END) AS available_count
        FROM vault_item
        ${isHardcore === undefined ? '' : 'WHERE is_hardcore = ?'}
        GROUP BY base_record
      `)
      .all(...(isHardcore === undefined ? [] : [isHardcore ? 1 : 0])) as Array<{
      base_record: string
      first_ingested_at_utc: string
      available_count: number
    }>
    const archived = new Map(rows.map((row) => [row.base_record.toLowerCase(), row]))
    const copiesByRecord = new Map<string, ObservedStashItem[]>()
    for (const copy of observedItems) {
      const key = copy.baseRecord.toLowerCase()
      const copies = copiesByRecord.get(key)
      if (copies) copies.push(copy)
      else copiesByRecord.set(key, [copy])
    }
    const pinned = this.loadPinned(isHardcore)
    const items = snapshot.items.map((item) => {
      const row = archived.get(item.record.toLowerCase())
      const copies = copiesByRecord.get(item.record.toLowerCase()) ?? []
      const analyzed = copies.filter(
        (copy) =>
          copy.rollAnalysis?.trusted === true &&
          copy.rollAnalysis.overallEstimatedPercentile !== null
      )
      return {
        ...item,
        availableCount: copies.length,
        bestRollPercentile:
          analyzed.length === 0
            ? null
            : Math.max(
                ...analyzed.map((copy) => copy.rollAnalysis!.overallEstimatedPercentile!)
              ),
        analyzedCopyCount: analyzed.length,
        discovered: Boolean(row),
        firstDiscoveredAt: row?.first_ingested_at_utc ?? null,
        pinnedInstanceKey: pinned.get(item.record.toLowerCase()) ?? null
      }
    })
    const supplies = (snapshot.supplies ?? []).map((item) => {
      const row = archived.get(item.record.toLowerCase())
      return {
        ...item,
        availableCount: row?.available_count ?? 0,
        discovered: Boolean(row),
        firstDiscoveredAt: row?.first_ingested_at_utc ?? null
      }
    })
    const rarities = collectionRarities.map((rarity) => {
      const matching = items.filter((item) => item.rarity === rarity)
      return {
        rarity,
        total: matching.length,
        collected: matching.filter((item) => item.discovered).length,
        availableCopies: matching.reduce((count, item) => count + item.availableCount, 0)
      }
    })
    return withAffixAvailability(
      {
        ...snapshot,
        basis: 'archive',
        observedItems,
        items,
        supplies,
        supplySummary: summarizeSupplies(supplies),
        rarities
      },
      observedItems
    )
  }

  listAvailableArchiveItems(isHardcore?: boolean): ArchiveVaultItem[] {
    const rows = this.database
      .prepare(`
        SELECT vault_item.id, vault_item.base_record, vault_item.serialized_item, vault_item.roll_json
        FROM vault_item
        JOIN catalog_item ON catalog_item.record = vault_item.base_record
        WHERE state = 'ingested'
          AND catalog_item.content_pack != 'cairn-quarantine'
          AND catalog_item.rarity != 'supply'
          ${isHardcore === undefined ? '' : 'AND is_hardcore = ?'}
        ORDER BY ingested_at_utc DESC, id DESC
      `)
      .all(...(isHardcore === undefined ? [] : [isHardcore ? 1 : 0])) as Array<{
      id: string
      base_record: string
      serialized_item: Uint8Array
      roll_json: string | null
    }>
    return rows.map((row) => ({
      id: row.id,
      baseRecord: row.base_record,
      payload: JSON.parse(Buffer.from(row.serialized_item).toString('utf8')) as unknown,
      rollAnalysis: row.roll_json ? (JSON.parse(row.roll_json) as ItemRollAnalysis) : null
    }))
  }

  listArchiveRollAnalysisCandidates(
    modelVersion: number,
    limit: number,
    isHardcore?: boolean
  ): ArchiveRollAnalysisCandidate[] {
    const safeLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)))
    const rows = this.database
      .prepare(`
        SELECT vault_item.id, vault_item.base_record, vault_item.serialized_item
        FROM vault_item
        JOIN catalog_item ON catalog_item.record = vault_item.base_record
        WHERE state = 'ingested'
          AND catalog_item.content_pack != 'cairn-quarantine'
          AND catalog_item.rarity != 'supply'
          ${isHardcore === undefined ? '' : 'AND is_hardcore = ?'}
          AND CASE
            WHEN roll_json IS NULL OR json_valid(roll_json) = 0 THEN 1
            WHEN COALESCE(CAST(json_extract(roll_json, '$.modelVersion') AS INTEGER), -1) != ? THEN 1
            WHEN json_type(roll_json, '$.baseEstimatedPercentile') IS NULL THEN 1
            WHEN json_type(roll_json, '$.prefixEstimatedPercentile') IS NULL THEN 1
            WHEN json_type(roll_json, '$.suffixEstimatedPercentile') IS NULL THEN 1
            ELSE 0
          END = 1
        ORDER BY ingested_at_utc ASC, id ASC
        LIMIT ?
      `)
      .all(
        ...(isHardcore === undefined
          ? [modelVersion, safeLimit]
          : [isHardcore ? 1 : 0, modelVersion, safeLimit])
      ) as Array<{
      id: string
      base_record: string
      serialized_item: Uint8Array
    }>
    return rows.map((row) => ({
      id: row.id,
      baseRecord: row.base_record,
      payload: JSON.parse(Buffer.from(row.serialized_item).toString('utf8')) as unknown
    }))
  }

  countArchiveRollAnalysisCandidates(modelVersion: number, isHardcore?: boolean): number {
    const row = this.database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM vault_item
        JOIN catalog_item ON catalog_item.record = vault_item.base_record
        WHERE state = 'ingested'
          AND catalog_item.content_pack != 'cairn-quarantine'
          AND catalog_item.rarity != 'supply'
          ${isHardcore === undefined ? '' : 'AND is_hardcore = ?'}
          AND CASE
            WHEN roll_json IS NULL OR json_valid(roll_json) = 0 THEN 1
            WHEN COALESCE(CAST(json_extract(roll_json, '$.modelVersion') AS INTEGER), -1) != ? THEN 1
            WHEN json_type(roll_json, '$.baseEstimatedPercentile') IS NULL THEN 1
            WHEN json_type(roll_json, '$.prefixEstimatedPercentile') IS NULL THEN 1
            WHEN json_type(roll_json, '$.suffixEstimatedPercentile') IS NULL THEN 1
            ELSE 0
          END = 1
      `)
      .get(
        ...(isHardcore === undefined
          ? [modelVersion]
          : [isHardcore ? 1 : 0, modelVersion])
      ) as { count: number }
    return Number(row.count)
  }

  listQuarantineCatalogRecords(): string[] {
    const rows = this.database
      .prepare(`
        SELECT record
        FROM catalog_item
        WHERE content_pack = 'cairn-quarantine'
          AND name LIKE 'Quarantined item (%'
        ORDER BY record
      `)
      .all() as Array<{ record: string }>
    return rows.map((row) => row.record)
  }

  resolveQuarantineCatalogItems(items: ResolvedArchiveCatalogItem[]): {
    releasedRecords: number
    recoveryRecords: number
    missingRecords: number
  } {
    if (items.length === 0) {
      return { releasedRecords: 0, recoveryRecords: 0, missingRecords: 0 }
    }
    const update = this.database.prepare(`
      UPDATE catalog_item
      SET name = ?,
          rarity = 'rare',
          item_class = ?,
          slot = ?,
          level_requirement = ?,
          item_level = ?,
          bitmap = ?,
          content_pack = ?,
          updated_at_utc = ?
      WHERE record = ?
        AND content_pack = 'cairn-quarantine'
    `)
    let releasedRecords = 0
    let recoveryRecords = 0
    let missingRecords = 0
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const now = new Date().toISOString()
      for (const item of items) {
        if (!item.found) {
          missingRecords += 1
          continue
        }
        const contentPack = item.catalogEligible ? item.contentPack : 'cairn-quarantine'
        const result = update.run(
          item.name,
          item.itemClass,
          item.slot,
          item.levelRequirement,
          item.itemLevel,
          item.bitmap,
          contentPack,
          now,
          item.record
        )
        if (Number(result.changes) === 0) continue
        if (item.catalogEligible) releasedRecords += 1
        else recoveryRecords += 1
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { releasedRecords, recoveryRecords, missingRecords }
  }

  setVaultRollAnalyses(items: Array<{ id: string; rollAnalysis: ItemRollAnalysis }>): void {
    if (items.length === 0) return
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const update = this.database.prepare('UPDATE vault_item SET roll_json = ? WHERE id = ?')
      for (const item of items) update.run(JSON.stringify(item.rollAnalysis), item.id)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  importVaultItems(input: VaultImport): VaultImportResult {
    const infiniteSupplies = this.getInfiniteSupplies()
    const existingRows = this.database
      .prepare("SELECT serialized_item, is_hardcore FROM vault_item WHERE state = 'ingested'")
      .all() as Array<{ serialized_item: Uint8Array; is_hardcore: number }>
    const existingCounts = new Map<string, number>()
    for (const row of existingRows) {
      const payload = JSON.parse(Buffer.from(row.serialized_item).toString('utf8')) as unknown
      const key = `${row.is_hardcore}:${vaultPayloadFingerprint(payload)}`
      existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1)
    }
    const seenSourceCounts = new Map<string, number>()
    const importedIds: string[] = []
    const duplicateIds: string[] = []
    const unsupportedIds: string[] = []
    const catalogItem = this.database.prepare('SELECT rarity, slot FROM catalog_item WHERE record = ?')
    const insertVault = this.database.prepare(`
      INSERT OR IGNORE INTO vault_item (
        id, base_record, state, serialized_item, ingested_at_utc, retrieved_at_utc,
        is_hardcore, reusable
      ) VALUES (?, ?, 'ingested', ?, ?, NULL, ?, ?)
    `)
    const insertJournal = this.database.prepare(`
      INSERT OR IGNORE INTO operation_journal (
        id, operation, state, vault_item_id, stash_path, source_sha256,
        backup_path, started_at_utc, completed_at_utc, detail_json
      ) VALUES (?, 'ingest', 'committed', ?, ?, ?, ?, ?, ?, ?)
    `)

    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const item of input.items) {
        const catalog = catalogItem.get(item.baseRecord) as { rarity: string; slot: string } | undefined
        if (!catalog) {
          unsupportedIds.push(item.externalId)
          continue
        }
        const fingerprint = vaultPayloadFingerprint(item.payload)
        const key = `${item.isHardcore ? 1 : 0}:${fingerprint}`
        const seen = (seenSourceCounts.get(key) ?? 0) + 1
        seenSourceCounts.set(key, seen)
        if (seen <= (existingCounts.get(key) ?? 0)) {
          duplicateIds.push(item.externalId)
          continue
        }
        const vaultItemId = `gdia-${item.externalId}-${fingerprint.slice(0, 16)}`
        const operationId = `gdia-import-${item.externalId}-${fingerprint.slice(0, 16)}`
        const inserted = insertVault.run(
          vaultItemId,
          item.baseRecord,
          Buffer.from(JSON.stringify(item.payload), 'utf8'),
          item.createdAtUtc,
          item.isHardcore ? 1 : 0,
          catalog.rarity === 'supply' && catalog.slot !== 'potion' && infiniteSupplies ? 1 : 0
        )
        if (Number(inserted.changes) !== 1) {
          duplicateIds.push(item.externalId)
          continue
        }
        insertJournal.run(
          operationId,
          vaultItemId,
          item.sourcePath ?? input.sourcePath,
          item.sourceSha256 ?? input.sourceSha256,
          item.backupPath ?? input.backupPath,
          input.importedAtUtc,
          input.importedAtUtc,
          JSON.stringify({
            adapter: 'gdia-sqlite-migration-v1',
            externalId: item.externalId,
            sourceCreatedAtUtc: item.createdAtUtc
          })
        )
        importedIds.push(vaultItemId)
      }
      if (input.requireAllSupported && unsupportedIds.length > 0) {
        throw new Error(
          `Migration contains ${unsupportedIds.length} item(s) outside the Cairn catalog: ${unsupportedIds.join(', ')}`
        )
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { importedIds, duplicateIds, unsupportedIds }
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
    const infiniteSupplies = this.getInfiniteSupplies()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const pending = this.database
        .prepare(`
          SELECT
            pending_ingest_item.vault_item_id,
            pending_ingest_item.base_record,
            pending_ingest_item.payload_json,
            CASE
              WHEN catalog_item.rarity = 'supply' AND catalog_item.slot <> 'potion' THEN 1
              ELSE 0
            END AS reusable
          FROM pending_ingest_item
          JOIN catalog_item ON catalog_item.record = pending_ingest_item.base_record
          WHERE operation_id = ?
          ORDER BY ordinal
        `)
        .all(input.operationId) as Array<{
        vault_item_id: string
        base_record: string
        payload_json: string
        reusable: number
      }>
      if (pending.length === 0) {
        throw new Error('Prepared ingest operation has no persisted item payloads.')
      }

      const insertVault = this.database.prepare(`
        INSERT INTO vault_item (
          id, base_record, state, serialized_item, ingested_at_utc, retrieved_at_utc,
          is_hardcore, reusable
        ) VALUES (?, ?, 'ingested', ?, ?, NULL, ?, ?)
      `)
      for (const item of pending) {
        insertVault.run(
          item.vault_item_id,
          item.base_record,
          Buffer.from(item.payload_json, 'utf8'),
          input.completedAtUtc,
          input.isHardcore ? 1 : 0,
          item.reusable === 1 && infiniteSupplies ? 1 : 0
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

  hasCommittedOperation(operationId: string): boolean {
    const row = this.database
      .prepare(`SELECT 1 AS found FROM operation_journal WHERE id = ? AND state = 'committed'`)
      .get(operationId) as { found: number } | undefined
    return row?.found === 1
  }

  getVaultItems(vaultItemIds: string[], isHardcore?: boolean): VaultItem[] {
    if (vaultItemIds.length === 0) {
      throw new Error('At least one vault item ID is required.')
    }
    if (new Set(vaultItemIds).size !== vaultItemIds.length) {
      throw new Error('Duplicate vault item IDs are not allowed.')
    }

    const placeholders = vaultItemIds.map(() => '?').join(', ')
    const rows = this.database
      .prepare(`
        SELECT id, base_record, state, serialized_item, reusable
        FROM vault_item
        WHERE id IN (${placeholders})
          ${isHardcore === undefined ? '' : 'AND is_hardcore = ?'}
      `)
      .all(...vaultItemIds, ...(isHardcore === undefined ? [] : [isHardcore ? 1 : 0])) as Array<{
      id: string
      base_record: string
      state: VaultItemState
      serialized_item: Uint8Array
      reusable: number
    }>
    const byId = new Map(rows.map((row) => [row.id, row]))
    return vaultItemIds.map((id) => {
      const row = byId.get(id)
      if (!row) {
        throw new Error('Vault item does not exist: ' + id)
      }
      const payload = JSON.parse(Buffer.from(row.serialized_item).toString('utf8')) as Record<string, unknown>
      if (row.reusable === 1) payload.stackCount = 1
      return {
        id: row.id,
        baseRecord: row.base_record,
        state: row.state,
        payload,
        reusable: row.reusable === 1
      }
    })
  }

  listVaultItems(isHardcore?: boolean): VaultListItem[] {
    const rows = this.database
      .prepare(`
        SELECT
          vault_item.id,
          vault_item.base_record,
          vault_item.state,
          vault_item.serialized_item,
          vault_item.ingested_at_utc,
          vault_item.retrieved_at_utc,
          vault_item.is_hardcore,
          vault_item.reusable,
          vault_item.roll_json,
          catalog_item.name,
          catalog_item.rarity,
          catalog_item.slot,
          catalog_item.level_requirement,
          catalog_item.item_level,
          catalog_item.content_pack
        FROM vault_item
        JOIN catalog_item ON catalog_item.record = vault_item.base_record
        ${isHardcore === undefined ? '' : 'WHERE vault_item.is_hardcore = ?'}
        ORDER BY vault_item.ingested_at_utc DESC, vault_item.id
      `)
      .all(...(isHardcore === undefined ? [] : [isHardcore ? 1 : 0])) as unknown as VaultListRow[]

    return this.presentVaultRows(rows)
  }

  queryVaultItems(request: VaultPageRequest): VaultItemPage {
    const clauses = ['vault_item.state = ?']
    const parameters: Array<string | number> = [request.state]
    if (request.isHardcore !== undefined) {
      clauses.push('vault_item.is_hardcore = ?')
      parameters.push(request.isHardcore ? 1 : 0)
    }
    if (request.catalogued !== undefined) {
      clauses.push(
        request.catalogued
          ? "catalog_item.content_pack != 'cairn-quarantine'"
          : "catalog_item.content_pack = 'cairn-quarantine'"
      )
    }
    if (request.excludeSupplies) clauses.push("catalog_item.rarity != 'supply'")
    if (request.rarity) {
      clauses.push('catalog_item.rarity = ?')
      parameters.push(request.rarity)
    }
    const query = request.query?.trim().toLocaleLowerCase() ?? ''
    if (query) {
      clauses.push(`
        LOWER(
          catalog_item.name || ' ' ||
          vault_item.base_record || ' ' ||
          catalog_item.slot || ' ' ||
          catalog_item.rarity || ' ' ||
          catalog_item.item_level || ' ' ||
          COALESCE(json_extract(CAST(vault_item.serialized_item AS TEXT), '$.seed'), '') || ' ' ||
          COALESCE(json_extract(CAST(vault_item.serialized_item AS TEXT), '$.prefixRecord'), '') || ' ' ||
          COALESCE(json_extract(CAST(vault_item.serialized_item AS TEXT), '$.suffixRecord'), '')
        ) LIKE ? ESCAPE char(92)
      `)
      parameters.push(`%${query.replace(/[\\%_]/g, '\\$&')}%`)
    }
    const where = clauses.join(' AND ')
    const totalRow = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM vault_item
      JOIN catalog_item ON catalog_item.record = vault_item.base_record
      WHERE ${where}
    `).get(...parameters) as { count: number }
    const sortColumn = request.sort === 'name'
      ? 'catalog_item.name COLLATE NOCASE'
      : request.sort === 'level'
        ? 'catalog_item.item_level'
        : request.sort === 'roll'
          ? "COALESCE(json_extract(vault_item.roll_json, '$.overallEstimatedPercentile'), -1)"
          : request.state === 'retrieved'
            ? 'vault_item.retrieved_at_utc'
            : 'vault_item.ingested_at_utc'
    const direction = request.direction === 'asc' ? 'ASC' : 'DESC'
    const limit = Math.max(1, Math.min(250, Math.trunc(request.limit)))
    const offset = Math.max(0, Math.trunc(request.offset))
    const rows = this.database.prepare(`
      SELECT
        vault_item.id,
        vault_item.base_record,
        vault_item.state,
        vault_item.serialized_item,
        vault_item.ingested_at_utc,
        vault_item.retrieved_at_utc,
        vault_item.is_hardcore,
        vault_item.reusable,
        vault_item.roll_json,
        catalog_item.name,
        catalog_item.rarity,
        catalog_item.slot,
        catalog_item.level_requirement,
        catalog_item.item_level,
        catalog_item.content_pack
      FROM vault_item
      JOIN catalog_item ON catalog_item.record = vault_item.base_record
      WHERE ${where}
      ORDER BY ${sortColumn} ${direction}, catalog_item.name COLLATE NOCASE, vault_item.id
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as unknown as VaultListRow[]
    return {
      items: this.presentVaultRows(rows),
      total: Number(totalRow.count),
      offset,
      limit
    }
  }

  getVaultSummary(): VaultSummary {
    const row = this.database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN vault_item.state = 'ingested' THEN 1 ELSE 0 END) AS ingested,
        SUM(CASE WHEN vault_item.state = 'retrieval_pending' THEN 1 ELSE 0 END) AS retrieval_pending,
        SUM(CASE WHEN vault_item.state = 'retrieved' THEN 1 ELSE 0 END) AS retrieved,
        SUM(CASE WHEN vault_item.state = 'ingested' AND catalog_item.content_pack = 'cairn-quarantine' THEN 1 ELSE 0 END) AS quarantined,
        SUM(CASE WHEN vault_item.state = 'ingested' AND catalog_item.rarity = 'supply' THEN 1 ELSE 0 END) AS supplies
      FROM vault_item
      JOIN catalog_item ON catalog_item.record = vault_item.base_record
    `).get() as {
      total: number
      ingested: number | null
      retrieval_pending: number | null
      retrieved: number | null
      quarantined: number | null
      supplies: number | null
    }
    return {
      total: Number(row.total),
      ingested: Number(row.ingested ?? 0),
      retrievalPending: Number(row.retrieval_pending ?? 0),
      retrieved: Number(row.retrieved ?? 0),
      quarantined: Number(row.quarantined ?? 0),
      supplies: Number(row.supplies ?? 0)
    }
  }

  private presentVaultRows(rows: VaultListRow[]): VaultListItem[] {
    return rows.map((row) => {
      const payload = JSON.parse(Buffer.from(row.serialized_item).toString('utf8')) as {
        seed?: number
        stackCount?: number
        prefixRecord?: string
        suffixRecord?: string
        materiaRecord?: string
        enchantmentRecord?: string
        ascendantRecord?: string
        ascendantRecord2H?: string
      }
      return {
        id: row.id,
        baseRecord: row.base_record,
        name: row.name,
        rarity: row.rarity,
        slot: row.slot,
        levelRequirement: row.level_requirement,
        itemLevel: row.item_level,
        catalogued: row.content_pack !== 'cairn-quarantine',
        reusable: row.reusable === 1,
        isHardcore: row.is_hardcore === 1,
        state: row.state,
        seed: payload.seed ?? 0,
        stackCount: Math.max(1, payload.stackCount ?? 1),
        prefixRecord: payload.prefixRecord ?? '',
        suffixRecord: payload.suffixRecord ?? '',
        componentRecord: payload.materiaRecord ?? '',
        augmentRecord: payload.enchantmentRecord ?? '',
        ascendant: Boolean(payload.ascendantRecord || payload.ascendantRecord2H),
        instanceKey: vaultPayloadFingerprint(payload),
        rollAnalysis: row.roll_json ? JSON.parse(row.roll_json) as ItemRollAnalysis : null,
        ingestedAtUtc: row.ingested_at_utc,
        retrievedAtUtc: row.retrieved_at_utc
      }
    })
  }

  ensureQuarantineCatalogItem(baseRecord: string): string {
    const fileName = baseRecord.replaceAll('\\', '/').split('/').at(-1)?.replace(/\.dbr$/i, '')
    const name = `Quarantined item (${fileName || baseRecord})`
    this.database
      .prepare(`
        INSERT INTO catalog_item (
          record, name, rarity, item_class, slot, level_requirement, item_level,
          set_name, set_record, bitmap, content_pack, updated_at_utc
        ) VALUES (?, ?, 'epic', 'Quarantined', 'unknown', 0, 0, NULL, NULL, NULL,
          'cairn-quarantine', ?)
        ON CONFLICT(record) DO NOTHING
      `)
      .run(baseRecord, name, new Date().toISOString())
    return name
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
        SET state = CASE reusable WHEN 1 THEN 'ingested' ELSE 'retrieved' END,
            retrieved_at_utc = ?
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

  prepareDeliveryOperation(input: PreparedDeliveryOperation): void {
    this.database
      .prepare(`
        INSERT INTO operation_journal (
          id, operation, state, vault_item_id, stash_path, source_sha256,
          backup_path, started_at_utc, completed_at_utc, detail_json
        ) VALUES (?, 'retrieve', 'prepared', NULL, ?, ?, NULL, ?, NULL, ?)
      `)
      .run(
        input.operationId,
        input.destination,
        input.payloadSha256,
        input.startedAtUtc,
        JSON.stringify({ ...input.detail, transferKind: 'generated_delivery' })
      )
  }

  updatePendingOperationDetail(operationId: string, detail: Record<string, unknown>): void {
    const row = this.database
      .prepare('SELECT detail_json FROM operation_journal WHERE id = ? AND state = \'prepared\'')
      .get(operationId) as { detail_json: string } | undefined
    if (!row) throw new Error('Prepared operation journal entry is missing.')
    const previous = JSON.parse(row.detail_json) as Record<string, unknown>
    const result = this.database
      .prepare(`
        UPDATE operation_journal SET detail_json = ?
        WHERE id = ? AND state = 'prepared'
      `)
      .run(JSON.stringify({ ...previous, ...detail }), operationId)
    if (Number(result.changes) !== 1) {
      throw new Error('Prepared operation journal entry could not be updated.')
    }
  }

  completeDeliveryOperation(input: CompletedDeliveryOperation): void {
    const result = this.database
      .prepare(`
        UPDATE operation_journal
        SET state = 'committed', backup_path = ?, completed_at_utc = ?, detail_json = ?
        WHERE id = ? AND operation = 'retrieve' AND state = 'prepared'
      `)
      .run(
        input.receiptPath,
        input.completedAtUtc,
        JSON.stringify({ ...input.detail, transferKind: 'generated_delivery' }),
        input.operationId
      )
    if (Number(result.changes) !== 1) {
      throw new Error('Prepared delivery journal entry is missing.')
    }
  }

  failDeliveryOperation(operationId: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    this.database
      .prepare(`
        UPDATE operation_journal
        SET state = 'failed', completed_at_utc = ?, detail_json = ?
        WHERE id = ? AND operation = 'retrieve' AND state = 'prepared'
      `)
      .run(
        new Date().toISOString(),
        JSON.stringify({ transferKind: 'generated_delivery', error: detail }),
        operationId
      )
  }

  markDeliveryNeedsRecovery(operationId: string, error: unknown): void {
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
        JSON.stringify({
          ...previous,
          transferKind: 'generated_delivery',
          error: detail,
          phase: 'delivery_outcome_unknown'
        }),
        operationId
      )
  }

  setPinnedBest(record: string, instanceKey: string | null, isHardcore?: boolean): void {
    if (isHardcore === undefined) {
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
      return
    }
    if (instanceKey === null) {
      this.database.prepare('DELETE FROM pinned_best WHERE record = ?').run(record)
      this.database
        .prepare('DELETE FROM pinned_best_mode WHERE record = ? AND is_hardcore = ?')
        .run(record, isHardcore ? 1 : 0)
      return
    }
    this.database.prepare('DELETE FROM pinned_best WHERE record = ?').run(record)
    this.database
      .prepare(`
        INSERT INTO pinned_best_mode (record, is_hardcore, instance_key, pinned_at_utc)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(record, is_hardcore) DO UPDATE SET
          instance_key = excluded.instance_key,
          pinned_at_utc = excluded.pinned_at_utc
      `)
      .run(record, isHardcore ? 1 : 0, instanceKey, new Date().toISOString())
  }

  getInfiniteSupplies(): boolean {
    const row = this.database
      .prepare("SELECT value FROM app_setting WHERE key = 'infinite_supplies'")
      .get() as { value: string } | undefined
    return row?.value !== 'false'
  }

  setInfiniteSupplies(enabled: boolean): boolean {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database
        .prepare(`
          INSERT INTO app_setting (key, value) VALUES ('infinite_supplies', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `)
        .run(enabled ? 'true' : 'false')
      if (enabled) {
        this.database.exec(`
          UPDATE vault_item
          SET reusable = 1
          WHERE state = 'ingested'
            AND base_record IN (
              SELECT record FROM catalog_item WHERE rarity = 'supply' AND slot <> 'potion'
            )
        `)
      } else {
        this.database.exec(`
          UPDATE vault_item
          SET reusable = 0
          WHERE base_record IN (SELECT record FROM catalog_item WHERE rarity = 'supply')
        `)
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return enabled
  }

  getDebugLogging(): boolean {
    const row = this.database
      .prepare("SELECT value FROM app_setting WHERE key = 'debug_logging'")
      .get() as { value: string } | undefined
    return row?.value === 'true'
  }

  setDebugLogging(enabled: boolean): boolean {
    this.database
      .prepare(`
        INSERT INTO app_setting (key, value) VALUES ('debug_logging', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(enabled ? 'true' : 'false')
    return enabled
  }

  close(): void {
    this.database.close()
  }

  private migrate(): void {
    let version = (this.database.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version
    if (version > CURRENT_COLLECTION_SCHEMA_VERSION) {
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
      version = 4
    }

    if (version === 4) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE collection_entry_mode (
          record TEXT NOT NULL REFERENCES catalog_item(record) ON DELETE RESTRICT,
          is_hardcore INTEGER NOT NULL CHECK (is_hardcore IN (0, 1)),
          first_discovered_at_utc TEXT NOT NULL,
          last_discovered_at_utc TEXT NOT NULL,
          PRIMARY KEY (record, is_hardcore)
        ) STRICT;
        INSERT OR IGNORE INTO collection_entry_mode (
          record, is_hardcore, first_discovered_at_utc, last_discovered_at_utc
        )
        SELECT
          observed_item.base_record,
          stash_snapshot.is_hardcore,
          MIN(scan_run.scanned_at_utc),
          MAX(scan_run.scanned_at_utc)
        FROM observed_item
        JOIN stash_snapshot ON stash_snapshot.id = observed_item.stash_snapshot_id
        JOIN scan_run ON scan_run.id = stash_snapshot.scan_run_id
        JOIN catalog_item ON catalog_item.record = observed_item.base_record
        GROUP BY observed_item.base_record, stash_snapshot.is_hardcore;

        CREATE TABLE pinned_best_mode (
          record TEXT NOT NULL REFERENCES catalog_item(record) ON DELETE CASCADE,
          is_hardcore INTEGER NOT NULL CHECK (is_hardcore IN (0, 1)),
          instance_key TEXT NOT NULL,
          pinned_at_utc TEXT NOT NULL,
          PRIMARY KEY (record, is_hardcore)
        ) STRICT;
        INSERT OR IGNORE INTO pinned_best_mode (record, is_hardcore, instance_key, pinned_at_utc)
        SELECT
          pinned_best.record,
          stash_snapshot.is_hardcore,
          pinned_best.instance_key,
          pinned_best.pinned_at_utc
        FROM pinned_best
        JOIN observed_item ON observed_item.instance_key = pinned_best.instance_key
        JOIN stash_snapshot ON stash_snapshot.id = observed_item.stash_snapshot_id
        GROUP BY pinned_best.record, stash_snapshot.is_hardcore;

        ALTER TABLE vault_item ADD COLUMN is_hardcore INTEGER NOT NULL DEFAULT 0
          CHECK (is_hardcore IN (0, 1));
        UPDATE vault_item
        SET is_hardcore = 1
        WHERE EXISTS (
          SELECT 1
          FROM operation_journal
          WHERE operation_journal.operation = 'ingest'
            AND operation_journal.completed_at_utc = vault_item.ingested_at_utc
            AND LOWER(operation_journal.stash_path) LIKE '%.gsh'
        );
        PRAGMA user_version = 5;
        COMMIT;
      `)
      version = 5
    }

    if (version === 5) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE vault_item ADD COLUMN roll_json TEXT;
        PRAGMA user_version = 6;
        COMMIT;
      `)
      version = 6
    }
    if (version === 6) {
      this.database.exec('PRAGMA foreign_keys = OFF')
      try {
        this.database.exec(`
          BEGIN IMMEDIATE;
          CREATE TABLE catalog_item_next (
            record TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            rarity TEXT NOT NULL CHECK (rarity IN ('epic', 'legendary', 'mi')),
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
          INSERT INTO catalog_item_next SELECT * FROM catalog_item;
          DROP TABLE catalog_item;
          ALTER TABLE catalog_item_next RENAME TO catalog_item;
          CREATE INDEX catalog_item_browse_idx ON catalog_item(rarity, slot, name);
          PRAGMA user_version = 7;
          COMMIT;
        `)
        version = 7
      } finally {
        this.database.exec('PRAGMA foreign_keys = ON')
      }
    }
    if (version === 7) {
      this.database.exec('PRAGMA foreign_keys = OFF')
      try {
        this.database.exec(`
          BEGIN IMMEDIATE;
          CREATE TABLE catalog_item_next (
            record TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            rarity TEXT NOT NULL CHECK (rarity IN ('epic', 'legendary', 'mi', 'rare', 'faction')),
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
          INSERT INTO catalog_item_next SELECT * FROM catalog_item;
          DROP TABLE catalog_item;
          ALTER TABLE catalog_item_next RENAME TO catalog_item;
          CREATE INDEX catalog_item_browse_idx ON catalog_item(rarity, slot, name);
          PRAGMA user_version = 8;
          COMMIT;
        `)
        version = 8
      } finally {
        this.database.exec('PRAGMA foreign_keys = ON')
      }
    }
    if (version === 8) {
      this.database.exec('PRAGMA foreign_keys = OFF')
      try {
        this.database.exec(`
          BEGIN IMMEDIATE;
          CREATE TABLE catalog_item_next (
            record TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            rarity TEXT NOT NULL CHECK (rarity IN ('epic', 'legendary', 'mi', 'rare', 'faction', 'supply')),
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
          INSERT INTO catalog_item_next SELECT * FROM catalog_item;
          DROP TABLE catalog_item;
          ALTER TABLE catalog_item_next RENAME TO catalog_item;
          CREATE INDEX catalog_item_browse_idx ON catalog_item(rarity, slot, name);
          ALTER TABLE vault_item ADD COLUMN reusable INTEGER NOT NULL DEFAULT 0
            CHECK (reusable IN (0, 1));
          CREATE INDEX vault_item_reusable_idx
            ON vault_item(reusable, is_hardcore, base_record, state);
          PRAGMA user_version = 9;
          COMMIT;
        `)
        version = 9
      } finally {
        this.database.exec('PRAGMA foreign_keys = ON')
      }
    }
    if (version === 9) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE app_setting (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT;
        INSERT INTO app_setting (key, value) VALUES ('infinite_supplies', 'true');
        PRAGMA user_version = 10;
        COMMIT;
      `)
      version = 10
    }
    if (version === 10) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        CREATE INDEX vault_item_browse_idx
          ON vault_item(state, is_hardcore, ingested_at_utc DESC, id);
        CREATE INDEX vault_item_history_idx
          ON vault_item(state, retrieved_at_utc DESC, id);
        PRAGMA user_version = 11;
        COMMIT;
      `)
      version = 11
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
    if (this.getInfiniteSupplies()) {
      this.database.exec(`
        UPDATE vault_item
        SET reusable = 1
        WHERE reusable = 0
          AND state = 'ingested'
          AND base_record IN (
            SELECT record FROM catalog_item WHERE rarity = 'supply' AND slot <> 'potion'
          )
      `)
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
      INSERT INTO collection_entry_mode (
        record, is_hardcore, first_discovered_at_utc, last_discovered_at_utc
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(record, is_hardcore) DO UPDATE SET
        last_discovered_at_utc = excluded.last_discovered_at_utc
    `)
    const catalogRecords = new Set(
      [...snapshot.items, ...(snapshot.supplies ?? [])].map((item) => item.record.toLowerCase())
    )
    const modesByPath = new Map(
      snapshot.scannedStashes.map((stash) => [stash.path.toLowerCase(), stash.isHardcore])
    )
    const discoveries = new Set<string>()
    for (const item of snapshot.observedItems) {
      if (!catalogRecords.has(item.baseRecord.toLowerCase())) continue
      const isHardcore = modesByPath.get(item.sourcePath.toLowerCase())
      if (isHardcore === undefined) continue
      const key = `${isHardcore ? 1 : 0}:${item.baseRecord.toLowerCase()}`
      if (discoveries.has(key)) continue
      discoveries.add(key)
      statement.run(item.baseRecord, isHardcore ? 1 : 0, snapshot.scannedAtUtc, snapshot.scannedAtUtc)
    }
  }

  private withLifetimeState(
    snapshot: CollectionSnapshot,
    isHardcore?: boolean
  ): CollectionSnapshot {
    const rows = (isHardcore === undefined
      ? this.database
          .prepare(`
            SELECT record, MIN(first_discovered_at_utc) AS first_discovered_at_utc FROM (
              SELECT record, first_discovered_at_utc FROM collection_entry_mode
              UNION ALL
              SELECT base_record AS record, ingested_at_utc AS first_discovered_at_utc
              FROM vault_item
            )
            GROUP BY record
          `)
          .all()
      : this.database
          .prepare(`
            SELECT record, MIN(first_discovered_at_utc) AS first_discovered_at_utc FROM (
              SELECT record, first_discovered_at_utc
              FROM collection_entry_mode
              WHERE is_hardcore = ?
              UNION ALL
              SELECT base_record AS record, ingested_at_utc AS first_discovered_at_utc
              FROM vault_item
              WHERE is_hardcore = ?
            )
            GROUP BY record
          `)
          .all(isHardcore ? 1 : 0, isHardcore ? 1 : 0)) as Array<{
      record: string
      first_discovered_at_utc: string
    }>
    const discovered = new Map(
      rows.map((row) => [row.record.toLowerCase(), row.first_discovered_at_utc])
    )
    const pinned = this.loadPinned(isHardcore)
    const items = snapshot.items.map((item) => ({
      ...item,
      discovered: discovered.has(item.record.toLowerCase()),
      firstDiscoveredAt: discovered.get(item.record.toLowerCase()) ?? null,
      pinnedInstanceKey: pinned.get(item.record.toLowerCase()) ?? null
    }))
    const supplies = (snapshot.supplies ?? []).map((item) => ({
      ...item,
      discovered: discovered.has(item.record.toLowerCase()),
      firstDiscoveredAt: discovered.get(item.record.toLowerCase()) ?? null
    }))
    const rarities = collectionRarities.map((rarity) => {
      const matching = items.filter((item) => item.rarity === rarity)
      return {
        rarity,
        total: matching.length,
        collected: matching.filter((item) => item.discovered).length,
        availableCopies: matching.reduce((count, item) => count + item.availableCount, 0)
      }
    })

    return {
      ...snapshot,
      basis: 'stashes',
      items,
      supplies,
      supplySummary: summarizeSupplies(supplies),
      rarities
    }
  }

  private loadPinned(isHardcore?: boolean): Map<string, string> {
    const pinnedRows = (isHardcore === undefined
      ? this.database
          .prepare(`
            SELECT record, instance_key FROM pinned_best
            UNION ALL
            SELECT record, MIN(instance_key) AS instance_key
            FROM pinned_best_mode AS mode_pin
            WHERE NOT EXISTS (
              SELECT 1 FROM pinned_best AS legacy_pin
              WHERE legacy_pin.record = mode_pin.record
            )
            GROUP BY record
            HAVING COUNT(DISTINCT instance_key) = 1
          `)
          .all()
      : this.database
          .prepare('SELECT record, instance_key FROM pinned_best_mode WHERE is_hardcore = ?')
          .all(isHardcore ? 1 : 0)) as Array<{
        record: string
        instance_key: string
      }>
    return new Map(pinnedRows.map((row) => [row.record.toLowerCase(), row.instance_key]))
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

export interface ArchiveVaultItem {
  id: string
  baseRecord: string
  payload: unknown
  rollAnalysis: ItemRollAnalysis | null
}

export interface ArchiveRollAnalysisCandidate {
  id: string
  baseRecord: string
  payload: unknown
}

export interface ResolvedArchiveCatalogItem {
  record: string
  found: boolean
  name: string
  baseClassification: string
  itemClass: string
  slot: string
  levelRequirement: number
  itemLevel: number
  bitmap: string | null
  contentPack: string
  catalogEligible: boolean
  reason: string
}

export interface VaultImport {
  sourcePath: string
  sourceSha256: string
  backupPath: string
  importedAtUtc: string
  requireAllSupported?: boolean
  items: Array<{
    externalId: string
    baseRecord: string
    isHardcore: boolean
    createdAtUtc: string
    payload: unknown
    sourcePath?: string
    sourceSha256?: string
    backupPath?: string
  }>
}

export interface VaultImportResult {
  importedIds: string[]
  duplicateIds: string[]
  unsupportedIds: string[]
}

export interface CompletedIngestOperation {
  operationId: string
  backupPath: string
  completedAtUtc: string
  isHardcore: boolean
  detail: unknown
}

export type VaultItemState = 'ingested' | 'retrieval_pending' | 'retrieved'

interface VaultListRow {
  id: string
  base_record: string
  state: VaultItemState
  serialized_item: Uint8Array
  ingested_at_utc: string
  retrieved_at_utc: string | null
  name: string
  rarity: 'epic' | 'legendary' | 'mi' | 'rare' | 'faction' | 'supply'
  slot: string
  level_requirement: number
  item_level: number
  content_pack: string
  is_hardcore: number
  reusable: number
  roll_json: string | null
}

export interface VaultItem {
  id: string
  baseRecord: string
  state: VaultItemState
  payload: unknown
  reusable: boolean
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

export interface PreparedDeliveryOperation {
  operationId: string
  destination: string
  payloadSha256: string
  startedAtUtc: string
  detail: Record<string, unknown>
}

export interface CompletedDeliveryOperation {
  operationId: string
  receiptPath: string
  completedAtUtc: string
  detail: Record<string, unknown>
}

export interface CollectionDatabaseDiagnosticSummary {
  schemaVersion: number
  quickCheck: string[]
  vaultStates: Array<{ state: string; count: number }>
  journalStates: Array<{ operation: string; state: string; count: number }>
  recoveryOperations: Array<{
    id: string
    operation: string
    state: string
    startedAtUtc: string
    completedAtUtc: string | null
    hasBackup: boolean
  }>
}
