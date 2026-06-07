import { expect, test } from '@playwright/test'

/**
 * Smoke: the public /sign-in route renders the auth form against the PROD
 * build. No DB seeding — this is a public, unauthenticated page; we wait on
 * explicit visible states (no fixed sleeps) so the run is first-attempt green.
 */
test('sign-in renders the auth form with email + password inputs', async ({ page }) => {
  await page.goto('/sign-in')

  // Heading proves the page (not the global-error boundary) rendered.
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()

  const email = page.locator('#auth-email')
  const password = page.locator('#auth-password')

  await expect(email).toBeVisible()
  await expect(email).toHaveAttribute('type', 'email')
  await expect(password).toBeVisible()
  await expect(password).toHaveAttribute('type', 'password')

  // The form is interactive: the submit control is present and enabled.
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
})
