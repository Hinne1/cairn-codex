import type { ItemPresentationLine } from '../../shared/contracts.ts'

export function formatRollValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

export function formatPresentationLine(line: ItemPresentationLine): string {
  const minimum = line.minimum === null ? '' : formatRollValue(line.minimum)
  const maximum = line.maximum === null ? '' : formatRollValue(line.maximum)
  const range = maximum ? `${minimum}${line.unit} - ${maximum}${line.unit}` : `${minimum}${line.unit}`
  return `${line.prefix}${range}${range ? ' ' : ''}${line.label}${line.suffix}`
}
