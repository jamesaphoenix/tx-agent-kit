import { createUserWithOrg } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './test-helpers.js'
import type { BrandSettings } from './teams-brand.js'

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'brand_settings'
})

const validBrandSettings: BrandSettings = {
  colors: {
    primary: '#6366F1',
    secondary: '#8B5CF6',
    accent: '#F59E0B',
    background: '#FFFFFF',
    text: '#1A1A2E'
  },
  brandGuidelines: 'Professional tone, avoid slang',
  industry: 'saas',
  targetAudience: 'B2B decision makers aged 30-50'
}

describe('Brand Settings — Team API', () => {
  it('creates a team with full brandSettings and returns them in the response', async () => {
    const { token, org } = await createUserWithOrg(getFactoryContext())

    const { response, body } = await request<{ id: string; brandSettings: BrandSettings }>(
      '/v1/teams',
      'create-team-with-brand',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: org.id,
          name: 'Brand Test Workspace',
          brandSettings: validBrandSettings
        })
      }
    )

    expect(response.status).toBe(201)
    expect(body.brandSettings).toEqual(validBrandSettings)
  })

  it('returns brandSettings in GET /v1/teams/:teamId', async () => {
    const { token, org } = await createUserWithOrg(getFactoryContext())

    const createRes = await request<{ id: string }>(
      '/v1/teams',
      'create-for-get',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: org.id,
          name: 'GET Brand Workspace',
          brandSettings: validBrandSettings
        })
      }
    )

    const { response, body } = await request<{ brandSettings: BrandSettings }>(
      `/v1/teams/${createRes.body.id}`,
      'get-team-brand',
      {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` }
      }
    )

    expect(response.status).toBe(200)
    expect(body.brandSettings).toEqual(validBrandSettings)
  })

  it('updates brandSettings via PATCH /v1/teams/:teamId', async () => {
    const { token, org } = await createUserWithOrg(getFactoryContext())

    const createRes = await request<{ id: string }>(
      '/v1/teams',
      'create-for-update',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: org.id,
          name: 'Update Brand Workspace',
          brandSettings: validBrandSettings
        })
      }
    )

    const updatedBrand: BrandSettings = {
      ...validBrandSettings,
      colors: { ...validBrandSettings.colors, primary: '#FF0000' },
      industry: 'healthcare'
    }

    const { response, body } = await request<{ brandSettings: BrandSettings }>(
      `/v1/teams/${createRes.body.id}`,
      'update-brand',
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ brandSettings: updatedBrand })
      }
    )

    expect(response.status).toBe(200)
    expect(body.brandSettings.colors.primary).toBe('#FF0000')
    expect(body.brandSettings.industry).toBe('healthcare')
  })

  it('clears brandSettings when PATCH sends brandSettings: null', async () => {
    const { token, org } = await createUserWithOrg(getFactoryContext())

    const createRes = await request<{ id: string }>(
      '/v1/teams',
      'create-for-clear',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: org.id,
          name: 'Clear Brand Workspace',
          brandSettings: validBrandSettings
        })
      }
    )

    const { response, body } = await request<{ brandSettings: BrandSettings | null }>(
      `/v1/teams/${createRes.body.id}`,
      'clear-brand',
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ brandSettings: null })
      }
    )

    expect(response.status).toBe(200)
    expect(body.brandSettings).toBeNull()
  })

  it('rejects invalid hex color with 400', async () => {
    const { token, org } = await createUserWithOrg(getFactoryContext())

    const invalidBrand = {
      ...validBrandSettings,
      colors: { ...validBrandSettings.colors, primary: '#GGGGGG' }
    }

    const { response } = await request<unknown>(
      '/v1/teams',
      'create-invalid-hex',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: org.id,
          name: 'Invalid Hex Workspace',
          brandSettings: invalidBrand
        })
      }
    )

    expect(response.status).toBe(400)
  })

  it('rejects missing brandSettings on create with 400', async () => {
    const { token, org } = await createUserWithOrg(getFactoryContext())

    const { response } = await request<unknown>(
      '/v1/teams',
      'create-no-brand',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: org.id,
          name: 'No Brand Workspace'
        })
      }
    )

    expect(response.status).toBe(400)
  })

  it('returns brandSettings in list teams response', async () => {
    const { token, org } = await createUserWithOrg(getFactoryContext())

    await request<unknown>(
      '/v1/teams',
      'create-for-list',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: org.id,
          name: 'List Brand Workspace',
          brandSettings: validBrandSettings
        })
      }
    )

    const { response, body } = await request<{ data: { brandSettings: BrandSettings | null }[] }>(
      `/v1/teams?organizationId=${org.id}`,
      'list-teams-brand',
      {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` }
      }
    )

    expect(response.status).toBe(200)
    expect(body.data.length).toBeGreaterThan(0)
    const teamWithBrand = body.data.find((t) => t.brandSettings !== null)
    expect(teamWithBrand).toBeDefined()
    expect(teamWithBrand!.brandSettings!.colors.primary).toBe('#6366F1')
  })

  it('[INV-BRAND-002] rejects brandGuidelines over 500 chars with 400', async () => {
    const { token, org } = await createUserWithOrg(getFactoryContext())

    const { response } = await request<unknown>(
      '/v1/teams',
      'create-oversized-guidelines',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: org.id,
          name: 'Oversized Guidelines',
          brandSettings: { ...validBrandSettings, brandGuidelines: 'x'.repeat(501) }
        })
      }
    )

    expect(response.status).toBe(400)
  })

  it('[INV-BRAND-003] rejects industry over 100 chars with 400', async () => {
    const { token, org } = await createUserWithOrg(getFactoryContext())

    const { response } = await request<unknown>(
      '/v1/teams',
      'create-oversized-industry',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: org.id,
          name: 'Oversized Industry',
          brandSettings: { ...validBrandSettings, industry: 'x'.repeat(101) }
        })
      }
    )

    expect(response.status).toBe(400)
  })

  it('[INV-BRAND-004] rejects targetAudience over 500 chars with 400', async () => {
    const { token, org } = await createUserWithOrg(getFactoryContext())

    const { response } = await request<unknown>(
      '/v1/teams',
      'create-oversized-audience',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: org.id,
          name: 'Oversized Audience',
          brandSettings: { ...validBrandSettings, targetAudience: 'x'.repeat(501) }
        })
      }
    )

    expect(response.status).toBe(400)
  })

  it('[INV-BRAND-005] rejects partial brandSettings (missing industry) with 400', async () => {
    const { token, org } = await createUserWithOrg(getFactoryContext())

    const partial = {
      colors: validBrandSettings.colors,
      brandGuidelines: validBrandSettings.brandGuidelines,
      targetAudience: validBrandSettings.targetAudience
    }

    const { response } = await request<unknown>(
      '/v1/teams',
      'create-partial-brand',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: org.id,
          name: 'Partial Brand Workspace',
          brandSettings: partial
        })
      }
    )

    expect(response.status).toBe(400)
  })

  it('[INV-BRAND-010] accepts custom industry value (not from presets)', async () => {
    const { token, org } = await createUserWithOrg(getFactoryContext())

    const customBrand: BrandSettings = { ...validBrandSettings, industry: 'custom_artisan_bakery' }

    const { response, body } = await request<{ brandSettings: BrandSettings }>(
      '/v1/teams',
      'create-custom-industry',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: org.id,
          name: 'Custom Industry Workspace',
          brandSettings: customBrand
        })
      }
    )

    expect(response.status).toBe(201)
    expect(body.brandSettings.industry).toBe('custom_artisan_bakery')
  })
})
