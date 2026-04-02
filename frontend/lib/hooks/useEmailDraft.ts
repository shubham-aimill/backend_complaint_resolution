'use client'

import { useState, useCallback } from 'react'

type DraftType = 'acknowledgment' | 'acceptance' | 'rejection' | 'moreInfo' | string

interface Draft {
  type: DraftType
  body: string
  recipient: string
  subject: string
  inReplyTo?: string
  references?: string
}

type SentState = {
  acknowledgment: boolean
  moreInfo: boolean
  acceptance: boolean
  rejection: boolean
  [key: string]: boolean
}

interface SentDraft {
  type: DraftType
  recipient: string
  subject: string
  body: string
  inReplyTo?: string
  references?: string
}

export function useEmailDraft(onSent?: (sent: SentDraft) => void) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [sent, setSent] = useState<SentState>({
    acknowledgment: false,
    moreInfo: false,
    acceptance: false,
    rejection: false,
  })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback((type: DraftType, body: string, recipient: string, subject: string, inReplyTo?: string, references?: string) => {
    setDraft({ type, body, recipient, subject, inReplyTo, references })
    setError(null)
  }, [])

  const close = useCallback(() => {
    setDraft(null)
    setError(null)
  }, [])

  const updateBody = useCallback((body: string) => {
    setDraft(prev => prev ? { ...prev, body } : prev)
  }, [])

  const updateRecipient = useCallback((recipient: string) => {
    setDraft(prev => prev ? { ...prev, recipient } : prev)
  }, [])

  const send = useCallback(async () => {
    if (!draft) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: draft.recipient,
          subject: draft.subject,
          body: draft.body,
          inReplyTo: draft.inReplyTo,
          references: draft.references,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send email')
      const sentDraft: SentDraft = { ...draft }
      setSent(prev => ({ ...prev, [draft.type]: true }))
      setDraft(null)
      onSent?.(sentDraft)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email')
    } finally {
      setSending(false)
    }
  }, [draft, onSent])

  return { draft, sent, sending, error, open, close, send, updateBody, updateRecipient }
}
