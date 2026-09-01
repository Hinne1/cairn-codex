import { searchHelp, searchSchemas, type SearchWorkspaceSchema } from '@shared/search-schema'

export interface SearchGuidance {
  searchHelp: string
  searchExamples: readonly [string, ...string[]]
  searchSchema: SearchWorkspaceSchema
}

function guidance(searchSchema: SearchWorkspaceSchema): SearchGuidance {
  return { searchHelp: searchHelp(searchSchema), searchExamples: searchSchema.examples, searchSchema }
}

export const searchGuidance = {
  collection: guidance(searchSchemas.collection),
  sets: guidance(searchSchemas.sets),
  materials: guidance(searchSchemas.materials),
  skillItems: guidance(searchSchemas.skillItems),
  oracle: guidance(searchSchemas.oracle),
  planner: guidance(searchSchemas.planner),
  atlas: guidance(searchSchemas.atlas),
  miWorkshop: guidance(searchSchemas.miWorkshop),
  supplies: guidance(searchSchemas.supplies),
  dismantling: guidance(searchSchemas.dismantling),
  farming: guidance(searchSchemas.farming),
  vault: guidance(searchSchemas.vault),
  history: guidance(searchSchemas.history)
}
