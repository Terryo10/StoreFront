import { describe, expect, it } from 'vitest'
import { dueIn, summarisePayments, toTenderLine, validateTender } from './payment-math'

const rates = { USD: '1', ZWG: '26.80' }
const t = (method: 'cash' | 'card' | 'mobile_money', currency: 'USD' | 'ZWG', amount: string, reference: string | null = null) =>
  toTenderLine({ id: crypto.randomUUID(), method, currency, amount, reference }, rates)

describe('payment maths', () => {
  it('gives change in USD for an overpaying USD cash tender', () => {
    const s = summarisePayments('7.40', [t('cash', 'USD', '10')], rates)
    expect(s.settled).toBe(true)
    expect(s.changeDue).toBe('2.60')
    expect(s.changeCurrency).toBe('USD')
  })

  it('supports split payments across card and ZiG cash', () => {
    const s = summarisePayments('20.00', [t('card', 'USD', '15.00', 'TRM-0042'), t('cash', 'ZWG', '134.00')], rates)
    expect(s.paidBase).toBe('20.00')
    expect(s.settled).toBe(true)
    expect(s.changeDue).toBe('0.00')
  })

  it('gives change in ZiG when the last cash tender was ZiG', () => {
    const s = summarisePayments('10.00', [t('cash', 'ZWG', '300.00')], rates)
    expect(s.changeCurrency).toBe('ZWG')
    expect(s.changeDue).toBe('32.00')
  })

  it('does not lose a cent of ZiG change to division residue', () => {
    // 100 − 2.90 × 26.80 = 22.28 exactly.
    expect(summarisePayments('2.90', [t('cash', 'ZWG', '100')], rates).changeDue).toBe('22.28')
  })

  it('reports the remaining balance', () => {
    const s = summarisePayments('10.00', [t('cash', 'USD', '4.00')], rates)
    expect(s.settled).toBe(false)
    expect(s.remainingBase).toBe('6.00')
  })

  it('rounds the exact ZiG amount up so it never falls short', () => {
    const due = dueIn('3.33', 'ZWG', { USD: '1', ZWG: '26.73' })
    expect(due).toBe('89.02')
    const s = summarisePayments('3.33', [toTenderLine({ id: 'x', method: 'cash', currency: 'ZWG', amount: due, reference: null }, { USD: '1', ZWG: '26.73' })], { USD: '1', ZWG: '26.73' })
    expect(s.settled).toBe(true)
  })

  it('does not allow card or mobile money above the amount owed', () => {
    expect(validateTender({ id: 'a', method: 'card', currency: 'USD', amount: '12', reference: 'REF123' }, '10.00', rates)).toMatch(/cannot be more/)
    expect(validateTender({ id: 'a', method: 'mobile_money', currency: 'USD', amount: '5', reference: '' }, '10.00', rates)).toMatch(/reference/)
    expect(validateTender({ id: 'a', method: 'cash', currency: 'USD', amount: '50', reference: null }, '10.00', rates)).toBeNull()
  })
})
