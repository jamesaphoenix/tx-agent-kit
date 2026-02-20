import type { AuthPrincipal } from '@tx-agent-kit/contracts'
import { redirect } from 'next/navigation'
import { backendFetch, getTokenFromCookies } from './backend'

export const requireSession = async (): Promise<{ token: string; principal: AuthPrincipal }> => {
  const token = await getTokenFromCookies()
  if (!token) {
    redirect('/sign-in')
  }

  try {
    const principal = await backendFetch<AuthPrincipal>('/v1/auth/me', { method: 'GET' }, token)
    return { token, principal }
  } catch {
    redirect('/sign-in')
  }

  throw new Error('Unreachable')
}
