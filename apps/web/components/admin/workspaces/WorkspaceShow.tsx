'use client'

import { DateField, Show, SimpleShowLayout, TextField } from 'react-admin'

export const WorkspaceShow = () => (
  <Show>
    <SimpleShowLayout>
      <TextField source="id" />
      <TextField source="name" />
      <TextField source="ownerUserId" label="Owner" />
      <DateField source="createdAt" showTime />
    </SimpleShowLayout>
  </Show>
)
