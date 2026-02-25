'use client'

import {
  DateField,
  Datagrid,
  DeleteButton,
  EditButton,
  List,
  ShowButton,
  TextField
} from 'react-admin'

export const OrganizationList = () => (
  <List sort={{ field: 'createdAt', order: 'DESC' }}>
    <Datagrid rowClick={false}>
      <TextField source="id" />
      <TextField source="name" />
      <TextField source="ownerUserId" label="Owner" />
      <DateField source="createdAt" showTime />
      <ShowButton />
      <EditButton />
      <DeleteButton />
    </Datagrid>
  </List>
)
