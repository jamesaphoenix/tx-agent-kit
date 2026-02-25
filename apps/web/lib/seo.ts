import { config } from '../config'

export interface SEOMetaProps {
  title?: string
  description?: string
  canonicalUrl?: string
  ogType?: string
  ogImage?: string
  noIndex?: boolean
}

export const buildTitle = (pageTitle?: string): string =>
  pageTitle ? `${pageTitle} — ${config.name}` : config.name

export const buildDescription = (description?: string): string =>
  description ?? config.description

export interface StructuredDataOrganization {
  '@context': string
  '@type': string
  name: string
  url: string
  description: string
  email?: string
}

export const buildOrganizationStructuredData = (): StructuredDataOrganization => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: config.company.name,
  url: `https://${config.domain}`,
  description: config.description,
  email: config.company.supportEmail
})

export interface StructuredDataWebPage {
  '@context': string
  '@type': string
  name: string
  description: string
  url: string
}

export const buildWebPageStructuredData = (
  name: string,
  description: string,
  path: string
): StructuredDataWebPage => ({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name,
  description,
  url: `https://${config.domain}${path}`
})

export interface BreadcrumbItem {
  name: string
  href: string
}

export interface StructuredDataBreadcrumb {
  '@context': string
  '@type': string
  itemListElement: Array<{
    '@type': string
    position: number
    name: string
    item: string
  }>
}

export const buildBreadcrumbStructuredData = (
  items: BreadcrumbItem[]
): StructuredDataBreadcrumb => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: `https://${config.domain}${item.href}`
  }))
})

export interface StructuredDataFAQ {
  '@context': string
  '@type': string
  mainEntity: Array<{
    '@type': string
    name: string
    acceptedAnswer: { '@type': string; text: string }
  }>
}

export const buildFAQStructuredData = (
  faqs: Array<{ question: string; answer: string }>
): StructuredDataFAQ => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer
    }
  }))
})
