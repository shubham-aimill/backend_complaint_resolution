'use client'

import { useState, useCallback } from 'react'

type DraftType = 'acknowledgment' | 'acceptance' | 'rejection' | 'moreInfo' | string

interface Draft {
  type: DraftType
  body: string
  recipient: string
  subject: string
}

type SentState = {
  acknowledgment: boolean
  moreInfo: boolean
  acceptance: boolean
  rejection: boolean
  [key: string]: boolean
}

export function useEmailDraft() {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [sent, setSent] = useState<SentState>({
    acknowledgment: false,
    moreInfo: false,
    acceptance: false,
    rejection: false,
  })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback((type: DraftType, body: string, recipient: string, subject: string) => {
    setDraft({ type, body, recipient, subject })
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
        body: JSON.stringify({ to: draft.recipient, subject: draft.subject, body: draft.body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send email')
      setSent(prev => ({ ...prev, [draft.type]: true }))
      setDraft(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email')
    } finally {
      setSending(false)
    }
  }, [draft])

  return { draft, sent, sending, error, open, close, send, updateBody, updateRecipient }
}
