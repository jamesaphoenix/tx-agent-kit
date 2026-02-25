'use client'

import {
  Admin,
  Resource
} from 'react-admin'
import { authProvider, dataProvider, ADMIN_RESOURCES } from '../../lib/react-admin'
import { InvitationCreate, InvitationEdit, InvitationList, InvitationShow } from './invitations'
import { OrganizationCreate, OrganizationEdit, OrganizationList, OrganizationShow } from './organizations'

export const AdminLayout = () => (
  <Admin
    basename="/admin"
    authProvider={authProvider}
    dataProvider={dataProvider}
  >
    <Resource
      name="organizations"
      options={{ label: ADMIN_RESOURCES.organizations.label }}
      list={OrganizationList}
      show={OrganizationShow}
      create={OrganizationCreate}
      edit={OrganizationEdit}
    />
    <Resource
      name="invitations"
      options={{ label: ADMIN_RESOURCES.invitations.label }}
      list={InvitationList}
      show={InvitationShow}
      create={InvitationCreate}
      edit={InvitationEdit}
    />
  </Admin>
)
