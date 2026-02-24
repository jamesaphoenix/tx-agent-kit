import type { ReactNode } from 'react';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: 'tx-agent-kit',
        url: '/docs',
      }}
      links={[
        {
          text: 'llms.txt',
          url: '/llms.txt',
          external: true,
        },
        {
          text: 'GitHub',
          url: 'https://github.com/jamesaphoenix/tx-agent-kit',
          external: true,
        },
      ]}
      sidebar={{
        defaultOpenLevel: 1,
      }}
    >
      {children}
    </DocsLayout>
  );
}
