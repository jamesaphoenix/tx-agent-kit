'use client'

import { Edit, SelectInput, SimpleForm, TextInput } from 'react-admin'

export const TaskEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="id" disabled />
      <TextInput source="workspaceId" disabled />
      <TextInput source="title" required />
      <TextInput source="description" multiline minRows={3} />
      <SelectInput
        source="status"
        choices={[
          { id: 'todo', name: 'Todo' },
          { id: 'in_progress', name: 'In Progress' },
          { id: 'done', name: 'Done' }
        ]}
      />
    </SimpleForm>
  </Edit>
)
