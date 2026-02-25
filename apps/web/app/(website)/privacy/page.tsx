'use client'

import { config } from '../../../config'
import { StructuredData } from '../../../components/StructuredData'
import { buildWebPageStructuredData, buildBreadcrumbStructuredData } from '../../../lib/seo'
import { Breadcrumbs } from '../../../components/Breadcrumbs'

export default function PrivacyPage() {
  const breadcrumbs = [
    { name: 'Home', href: '/' },
    { name: 'Privacy Policy', href: '/privacy' }
  ]

  return (
    <div className="page-container">
      <title>{`Privacy Policy — ${config.name}`}</title>
      <meta name="description" content={`Privacy Policy for ${config.name}`} />
      <StructuredData data={buildWebPageStructuredData('Privacy Policy', `Privacy Policy for ${config.name}`, '/privacy')} />
      <StructuredData data={buildBreadcrumbStructuredData(breadcrumbs)} />

      <Breadcrumbs items={breadcrumbs} />

      <article className="legal-page">
        <header className="legal-header">
          <h1>Privacy Policy</h1>
          <p className="legal-effective">Effective date: February 25, 2026</p>
        </header>

        <section className="legal-section">
          <h2>1. Information We Collect</h2>
          <p>We collect information you provide directly to us, including:</p>
          <ul>
            <li><strong>Account information:</strong> name, email address, and password when you create an account.</li>
            <li><strong>Organization information:</strong> organization name, billing email, and team member details.</li>
            <li><strong>Usage data:</strong> workflow execution logs, feature usage, and interaction data.</li>
            <li><strong>Payment information:</strong> billing details processed by our third-party payment provider (we do not store card numbers).</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>2. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide, maintain, and improve the Service.</li>
            <li>Process transactions and send related information.</li>
            <li>Send technical notices, updates, and support messages.</li>
            <li>Monitor and analyze usage trends to improve user experience.</li>
            <li>Detect, investigate, and prevent fraud and abuse.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>3. Information Sharing</h2>
          <p>
            We do not sell your personal information. We may share information in the following
            circumstances:
          </p>
          <ul>
            <li>With service providers who perform services on our behalf (payment processing, hosting, analytics).</li>
            <li>To comply with legal obligations or respond to lawful requests.</li>
            <li>To protect the rights, property, or safety of {config.company.name}, our users, or the public.</li>
            <li>With your consent or at your direction.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>4. Data Security</h2>
          <p>
            We implement appropriate technical and organizational measures to protect your
            personal information against unauthorized access, alteration, disclosure, or
            destruction. This includes encryption in transit and at rest, access controls,
            and regular security assessments.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Data Retention</h2>
          <p>
            We retain your personal information for as long as your account is active or as
            needed to provide the Service. We will delete or anonymize your data upon request,
            subject to any legal retention requirements.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Your Rights</h2>
          <p>Depending on your jurisdiction, you may have the right to:</p>
          <ul>
            <li>Access the personal information we hold about you.</li>
            <li>Request correction of inaccurate data.</li>
            <li>Request deletion of your data.</li>
            <li>Object to or restrict certain processing of your data.</li>
            <li>Request portability of your data.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>7. Cookies and Tracking</h2>
          <p>
            We use essential cookies to maintain your session and preferences. We do not use
            third-party advertising cookies. Analytics cookies are used only with your consent
            where required by law.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. Children&apos;s Privacy</h2>
          <p>
            The Service is not directed to children under 16. We do not knowingly collect
            personal information from children. If we learn we have collected information
            from a child, we will promptly delete it.
          </p>
        </section>

        <section className="legal-section">
          <h2>9. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of
            material changes by posting the updated policy on this page with a new effective
            date.
          </p>
        </section>

        <section className="legal-section">
          <h2>10. Contact</h2>
          <p>
            For privacy-related inquiries, contact us at{' '}
            <a href={`mailto:${config.company.privacyEmail}`}>{config.company.privacyEmail}</a>.
          </p>
        </section>
      </article>
    </div>
  )
}
