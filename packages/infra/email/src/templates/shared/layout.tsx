import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text
} from '@react-email/components'
import * as React from 'react'

export interface EmailLayoutProps {
  readonly preview: string
  readonly unsubscribeUrl?: string
  readonly children: React.ReactNode
}

const mainStyle: React.CSSProperties = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif"
}

const containerStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '580px'
}

const headerStyle: React.CSSProperties = {
  padding: '24px 48px 0'
}

const logoTextStyle: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 700,
  color: '#111827',
  margin: 0,
  letterSpacing: '-0.5px'
}

const contentStyle: React.CSSProperties = {
  padding: '0 48px'
}

const footerSectionStyle: React.CSSProperties = {
  padding: '0 48px'
}

const footerTextStyle: React.CSSProperties = {
  color: '#8898aa',
  fontSize: '12px',
  lineHeight: '16px',
  margin: '0 0 8px'
}

const footerLinkStyle: React.CSSProperties = {
  color: '#8898aa',
  fontSize: '12px',
  textDecoration: 'underline'
}

const hrStyle: React.CSSProperties = {
  borderColor: '#e6ebf1',
  margin: '20px 0'
}

export const EmailLayout: React.FC<EmailLayoutProps> = ({
  preview,
  unsubscribeUrl,
  children
}) => (
  <Html>
    <Head />
    <Preview>{preview}</Preview>
    <Body style={mainStyle}>
      <Container style={containerStyle}>
        <Section style={headerStyle}>
          <Heading style={logoTextStyle}>tx-agent-kit</Heading>
        </Section>

        <Hr style={hrStyle} />

        <Section style={contentStyle}>{children}</Section>

        <Hr style={hrStyle} />

        <Section style={footerSectionStyle}>
          <Text style={footerTextStyle}>tx-agent-kit Ltd, 68 Kings Ride, HP10 8BP</Text>
          {unsubscribeUrl ? (
            <>
              <Text style={footerTextStyle}>
                <Link href={unsubscribeUrl} style={footerLinkStyle}>
                  Unsubscribe
                </Link>
                {' '}from these emails.
              </Text>
              <Text style={footerTextStyle}>
                List-Unsubscribe: {'<'}{unsubscribeUrl}{'>'}
              </Text>
            </>
          ) : null}
          <Text style={footerTextStyle}>
            &copy; {new Date().getFullYear()} tx-agent-kit. All rights reserved.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)
