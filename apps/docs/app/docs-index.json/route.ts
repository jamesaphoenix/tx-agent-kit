import { source } from '@/lib/source';
import { NextResponse } from 'next/server';

export function GET() {
  const pages = source.getPages().map((page) => ({
    url: page.url,
    title: page.data.title,
    description: page.data.description,
    slugs: page.slugs,
  }));

  return NextResponse.json({ pages });
}
