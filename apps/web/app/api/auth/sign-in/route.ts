import { NextResponse } from 'next/server'
import { backendFetch } from '../../../../lib/backend'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = await request.json()
    const data = await backendFetch<{ token: string; user: unknown }>('/v1/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify(payload)
    })

    const response = NextResponse.json(data)
    response.cookies.set('tx_agent_token', data.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 7
    })

    return response
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          message: error instanceof Error ? error.message : 'Sign-in failed'
        }
      },
      { status: 401 }
    )
  }
}
