import { NextResponse } from 'next/server'

export function POST(): NextResponse {
  const response = NextResponse.json({ ok: true })
  response.cookies.set('tx_agent_token', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  })
  return response
}
