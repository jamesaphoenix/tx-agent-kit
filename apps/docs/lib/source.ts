import { docs as rawDocs } from '@/.source/server';
import { loader, type PageData } from 'fumadocs-core/source';
import type { DocsCollectionEntry } from 'fumadocs-mdx/runtime/server';

type DocsFrontmatter = PageData & {
  full?: boolean;
}

const docs = rawDocs as DocsCollectionEntry<'docs', DocsFrontmatter>

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource()
});
