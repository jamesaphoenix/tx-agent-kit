'use client'

import { Create, SimpleForm, TextInput } from 'react-admin'

export const OrganizationCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="name" required />
    </SimpleForm>
  </Create>
)
