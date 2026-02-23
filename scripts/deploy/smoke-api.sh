#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-}"
if [[ -z "$API_BASE_URL" ]]; then
  echo "API_BASE_URL must be set"
  exit 1
fi

node <<'NODE'
const baseUrl = process.env.API_BASE_URL
if (!baseUrl) {
  console.error('API_BASE_URL must be set')
  process.exit(1)
}

const requestJson = async (path, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  })

  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  return { response, body }
}

const assertStatus = (response, expected, label) => {
  if (response.status !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${response.status}`)
  }
}

const randomSuffix = Math.random().toString(16).slice(2)
const email = `deploy-smoke-${Date.now()}-${randomSuffix}@example.com`
const password = `Sm0ke-${randomSuffix}-Pass!`

const health = await requestJson('/health', { method: 'GET' })
assertStatus(health.response, 200, 'health')
if (health.body?.status !== 'healthy') {
  throw new Error(`health: expected status=healthy, got ${String(health.body?.status)}`)
}

const signUp = await requestJson('/v1/auth/sign-up', {
  method: 'POST',
  body: JSON.stringify({
    email,
    password,
    name: 'Deploy Smoke User'
  })
})
assertStatus(signUp.response, 201, 'sign-up')

const token = signUp.body?.token
if (typeof token !== 'string' || token.length === 0) {
  throw new Error('sign-up: missing token')
}

const me = await requestJson('/v1/auth/me', {
  method: 'GET',
  headers: { authorization: `Bearer ${token}` }
})
assertStatus(me.response, 200, 'auth/me')

const workspace = await requestJson('/v1/workspaces', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: `Smoke Workspace ${randomSuffix}` })
})
assertStatus(workspace.response, 201, 'create workspace')

const workspaceId = workspace.body?.id
if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
  throw new Error('create workspace: missing id')
}

const listWorkspaces = await requestJson('/v1/workspaces?limit=5', {
  method: 'GET',
  headers: { authorization: `Bearer ${token}` }
})
assertStatus(listWorkspaces.response, 200, 'list workspaces')

const task = await requestJson('/v1/tasks', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  body: JSON.stringify({
    workspaceId,
    title: `Smoke Task ${randomSuffix}`,
    description: 'deployment smoke test'
  })
})
assertStatus(task.response, 201, 'create task')

const listTasks = await requestJson(`/v1/tasks?workspaceId=${encodeURIComponent(workspaceId)}&limit=5`, {
  method: 'GET',
  headers: { authorization: `Bearer ${token}` }
})
assertStatus(listTasks.response, 200, 'list tasks')

const invitation = await requestJson('/v1/invitations', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  body: JSON.stringify({
    workspaceId,
    email: `invitee-${randomSuffix}@example.com`,
    role: 'member'
  })
})
assertStatus(invitation.response, 201, 'create invitation')

const listInvitations = await requestJson('/v1/invitations?limit=5', {
  method: 'GET',
  headers: { authorization: `Bearer ${token}` }
})
assertStatus(listInvitations.response, 200, 'list invitations')

console.log('Deploy smoke checks passed')
NODE
