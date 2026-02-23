'use client'

import {
  DateField,
  Datagrid,
  DeleteButton,
  EditButton,
  List,
  SelectInput,
  ShowButton,
  TextField,
  TextInput
} from 'react-admin'

const taskFilters = [
  <TextInput key="workspaceId" source="workspaceId" label="Workspace ID" alwaysOn />,
  <SelectInput
    key="status"
    source="status"
    choices={[
      { id: 'todo', name: 'Todo' },
      { id: 'in_progress', name: 'In Progress' },
      { id: 'done', name: 'Done' }
    ]}
  />
]

export const TaskList = () => (
  <List sort={{ field: 'createdAt', order: 'DESC' }} filters={taskFilters}>
    <Datagrid rowClick={false}>
      <TextField source="id" />
      <TextField source="workspaceId" />
      <TextField source="title" />
      <TextField source="status" />
      <TextField source="createdByUserId" label="Created By" />
      <DateField source="createdAt" showTime />
      <ShowButton />
      <EditButton />
      <DeleteButton />
    </Datagrid>
  </List>
)
