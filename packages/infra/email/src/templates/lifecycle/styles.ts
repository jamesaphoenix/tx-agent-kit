import type * as React from 'react'

/**
 * Shared inline styles for the lifecycle email templates. React Email needs
 * inline styles for cross-client compatibility, so every lifecycle template
 * pulls its typography + button look from this one module. Keeping them here
 * (instead of repeating per file) makes the 16 templates a thin layer of copy.
 */

// Palette is the starter kit's neutral brand default: primary #4f46e5,
// foreground #1b2034, canvas #f4f6fb. A fork can re-tone these to match its own
// apps/web design tokens without touching any template body.
export const headingStyle: React.CSSProperties = {
  fontSize: '22px',
  fontWeight: 700,
  color: '#1b2034',
  margin: '0 0 16px',
  lineHeight: '30px',
  letterSpacing: '-0.3px'
}

export const paragraphStyle: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '24px',
  color: '#3a4055',
  margin: '0 0 16px'
}

export const buttonStyle: React.CSSProperties = {
  backgroundColor: '#4f46e5',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 32px',
  margin: '8px 0 16px'
}

export const codeBlockStyle: React.CSSProperties = {
  backgroundColor: '#1b2034',
  color: '#e6e9f5',
  borderRadius: '8px',
  fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  fontSize: '13px',
  lineHeight: '20px',
  padding: '14px 16px',
  margin: '0 0 16px',
  whiteSpace: 'pre' as const,
  overflowX: 'auto' as const
}

export const secondaryLinkStyle: React.CSSProperties = {
  color: '#4f46e5',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none'
}

export const mutedTextStyle: React.CSSProperties = {
  fontSize: '13px',
  lineHeight: '20px',
  color: '#5b6378',
  margin: '0 0 8px'
}
