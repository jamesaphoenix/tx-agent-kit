import { expect, test } from '@playwright/test'

/**
 * Smoke: an unauthenticated visit to the protected /org route (wrapped by
 * ProtectedClientRoute in app/(application)/layout.tsx) redirects to /sign-in.
 * No DB seeding — the redirect is driven purely by the absence of a session.
 * We wait on the URL transition and the rendered auth form (no fixed sleeps).
 */
test('unauthenticated protected route redirects to /sign-in', async ({ page }) => {
  await page.goto('/org')

  // ProtectedClientRoute calls router.replace(buildSignInPath(...)) once the
  // (empty) session is ready, so the URL lands on /sign-in.
  await expect(page).toHaveURL(/\/sign-in/u)

  // And the sign-in page actually rendered (not a blank redirect target).
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.locator('#auth-email')).toBeVisible()
})
