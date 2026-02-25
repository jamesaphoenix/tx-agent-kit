'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import type { BlogArticle } from '../../../../lib/blog'
import { getBlogDataSource } from '../../../../lib/blog'
import { config } from '../../../../config'
import { StructuredData } from '../../../../components/StructuredData'
import { buildBlogPostStructuredData } from '../../../../lib/blog-seo'
import { buildBreadcrumbStructuredData } from '../../../../lib/seo'
import { Breadcrumbs } from '../../../../components/Breadcrumbs'

const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'dd', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i',
  'img', 'li', 'ol', 'p', 'pre', 'section', 'span', 'strong', 'sub', 'sup',
  'table', 'tbody', 'td', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'video'
])

const ALLOWED_ATTRS = new Set([
  'alt', 'class', 'datetime', 'height', 'href', 'id', 'loading', 'rel',
  'src', 'srcset', 'target', 'title', 'width'
])

function sanitizeHtml(html: string): string {
  if (typeof document === 'undefined') return ''
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  const walk = (node: Element): void => {
    const children = Array.from(node.children)
    for (const child of children) {
      if (!ALLOWED_TAGS.has(child.tagName.toLowerCase())) {
        child.remove()
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) {
          child.removeAttribute(attr.name)
        }
      }
      if (child.tagName === 'A') {
        const href = child.getAttribute('href') ?? ''
        if (href.startsWith('javascript:') || href.startsWith('data:')) {
          child.removeAttribute('href')
        }
      }
      walk(child)
    }
  }

  walk(doc.body)
  return doc.body.innerHTML
}

export default function BlogPostPage() {
  const params = useParams()
  const slug = typeof params.slug === 'string' ? params.slug : ''
  const [article, setArticle] = useState<BlogArticle | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const ds = getBlogDataSource()
        if (!ds || !slug) {
          setNotFound(true)
          setLoading(false)
          return
        }
        const post = await ds.getArticleBySlug(slug)
        if (!post) {
          setNotFound(true)
        } else {
          setArticle(post)
        }
      } catch {
        setNotFound(true)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [slug])

  if (loading) {
    return (
      <div className="page-container">
        <div className="blog-post-skeleton">
          <div className="blog-skeleton-bar blog-skeleton-bar--wide" />
          <div className="blog-skeleton-bar blog-skeleton-bar--narrow" />
          <div className="blog-skeleton-bar blog-skeleton-bar--full" />
          <div className="blog-skeleton-bar blog-skeleton-bar--full" />
          <div className="blog-skeleton-bar blog-skeleton-bar--wide" />
        </div>
      </div>
    )
  }

  if (notFound || !article) {
    return (
      <div className="page-container">
        <div className="blog-not-found">
          <h1>Article not found</h1>
          <p>The article you are looking for does not exist or has been removed.</p>
          <Link href="/blog" className="blog-back-link">Back to blog</Link>
        </div>
      </div>
    )
  }

  const breadcrumbs = [
    { name: 'Home', href: '/' },
    { name: 'Blog', href: '/blog' },
    { name: article.title, href: `/blog/${article.slug}` }
  ]

  return (
    <div className="page-container">
      <title>{`${article.seoTitle ?? article.title} — ${config.name}`}</title>
      <meta name="description" content={article.seoDescription ?? article.excerpt} />
      {article.seoKeywords && <meta name="keywords" content={article.seoKeywords} />}
      <StructuredData data={buildBreadcrumbStructuredData(breadcrumbs)} />
      <StructuredData data={buildBlogPostStructuredData(article)} />

      <Breadcrumbs items={breadcrumbs} />

      <article className="blog-post">
        <header className="blog-post-header">
          {article.categoryName && (
            <span className="blog-card-category">{article.categoryName}</span>
          )}
          <h1 className="blog-post-title">{article.title}</h1>
          <div className="blog-post-meta">
            <div className="blog-post-author">
              {article.authorAvatarUrl && (
                <img
                  src={article.authorAvatarUrl}
                  alt={article.authorName}
                  className="blog-post-avatar"
                />
              )}
              <div>
                <span className="blog-post-author-name">{article.authorName}</span>
                {article.authorBio && (
                  <span className="blog-post-author-bio">{article.authorBio}</span>
                )}
              </div>
            </div>
            <div className="blog-post-meta-details">
              <time dateTime={article.publishedAt}>
                {new Date(article.publishedAt).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </time>
              <span className="blog-card-meta-dot" aria-hidden="true" />
              <span>{article.readingTimeMinutes} min read</span>
            </div>
          </div>
        </header>

        {article.featuredImageUrl && (
          <div className="blog-post-hero-image">
            <img src={article.featuredImageUrl} alt={article.title} />
          </div>
        )}

        <div
          className="blog-post-body"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(article.content) }}
        />

        {article.tags.length > 0 && (
          <div className="blog-post-tags">
            {article.tags.map((tag) => (
              <span key={tag} className="blog-tag">{tag}</span>
            ))}
          </div>
        )}

        <div className="blog-post-footer">
          <Link href="/blog" className="blog-back-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back to all articles
          </Link>
        </div>
      </article>
    </div>
  )
}
