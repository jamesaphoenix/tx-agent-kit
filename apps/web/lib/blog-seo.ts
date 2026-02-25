import type { BlogArticle } from './blog'
import { config } from '../config'

const baseUrl = `https://${config.domain}`

export const buildBlogPostStructuredData = (post: BlogArticle) => ({
  '@context': 'https://schema.org',
  '@type': 'BlogPosting',
  headline: post.seoTitle ?? post.title,
  description: post.seoDescription ?? post.excerpt,
  datePublished: post.publishedAt,
  dateModified: post.updatedAt,
  author: {
    '@type': 'Person',
    name: post.authorName
  },
  publisher: {
    '@type': 'Organization',
    name: config.company.name,
    url: baseUrl
  },
  mainEntityOfPage: {
    '@type': 'WebPage',
    '@id': `${baseUrl}/blog/${post.slug}`
  },
  ...(post.featuredImageUrl ? { image: post.featuredImageUrl } : {}),
  ...(post.readingTimeMinutes ? { timeRequired: `PT${post.readingTimeMinutes}M` } : {}),
  ...(post.categoryName ? { articleSection: post.categoryName } : {}),
  ...(post.seoKeywords ? { keywords: post.seoKeywords } : {})
})

export const buildBlogListStructuredData = (posts: BlogArticle[]) => ({
  '@context': 'https://schema.org',
  '@type': 'Blog',
  name: config.blog.title,
  description: config.blog.description,
  url: `${baseUrl}/blog`,
  blogPost: posts.map((post) => ({
    '@type': 'BlogPosting',
    headline: post.title,
    url: `${baseUrl}/blog/${post.slug}`,
    datePublished: post.publishedAt,
    author: { '@type': 'Person', name: post.authorName }
  }))
})
