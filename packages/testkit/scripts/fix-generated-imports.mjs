import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const GENERATED_DIR = join(__dirname, '../src/api-client/generated')

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      walk(fullPath)
    } else if (fullPath.endsWith('.ts')) {
      let content = readFileSync(fullPath, 'utf-8')
      content = content.replaceAll(
        /(from\s+['"])(\.\.?[^'"]*?)(?<!\.(js|ts|json))(['"])/g,
        (_, pre, importPath, _ext, quote) => {
          if (importPath.endsWith('/schemas')) {
            return `${pre}${importPath}/index.js${quote}`
          }
          return `${pre}${importPath}.js${quote}`
        }
      )
      writeFileSync(fullPath, content)
    }
  }
}

walk(GENERATED_DIR)
