'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { BlogArticle, BlogCategory } from '../../../lib/blog'
import { getBlogDataSource } from '../../../lib/blog'
import { config } from '../../../config'
import { StructuredData } from '../../../components/StructuredData'
import { buildBlogListStructuredData } from '../../../lib/blog-seo'
import { buildBreadcrumbStructuredData } from '../../../lib/seo'
import { Breadcrumbs } from '../../../components/Breadcrumbs'

export default function BlogListingPage() {
  const [articles, setArticles] = useState<BlogArticle[]>([])
  const [categories, setCategories] = useState<BlogCategory[]>([])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const ds = getBlogDataSource()
        if (!ds) {
          setLoading(false)
          return
        }
        const [arts, cats] = await Promise.all([
          ds.getArticles(undefined, activeCategory ?? undefined),
          ds.getCategories()
        ])
        setArticles(arts)
        setCategories(cats)
      } catch {
        setArticles([])
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [activeCategory])

  const breadcrumbs = [
    { name: 'Home', href: '/' },
    { name: 'Blog', href: '/blog' }
  ]

  return (
    <div className="page-container">
      <title>{`Blog — ${config.name}`}</title>
      <meta name="description" content={config.blog.description} />
      <StructuredData data={buildBreadcrumbStructuredData(breadcrumbs)} />
      {articles.length > 0 && (
        <StructuredData data={buildBlogListStructuredData(articles)} />
      )}

      <Breadcrumbs items={breadcrumbs} />

      <div className="blog-header">
        <h1 className="blog-header-title">{config.blog.title}</h1>
        <p className="blog-header-description">{config.blog.description}</p>
      </div>

      {categories.length > 0 && (
        <div className="blog-categories">
          <button
            className={`blog-category-pill${activeCategory === null ? ' blog-category-pill--active' : ''}`}
            onClick={() => setActiveCategory(null)}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              className={`blog-category-pill${activeCategory === cat.id ? ' blog-category-pill--active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="blog-loading">
          <div className="blog-skeleton-grid">
            {[1, 2, 3].map((i) => (
              <div key={i} className="blog-skeleton-card" />
            ))}
          </div>
        </div>
      ) : articles.length === 0 ? (
        <div className="blog-empty">
          <div className="blog-empty-icon" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none"><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <h2>No articles yet</h2>
          <p>Connect a blog data source to start publishing.</p>
        </div>
      ) : (
        <div className="blog-grid">
          {articles.map((article) => (
            <Link
              key={article.id}
              href={`/blog/${article.slug}`}
              className="blog-card"
            >
              {article.featuredImageUrl && (
                <div className="blog-card-image">
                  <img src={article.featuredImageUrl} alt={article.title} />
                </div>
              )}
              <div className="blog-card-content">
                {article.categoryName && (
                  <span className="blog-card-category">{article.categoryName}</span>
                )}
                <h2 className="blog-card-title">{article.title}</h2>
                <p className="blog-card-excerpt">{article.excerpt}</p>
                <div className="blog-card-meta">
                  <span>{article.authorName}</span>
                  <span className="blog-card-meta-dot" aria-hidden="true" />
                  <time dateTime={article.publishedAt}>
                    {new Date(article.publishedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </time>
                  <span className="blog-card-meta-dot" aria-hidden="true" />
                  <span>{article.readingTimeMinutes} min read</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
