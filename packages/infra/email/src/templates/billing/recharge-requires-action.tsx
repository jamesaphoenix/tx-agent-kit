import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

/**
 * 3DS off-session challenge email. The `challengeUrl` is the URL where the
 * frontend surfaces Stripe's card challenge — the worker emits
 * `billing.recharge_requires_action` with a PaymentIntent client_secret
 * that the client-side confirmCardPayment() flow consumes. The email
 * itself never carries the client_secret (it is short-lived and we do
 * not want it in an inbox).
 *
 * @spec billing-and-pricing-design §"3DS off-session challenge"
 */
export interface RechargeRequiresActionEmailProps {
  readonly recipientName: string
  readonly amountUsd: string
  readonly challengeUrl: string
}

const headingStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 600,
  color: '#111827',
  margin: '0 0 16px',
  lineHeight: '28px'
}

const paragraphStyle: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '24px',
  color: '#374151',
  margin: '0 0 16px'
}

const buttonStyle: React.CSSProperties = {
  backgroundColor: '#b45309',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 500,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 32px',
  margin: '16px 0'
}

export const RechargeRequiresActionEmail: React.FC<RechargeRequiresActionEmailProps> = ({
  recipientName,
  amountUsd,
  challengeUrl
}) => (
  <EmailLayout preview="Your bank needs to confirm this top-up">
    <Text style={headingStyle}>Your bank needs to confirm this top-up</Text>
    <Text style={paragraphStyle}>Hi {recipientName},</Text>
    <Text style={paragraphStyle}>
      We tried to auto-recharge your tx-agent-kit wallet with <strong>{amountUsd}</strong>, but
      your bank has asked for extra verification (3D Secure). Follow the link below to
      complete the challenge — it only takes a moment and is handled directly by your bank.
    </Text>
    <Button href={challengeUrl} style={buttonStyle}>
      Complete verification
    </Button>
    <Text style={paragraphStyle}>
      If you do not complete the challenge, tx-agent-kit operations that need credits will stay
      paused until the balance is restored.
    </Text>
  </EmailLayout>
)

export const rechargeRequiresActionEmailSubject = 'Action required: confirm your tx-agent-kit top-up with your bank'
