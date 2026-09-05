import type { DatabaseSync } from 'node:sqlite'

/** Query metadata is derived on writes; exact serialized payloads remain authoritative. */
export function migrateArchiveItemProjection(database: DatabaseSync): void {
  const columns = 'id, payload_valid, seed, stack_count, prefix_record, suffix_record, component_record, augment_record, ascendant, roll_percentile'
  const values = (row: string): string => {
    const payload = `CASE WHEN json_valid(CAST(${row}.serialized_item AS TEXT)) THEN CAST(${row}.serialized_item AS TEXT) ELSE '{}' END`
    const field = (name: string): string => `json_extract(${payload}, '$.${name}')`
    const kind = (name: string): string => `json_type(${payload}, '$.${name}')`
    const strings = ['prefixRecord', 'suffixRecord', 'materiaRecord', 'enchantmentRecord', 'ascendantRecord', 'ascendantRecord2H']
    const validField = (name: string, type: string): string => `(${kind(name)} IS NULL OR ${kind(name)} IN ('null', '${type}'))`
    const text = (name: string): string => `CASE WHEN ${kind(name)} = 'text' THEN ${field(name)} ELSE '' END`
    const integer = (name: string, fallback: number): string => `CASE WHEN ${kind(name)} = 'integer' THEN ${field(name)} ELSE ${fallback} END`
    return `${row}.id,
      (json_type(${payload}) = 'object' AND json_valid(CAST(${row}.serialized_item AS TEXT))
        AND ${[...strings.map(name => validField(name, 'text')), validField('seed', 'integer'), validField('stackCount', 'integer')].join(' AND ')}),
      ${integer('seed', 0)}, MAX(1, ${integer('stackCount', 1)}),
      ${text('prefixRecord')}, ${text('suffixRecord')}, ${text('materiaRecord')}, ${text('enchantmentRecord')},
      (${text('ascendantRecord')} != '' OR ${text('ascendantRecord2H')} != ''),
      CASE WHEN json_valid(${row}.roll_json) THEN
        CASE WHEN json_type(${row}.roll_json, '$.overallEstimatedPercentile') IN ('integer', 'real')
          THEN json_extract(${row}.roll_json, '$.overallEstimatedPercentile') END ELSE NULL END`
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      CREATE TABLE vault_item_projection (
        id TEXT PRIMARY KEY REFERENCES vault_item(id) ON DELETE CASCADE,
        payload_valid INTEGER NOT NULL, seed INTEGER NOT NULL, stack_count INTEGER NOT NULL,
        prefix_record TEXT NOT NULL, suffix_record TEXT NOT NULL,
        component_record TEXT NOT NULL, augment_record TEXT NOT NULL,
        ascendant INTEGER NOT NULL, roll_percentile REAL
      ) STRICT;
      INSERT INTO vault_item_projection (${columns}) SELECT ${values('vault_item')} FROM vault_item;
      CREATE TRIGGER vault_item_projection_insert AFTER INSERT ON vault_item BEGIN
        INSERT INTO vault_item_projection (${columns}) VALUES (${values('NEW')});
      END;
      CREATE TRIGGER vault_item_projection_update AFTER UPDATE OF serialized_item, roll_json ON vault_item BEGIN
        INSERT OR REPLACE INTO vault_item_projection (${columns}) VALUES (${values('NEW')});
      END;
      CREATE INDEX vault_item_group_idx ON vault_item(state, is_hardcore, base_record COLLATE NOCASE, ingested_at_utc DESC, id);
      PRAGMA user_version = 14;
    `)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
