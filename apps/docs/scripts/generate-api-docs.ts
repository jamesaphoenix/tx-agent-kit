import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '../../..');
const OPENAPI_PATH = path.join(ROOT_DIR, 'apps/api/openapi.json');
const OUTPUT_DIR = path.join(ROOT_DIR, 'apps/docs/content/docs/api-reference');

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: { type?: string };
  description?: string;
}

interface OpenApiRequestBody {
  content?: {
    'application/json'?: {
      schema?: Record<string, unknown>;
    };
  };
}

interface OpenApiResponse {
  description?: string;
  content?: {
    'application/json'?: {
      schema?: Record<string, unknown>;
    };
  };
}

interface OpenApiOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
}

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: Record<string, unknown>;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function loadSpec(): OpenApiSpec {
  const raw = fs.readFileSync(OPENAPI_PATH, 'utf-8');
  return JSON.parse(raw) as OpenApiSpec;
}

function groupByTag(
  spec: OpenApiSpec
): Map<string, Array<{ method: string; path: string; operation: OpenApiOperation }>> {
  const groups = new Map<
    string,
    Array<{ method: string; path: string; operation: OpenApiOperation }>
  >();

  for (const [urlPath, methods] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = methods[method];
      if (!operation) continue;

      const tag = operation.tags?.[0] ?? 'default';

      if (!groups.has(tag)) {
        groups.set(tag, []);
      }
      groups.get(tag)!.push({ method: method.toUpperCase(), path: urlPath, operation });
    }
  }

  return groups;
}

function formatParameters(params: OpenApiParameter[]): string {
  if (params.length === 0) return '';

  const lines = [
    '',
    '### Parameters',
    '',
    '| Name | In | Type | Required | Description |',
    '|------|-----|------|----------|-------------|',
  ];

  for (const param of params) {
    const type = param.schema?.type ?? 'string';
    const required = param.required ? 'Yes' : 'No';
    const description = param.description ?? '---';
    lines.push(`| \`${param.name}\` | ${param.in} | \`${type}\` | ${required} | ${description} |`);
  }

  return lines.join('\n');
}

function formatResponses(responses: Record<string, OpenApiResponse>): string {
  const lines = ['', '### Responses', '', '| Status | Description |', '|--------|-------------|'];

  for (const [status, response] of Object.entries(responses)) {
    const description = response.description ?? '---';
    lines.push(`| \`${status}\` | ${description} |`);
  }

  return lines.join('\n');
}

function generateEndpointSection(entry: {
  method: string;
  path: string;
  operation: OpenApiOperation;
}): string {
  const { method, path: urlPath, operation } = entry;
  const lines: string[] = [];

  lines.push(`## \`${method} ${urlPath}\``);
  lines.push('');

  if (operation.summary) {
    lines.push(operation.summary);
    lines.push('');
  }

  if (operation.description && operation.description !== operation.summary) {
    lines.push(operation.description);
    lines.push('');
  }

  if (operation.security && operation.security.length > 0) {
    lines.push('**Authentication required:** Bearer JWT token');
    lines.push('');
  }

  if (operation.parameters && operation.parameters.length > 0) {
    lines.push(formatParameters(operation.parameters));
    lines.push('');
  }

  if (operation.responses) {
    lines.push(formatResponses(operation.responses));
    lines.push('');
  }

  return lines.join('\n');
}

function generateTagPage(
  tag: string,
  endpoints: Array<{ method: string; path: string; operation: OpenApiOperation }>
): string {
  const slug = tag.toLowerCase().replace(/\s+/g, '-');
  const lines: string[] = [];

  lines.push('---');
  lines.push(`title: "${tag}" Endpoints`);
  lines.push(`description: API endpoints for the ${tag} resource group`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${tag} Endpoints`);
  lines.push('');

  for (const endpoint of endpoints) {
    lines.push(generateEndpointSection(endpoint));
  }

  return lines.join('\n');
}

function main(): void {
  const spec = loadSpec();
  const groups = groupByTag(spec);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const generatedPages: string[] = [];

  for (const [tag, endpoints] of groups) {
    const slug = tag.toLowerCase().replace(/\s+/g, '-');
    const content = generateTagPage(tag, endpoints);
    const filePath = path.join(OUTPUT_DIR, `${slug}.mdx`);

    fs.writeFileSync(filePath, content, 'utf-8');
    generatedPages.push(slug);
    process.stdout.write(`Generated: ${filePath}\n`);
  }

  const metaPath = path.join(OUTPUT_DIR, 'meta.json');
  const meta = {
    title: 'API Reference',
    pages: ['index', ...generatedPages],
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
  process.stdout.write(`Updated: ${metaPath}\n`);

  process.stdout.write(
    `\nGenerated ${generatedPages.length} API reference pages from ${spec.info.title} v${spec.info.version}\n`
  );
}

main();
