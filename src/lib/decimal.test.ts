import { describe, expect, it } from 'vitest'
import { applyCountMode, money, parseDecimalInput, qty, roundToStep, sum, toBase, toForeign } from './decimal'
import { formatMoney } from './currency'

describe('decimal helpers', () => {
  it('avoids binary floating point errors', () => {
    expect(sum(['0.10', '0.20'])).toBe('0.30')
    expect(money('1.005')).toBe('1.01')
    expect(sum(['19.99', '0.01', '80'])).toBe('100.00')
  })

  it('converts between USD and ZiG with a per-shift rate', () => {
    expect(toForeign('10.00', '26.80')).toBe('268.00')
    expect(toBase('268.00', '26.80')).toBe('10.00')
    expect(() => toBase('1', '0')).toThrow()
  })

  it('rounds to a cash step, half away from zero', () => {
    expect(roundToStep('155.44', '0.05')).toBe('155.45')
    expect(roundToStep('155.42', '0.05')).toBe('155.40')
    expect(roundToStep('0.025', '0.05')).toBe('0.05')
  })

  it('formats quantities without trailing zeros', () => {
    expect(qty('2.500')).toBe('2.5')
    expect(qty('3')).toBe('3')
  })

  it('parses user input strictly', () => {
    expect(parseDecimalInput('1,250.50', { maxScale: 2 })).toBe('1250.5')
    expect(parseDecimalInput('abc')).toBeNull()
    expect(parseDecimalInput('-1')).toBeNull()
    expect(parseDecimalInput('1.2345', { maxScale: 3 })).toBeNull()
  })

  it('applies add and replace count modes', () => {
    expect(applyCountMode('4', '2', 'add')).toBe('6')
    expect(applyCountMode('4', '2', 'replace')).toBe('2')
    expect(applyCountMode(null, '1', 'add')).toBe('1')
  })

  it('formats money with grouping and currency symbol', () => {
    expect(formatMoney('1234.5', 'USD')).toBe('US$ 1,234.50')
    expect(formatMoney('-3', 'ZWG')).toBe('−ZiG 3.00')
  })
})
