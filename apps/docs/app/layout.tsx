import { RootProvider } from 'fumadocs-ui/provider/next';
import Script from 'next/script';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';

const GA_ID = 'G-JPDS4Q62K4';

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
      <head>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}');
          `}
        </Script>
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
