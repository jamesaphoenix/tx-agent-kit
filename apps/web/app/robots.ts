import type { MetadataRoute } from 'next'
import { getWebEnv } from '../lib/env'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getWebEnv().SITE_URL

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/org/',
        '/admin/',
        '/dashboard',
        '/invitations',
        '/organizations',
        '/sign-in',
        '/sign-up',
        '/forgot-password',
        '/reset-password'
      ]
    },
    sitemap: `${baseUrl}/sitemap.xml`
  }
}
