import { test, expect } from '@playwright/test'

test('login, open counting, save local count with keyboard', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('counter@demo.local')
  await page.getByLabel('Password').fill('demo')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await page.getByRole('link', { name: 'Mobile count' }).click()
  await expect(page.getByRole('heading', { name: /Assigned|open stocktakes/i })).toBeVisible()

  const session = page.getByRole('link').filter({ hasText: /count|progress|Weekend/i }).first()
  await session.click()

  const scan = page.getByLabel('Scan barcode')
  await expect(scan).toBeFocused()

  // Use a deterministic seeded barcode pattern 6039 + padded catalogue number
  await scan.fill('6039000000001')
  await scan.press('Enter')

  await expect(page.getByText(/Current local count|Replace|Confirm count/i).first()).toBeVisible({
    timeout: 10_000,
  })

  await page.getByRole('button', { name: '1' }).click()
  await page.getByRole('button', { name: 'Confirm count' }).click()
  await expect(page.getByText(/Saved locally|Last display qty/i).first()).toBeVisible()
})
