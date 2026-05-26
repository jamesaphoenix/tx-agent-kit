import { describe, expect, it } from 'vitest'

import { buildMcpTools } from './manifest.js'
import { callMcpTool, metaToolNames } from './tools.js'

describe('agent MCP template', () => {
  it('registers only generic meta tools', () => {
    const toolNames = buildMcpTools().map((tool) => tool.name)

    expect(toolNames).toContain(metaToolNames.list)
    expect(toolNames).toContain(metaToolNames.describe)
    expect(toolNames).toContain(metaToolNames.schema)
    expect(toolNames.some((name) => name.includes('publish'))).toBe(false)
  })

  it('lists and describes generated surfaces', () => {
    const list = callMcpTool(metaToolNames.list, { fields: 'key,mcpTool' })
    const listed = JSON.parse(list.content[0].text) as readonly { readonly key: string; readonly mcpTool: string }[]
    const first = listed[0]

    expect(first?.key).toEqual(expect.any(String))
    expect(first?.mcpTool).toEqual(expect.any(String))

    const described = callMcpTool(metaToolNames.describe, { surface: first?.key })
    expect(JSON.parse(described.content[0].text)).toMatchObject({
      key: first?.key
    })
  })
})
