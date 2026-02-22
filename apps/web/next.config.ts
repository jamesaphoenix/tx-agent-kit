import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE_URL:
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      process.env.API_BASE_URL ??
      'http://localhost:4000'
  }
}

export default nextConfig
