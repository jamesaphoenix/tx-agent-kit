---
name: new-domain-event
description: Add a new domain event type to the transactional outbox system. Use when adding events like invitation.accepted, user.deleted, or any new aggregate event.
argument-hint: <aggregate>.<past-tense-verb>
---

# Add a New Domain Event Type

Add a new event type to the transactional outbox system. The event name must follow `<aggregate>.<past-tense-verb>` convention (e.g. `invitation.accepted`, `user.deleted`).

## Steps

### 1. Register the event type in contracts

**File:** `packages/contracts/src/literals.ts`

Add the new event type string to `domainEventTypes` and (if new aggregate) to `domainEventAggregateTypes`:

```typescript
export const domainEventTypes = ['organization.created', '$ARGUMENTS'] as const
```

### 2. Add payload interface in the domain layer

**File:** `packages/core/src/domains/<aggregate>/domain/<aggregate>-events.ts`

Create or extend the events file with a typed payload interface. The interface name must be `<PascalCaseEventType>EventPayload`:

```typescript
export interface <PascalCase>EventPayload {
  // fields specific to this event
}
```

If the file already exists (e.g. `organization-events.ts`), add the new interface alongside existing ones.

### 3. Add payload schema in temporal-client

**File:** `packages/temporal-client/src/types/domain-event.ts`

Add a matching `effect/Schema` struct. The export name must be `<PascalCaseEventType>EventPayloadSchema`:

```typescript
export const <PascalCase>EventPayloadSchema = Schema.Struct({
  // same fields as the payload interface
})
```

Re-export from `packages/temporal-client/src/index.ts` if not already.

### 4. Add handler case in the worker workflow dispatcher

**File:** `apps/worker/src/workflows.ts`

Add a `case` inside the `switch (event.eventType)` block in `outboxPollerWorkflow`:

```typescript
case '<aggregate>.<verb>': {
  // Validate payload shape
  // startChild with workflowId containing event.id
  // Push to dispatched array
  break
}
```

Requirements enforced by lint:
- `workflowId` must contain `event.id` (idempotent dispatch)
- `workflowIdReusePolicy: 'REJECT_DUPLICATE'`
- `parentClosePolicy: ParentClosePolicy.ABANDON`
- No `as` type assertions on `.payload`

### 5. Add the handler workflow function

**File:** `apps/worker/src/workflows.ts`

```typescript
export async function <eventName>Workflow(event: SerializedDomainEvent): Promise<void> {
  // Type-narrow payload fields (no `as` casts)
  // Call activity
}
```

### 6. Add activity if needed

**File:** `apps/worker/src/activities.ts`

Add the activity function and register it in the `activities` object.

### 7. Write the event transactionally

**File:** `packages/infra/db/src/repositories/<aggregate>.ts`

Either reuse the existing `createWithEvent` pattern or add a new `*WithEvent` method that writes the domain event inside `db.transaction()`.

### 8. Wire through the port and adapter

- **Port:** `packages/core/src/domains/<aggregate>/ports/<aggregate>-ports.ts` — add method signature
- **Adapter:** `packages/core/src/domains/<aggregate>/adapters/<aggregate>-adapters.ts` — wire to repository
- **Service:** `packages/core/src/domains/<aggregate>/application/<aggregate>-service.ts` — call the port method

### 9. Add integration tests

**File:** `packages/testkit/src/domain-events-outbox.integration.test.ts`

Test that the event is written transactionally, has correct payload, and follows the full lifecycle.

### 10. Verify

```bash
pnpm lint        # structural enforcement checks all 10 rules
pnpm type-check  # types pass
pnpm test        # unit tests pass
pnpm test:integration  # integration tests pass
```

## Enforcement Rules

The lint script `scripts/lint/enforce-domain-event-contracts.mjs` checks:

1. Every `eventType: 'x.y'` string is registered in `domainEventTypes`
2. Each event type has a `*EventPayload` interface in the domain layer
3. Each event type has a `*EventPayloadSchema` in temporal-client
4. Service layer cannot import domain-events repository directly
5. Domain event inserts must be inside `db.transaction()`
6. Every registered event type has a `case` in the workflow dispatcher
7. `startChild` calls include `event.id` in `workflowId`
8. No `as` type assertions on `.payload` in worker files
9. Event type names match `<lowercase>.<lowercase>` convention
10. `apps/api/` cannot import `@temporalio/*`

Run `pnpm lint` after each step — it tells you exactly what's missing.

## Reference Files

| File | Role |
|------|------|
| `packages/contracts/src/literals.ts` | Event type registry |
| `packages/core/src/domains/*/domain/*-events.ts` | Payload interfaces |
| `packages/temporal-client/src/types/domain-event.ts` | Payload schemas |
| `apps/worker/src/workflows.ts` | Poller dispatcher + handler workflows |
| `apps/worker/src/activities.ts` | Activity implementations |
| `packages/infra/db/src/repositories/*.ts` | Transactional write (outbox pattern) |
| `scripts/lint/enforce-domain-event-contracts.mjs` | Structural enforcement |
