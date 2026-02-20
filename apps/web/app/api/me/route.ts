import { NextResponse } from 'next/server'
import { backendFetch, getTokenFromCookies } from '../../../lib/backend'

export async function GET(): Promise<NextResponse> {
  const token = await getTokenFromCookies()
  if (!token) {
    return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 })
  }

  try {
    const data = await backendFetch('/v1/auth/me', { method: 'GET' }, token)
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : 'Unauthorized' } },
      { status: 401 }
    )
  }
}
