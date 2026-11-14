import { describe, expect, it } from 'vitest'
import { addQty, applyCountMode, qtyString, variancePct } from './decimal'

describe('decimal helpers', () => {
  it('avoids float drift for money-like quantities', () => {
    expect(addQty('0.1', '0.2')).toBe('0.300000')
  })

  it('replace overwrites and add increments', () => {
    expect(applyCountMode('5.000000', '2', 'replace')).toBe('2.000000')
    expect(applyCountMode('5.000000', '2', 'add')).toBe('7.000000')
  })

  it('formats scale 6', () => {
    expect(qtyString(3)).toBe('3.000000')
  })

  it('computes variance percent', () => {
    expect(variancePct('10', '12')).toBeCloseTo(20)
    expect(variancePct(null, '1')).toBeNull()
  })
})
