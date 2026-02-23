'use client'

import { Create, SimpleForm, TextInput } from 'react-admin'

export const TaskCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="workspaceId" required />
      <TextInput source="title" required />
      <TextInput source="description" multiline minRows={3} />
    </SimpleForm>
  </Create>
)
