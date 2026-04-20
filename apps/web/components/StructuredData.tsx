'use client'

export function StructuredData({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data)
          .split('<').join('\\u003c')
          .split('>').join('\\u003e')
          .split('/').join('\\u002f')
          .split('&').join('\\u0026')
          .split('\u2028').join('\\u2028')
          .split('\u2029').join('\\u2029')
      }}
    />
  )
}
