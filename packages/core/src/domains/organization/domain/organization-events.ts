export type { DomainEventInput } from '../../../domain-event-types.js'

export interface OrganizationCreatedEventPayload {
  organizationName: string
  ownerUserId: string
  ownerEmail: string
}

export interface OrganizationDeletedEventPayload {
  organizationId: string
  organizationName: string
  deletedByUserId: string
}
