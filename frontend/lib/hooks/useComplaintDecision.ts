'use client'

import { useState, useCallback } from 'react'
import { ClaimData } from '@/types/claims'

type DecisionStatus = 'pending' | 'accepted' | 'rejected'

interface DecideParams {
  decision: 'accept' | 'reject'
  letter: string
  recipient: string
  subject: string
  rejectionReason?: string
}

export function useComplaintDecision(claimData: ClaimData, ingestedId?: string) {
  const [status, setStatus] = useState<DecisionStatus>('pending')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decide = useCallback(async (params: DecideParams): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      // 1. Send the letter email to the complainant
      if (params.recipient) {
        const emailRes = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: params.recipient, subject: params.subject, body: params.letter }),
        })
        if (!emailRes.ok) {
          const d = await emailRes.json().catch(() => ({}))
          throw new Error(d.error || 'Failed to send email')
        }
      }

      // 2. Append letter to mail thread
      if (ingestedId) {
        await fetch(`/api/ingested-claims/${encodeURIComponent(ingestedId)}/thread`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Customer Support <support@electronics.com>',
            subject: params.subject,
            emailBody: params.letter,
            direction: 'outbound',
          }),
        })
      }

      // 3. Update complaint status in backend
      const complaintId = claimData?.claimId
      if (complaintId) {
        await fetch(`/api/complaints/${encodeURIComponent(complaintId)}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: params.decision === 'accept' ? 'accepted' : 'rejected' }),
        })
      }

      setStatus(params.decision === 'accept' ? 'accepted' : 'rejected')
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      return false
    } finally {
      setLoading(false)
    }
  }, [claimData?.claimId, ingestedId])

  const reset = useCallback(() => {
    setStatus('pending')
    setError(null)
  }, [])

  return { status, loading, error, decide, reset }
}
