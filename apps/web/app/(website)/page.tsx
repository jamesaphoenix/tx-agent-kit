'use client'

import Link from 'next/link'
import { config } from '../../config'
import { StructuredData } from '../../components/StructuredData'
import { buildOrganizationStructuredData, buildFAQStructuredData } from '../../lib/seo'

const featureIcons: Record<string, JSX.Element> = {
  'Temporal Workflows': <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 12h16M14 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  'Effect + Schema': <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  'Structured Observability': <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  'DDD Architecture': <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  'Teams + RBAC': <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  'Stripe Billing': <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

export default function LandingPage() {
  const { homepage } = config

  return (
    <div className="landing">
      <title>{config.name}</title>
      <meta name="description" content={config.description} />
      <StructuredData data={buildOrganizationStructuredData()} />
      {homepage.faqs.length > 0 && (
        <StructuredData data={buildFAQStructuredData(homepage.faqs)} />
      )}

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <span className="landing-badge">Open-source starter kit</span>
          <h1 className="landing-title">
            {homepage.heroTitle}
          </h1>
          <p className="landing-subtitle">{homepage.heroSubtitle}</p>
          <div className="landing-cta-row">
            <Link href="/sign-up" className="landing-cta-primary">Get started</Link>
            <Link href="/sign-in" className="landing-cta-secondary">Sign in</Link>
          </div>
        </div>
      </section>

      <section className="landing-features">
        <div className="landing-features-inner">
          <h2 className="landing-section-title">Everything you need to ship</h2>
          <p className="landing-section-subtitle">
            A complete foundation for building agent-powered applications.
          </p>
          <div className="landing-feature-grid">
            {homepage.features.map((feature) => (
              <div key={feature.title} className="landing-feature-card">
                <div className="landing-feature-icon" aria-hidden="true">
                  {featureIcons[feature.title] ?? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  )}
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {homepage.faqs.length > 0 && (
        <section className="landing-faq">
          <div className="landing-faq-inner">
            <h2 className="landing-section-title">Frequently asked questions</h2>
            <div className="landing-faq-grid">
              {homepage.faqs.map((faq) => (
                <div key={faq.question} className="landing-faq-item">
                  <h3>{faq.question}</h3>
                  <p>{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="landing-cta-section">
        <div className="landing-cta-section-inner">
          <h2>{homepage.ctaTitle}</h2>
          <p>{homepage.ctaDescription}</p>
          <Link href="/sign-up" className="landing-cta-primary">Get started for free</Link>
        </div>
      </section>
    </div>
  )
}
