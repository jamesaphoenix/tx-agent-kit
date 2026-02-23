'use client'

import { DateField, Show, SimpleShowLayout, TextField } from 'react-admin'

export const InvitationShow = () => (
  <Show>
    <SimpleShowLayout>
      <TextField source="id" />
      <TextField source="workspaceId" />
      <TextField source="email" />
      <TextField source="role" />
      <TextField source="status" />
      <TextField source="invitedByUserId" label="Invited By" />
      <TextField source="token" />
      <DateField source="expiresAt" showTime />
      <DateField source="createdAt" showTime />
    </SimpleShowLayout>
  </Show>
)
