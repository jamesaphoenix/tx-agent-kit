import { NextResponse } from 'next/server'
import { backendFetch, getTokenFromCookies } from '../../../lib/backend'

export async function GET(request: Request): Promise<NextResponse> {
  const token = await getTokenFromCookies()
  if (!token) {
    return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 })
  }

  const url = new URL(request.url)
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json({ error: { message: 'workspaceId is required' } }, { status: 400 })
  }

  try {
    const data = await backendFetch(`/v1/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, { method: 'GET' }, token)
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : 'Failed to list tasks' } },
      { status: 400 }
    )
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const token = await getTokenFromCookies()
  if (!token) {
    return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 })
  }

  try {
    const payload = await request.json()
    const data = await backendFetch('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token)

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : 'Failed to create task' } },
      { status: 400 }
    )
  }
}
