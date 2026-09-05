import type { SearchExpression } from '../shared/search-query.ts'

export interface SqlSearchFragment {
  sql: string
  parameters: Array<string | number>
}

export function textSearchSql(expression: string, value: string): SqlSearchFragment {
  return {
    sql: `LOWER(COALESCE(${expression}, '')) LIKE ? ESCAPE char(92)`,
    parameters: [`%${value.replace(/[\\%_]/g, '\\$&')}%`]
  }
}

export function numericSearchSql(expression: string, value: string): SqlSearchFragment {
  const match = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(value)
  if (!match) return { sql: '0', parameters: [] }
  return { sql: `CAST(${expression} AS REAL) ${match[1] ?? '='} ?`, parameters: [Number(match[2])] }
}

export function searchExpressionSql(
  expression: SearchExpression,
  resolveTerm: (term: Extract<SearchExpression, { kind: 'term' }>) => SqlSearchFragment
): SqlSearchFragment {
  if (expression.kind === 'term') return resolveTerm(expression)
  if (expression.kind === 'not') {
    const operand = searchExpressionSql(expression.operand, resolveTerm)
    return { sql: `(NOT (${operand.sql}))`, parameters: operand.parameters }
  }
  const left = searchExpressionSql(expression.left, resolveTerm)
  const right = searchExpressionSql(expression.right, resolveTerm)
  return {
    sql: `((${left.sql}) ${expression.kind === 'and' ? 'AND' : 'OR'} (${right.sql}))`,
    parameters: [...left.parameters, ...right.parameters]
  }
}
