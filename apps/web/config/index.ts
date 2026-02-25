export interface SiteConfig {
  name: string
  domain: string
  description: string
  company: CompanyInfo
  homepage: HomepageConfig
  blog: BlogConfig
  dashboard: DashboardConfig
}

export interface CompanyInfo {
  name: string
  supportEmail: string
  legalEmail: string
  privacyEmail: string
  address: string
  phone: string
}

export interface HomepageConfig {
  heroTitle: string
  heroSubtitle: string
  features: FeatureItem[]
  faqs: FAQItem[]
  ctaTitle: string
  ctaDescription: string
}

export interface FeatureItem {
  title: string
  description: string
}

export interface FAQItem {
  question: string
  answer: string
}

export interface BlogConfig {
  title: string
  description: string
}

export interface NavItem {
  title: string
  href: string
  section?: string
}

export interface DashboardConfig {
  sidebarNavItems: NavItem[]
}

export const config: SiteConfig = {
  name: 'tx-agent-kit',
  domain: 'tx-agent-kit.dev',
  description: 'Agent-first execution platform. Effect HTTP + Temporal + Next.js + Drizzle.',

  company: {
    name: 'tx-agent-kit',
    supportEmail: 'support@tx-agent-kit.dev',
    legalEmail: 'legal@tx-agent-kit.dev',
    privacyEmail: 'privacy@tx-agent-kit.dev',
    address: '',
    phone: ''
  },

  homepage: {
    heroTitle: 'Build agent workflows with type-safe precision',
    heroSubtitle:
      'Effect HTTP + Temporal + Next.js + Drizzle. Autonomous workflows with structured observability, role-based access, and production-grade infrastructure.',
    features: [
      { title: 'Temporal Workflows', description: 'Durable, fault-tolerant workflow orchestration for complex multi-step agent tasks.' },
      { title: 'Effect + Schema', description: 'Type-safe service composition with schema-driven validation at every boundary.' },
      { title: 'Structured Observability', description: 'OpenTelemetry traces, Prometheus metrics, and structured logging from day one.' },
      { title: 'DDD Architecture', description: 'Clean domain-driven design with ports, adapters, and mechanical enforcement.' },
      { title: 'Teams + RBAC', description: 'Organizations, teams, role-based permissions, and invitation management built in.' },
      { title: 'Stripe Billing', description: 'Subscription management, credit ledger, and auto-recharge built into the org model.' }
    ],
    faqs: [
      { question: 'What is tx-agent-kit?', answer: 'An open-source starter kit for building agent-powered applications with Effect, Temporal, Next.js, and Drizzle. It provides domain-driven architecture, RBAC, billing, and observability out of the box.' },
      { question: 'Do I need to know Effect to use it?', answer: 'Basic TypeScript knowledge is enough to get started. Effect powers the backend service layer, but the web frontend is a standard React/Next.js app.' },
      { question: 'Is it production ready?', answer: 'The architecture is designed for production workloads with structured logging, observability, and fault-tolerant workflow orchestration via Temporal.' },
      { question: 'What database does it use?', answer: 'PostgreSQL with Drizzle ORM. Migrations are managed via Drizzle Kit with pgTAP tests for database trigger contracts.' },
      { question: 'Can I use it without Temporal?', answer: 'Yes. Temporal is optional — you can use the Effect HTTP API, auth, RBAC, and billing layers without the workflow engine.' }
    ],
    ctaTitle: 'Ready to build?',
    ctaDescription: 'Get your first agent workflow running in minutes.'
  },

  blog: {
    title: 'tx-agent-kit Blog',
    description: 'Engineering insights, architecture patterns, and best practices for building agent-powered applications.'
  },

  dashboard: {
    sidebarNavItems: [
      { title: 'Home', href: '[teamId]/' },
      { title: 'Workflows', href: '[teamId]/workflows', section: 'execute' },
      { title: 'Analytics', href: '[teamId]/analytics', section: 'insights' },
      { title: 'Integrations', href: '[teamId]/integrations', section: 'setup' },
      { title: 'Settings', href: '[teamId]/settings', section: 'setup' },
      { title: 'Workspaces', href: 'workspaces', section: 'organization' }
    ]
  }
}

export const getConfig = (): SiteConfig => config
export const getCompanyInfo = (): CompanyInfo => config.company
export const getBlogConfig = (): BlogConfig => config.blog
export const getDashboardConfig = (): DashboardConfig => config.dashboard
