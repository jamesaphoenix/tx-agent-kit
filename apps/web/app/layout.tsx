'use client'

import type { ReactNode } from 'react'
import { AppProviders } from '../components/providers/AppProviders'
import { ApiResourceHints } from '@/lib/api-resource-hints'
import './globals.css'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});


export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <ApiResourceHints />
      <body>
        <AppProviders>
          <main>{children}</main>
        </AppProviders>
      </body>
    </html>
  )
}
