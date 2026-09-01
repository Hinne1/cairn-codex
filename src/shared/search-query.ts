export type SearchScalar = string | number | boolean
export type SearchFieldValue = SearchScalar | readonly SearchScalar[] | null | undefined

export interface SearchDocument {
  text: string
  fields?: Readonly<Record<string, SearchFieldValue>>
}

export interface SearchQueryError {
  message: string
  start: number
  end: number
  fragment: string
}

export type SearchExpression =
  | { kind: 'term'; field: string | null; value: string; start: number; end: number }
  | { kind: 'not'; operand: SearchExpression }
  | { kind: 'and'; left: SearchExpression; right: SearchExpression }
  | { kind: 'or'; left: SearchExpression; right: SearchExpression }

export interface SearchQueryOptions {
  fields?: readonly string[]
  aliases?: Readonly<Record<string, string>>
  numericFields?: readonly string[]
}

export interface CompiledSearchQuery {
  expression: SearchExpression | null
  error: SearchQueryError | null
  matches: (document: SearchDocument) => boolean
}

type TokenKind = 'term' | 'and' | 'or' | 'not' | 'left' | 'right'

interface Token {
  kind: TokenKind
  raw: string
  start: number
  end: number
}

class SearchSyntaxError extends Error {
  readonly start: number
  readonly end: number

  constructor(
    message: string,
    start: number,
    end: number
  ) {
    super(message)
    this.start = start
    this.end = end
  }
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function compact(value: string): string {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, '')
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = []
  let cursor = 0
  while (cursor < query.length) {
    if (/\s/u.test(query[cursor]!)) {
      cursor += 1
      continue
    }
    if (query[cursor] === '(' || query[cursor] === ')') {
      tokens.push({
        kind: query[cursor] === '(' ? 'left' : 'right',
        raw: query[cursor]!,
        start: cursor,
        end: cursor + 1
      })
      cursor += 1
      continue
    }
    const start = cursor
    let quoted = false
    let escaped = false
    while (cursor < query.length) {
      const character = query[cursor]!
      if (escaped) {
        escaped = false
        cursor += 1
        continue
      }
      if (character === '\\' && quoted) {
        escaped = true
        cursor += 1
        continue
      }
      if (character === '"') {
        quoted = !quoted
        cursor += 1
        continue
      }
      if (!quoted && (/\s/u.test(character) || character === '(' || character === ')')) break
      cursor += 1
    }
    if (quoted) throw new SearchSyntaxError('Missing a closing quote.', start, query.length)
    const raw = query.slice(start, cursor)
    const operator = raw.toLocaleUpperCase()
    if (operator === 'AND' || operator === 'OR' || operator === 'NOT') {
      tokens.push({ kind: operator.toLocaleLowerCase() as 'and' | 'or' | 'not', raw, start, end: cursor })
    } else if (raw.startsWith('-') && raw.length > 1) {
      tokens.push({ kind: 'not', raw: '-', start, end: start + 1 })
      tokens.push({ kind: 'term', raw: raw.slice(1), start: start + 1, end: cursor })
    } else {
      tokens.push({ kind: 'term', raw, start, end: cursor })
    }
  }
  return tokens
}

function decodeValue(raw: string, start: number, end: number): string {
  const quoted = raw.startsWith('"') || raw.endsWith('"')
  if (quoted && !(raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)) {
    throw new SearchSyntaxError('Quoted values need both opening and closing quotes.', start, end)
  }
  const value = quoted ? raw.slice(1, -1) : raw
  const decoded = value.replace(/\\(["\\])/g, '$1').trim()
  if (!decoded) throw new SearchSyntaxError('Search terms cannot be empty.', start, end)
  return normalize(decoded)
}

function termExpression(token: Token): SearchExpression {
  const separator = token.raw.indexOf(':')
  if (separator < 0) {
    return { kind: 'term', field: null, value: decodeValue(token.raw, token.start, token.end), start: token.start, end: token.end }
  }
  const field = normalize(token.raw.slice(0, separator).trim())
  if (!field) throw new SearchSyntaxError('A field name is required before “:”.', token.start, token.end)
  const valueStart = token.start + separator + 1
  const value = decodeValue(token.raw.slice(separator + 1), valueStart, token.end)
  return { kind: 'term', field, value, start: token.start, end: token.end }
}

class Parser {
  private cursor = 0
  private readonly tokens: Token[]
  private readonly query: string

  constructor(tokens: Token[], query: string) {
    this.tokens = tokens
    this.query = query
  }

  parse(): SearchExpression | null {
    if (this.tokens.length === 0) return null
    const expression = this.parseOr()
    const remaining = this.peek()
    if (remaining) throw this.unexpected(remaining)
    return expression
  }

  private parseOr(): SearchExpression {
    let expression = this.parseAnd()
    while (this.peek()?.kind === 'or') {
      const operator = this.take()!
      if (!this.startsExpression(this.peek())) {
        throw new SearchSyntaxError('OR needs a search expression on both sides.', operator.start, operator.end)
      }
      expression = { kind: 'or', left: expression, right: this.parseAnd() }
    }
    return expression
  }

  private parseAnd(): SearchExpression {
    let expression = this.parseUnary()
    while (true) {
      const next = this.peek()
      if (next?.kind === 'and') {
        const operator = this.take()!
        if (!this.startsExpression(this.peek())) {
          throw new SearchSyntaxError('AND needs a search expression on both sides.', operator.start, operator.end)
        }
        expression = { kind: 'and', left: expression, right: this.parseUnary() }
        continue
      }
      if (this.startsExpression(next)) {
        expression = { kind: 'and', left: expression, right: this.parseUnary() }
        continue
      }
      return expression
    }
  }

  private parseUnary(): SearchExpression {
    const token = this.peek()
    if (token?.kind === 'not') {
      this.take()
      if (!this.startsExpression(this.peek())) {
        throw new SearchSyntaxError('NOT needs a search expression.', token.start, token.end)
      }
      return { kind: 'not', operand: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): SearchExpression {
    const token = this.take()
    if (!token) throw new SearchSyntaxError('A search expression is required.', this.query.length, this.query.length)
    if (token.kind === 'term') return termExpression(token)
    if (token.kind === 'left') {
      if (this.peek()?.kind === 'right') {
        const close = this.take()!
        throw new SearchSyntaxError('Parentheses cannot be empty.', token.start, close.end)
      }
      const expression = this.parseOr()
      const close = this.take()
      if (close?.kind !== 'right') {
        throw new SearchSyntaxError('Missing a closing parenthesis.', token.start, this.query.length)
      }
      return expression
    }
    throw this.unexpected(token)
  }

  private startsExpression(token: Token | undefined): boolean {
    return token?.kind === 'term' || token?.kind === 'left' || token?.kind === 'not'
  }

  private unexpected(token: Token): SearchSyntaxError {
    return new SearchSyntaxError(`Unexpected “${token.raw}”.`, token.start, token.end)
  }

  private peek(): Token | undefined {
    return this.tokens[this.cursor]
  }

  private take(): Token | undefined {
    const token = this.tokens[this.cursor]
    this.cursor += 1
    return token
  }
}

function numericMatch(actual: number, expected: string): boolean {
  const match = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(expected)
  if (!match) return false
  const target = Number(match[2])
  if (match[1] === '>=') return actual >= target
  if (match[1] === '<=') return actual <= target
  if (match[1] === '>') return actual > target
  if (match[1] === '<') return actual < target
  return actual === target
}

function scalarMatch(actual: SearchScalar, expected: string): boolean {
  if (typeof actual === 'number') return numericMatch(actual, expected)
  if (typeof actual === 'boolean') {
    const normalized = expected === 'yes' ? 'true' : expected === 'no' ? 'false' : expected
    return String(actual) === normalized
  }
  const normalized = normalize(actual)
  return normalized.includes(expected) || compact(normalized).includes(compact(expected))
}

function fieldMatch(value: SearchFieldValue, expected: string): boolean {
  if (value === null || value === undefined) return false
  return Array.isArray(value)
    ? value.some((entry) => scalarMatch(entry, expected))
    : scalarMatch(value as SearchScalar, expected)
}

function evaluate(expression: SearchExpression, document: SearchDocument, aliases: Readonly<Record<string, string>>): boolean {
  if (expression.kind === 'and') return evaluate(expression.left, document, aliases) && evaluate(expression.right, document, aliases)
  if (expression.kind === 'or') return evaluate(expression.left, document, aliases) || evaluate(expression.right, document, aliases)
  if (expression.kind === 'not') return !evaluate(expression.operand, document, aliases)
  if (!expression.field) return scalarMatch(document.text, expression.value)
  const field = aliases[expression.field] ?? expression.field
  return fieldMatch(document.fields?.[field], expression.value)
}

function findUnknownField(expression: SearchExpression, allowed: ReadonlySet<string>, aliases: Readonly<Record<string, string>>): SearchExpression | null {
  if (expression.kind === 'term') {
    if (!expression.field) return null
    const field = aliases[expression.field] ?? expression.field
    return allowed.has(field) ? null : expression
  }
  if (expression.kind === 'not') return findUnknownField(expression.operand, allowed, aliases)
  return findUnknownField(expression.left, allowed, aliases) ?? findUnknownField(expression.right, allowed, aliases)
}

function findInvalidNumericField(expression: SearchExpression, numeric: ReadonlySet<string>, aliases: Readonly<Record<string, string>>): SearchExpression | null {
  if (expression.kind === 'term') {
    if (!expression.field) return null
    const field = aliases[expression.field] ?? expression.field
    return numeric.has(field) && !/^(>=|<=|>|<|=)?\s*-?\d+(?:\.\d+)?$/.test(expression.value)
      ? expression
      : null
  }
  if (expression.kind === 'not') return findInvalidNumericField(expression.operand, numeric, aliases)
  return findInvalidNumericField(expression.left, numeric, aliases) ?? findInvalidNumericField(expression.right, numeric, aliases)
}

export function compileSearchQuery(query: string, options: SearchQueryOptions = {}): CompiledSearchQuery {
  try {
    const expression = new Parser(tokenize(query), query).parse()
    const aliases = Object.fromEntries(
      Object.entries(options.aliases ?? {}).map(([field, target]) => [normalize(field), normalize(target)])
    )
    if (expression && options.fields) {
      const allowed = new Set(options.fields.map(normalize))
      const unknown = findUnknownField(expression, allowed, aliases)
      if (unknown?.kind === 'term') {
        throw new SearchSyntaxError(`Unknown search field “${unknown.field}”.`, unknown.start, unknown.end)
      }
    }
    if (expression && options.numericFields) {
      const invalid = findInvalidNumericField(expression, new Set(options.numericFields.map(normalize)), aliases)
      if (invalid?.kind === 'term') {
        throw new SearchSyntaxError(`Search field “${invalid.field}” needs a number or comparison such as >=75.`, invalid.start, invalid.end)
      }
    }
    return {
      expression,
      error: null,
      matches: (document) => expression ? evaluate(expression, document, aliases) : true
    }
  } catch (error) {
    const syntax = error instanceof SearchSyntaxError
      ? error
      : new SearchSyntaxError(error instanceof Error ? error.message : String(error), 0, query.length)
    return {
      expression: null,
      error: {
        message: syntax.message,
        start: syntax.start,
        end: syntax.end,
        fragment: query.slice(syntax.start, syntax.end)
      },
      // Invalid edits never destroy the current result surface.
      matches: () => true
    }
  }
}
