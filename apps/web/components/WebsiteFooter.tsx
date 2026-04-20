'use client'

import Link from 'next/link'
import { config } from '../config'

export function WebsiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-1 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-xs font-extrabold text-white shadow-sm">
                tx
              </span>
              <span className="text-sm font-semibold text-foreground">{config.name}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {config.description}
            </p>
          </div>

          {/* Product */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Product</h4>
            <div className="flex flex-col gap-2">
              <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
              <Link href="/blog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Blog</Link>
              <Link href="/sign-up" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Get started</Link>
            </div>
          </div>

          {/* Legal */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Legal</h4>
            <div className="flex flex-col gap-2">
              <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Terms of Service</Link>
              <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Privacy Policy</Link>
            </div>
          </div>

          {/* Support */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Support</h4>
            <div className="flex flex-col gap-2">
              <a href={`mailto:${config.company.supportEmail}`} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Contact</a>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-border py-6 text-center text-sm text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} {config.company.name}. All rights reserved.</p>
      </div>
    </footer>
  )
}
