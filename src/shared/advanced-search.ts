import { compileSearchQuery, type SearchExpression } from './search-query.ts'
import { searchQueryOptions, type SearchFieldDefinition, type SearchWorkspaceSchema } from './search-schema.ts'

export type AdvancedSearchCombinator = 'all' | 'any'
export type AdvancedSearchOperator =
  | 'contains'
  | 'exact'
  | 'is'
  | 'is-not'
  | 'at-least'
  | 'at-most'
  | 'greater-than'
  | 'less-than'

export interface AdvancedSearchRule {
  id: number
  field: string
  operator: AdvancedSearchOperator
  value: string
  negated: boolean
}

export interface AdvancedSearchDraft {
  combinator: AdvancedSearchCombinator
  rules: AdvancedSearchRule[]
  preservedQuery: string
}

export interface AdvancedSearchParseResult {
  draft: AdvancedSearchDraft
  representable: boolean
  notice: string | null
}

export interface AdvancedSearchBuildResult {
  query: string
  error: string | null
  errorRuleId: number | null
}

let nextRuleId = 1

export function newAdvancedSearchRule(field = ''): AdvancedSearchRule {
  return { id: nextRuleId++, field, operator: 'contains', value: '', negated: false }
}

export function operatorsForField(field: SearchFieldDefinition | null): readonly AdvancedSearchOperator[] {
  if (!field || field.kind === 'text') return ['contains', 'exact', 'is-not']
  if (field.kind === 'number') return ['is', 'at-least', 'at-most', 'greater-than', 'less-than', 'is-not']
  return ['is', 'is-not']
}

function flatten(expression: SearchExpression, kind: 'and' | 'or'): SearchExpression[] {
  return expression.kind === kind
    ? [...flatten(expression.left, kind), ...flatten(expression.right, kind)]
    : [expression]
}

function isRuleExpression(expression: SearchExpression): boolean {
  return expression.kind === 'term' || (expression.kind === 'not' && expression.operand.kind === 'term')
}

function unrepresentable(query: string, notice: string): AdvancedSearchParseResult {
  return {
    draft: { combinator: 'all', rules: [newAdvancedSearchRule()], preservedQuery: query },
    representable: false,
    notice
  }
}

function ruleFromExpression(
  expression: SearchExpression,
  query: string,
  schema: SearchWorkspaceSchema
): AdvancedSearchRule | null {
  const excluded = expression.kind === 'not'
  const term = excluded ? expression.operand : expression
  if (term.kind !== 'term') return null
  const field = term.field ? (schema.aliases?.[term.field] ?? term.field) : ''
  const definition = schema.fields.find((candidate) => candidate.name === field) ?? null
  if (field && !definition) return null
  let value = term.value
  let operator: AdvancedSearchOperator = definition?.kind === 'number' ? 'is' : 'contains'
  const comparison = /^(>=|<=|>|<|=)\s*(.+)$/.exec(value)
  if (definition?.kind === 'number' && comparison) {
    operator = comparison[1] === '>='
      ? 'at-least'
      : comparison[1] === '<='
        ? 'at-most'
        : comparison[1] === '>'
          ? 'greater-than'
          : comparison[1] === '<'
            ? 'less-than'
            : 'is'
    value = comparison[2]!
  } else if (definition?.kind === 'choice' || definition?.kind === 'boolean') {
    operator = 'is'
  } else {
    const raw = query.slice(term.start, term.end)
    if (raw.includes('"')) operator = 'exact'
  }
  const negated = excluded && definition?.kind === 'number' && operator !== 'is'
  if (excluded && !negated) operator = 'is-not'
  return { id: nextRuleId++, field, operator, value, negated }
}

export function parseAdvancedSearchDraft(query: string, schema: SearchWorkspaceSchema): AdvancedSearchParseResult {
  const trimmed = query.trim()
  if (!trimmed) {
    return {
      draft: { combinator: 'all', rules: [newAdvancedSearchRule()], preservedQuery: '' },
      representable: true,
      notice: null
    }
  }
  const compiled = compileSearchQuery(trimmed, searchQueryOptions(schema))
  if (compiled.error || !compiled.expression) {
    return unrepresentable(trimmed, 'The current query has a syntax error. It will remain unchanged unless you reset it.')
  }

  let combinator: AdvancedSearchCombinator = 'all'
  let expressions: SearchExpression[]
  if (compiled.expression.kind === 'or') {
    combinator = 'any'
    expressions = flatten(compiled.expression, 'or')
    if (expressions.some((expression) => expression.kind === 'not')) {
      return unrepresentable(trimmed, 'This query combines exclusions with OR in a way the form cannot edit safely. It is preserved as a locked clause.')
    }
  } else if (compiled.expression.kind === 'and') {
    const andParts = flatten(compiled.expression, 'and')
    const positiveParts = andParts.filter((part) => part.kind !== 'not')
    const excludedParts = andParts.filter((part) => part.kind === 'not')
    if (positiveParts.length === 1 && positiveParts[0]?.kind === 'or') {
      combinator = 'any'
      expressions = [...flatten(positiveParts[0], 'or'), ...excludedParts]
    } else {
      expressions = andParts
    }
  } else {
    expressions = [compiled.expression]
  }

  if (!expressions.every(isRuleExpression)) {
    return unrepresentable(trimmed, 'This query uses nested or mixed Boolean groups that the form cannot edit. It is preserved as a locked clause.')
  }
  const rules = expressions.map((expression) => ruleFromExpression(expression, trimmed, schema))
  if (rules.some((rule) => !rule)) {
    return unrepresentable(trimmed, 'This query uses syntax that the form cannot edit. It is preserved as a locked clause.')
  }
  return {
    draft: { combinator, rules: rules as AdvancedSearchRule[], preservedQuery: '' },
    representable: true,
    notice: null
  }
}

function quoteValue(value: string, force = false): string {
  const trimmed = value.trim()
  if (!force && /^[\p{L}\p{N}_.’'-]+$/u.test(trimmed) && !/^(AND|OR|NOT)$/iu.test(trimmed)) return trimmed
  return `"${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function ruleTerm(rule: AdvancedSearchRule, schema: SearchWorkspaceSchema): { term: string; error: string | null } {
  const value = rule.value.trim()
  if (!value) return { term: '', error: 'Every rule needs a value.' }
  const definition = rule.field ? schema.fields.find((field) => field.name === rule.field) : null
  if (rule.field && !definition) return { term: '', error: `Unknown field “${rule.field}”.` }
  if (definition?.kind === 'number' && !/^-?\d+(?:\.\d+)?$/.test(value)) {
    return { term: '', error: `${definition.label} needs a number.` }
  }
  const comparison = rule.operator === 'at-least'
    ? '>='
    : rule.operator === 'at-most'
      ? '<='
      : rule.operator === 'greater-than'
        ? '>'
        : rule.operator === 'less-than'
          ? '<'
          : ''
  const renderedValue = definition?.kind === 'number'
    ? `${comparison}${value}`
    : quoteValue(value, rule.operator === 'exact')
  const term = `${rule.field ? `${rule.field}:` : ''}${renderedValue}`
  return { term, error: null }
}

export function buildAdvancedSearchQuery(draft: AdvancedSearchDraft, schema: SearchWorkspaceSchema): AdvancedSearchBuildResult {
  const activeRules = draft.rules.filter((rule) => rule.field || rule.value.trim())
  const positive: string[] = []
  const excluded: string[] = []
  for (const rule of activeRules) {
    const index = draft.rules.indexOf(rule)
    const built = ruleTerm(rule, schema)
    if (built.error) return { query: '', error: `Rule ${index + 1}: ${built.error}`, errorRuleId: rule.id }
    if (rule.negated || rule.operator === 'is-not') excluded.push(`NOT ${built.term}`)
    else positive.push(built.term)
  }

  const joiner = draft.combinator === 'any' ? ' OR ' : ' AND '
  const positiveClause = positive.length > 1 ? positive.join(joiner) : positive[0] ?? ''
  const generated = [
    draft.combinator === 'any' && positive.length > 1 && excluded.length ? `(${positiveClause})` : positiveClause,
    ...excluded
  ].filter(Boolean).join(' AND ')
  const preserved = draft.preservedQuery.trim()
  const query = preserved && generated ? `(${preserved}) AND (${generated})` : preserved || generated
  const compiled = compileSearchQuery(query, searchQueryOptions(schema))
  if (compiled.error) return { query: '', error: compiled.error.message, errorRuleId: null }
  return { query, error: null, errorRuleId: null }
}
