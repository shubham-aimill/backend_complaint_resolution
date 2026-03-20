'use client'

import { useState, useCallback } from 'react'

export interface MailMessage {
  id: string
  from?: string
  subject?: string
  emailBody?: string
  createdAt?: string
  inReplyTo?: string
  [key: string]: unknown
}

export function useMailChain(ingestedId?: string) {
  const [chain, setChain] = useState<MailMessage[]>([])
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    if (!ingestedId) return
    setLoading(true)
    try {
      const res = await window.fetch(`/api/ingested-claims/${encodeURIComponent(ingestedId)}/thread`)
      if (res.ok) {
        const data = await res.json()
        setChain(Array.isArray(data) ? data : data.thread ?? [])
      }
    } catch {
      // silently fail — UI shows empty state
    } finally {
      setLoading(false)
    }
  }, [ingestedId])

  return { chain, loading, fetch }
}
