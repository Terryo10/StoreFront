import { describe, expect, it } from 'vitest'
import { canSeeExpected } from './permissions'

describe('blind counting permissions', () => {
  it('hides expected from counters when blind', () => {
    expect(canSeeExpected('counter', true)).toBe(false)
    expect(canSeeExpected('manager', true)).toBe(true)
    expect(canSeeExpected('counter', false)).toBe(true)
  })
})
