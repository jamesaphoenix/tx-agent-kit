import { render } from '@react-email/components'
import { describe, expect, it } from 'vitest'
import * as React from 'react'
import { EmailLayout } from './layout.js'
import { Text } from '@react-email/components'

describe('EmailLayout', () => {
  it('should contain the physical address "68 Kings Ride" [INV-EMAIL-CAMP-018]', async () => {
    const html = await render(
      <EmailLayout preview="Test preview">
        <Text>Test content</Text>
      </EmailLayout>
    )

    expect(html).toContain('68 Kings Ride')
    expect(html).toContain('HP10 8BP')
  })

  it('should contain an unsubscribe link when unsubscribeUrl is provided [INV-EMAIL-CAMP-015]', async () => {
    const unsubscribeUrl = 'https://tx-agent-kit.local/unsubscribe?token=abc123'

    const html = await render(
      <EmailLayout preview="Test preview" unsubscribeUrl={unsubscribeUrl}>
        <Text>Test content</Text>
      </EmailLayout>
    )

    expect(html).toContain('Unsubscribe')
    expect(html).toContain(unsubscribeUrl)
  })

  it('should contain List-Unsubscribe text when unsubscribeUrl is provided [INV-EMAIL-CAMP-015]', async () => {
    const unsubscribeUrl = 'https://tx-agent-kit.local/unsubscribe?token=abc123'

    const html = await render(
      <EmailLayout preview="Test preview" unsubscribeUrl={unsubscribeUrl}>
        <Text>Test content</Text>
      </EmailLayout>
    )

    expect(html).toContain('List-Unsubscribe')
    expect(html).toContain(unsubscribeUrl)
  })

  it('should not render unsubscribe section when unsubscribeUrl is not provided', async () => {
    const html = await render(
      <EmailLayout preview="Test preview">
        <Text>Test content</Text>
      </EmailLayout>
    )

    expect(html).not.toContain('Unsubscribe')
    expect(html).not.toContain('List-Unsubscribe')
  })

  it('should contain tx-agent-kit branding in the header', async () => {
    const html = await render(
      <EmailLayout preview="Test preview">
        <Text>Test content</Text>
      </EmailLayout>
    )

    expect(html).toContain('tx-agent-kit')
  })

  it('should render the preview text', async () => {
    const html = await render(
      <EmailLayout preview="This is the preview text">
        <Text>Test content</Text>
      </EmailLayout>
    )

    expect(html).toContain('This is the preview text')
  })

  it('should render children content', async () => {
    const html = await render(
      <EmailLayout preview="Preview">
        <Text>My custom email body content</Text>
      </EmailLayout>
    )

    expect(html).toContain('My custom email body content')
  })
})
