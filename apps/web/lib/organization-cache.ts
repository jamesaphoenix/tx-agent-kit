import type { QueryClient } from '@tanstack/react-query'
import { getOrganizationsGetOrganizationQueryKey } from './api/generated/organizations/organizations'
import type { OrganizationsGetOrganization200 } from './api/generated/schemas/organizationsGetOrganization200'
import type { OrganizationsListOrganizations200 } from './api/generated/schemas/organizationsListOrganizations200'
import type { OrganizationsUpdateOrganization200 } from './api/generated/schemas/organizationsUpdateOrganization200'

const organizationsListQueryKey = ['/v1/organizations'] as const

export const syncOrganizationCache = (
  queryClient: QueryClient,
  organization: OrganizationsUpdateOrganization200
): void => {
  queryClient.setQueryData<OrganizationsGetOrganization200>(
    getOrganizationsGetOrganizationQueryKey(organization.id),
    (current) => current ? { ...current, ...organization } : organization
  )

  queryClient.setQueriesData<OrganizationsListOrganizations200>(
    { queryKey: organizationsListQueryKey },
    (current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        data: current.data.map((item) =>
          item.id === organization.id
            ? { ...item, ...organization }
            : item
        )
      }
    }
  )
}
