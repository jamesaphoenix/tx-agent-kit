import { NextResponse } from 'next/server'
import { backendFetch, getTokenFromCookies } from '../../../../../lib/backend'

export async function POST(
  _: Request,
  context: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const token = await getTokenFromCookies()
  if (!token) {
    return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 })
  }

  const params = await context.params

  try {
    const data = await backendFetch(`/v1/invitations/${encodeURIComponent(params.token)}/accept`, {
      method: 'POST'
    }, token)

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : 'Failed to accept invitation' } },
      { status: 400 }
    )
  }
}
