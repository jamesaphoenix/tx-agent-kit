'use client'

import {
  DateField,
  Datagrid,
  DeleteButton,
  EditButton,
  List,
  SelectInput,
  ShowButton,
  TextField
} from 'react-admin'

const invitationFilters = [
  <SelectInput
    key="status"
    source="status"
    choices={[
      { id: 'pending', name: 'Pending' },
      { id: 'accepted', name: 'Accepted' },
      { id: 'revoked', name: 'Revoked' },
      { id: 'expired', name: 'Expired' }
    ]}
    alwaysOn
  />,
  <SelectInput
    key="role"
    source="role"
    choices={[
      { id: 'admin', name: 'Admin' },
      { id: 'member', name: 'Member' }
    ]}
  />
]

export const InvitationList = () => (
  <List sort={{ field: 'createdAt', order: 'DESC' }} filters={invitationFilters}>
    <Datagrid rowClick={false}>
      <TextField source="id" />
      <TextField source="workspaceId" />
      <TextField source="email" />
      <TextField source="role" />
      <TextField source="status" />
      <DateField source="expiresAt" showTime />
      <DateField source="createdAt" showTime />
      <ShowButton />
      <EditButton />
      <DeleteButton />
    </Datagrid>
  </List>
)
