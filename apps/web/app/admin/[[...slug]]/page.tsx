'use client'

import dynamic from 'next/dynamic'

const DynamicAdminLayout = dynamic(
  async () => {
    const mod = await import('../../../components/admin/AdminLayout')
    return mod.AdminLayout
  },
  {
    ssr: false
  }
)

export default function AdminPage() {
  return <DynamicAdminLayout />
}
