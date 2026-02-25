'use client'

import Link from 'next/link'
import { config } from '../../../config'
import { StructuredData } from '../../../components/StructuredData'
import { buildWebPageStructuredData, buildBreadcrumbStructuredData, buildFAQStructuredData } from '../../../lib/seo'
import { Breadcrumbs } from '../../../components/Breadcrumbs'

const plans = [
  {
    name: 'Free',
    description: 'For individuals exploring the platform.',
    price: '$0',
    period: 'forever',
    features: [
      '1 organization',
      '1 team member',
      '100 workflow executions / month',
      'Community support',
      'Basic observability'
    ],
    cta: 'Get started',
    href: '/sign-up',
    highlighted: false
  },
  {
    name: 'Pro',
    description: 'For teams shipping agent-powered products.',
    price: '$49',
    period: 'per seat / month',
    features: [
      'Unlimited organizations',
      'Unlimited team members',
      '10,000 workflow executions / month',
      'Priority support',
      'Full observability stack',
      'RBAC + custom roles',
      'Stripe billing integration'
    ],
    cta: 'Start free trial',
    href: '/sign-up',
    highlighted: true
  },
  {
    name: 'Enterprise',
    description: 'For organizations with advanced requirements.',
    price: 'Custom',
    period: 'contact us',
    features: [
      'Everything in Pro',
      'Unlimited workflow executions',
      'Dedicated support',
      'Custom SLA',
      'SSO / SAML',
      'Audit logs',
      'On-premise deployment option'
    ],
    cta: 'Contact sales',
    href: `mailto:${config.company.supportEmail}`,
    highlighted: false
  }
]

const faqs = [
  {
    question: 'Can I switch plans later?',
    answer: 'Yes — you can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle.'
  },
  {
    question: 'What happens if I exceed my workflow limit?',
    answer: 'You will receive a notification at 80% usage. Additional executions are available via credit top-ups or by upgrading your plan.'
  },
  {
    question: 'Do you offer discounts for annual billing?',
    answer: 'Yes — annual plans include a 20% discount. Contact us for details.'
  },
  {
    question: 'Is there a free trial for Pro?',
    answer: 'Yes — Pro includes a 14-day free trial with full access to all features. No credit card required.'
  }
]

export default function PricingPage() {
  const breadcrumbs = [
    { name: 'Home', href: '/' },
    { name: 'Pricing', href: '/pricing' }
  ]

  return (
    <div className="page-container">
      <title>{`Pricing — ${config.name}`}</title>
      <meta name="description" content={`Simple, transparent pricing for ${config.name}. Start free, scale as you grow.`} />
      <StructuredData data={buildWebPageStructuredData('Pricing', `Pricing plans for ${config.name}`, '/pricing')} />
      <StructuredData data={buildBreadcrumbStructuredData(breadcrumbs)} />
      <StructuredData data={buildFAQStructuredData(faqs)} />

      <Breadcrumbs items={breadcrumbs} />

      <section className="pricing-header">
        <h1 className="pricing-title">
          Simple, transparent
          <span className="landing-gradient-text"> pricing</span>
        </h1>
        <p className="pricing-subtitle">
          Start free. Scale as your team and workloads grow.
        </p>
      </section>

      <section className="pricing-grid">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`pricing-card${plan.highlighted ? ' pricing-card--highlighted' : ''}`}
          >
            {plan.highlighted && (
              <span className="pricing-badge">Most popular</span>
            )}
            <h2 className="pricing-plan-name">{plan.name}</h2>
            <p className="pricing-plan-description">{plan.description}</p>
            <div className="pricing-price">
              <span className="pricing-amount">{plan.price}</span>
              <span className="pricing-period">{plan.period}</span>
            </div>
            <ul className="pricing-features">
              {plan.features.map((feature) => (
                <li key={feature}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  {feature}
                </li>
              ))}
            </ul>
            <Link
              href={plan.href}
              className={`pricing-cta${plan.highlighted ? ' pricing-cta--primary' : ''}`}
            >
              {plan.cta}
            </Link>
          </div>
        ))}
      </section>

      <section className="pricing-faq">
        <h2 className="pricing-faq-title">Frequently asked questions</h2>
        <div className="pricing-faq-grid">
          {faqs.map((faq) => (
            <div key={faq.question} className="pricing-faq-item">
              <h3>{faq.question}</h3>
              <p>{faq.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
