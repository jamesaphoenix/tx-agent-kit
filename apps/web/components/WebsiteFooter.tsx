'use client'

import Link from 'next/link'
import { config } from '../config'

export function WebsiteFooter() {
  return (
    <footer className="website-footer">
      <div className="website-footer-inner">
        <div className="website-footer-brand">
          <div className="website-logo">
            <span className="website-logo-mark">tx</span>
            <span className="website-logo-wordmark">{config.name}</span>
          </div>
          <p className="website-footer-description">
            {config.description}
          </p>
        </div>
        <div className="website-footer-links">
          <div className="website-footer-column">
            <h4>Product</h4>
            <Link href="/pricing">Pricing</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/sign-up">Get started</Link>
          </div>
          <div className="website-footer-column">
            <h4>Legal</h4>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/privacy">Privacy Policy</Link>
          </div>
          <div className="website-footer-column">
            <h4>Support</h4>
            <a href={`mailto:${config.company.supportEmail}`}>Contact</a>
          </div>
        </div>
      </div>
      <div className="website-footer-bottom">
        <p>&copy; {new Date().getFullYear()} {config.company.name}. All rights reserved.</p>
      </div>
    </footer>
  )
}
