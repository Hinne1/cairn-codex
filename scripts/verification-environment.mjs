/** Keep callers' shell/runtime settings, but never inherit operational commands or
 * archive destinations into a disposable verification process. */
export function verificationEnvironment(source = process.env) {
  const environment = { ...source }
  for (const key of Object.keys(environment)) {
    if (/^CAIRN_CODEX_(DATABASE_PATH|ARCHIVE_BACKUP_DIR|MIGRATION_BACKUP_DIR|INGEST_REQUEST|IMPORT_GDIA|RETRIEVAL_PLAN_REQUEST|RETRIEVE_REQUEST|SMOKE_TEST)$/i.test(key)) {
      delete environment[key]
    }
  }
  return environment
}
