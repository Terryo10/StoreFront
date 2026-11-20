import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 1366, height: 768 } })

const SHOTS = process.env.E2E_SHOTS === '1'

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `test-results/shots/${name}.png` })
}

async function freshTill(page: Page) {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('zw_pos')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  })
  await page.reload()
}

async function signInIfNeeded(page: Page, email: string) {
  const emailField = page.getByLabel('Email')
  await expect(emailField.or(page.getByLabel('Scan barcode or search products')).or(page.getByRole('heading', { name: 'Open a shift' })).first()).toBeVisible()
  if (await emailField.isVisible()) {
    await emailField.fill(email)
    await page.keyboard.press('Tab')
    await page.keyboard.type('demo')
    await page.keyboard.press('Enter')
  }
}

async function openShiftWithKeyboard(page: Page) {
  await expect(page.getByRole('heading', { name: 'Open a shift' })).toBeVisible()
  await shot(page, '02-open-shift')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Scan barcode or search products')).toBeFocused()
}

async function scan(page: Page, code: string) {
  await page.keyboard.type(code, { delay: 5 })
  await page.keyboard.press('Enter')
}

test('cashier completes a sale with only the keyboard and scanner', async ({ page }) => {
  await freshTill(page)
  await expect(page.getByLabel('Email')).toBeFocused()
  await shot(page, '01-login')
  await signInIfNeeded(page, 'cashier@demo.local')
  await openShiftWithKeyboard(page)

  await scan(page, '6009000000001')
  await scan(page, '2*6009000000002')
  const cart = page.getByRole('list', { name: 'Cart' })
  await expect(cart.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByTestId('cart-total')).toContainText('13.30')
  await shot(page, '03-sale')

  await page.keyboard.press('F10')
  await expect(page.getByRole('dialog', { name: 'Take payment' })).toBeVisible()
  await expect(page.getByLabel(/Cash received/)).toBeFocused()
  await page.keyboard.type('20')
  await shot(page, '04-payment')
  await page.keyboard.press('Enter')

  const receipt = page.getByRole('dialog', { name: 'Sale completed' })
  await expect(receipt).toBeVisible()
  await expect(receipt).toContainText('US$ 6.70')
  await expect(receipt).toContainText(/Receipt T\w+-0001-0001/)
  await expect(receipt.getByText(/Saved locally|Pending sync|Synced/).first()).toBeVisible()
  await shot(page, '05-receipt')

  await page.keyboard.press('Enter')
  await expect(receipt).toBeHidden()
  await expect(cart.getByRole('listitem')).toHaveCount(0)
  await expect(page.getByLabel('Scan barcode or search products')).toBeFocused()
})

test('an unfinished cart survives a reload and a held sale can be resumed', async ({ page }) => {
  await freshTill(page)
  await signInIfNeeded(page, 'cashier@demo.local')
  await openShiftWithKeyboard(page)

  await scan(page, '6009000000009')
  await expect(page.getByRole('list', { name: 'Cart' }).getByRole('listitem')).toHaveCount(1)

  await page.reload()
  await signInIfNeeded(page, 'cashier@demo.local')
  const cart = page.getByRole('list', { name: 'Cart' })
  await expect(cart.getByRole('listitem')).toHaveCount(1)
  await expect(cart).toContainText('Mazoe')

  await page.keyboard.press('F4')
  const holdDialog = page.getByRole('dialog', { name: 'Hold this sale' })
  await expect(holdDialog).toBeVisible()
  await page.keyboard.type('Blue shirt')
  await page.keyboard.press('Enter')
  await expect(holdDialog).toBeHidden()
  await expect(cart).toBeHidden()

  await page.keyboard.press('F6')
  const held = page.getByRole('dialog', { name: 'Held sales' })
  await expect(held).toContainText('Blue shirt')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('list', { name: 'Cart' })).toContainText('Mazoe')
})

test('sync page shows pending events and the counter sees a blind count', async ({ page }) => {
  await freshTill(page)
  await signInIfNeeded(page, 'cashier@demo.local')
  await openShiftWithKeyboard(page)
  await scan(page, '6009000000001')
  await expect(page.getByRole('list', { name: 'Cart' }).getByRole('listitem')).toHaveCount(1)
  await page.keyboard.press('F10')
  await expect(page.getByLabel(/Cash received/)).toBeFocused()
  await page.keyboard.press('F8')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Sale completed' })).toBeVisible()
  await page.keyboard.press('Enter')

  await page.keyboard.press('Alt+5')
  await expect(page.getByRole('heading', { name: 'Sync' })).toBeVisible()
  await expect(page.getByRole('cell', { name: /^Sale/ }).first()).toBeVisible()
  await shot(page, '06-sync')

  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Sign out' }).click()
  await signInIfNeeded(page, 'counter@demo.local')
  await expect(page.getByRole('heading', { name: 'Stock counts' })).toBeVisible()
  await page.goto('/#/count/stk-blind-shelf')
  await expect(page.getByRole('textbox', { name: /Scan/ })).toBeFocused()
  await scan(page, '6009000000001')
  await expect(page.getByText('Pearlenta Mealie Meal 10kg').first()).toBeVisible()
  await expect(page.getByText(/not in the catalogue/)).toHaveCount(0)
  await page.keyboard.type('12')
  await shot(page, '07-count')
  await page.keyboard.press('Enter')
  await expect(page.getByText(/1 item counted/)).toBeVisible()
  await expect(page.getByText(/^Expected/)).toHaveCount(0)
  const html = await page.content()
  expect(html).not.toMatch(/expected\s*(quantity|qty)?\s*:?\s*\d/i)
})
