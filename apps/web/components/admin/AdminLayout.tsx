'use client'

import {
  Admin,
  Resource
} from 'react-admin'
import { authProvider, dataProvider, ADMIN_RESOURCES } from '../../lib/react-admin'
import { InvitationCreate, InvitationEdit, InvitationList, InvitationShow } from './invitations'
import { TaskCreate, TaskEdit, TaskList, TaskShow } from './tasks'
import { WorkspaceCreate, WorkspaceEdit, WorkspaceList, WorkspaceShow } from './workspaces'

export const AdminLayout = () => (
  <Admin
    basename="/admin"
    authProvider={authProvider}
    dataProvider={dataProvider}
  >
    <Resource
      name="tasks"
      options={{ label: ADMIN_RESOURCES.tasks.label }}
      list={TaskList}
      show={TaskShow}
      create={TaskCreate}
      edit={TaskEdit}
    />
    <Resource
      name="workspaces"
      options={{ label: ADMIN_RESOURCES.workspaces.label }}
      list={WorkspaceList}
      show={WorkspaceShow}
      create={WorkspaceCreate}
      edit={WorkspaceEdit}
    />
    <Resource
      name="invitations"
      options={{ label: ADMIN_RESOURCES.invitations.label }}
      list={InvitationList}
      show={InvitationShow}
      create={InvitationCreate}
      edit={InvitationEdit}
    />
  </Admin>
)
