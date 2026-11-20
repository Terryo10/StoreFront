import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { db } from '@/db/schema'
import { barcodeFor, resetDb } from '@/test/fixtures'
import { useAuth } from '@/features/auth/auth-store'
import { useSettings } from '@/features/settings/settings-store'
import type { Role } from '@/lib/permissions'
import { CountScreen } from './CountScreen'

// prd-00009 has an expected quantity of 24 in the seeded open stocktake.
const EXPECTED = '24'

async function renderAs(role: Role, stocktakeId: string) {
  useAuth.setState({ session: { userId: `u-${role}`, name: role, email: `${role}@demo.local`, role, authMode: 'mock' } })
  await useSettings.getState().load()
  render(
    <MemoryRouter initialEntries={[`/count/${stocktakeId}`]}>
      <Routes>
        <Route path="/count/:stocktakeId" element={<CountScreen />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByLabelText('Scan barcode')
}

function assertNoExpected(container: HTMLElement) {
  expect(container.textContent ?? '').not.toMatch(/expected\s*\d/i)
  for (const el of container.querySelectorAll('*')) {
    for (const attr of el.getAttributeNames()) {
      if (attr.startsWith('aria-') || attr === 'title' || attr.startsWith('data-')) {
        expect(el.getAttribute(attr) ?? '').not.toContain(EXPECTED)
      }
    }
  }
}

describe('blind counting', () => {
  beforeEach(resetDb)

  it('hides expected quantities from counters, including in aria attributes', async () => {
    // Even if an expected value were present on the record, a counter must not see it.
    await db.stocktakes.update('stk-blind-shelf', { expected: { 'prd-00009': EXPECTED } })
    await renderAs('counter', 'stk-blind-shelf')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Scan barcode'), `${barcodeFor(9)}{Enter}`)
    await screen.findByText(/Mazoe Orange Crush/)
    assertNoExpected(document.body)
  })

  it('hides expected quantities from counters on open counts too', async () => {
    await renderAs('counter', 'stk-open-bev')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Scan barcode'), `${barcodeFor(9)}{Enter}`)
    await screen.findByText(/Mazoe Orange Crush/)
    assertNoExpected(document.body)
  })

  it('shows expected quantities to supervisors only on open (non-blind) counts', async () => {
    await renderAs('supervisor', 'stk-open-bev')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Scan barcode'), `${barcodeFor(9)}{Enter}`)
    await waitFor(() => expect(screen.getByText(`Expected ${EXPECTED}`)).toBeInTheDocument())
  })
})
