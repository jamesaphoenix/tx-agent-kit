'use client'

import { DateField, Show, SimpleShowLayout, TextField } from 'react-admin'

export const TaskShow = () => (
  <Show>
    <SimpleShowLayout>
      <TextField source="id" />
      <TextField source="workspaceId" />
      <TextField source="title" />
      <TextField source="description" />
      <TextField source="status" />
      <TextField source="createdByUserId" label="Created By" />
      <DateField source="createdAt" showTime />
    </SimpleShowLayout>
  </Show>
)
