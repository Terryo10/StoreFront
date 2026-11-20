import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { openTestShift, resetDb, sellCash } from '@/test/fixtures'
import { useAuth } from '@/features/auth/auth-store'
import { CloseShiftPage } from './CloseShiftPage'

describe('blind shift close', () => {
  beforeEach(resetDb)

  it('reveals expected cash only after the cashier confirms the count', async () => {
    const shift = await openTestShift()
    await sellCash(shift.id, [[1]], '10')
    useAuth.setState({ session: { userId: 'u-cashier', name: 'Tendai Moyo', email: 'cashier@demo.local', role: 'cashier', authMode: 'mock' } })

    render(
      <MemoryRouter>
        <CloseShiftPage />
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    const usd = await screen.findByLabelText('US$ counted')
    expect(screen.queryByText('Expected')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('57.50')

    await user.type(usd, '57')
    await user.type(screen.getByLabelText('ZiG counted'), '0')
    await user.click(screen.getByRole('button', { name: 'Review count' }))
    expect(document.body.textContent).not.toContain('57.50')

    await user.click(await screen.findByRole('button', { name: 'Confirm and close shift' }))
    expect(await screen.findByText(/Shift 1 closed/)).toBeInTheDocument()
    expect(screen.getByText('Expected')).toBeInTheDocument()
    expect(screen.getByText('US$ 57.50')).toBeInTheDocument()
    expect(screen.getByText('Short US$ 0.50')).toBeInTheDocument()
  })
})
