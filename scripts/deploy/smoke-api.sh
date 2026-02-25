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
const inviteeEmail = `deploy-smoke-invitee-${Date.now()}-${randomSuffix}@example.com`
const inviteePassword = `Sm0keInvitee-${randomSuffix}-Pass!`

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

const organization = await requestJson('/v1/organizations', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: `Smoke Organization ${randomSuffix}` })
})
assertStatus(organization.response, 201, 'create organization')

const organizationId = organization.body?.id
if (typeof organizationId !== 'string' || organizationId.length === 0) {
  throw new Error('create organization: missing id')
}

const listOrganizations = await requestJson('/v1/organizations?limit=5', {
  method: 'GET',
  headers: { authorization: `Bearer ${token}` }
})
assertStatus(listOrganizations.response, 200, 'list organizations')

const inviteeSignUp = await requestJson('/v1/auth/sign-up', {
  method: 'POST',
  body: JSON.stringify({
    email: inviteeEmail,
    password: inviteePassword,
    name: 'Deploy Smoke Invitee'
  })
})
assertStatus(inviteeSignUp.response, 201, 'invitee sign-up')

const inviteeToken = inviteeSignUp.body?.token
if (typeof inviteeToken !== 'string' || inviteeToken.length === 0) {
  throw new Error('invitee sign-up: missing token')
}

const invitation = await requestJson('/v1/invitations', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  body: JSON.stringify({
    organizationId,
    email: inviteeEmail,
    role: 'member'
  })
})
assertStatus(invitation.response, 201, 'create invitation')

const invitationToken = invitation.body?.token
if (typeof invitationToken !== 'string' || invitationToken.length === 0) {
  throw new Error('create invitation: missing token')
}

const listInvitations = await requestJson('/v1/invitations?limit=5', {
  method: 'GET',
  headers: { authorization: `Bearer ${token}` }
})
assertStatus(listInvitations.response, 200, 'list invitations')

const acceptInvitation = await requestJson(`/v1/invitations/${encodeURIComponent(invitationToken)}/accept`, {
  method: 'POST',
  headers: { authorization: `Bearer ${inviteeToken}` }
})
assertStatus(acceptInvitation.response, 200, 'accept invitation')
if (acceptInvitation.body?.accepted !== true) {
  throw new Error('accept invitation: expected accepted=true')
}

const acceptInvitationSecond = await requestJson(`/v1/invitations/${encodeURIComponent(invitationToken)}/accept`, {
  method: 'POST',
  headers: { authorization: `Bearer ${inviteeToken}` }
})
assertStatus(acceptInvitationSecond.response, 404, 'accept invitation second')

console.log('Deploy smoke checks passed')
NODE
