'use client'

import { Create, SelectInput, SimpleForm, TextInput } from 'react-admin'

export const InvitationCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="workspaceId" required />
      <TextInput source="email" type="email" required />
      <SelectInput
        source="role"
        choices={[
          { id: 'admin', name: 'Admin' },
          { id: 'member', name: 'Member' }
        ]}
        defaultValue="member"
      />
    </SimpleForm>
  </Create>
)
