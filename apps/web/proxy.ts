import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const protectedPaths = ['/dashboard', '/workspaces', '/invitations']

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  const shouldProtect = protectedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  if (!shouldProtect) {
    return NextResponse.next()
  }

  const token = request.cookies.get('tx_agent_token')?.value
  if (!token) {
    const url = new URL('/sign-in', request.url)
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/workspaces/:path*', '/invitations/:path*']
}
