/**
 * Backend-agnostic blog data layer.
 *
 * Consumers provide a `BlogDataSource` implementation that fetches
 * articles and categories from any backend (PocketBase, Supabase,
 * filesystem MDX, headless CMS, etc.).
 */

export interface BlogArticle {
  id: string
  slug: string
  title: string
  excerpt: string
  content: string
  featuredImageUrl: string | null
  authorName: string
  authorBio: string | null
  authorAvatarUrl: string | null
  categoryId: string | null
  categoryName: string | null
  tags: string[]
  seoTitle: string | null
  seoDescription: string | null
  seoKeywords: string | null
  readingTimeMinutes: number
  publishedAt: string
  updatedAt: string
}

export interface BlogCategory {
  id: string
  name: string
  slug: string
  description: string | null
}

export interface BlogDataSource {
  getArticles: (limit?: number, categoryId?: string) => Promise<BlogArticle[]>
  getArticleBySlug: (slug: string) => Promise<BlogArticle | null>
  getCategories: () => Promise<BlogCategory[]>
  getCategoryBySlug: (slug: string) => Promise<BlogCategory | null>
}

let dataSource: BlogDataSource | null = null

export const setBlogDataSource = (source: BlogDataSource): void => {
  dataSource = source
}

export const getBlogDataSource = (): BlogDataSource | null => dataSource

export const estimateReadingTime = (content: string): number => {
  const words = content.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(words / 200))
}

export const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
