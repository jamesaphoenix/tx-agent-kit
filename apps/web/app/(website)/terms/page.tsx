'use client'

import { config } from '../../../config'
import { StructuredData } from '../../../components/StructuredData'
import { buildWebPageStructuredData, buildBreadcrumbStructuredData } from '../../../lib/seo'
import { Breadcrumbs } from '../../../components/Breadcrumbs'

export default function TermsPage() {
  const breadcrumbs = [
    { name: 'Home', href: '/' },
    { name: 'Terms of Service', href: '/terms' }
  ]

  return (
    <div className="page-container">
      <title>{`Terms of Service — ${config.name}`}</title>
      <meta name="description" content={`Terms of Service for ${config.name}`} />
      <StructuredData data={buildWebPageStructuredData('Terms of Service', `Terms of Service for ${config.name}`, '/terms')} />
      <StructuredData data={buildBreadcrumbStructuredData(breadcrumbs)} />

      <Breadcrumbs items={breadcrumbs} />

      <article className="legal-page">
        <header className="legal-header">
          <h1>Terms of Service</h1>
          <p className="legal-effective">Effective date: February 25, 2026</p>
        </header>

        <section className="legal-section">
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using {config.name} (&ldquo;Service&rdquo;), operated by {config.company.name},
            you agree to be bound by these Terms of Service (&ldquo;Terms&rdquo;). If you do not agree
            to these Terms, do not use the Service.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Description of Service</h2>
          <p>
            {config.name} provides an agent-first execution platform for building autonomous
            workflows with structured observability, role-based access control, and
            production-grade infrastructure.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. User Accounts</h2>
          <p>
            You are responsible for maintaining the confidentiality of your account credentials
            and for all activities that occur under your account. You agree to notify us
            immediately of any unauthorized use.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the Service for any unlawful purpose or in violation of any applicable laws.</li>
            <li>Attempt to gain unauthorized access to any part of the Service.</li>
            <li>Interfere with or disrupt the integrity or performance of the Service.</li>
            <li>Use the Service to transmit any malware, viruses, or harmful code.</li>
            <li>Reverse engineer, decompile, or disassemble any part of the Service.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>5. Intellectual Property</h2>
          <p>
            The Service and its original content, features, and functionality are owned by
            {' '}{config.company.name} and are protected by international copyright, trademark,
            and other intellectual property laws.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Payment and Billing</h2>
          <p>
            Certain features of the Service require a paid subscription. Billing is handled
            through our third-party payment processor. You agree to pay all fees associated
            with your selected plan. Prices are subject to change with 30 days&apos; prior notice.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Termination</h2>
          <p>
            We may terminate or suspend your access to the Service immediately, without prior
            notice, for conduct that we believe violates these Terms or is harmful to other
            users, us, or third parties, or for any other reason at our sole discretion.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, {config.company.name} shall not be liable
            for any indirect, incidental, special, consequential, or punitive damages, including
            loss of profits, data, or use, arising out of or related to your use of the Service.
          </p>
        </section>

        <section className="legal-section">
          <h2>9. Changes to Terms</h2>
          <p>
            We reserve the right to modify these Terms at any time. We will provide notice of
            material changes by posting the updated Terms on this page with a new effective date.
            Your continued use of the Service after changes constitutes acceptance.
          </p>
        </section>

        <section className="legal-section">
          <h2>10. Contact</h2>
          <p>
            If you have questions about these Terms, contact us at{' '}
            <a href={`mailto:${config.company.legalEmail}`}>{config.company.legalEmail}</a>.
          </p>
        </section>
      </article>
    </div>
  )
}
