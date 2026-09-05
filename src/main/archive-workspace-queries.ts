import type { DatabaseSync } from 'node:sqlite'
import type { CollectionItem } from '../shared/contracts.ts'
import { compileSearchQuery } from '../shared/search-query.ts'
import { searchQueryOptions, searchSchemas } from '../shared/search-schema.ts'
import {
  ARCHIVE_SELECTION_LIMIT, WORKSPACE_PAGE_LIMIT,
  type ArchiveItemSummary, type DismantlingPage, type DismantlingQueryRequest, type DismantlingSelection,
  type SupplyQueryRequest, type SupplyPage, type SupplyOption, type SupplySelection
} from '../shared/workspace-query-contracts.ts'
import { buildSupplyCatalogIndex, buildReusableSupplySummary, createSupplyAccessSummary, createSupplyOptions,
  type SupplyArchiveItem, type SupplyCatalogIndex } from '../shared/supply-presentation.ts'
import { numericSearchSql, searchExpressionSql, textSearchSql, type SqlSearchFragment } from './archive-search-sql.ts'

const columns = `v.id, v.base_record AS baseRecord, v.state, v.ingested_at_utc AS ingestedAtUtc,
  v.retrieved_at_utc AS retrievedAtUtc, v.is_hardcore AS isHardcore, v.reusable,
  c.name, c.rarity, c.slot, c.level_requirement AS levelRequirement, c.item_level AS itemLevel,
  (c.content_pack != 'cairn-quarantine' AND p.payload_valid = 1) AS catalogued,
  p.seed, p.stack_count AS stackCount, p.prefix_record AS prefixRecord, p.suffix_record AS suffixRecord,
  p.component_record AS componentRecord, p.augment_record AS augmentRecord,
  p.ascendant, p.roll_percentile AS rollPercentile`
const joins = `FROM vault_item v JOIN catalog_item c ON c.record = v.base_record
  JOIN vault_item_projection p ON p.id = v.id`
const dismantlingEligibility = `v.state = 'ingested' AND v.reusable = 0 AND p.payload_valid = 1
  AND c.content_pack != 'cairn-quarantine' AND c.rarity IN ('epic', 'legendary', 'mi', 'rare')`

function present(rows: unknown[]): ArchiveItemSummary[] {
  return (rows as ArchiveItemSummary[]).map(row => ({ ...row,
    isHardcore: Boolean(row.isHardcore), reusable: Boolean(row.reusable),
    catalogued: Boolean(row.catalogued), ascendant: Boolean(row.ascendant)
  }))
}

export function validateDismantlingQuery(input: unknown): DismantlingQueryRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid dismantling query.')
  const request = input as DismantlingQueryRequest
  if (request.source !== 'archive' ||
      (request.isHardcore !== undefined && typeof request.isHardcore !== 'boolean') ||
      (request.rarity !== undefined && !['epic', 'legendary', 'mi', 'rare'].includes(request.rarity)) ||
      typeof request.query !== 'string' || request.query.length > 200 ||
      !Number.isInteger(request.offset) || request.offset < 0 || request.offset > 10_000_000 ||
      !Number.isInteger(request.limit) || request.limit < 1 || request.limit > WORKSPACE_PAGE_LIMIT) {
    throw new Error('Dismantling query parameters are outside their safe bounds.')
  }
  return { source: 'archive', isHardcore: request.isHardcore, rarity: request.rarity,
    query: request.query, offset: request.offset, limit: request.limit }
}

export function validateSupplyQuery(input: unknown): SupplyQueryRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid supply query.')
  const request = input as SupplyQueryRequest
  validateDismantlingQuery({ source: 'archive', query: request.query, isHardcore: request.isHardcore,
    offset: request.offset, limit: request.limit })
  if (!['all', 'archive', 'faction'].includes(request.source) ||
      !['writs', 'augments'].includes(request.category) || !['all', 'weapon', 'armor', 'jewelry'].includes(request.slot) ||
      typeof request.liveReady !== 'boolean' ||
      (request.activeTransferHardcore !== undefined && typeof request.activeTransferHardcore !== 'boolean')) {
    throw new Error('Supply query parameters are outside their safe bounds.')
  }
  const character = request.activeCharacter
  if (character !== null && (!character || typeof character.name !== 'string' || character.name.length > 128 ||
      typeof character.isHardcore !== 'boolean' || !Array.isArray(character.factions) || character.factions.length > 250 ||
      !character.factions.every(faction => faction && typeof faction.name === 'string' && faction.name.length <= 256 &&
        typeof faction.isUnlocked === 'boolean' && Number.isFinite(faction.value)))) {
    throw new Error('Supply character metadata is outside its safe bounds.')
  }
  return { source: request.source, category: request.category, slot: request.slot, query: request.query,
    isHardcore: request.isHardcore, activeTransferHardcore: request.activeTransferHardcore,
    liveReady: request.liveReady, offset: request.offset, limit: request.limit,
    activeCharacter: character && { name: character.name, isHardcore: character.isHardcore,
      factions: character.factions.map(({ name, isUnlocked, value }) => ({ name, isUnlocked, value })) } }
}

function dismantlingFilter(request: DismantlingQueryRequest): SqlSearchFragment {
  const clauses = ['1']
  const parameters: Array<string | number> = []
  if (request.isHardcore !== undefined) { clauses.push('isHardcore = ?'); parameters.push(Number(request.isHardcore)) }
  if (request.rarity !== undefined) { clauses.push('rarity = ?'); parameters.push(request.rarity) }
  if (request.query.trim()) {
    const compiled = compileSearchQuery(request.query, searchQueryOptions(searchSchemas.dismantling))
    if (compiled.error || !compiled.expression) throw new Error(compiled.error?.message ?? 'Invalid dismantling search.')
    const mode = "CASE WHEN isHardcore = 1 THEN 'hardcore' ELSE 'softcore' END"
    const fields: Record<string, string> = { name: 'name', base: 'baseRecord', prefix: 'prefixRecord',
      suffix: 'suffixRecord', affix: "prefixRecord || ' ' || suffixRecord", rarity: 'rarity', mode }
    const fragment = searchExpressionSql(compiled.expression, term => {
      if (term.field === 'level') return numericSearchSql('levelRequirement', term.value)
      return textSearchSql(term.field ? fields[term.field]!
        : `name || ' ' || baseRecord || ' ' || prefixRecord || ' ' || suffixRecord || ' ' || rarity || ' ' || ${mode}`, term.value)
    })
    clauses.push(fragment.sql); parameters.push(...fragment.parameters)
  }
  return { sql: clauses.join(' AND '), parameters }
}

export class ArchiveWorkspaceQueries {
  private readonly database: DatabaseSync
  private readonly supplyIndexes = new WeakMap<readonly CollectionItem[], SupplyCatalogIndex>()

  constructor(database: DatabaseSync) { this.database = database }

  dismantlingPage(input: DismantlingQueryRequest): DismantlingPage {
    const request = validateDismantlingQuery(input)
    const filter = dismantlingFilter(request)
    const cte = `WITH candidates AS (SELECT ${columns} ${joins} WHERE ${dismantlingEligibility})`
    const total = this.database.prepare(`${cte} SELECT COUNT(*) AS total FROM candidates WHERE ${filter.sql}`)
      .get(...filter.parameters) as { total: number }
    const rows = this.database.prepare(`${cte} SELECT * FROM candidates WHERE ${filter.sql}
      ORDER BY ingestedAtUtc DESC, id LIMIT ? OFFSET ?`).all(...filter.parameters, request.limit, request.offset)
    return { items: present(rows), total: Number(total.total), offset: request.offset, limit: request.limit }
  }

  dismantlingDuplicates(input: DismantlingQueryRequest): DismantlingSelection {
    const request = validateDismantlingQuery(input)
    const filter = dismantlingFilter(request)
    // Rank whole eligible groups before applying search or pages. Attachments can
    // protect the best copy, but attached extras never enter automatic selection.
    const cte = `WITH candidates AS (SELECT ${columns}, ROW_NUMBER() OVER (
      PARTITION BY v.is_hardcore, LOWER(v.base_record)
      ORDER BY COALESCE(p.roll_percentile, -1) DESC, v.ingested_at_utc DESC, v.id) AS copyRank
      ${joins} WHERE ${dismantlingEligibility})`
    const where = `${filter.sql} AND copyRank > 1 AND componentRecord = '' AND augmentRecord = ''`
    const total = this.database.prepare(`${cte} SELECT COUNT(*) AS total FROM candidates WHERE ${where}`)
      .get(...filter.parameters) as { total: number }
    const rows = this.database.prepare(`${cte} SELECT id FROM candidates WHERE ${where}
      ORDER BY ingestedAtUtc DESC, id LIMIT ?`).all(...filter.parameters, ARCHIVE_SELECTION_LIMIT) as Array<{ id: string }>
    return { ids: rows.map(row => row.id), total: Number(total.total), limit: ARCHIVE_SELECTION_LIMIT }
  }

  itemsByIds(ids: readonly string[]): ArchiveItemSummary[] {
    if (ids.length > ARCHIVE_SELECTION_LIMIT || new Set(ids).size !== ids.length ||
      !ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128)) {
      throw new Error('Archive selection is outside its safe bounds.')
    }
    if (ids.length === 0) return []
    return present(this.database.prepare(`SELECT ${columns} ${joins}
      WHERE v.id IN (${ids.map(() => '?').join(',')})`).all(...ids))
  }

  private supplyGroups(isHardcore?: boolean): SupplyArchiveItem[] {
    const rows = this.database.prepare(`SELECT MIN(v.id) AS id, v.base_record AS baseRecord, c.name, c.rarity, c.slot,
      v.state, v.is_hardcore AS isHardcore, MAX(v.reusable) AS reusable, 1 AS stackCount
      ${joins} WHERE v.state = 'ingested' AND c.rarity = 'supply' AND p.payload_valid = 1
      ${isHardcore === undefined ? '' : 'AND v.is_hardcore = ?'}
      GROUP BY LOWER(v.base_record), v.is_hardcore ORDER BY c.name COLLATE NOCASE, v.base_record`)
      .all(...(isHardcore === undefined ? [] : [Number(isHardcore)])) as unknown as SupplyArchiveItem[]
    return rows.map(row => ({ ...row, isHardcore: Boolean(row.isHardcore), reusable: Boolean(row.reusable) }))
  }

  private supplyPlan(input: SupplyQueryRequest, catalog: readonly CollectionItem[], boostsOnly = false) {
    const request = validateSupplyQuery(input)
    const query = compileSearchQuery(request.query, searchQueryOptions(searchSchemas.supplies))
    if (query.error) throw new Error(query.error.message)
    let index = this.supplyIndexes.get(catalog)
    if (!index) { index = buildSupplyCatalogIndex(catalog); this.supplyIndexes.set(catalog, index) }
    const groups = this.supplyGroups(request.isHardcore)
    const presentation = { catalogItems: catalog, controls: request, activeCharacter: request.activeCharacter,
      activeTransferHardcore: request.activeTransferHardcore, liveReady: request.liveReady, query, catalogIndex: index }
    const candidates = createSupplyOptions({ ...presentation, vaultItems: groups }).filter(item =>
      (request.source === 'all' || request.source === item.source) &&
      (request.isHardcore === undefined || request.isHardcore === item.isHardcore) &&
      (!boostsOnly || (item.eligible && item.source === 'archive' && ['writ', 'mandate', 'warrant'].includes(item.slot))))
    const archive = candidates.filter(item => item.source === 'archive').map(item => ({
      record: item.record.toLowerCase(), isHardcore: Number(item.isHardcore), eligible: Number(item.eligible)
    }))
    const faction = candidates.filter(item => item.source === 'faction')
    const parameters = [JSON.stringify(archive), JSON.stringify(faction.map(item => ({
      id: item.id, record: item.record, name: item.name, slot: item.slot,
      isHardcore: Number(item.isHardcore), eligible: Number(item.eligible)
    })))]
    const cte = `WITH allowed AS (SELECT json_extract(value, '$.record') AS record,
        json_extract(value, '$.isHardcore') AS isHardcore, json_extract(value, '$.eligible') AS eligible FROM json_each(?)),
      ranked AS (SELECT v.id, v.base_record AS record, c.name, c.slot, v.is_hardcore AS isHardcore, allowed.eligible,
        ROW_NUMBER() OVER (PARTITION BY v.is_hardcore, LOWER(v.base_record) ORDER BY v.ingested_at_utc DESC, v.id) AS copyRank
        ${joins} JOIN allowed ON allowed.record = LOWER(v.base_record) AND allowed.isHardcore = v.is_hardcore
        WHERE v.state = 'ingested' AND p.payload_valid = 1),
      options AS (SELECT id, record, name, slot, isHardcore, eligible, 'archive' AS source FROM ranked
        WHERE ${request.category === 'writs' ? "slot = 'potion' OR copyRank = 1" : '1'}
        UNION ALL SELECT json_extract(value, '$.id'), json_extract(value, '$.record'), json_extract(value, '$.name'),
          json_extract(value, '$.slot'), json_extract(value, '$.isHardcore'), json_extract(value, '$.eligible'), 'faction'
        FROM json_each(?))`
    const order = request.category === 'augments' ? 'eligible DESC, name COLLATE NOCASE, id' : 'slot, name COLLATE NOCASE, id'
    return { request, presentation, groups, parameters, cte, order }
  }

  suppliesPage(input: SupplyQueryRequest, catalog: readonly CollectionItem[]): SupplyPage {
    const plan = this.supplyPlan(input, catalog)
    const { request, parameters, cte, order } = plan
    const { total } = this.database.prepare(`${cte} SELECT COUNT(*) AS total FROM options`).get(...parameters) as { total: number }
    const selected = this.database.prepare(`${cte} SELECT id, source FROM options ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...parameters, request.limit, request.offset) as Array<{ id: string; source: string }>
    const archived = this.itemsByIds(selected.filter(item => item.source === 'archive').map(item => item.id))
    const available = createSupplyOptions({ ...plan.presentation, vaultItems: archived })
    const byId = new Map(available.map(item => [item.id, item]))
    return { items: selected.map(item => byId.get(item.id)!).filter((item): item is SupplyOption => Boolean(item)),
      total: Number(total), offset: request.offset, limit: request.limit,
      summary: buildReusableSupplySummary(catalog, plan.groups),
      accessSummary: createSupplyAccessSummary(catalog, request.activeCharacter) }
  }

  supplyBoostSelection(input: SupplyQueryRequest, catalog: readonly CollectionItem[]): SupplySelection {
    const { parameters, cte, order } = this.supplyPlan(input, catalog, true)
    const { total } = this.database.prepare(`${cte} SELECT COUNT(*) AS total FROM options`).get(...parameters) as { total: number }
    const rows = this.database.prepare(`${cte} SELECT id, record, name, slot, isHardcore, eligible, source,
      (SELECT reusable FROM vault_item WHERE vault_item.id = options.id) AS reusable FROM options
      ORDER BY ${order} LIMIT ?`).all(...parameters, ARCHIVE_SELECTION_LIMIT) as unknown as SupplySelection['items']
    return { items: rows.map(item => ({ ...item, isHardcore: Boolean(item.isHardcore), eligible: Boolean(item.eligible), reusable: Boolean(item.reusable) })),
      total: Number(total), limit: ARCHIVE_SELECTION_LIMIT }
  }
}
