import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s | tx-agent-kit docs',
    default: 'tx-agent-kit docs',
  },
  description:
    'Documentation for tx-agent-kit — an agent-first starter for Effect HTTP + Temporal + Next.js + Drizzle.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
