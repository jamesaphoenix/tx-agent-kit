'use client'

import { Create, SimpleForm, TextInput } from 'react-admin'

export const WorkspaceCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="name" required />
    </SimpleForm>
  </Create>
)
