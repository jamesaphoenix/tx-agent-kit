'use client'

import { Edit, SimpleForm, TextInput } from 'react-admin'

export const OrganizationEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="id" disabled />
      <TextInput source="name" required />
      <TextInput source="ownerUserId" disabled />
    </SimpleForm>
  </Edit>
)
