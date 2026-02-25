'use client'

import { Edit, SelectInput, SimpleForm, TextInput } from 'react-admin'

export const InvitationEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="id" disabled />
      <TextInput source="organizationId" disabled />
      <TextInput source="email" disabled />
      <SelectInput
        source="role"
        choices={[
          { id: 'admin', name: 'Admin' },
          { id: 'member', name: 'Member' }
        ]}
      />
      <SelectInput
        source="status"
        choices={[
          { id: 'pending', name: 'Pending' },
          { id: 'revoked', name: 'Revoked' },
          { id: 'expired', name: 'Expired' }
        ]}
      />
    </SimpleForm>
  </Edit>
)
