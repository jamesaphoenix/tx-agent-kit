export const clientApi = {
  signIn: (input: { email: string; password: string }) =>
    fetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    }),

  signUp: (input: { email: string; password: string; name: string }) =>
    fetch('/api/auth/sign-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    }),

  signOut: () =>
    fetch('/api/auth/sign-out', { method: 'POST' }),

  listWorkspaces: () => fetch('/api/workspaces', { method: 'GET' }),
  createWorkspace: (input: { name: string }) =>
    fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    }),

  listTasks: (workspaceId: string) =>
    fetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, { method: 'GET' }),

  createTask: (input: { workspaceId: string; title: string; description?: string }) =>
    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    }),

  listInvitations: () => fetch('/api/invitations', { method: 'GET' }),
  createInvitation: (input: { workspaceId: string; email: string; role: 'admin' | 'member' }) =>
    fetch('/api/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    }),

  acceptInvitation: (token: string) =>
    fetch(`/api/invitations/${token}/accept`, { method: 'POST' })
}
