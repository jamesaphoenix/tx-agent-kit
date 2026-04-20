'use client'

import type React from 'react'
import Link from 'next/link'
import { config } from '../../config'
import { StructuredData } from '../../components/StructuredData'
import { buildOrganizationStructuredData, buildFAQStructuredData } from '../../lib/seo'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

const featureIcons: Record<string, React.JSX.Element> = {
  'Temporal Workflows': <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 12h16M14 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  'Effect + Schema': <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  'Structured Observability': <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  'DDD Architecture': <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  'Teams + RBAC': <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  'Stripe Billing': <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

export function LandingPageContent() {
  const { homepage } = config

  return (
    <div className="min-h-screen">
      <StructuredData data={buildOrganizationStructuredData()} />
      {homepage.faqs.length > 0 && (
        <StructuredData data={buildFAQStructuredData(homepage.faqs)} />
      )}

      {/* Hero */}
      <section className="max-w-4xl mx-auto text-center py-24 px-4 space-y-6">
        <Badge variant="secondary">Open-source starter kit</Badge>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          {homepage.heroTitle}
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          {homepage.heroSubtitle}
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
            Get started
          </Link>
          <Link href="/sign-in" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            Sign in
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="bg-muted/40 py-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center space-y-2 mb-12">
            <h2 className="text-3xl font-bold tracking-tight">Everything you need to ship</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              A complete foundation for building agent-powered applications.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {homepage.features.map((feature) => (
              <Card key={feature.title}>
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
                    {featureIcons[feature.title] ?? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    )}
                  </div>
                  <CardTitle>{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      {homepage.faqs.length > 0 && (
        <section className="max-w-3xl mx-auto px-4 py-16 space-y-6">
          <h2 className="text-3xl font-bold tracking-tight text-center mb-8">Frequently asked questions</h2>
          <div className="space-y-6">
            {homepage.faqs.map((faq) => (
              <div key={faq.question} className="space-y-2">
                <h3 className="font-semibold">{faq.question}</h3>
                <p className="text-muted-foreground">{faq.answer}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="border-t border-border bg-muted/40 py-16">
        <div className="max-w-4xl mx-auto px-4 text-center space-y-4">
          <h2 className="text-3xl font-bold tracking-tight">{homepage.ctaTitle}</h2>
          <p className="text-muted-foreground">{homepage.ctaDescription}</p>
          <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
            Get started for free
          </Link>
        </div>
      </section>
    </div>
  )
}
