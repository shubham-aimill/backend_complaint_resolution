'use client'

import { useEffect, useState } from 'react'
import {
  MessageCircle,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Mail,
  Paperclip,
  CheckCircle2,
  Send,
  HelpCircle,
  Trash2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface MatchedFaq {
  question: string | null
  answer: string
  category: string
}

interface FaqEmail {
  id: string
  from?: string
  to?: string
  subject?: string
  emailBody?: string
  createdAt?: string
  matchedFaq: MatchedFaq | null
}

// Build a synthetic 2-message thread for a FAQ email:
// [0] = original inbound customer email
// [1] = auto-reply from support (synthesized from matchedFaq.answer)
interface ThreadMsg {
  id: string
  direction: 'inbound' | 'outbound'
  from: string
  to: string
  subject: string
  body: string
  createdAt: string
}

function buildThread(email: FaqEmail): ThreadMsg[] {
  const inbound: ThreadMsg = {
    id:        `${email.id}-in`,
    direction: 'inbound',
    from:      email.from ?? '',
    to:        email.to ?? '',
    subject:   email.subject ?? '(no subject)',
    body:      email.emailBody ?? '',
    createdAt: email.createdAt ?? '',
  }

  const replyBody = email.matchedFaq?.answer
    ?? 'Thank you for contacting our support team. We have reviewed your enquiry and will respond within 2 business days.'

  // Auto-reply timestamp: 1 minute after received
  const replyTs = email.createdAt
    ? new Date(new Date(email.createdAt).getTime() + 60_000).toISOString()
    : ''

  const outbound: ThreadMsg = {
    id:        `${email.id}-out`,
    direction: 'outbound',
    from:      `Support Team <${email.to ?? 'support@example.com'}>`,
    to:        email.from ?? '',
    subject:   `Re: ${email.subject ?? '(no subject)'}`,
    body:      replyBody,
    createdAt: replyTs,
  }

  return [inbound, outbound]
}

function avatarInitial(str?: string): string {
  if (!str) return '?'
  const name = str.split('@')[0].replace(/[._+<>-]/g, ' ').trim()
  return (name.charAt(0) || '?').toUpperCase()
}

function displayName(from?: string): string {
  if (!from) return 'Unknown'
  const match = from.match(/^([^<]+)</)
  if (match) return match[1].trim()
  const local = from.split('@')[0].replace(/[._+-]/g, ' ').trim()
  return local.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function formatDateShort(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (diffDays < 7)  return d.toLocaleDateString('en-GB', { weekday: 'short' })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatDateLong(iso?: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

interface SyncFaqProgress {
  total: number
  done: number
  faqAnswered: number
  errorsCount: number
}

interface SyncFaqResult {
  success?: boolean
  scanned?: number
  faqAnswered?: number
  faqError?: number
  skipped?: number
  errors?: string[]
  note?: string
  hint?: string
}

export default function FAQPage() {
  const [emails, setEmails]               = useState<FaqEmail[]>([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState('')
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [expandedIds, setExpandedIds]     = useState<Set<string>>(new Set())
  const [clearing, setClearing]           = useState(false)
  const [syncing, setSyncing]             = useState(false)
  const [syncProgress, setSyncProgress]   = useState<SyncFaqProgress | null>(null)
  const [syncResult, setSyncResult]       = useState<SyncFaqResult | null>(null)

  const selectedEmail = emails.find(e => e.id === selectedId) ?? null
  const thread        = selectedEmail ? buildThread(selectedEmail) : []

  const fetchEmails = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/faq/emails')
      if (!res.ok) throw new Error('Failed to load FAQ emails')
      const data: FaqEmail[] = await res.json()
      setEmails(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load FAQ emails')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchEmails() }, [])

  // Auto-select first email when list loads
  useEffect(() => {
    if (!selectedId && emails.length > 0) {
      const first = emails[0]
      setSelectedId(first.id)
      // Auto-expand last message in thread
      setExpandedIds(new Set([`${first.id}-out`]))
    }
  }, [emails, selectedId])

  const handleSelect = (email: FaqEmail) => {
    if (email.id === selectedId) return
    setSelectedId(email.id)
    const t = buildThread(email)
    // Auto-expand last (auto-reply)
    setExpandedIds(new Set([t[t.length - 1].id]))
  }

  const toggleMsg = (id: string) => {
    setExpandedIds(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const handleSyncFaq = async () => {
    if (syncing) return
    setSyncing(true)
    setSyncProgress(null)
    setSyncResult(null)
    setError('')

    try {
      const response = await fetch('/api/sync-faq/stream', {
        headers: { Accept: 'text/event-stream' },
      })
      if (!response.ok || !response.body) {
        throw new Error('FAQ sync stream failed')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            const payload = line.slice(5).trim()
            try {
              const parsed = JSON.parse(payload)
              if (eventType === 'progress') {
                setSyncProgress(parsed as SyncFaqProgress)
              } else if (eventType === 'done' || eventType === 'error') {
                setSyncResult(parsed as SyncFaqResult)
                // Refresh email list after sync
                if (eventType === 'done') fetchEmails()
              }
            } catch {
              // ignore parse errors on incomplete chunks
            }
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'FAQ sync failed')
    } finally {
      setSyncing(false)
      setSyncProgress(null)
    }
  }

  const handleClear = async () => {
    if (!confirm('Clear all FAQ emails? This cannot be undone.')) return
    setClearing(true)
    try {
      const res = await fetch('/api/faq/emails/clear', { method: 'POST' })
      if (!res.ok) throw new Error('Clear failed')
      setEmails([])
      setSelectedId(null)
      setExpandedIds(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear')
    } finally {
      setClearing(false)
    }
  }

  const answeredCount = emails.filter(e => e.matchedFaq).length

  return (
    <div className="flex flex-col h-[calc(100vh-68px)] overflow-hidden bg-[#F8FAFC]">

      {/* ── Top toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#E5E7EB] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-[#FEF2F2]">
            <MessageCircle className="w-4 h-4 text-[#991B1B]" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-[#111827]">FAQ Auto Resolution</h1>
            <p className="text-[11px] text-[#9CA3AF] font-medium">
              {loading ? 'Loading…' : `${emails.length} conversation${emails.length !== 1 ? 's' : ''} auto-resolved`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Count badge */}
          {!loading && emails.length > 0 && (
            <span className="text-[11px] font-semibold text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] px-2.5 py-1 rounded-full">
              {emails.length} FAQ conversation{emails.length !== 1 ? 's' : ''} on record
            </span>
          )}

          {/* Sync progress badge */}
          {syncProgress && (
            <span className="text-[11px] font-medium text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] px-2.5 py-1 rounded-full">
              {syncProgress.done}/{syncProgress.total} scanned · {syncProgress.faqAnswered} answered
            </span>
          )}
          {/* Sync result badge */}
          {!syncing && syncResult && (
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
              syncResult.success
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : 'text-red-700 bg-red-50 border-red-200'
            }`}>
              {syncResult.faqAnswered ?? 0} new FAQ{(syncResult.faqAnswered ?? 0) !== 1 ? 's' : ''} answered
            </span>
          )}

          {/* Sync FAQ button */}
          <button
            onClick={handleSyncFaq}
            disabled={syncing}
            title="Scan inbox for new FAQ emails independently of complaint sync"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#991B1B] hover:bg-[#7F1D1D] rounded-lg transition-colors disabled:opacity-60"
          >
            <Send className={`w-3.5 h-3.5 ${syncing ? 'animate-pulse' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync FAQ'}
          </button>

          <button
            onClick={fetchEmails}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] hover:bg-[#FEE2E2] rounded-lg transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleClear}
            disabled={clearing || emails.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#6B7280] bg-white border border-[#E5E7EB] hover:border-red-300 hover:text-red-600 rounded-lg transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* ── Two-panel layout ─────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left panel: FAQ email list ──────────────────────────────── */}
        <div className="w-[320px] flex-shrink-0 border-r border-[#E5E7EB] bg-white flex flex-col">
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-[#9CA3AF]">
                <RefreshCw className="w-6 h-6 animate-spin" />
                <p className="text-xs font-medium">Loading FAQ emails…</p>
              </div>
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-[#F3F4F6] flex items-center justify-center">
                  <MessageCircle className="w-6 h-6 text-[#9CA3AF]" />
                </div>
                <p className="text-sm font-semibold text-[#374151]">No FAQ emails yet</p>
                <p className="text-xs text-[#9CA3AF]">FAQ queries detected during inbox sync will appear here</p>
              </div>
            ) : (
              <ul>
                {emails.map(email => {
                  const isSelected  = selectedId === email.id
                  const isAnswered  = !!email.matchedFaq
                  const senderName  = displayName(email.from)
                  const initial     = avatarInitial(email.from)

                  return (
                    <li key={email.id} className="border-b border-[#F3F4F6]">
                      <button
                        onClick={() => handleSelect(email)}
                        className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-all
                          ${isSelected
                            ? 'bg-[#FEF2F2] border-l-[3px] border-[#991B1B]'
                            : 'bg-white hover:bg-[#F8FAFC] border-l-[3px] border-transparent'}`}
                      >
                        {/* Avatar */}
                        <div className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-[13px] font-bold mt-0.5
                          ${isSelected ? 'bg-[#991B1B] text-white' : 'bg-[#E5E7EB] text-[#6B7280]'}`}>
                          {initial}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          {/* Row 1: sender + ANSWERED badge + time */}
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className={`text-[12px] font-bold truncate ${isSelected ? 'text-[#991B1B]' : 'text-[#111827]'}`}>
                              {senderName}
                            </span>
                            <span className="text-[10px] text-[#9CA3AF] flex-shrink-0">{formatDateShort(email.createdAt)}</span>
                          </div>
                          {/* Row 2: subject */}
                          <p className="text-[12px] font-semibold text-[#374151] truncate">{email.subject || '(no subject)'}</p>
                          {/* Row 3: id + answered badge */}
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-[11px] text-[#B0B8C4] truncate flex-1">{email.id}</p>
                            {isAnswered && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                                <CheckCircle2 className="w-2.5 h-2.5" />ANSWERED
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ── Right panel: Email thread view ─────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white">
          <AnimatePresence mode="wait">
            {!selectedEmail ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-12"
              >
                <div className="w-16 h-16 rounded-2xl bg-[#FEF2F2] flex items-center justify-center">
                  <Mail className="w-8 h-8 text-[#FECACA]" />
                </div>
                <div>
                  <p className="text-base font-bold text-[#374151]">Select a FAQ conversation</p>
                  <p className="text-sm text-[#9CA3AF] mt-1">Choose an email from the list to view the full conversation thread</p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={selectedEmail.id}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18 }}
                className="flex-1 flex flex-col min-h-0 overflow-hidden"
              >
                {/* Thread header */}
                <div className="px-6 py-4 border-b border-[#E5E7EB] flex-shrink-0">
                  {/* Subject line label */}
                  <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wider mb-1">Subject Line</p>
                  <h2 className="text-base font-bold text-[#111827] leading-snug mb-2">
                    {selectedEmail.subject || '(no subject)'}
                  </h2>

                  {/* Status badges row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3 h-3" />
                      FAQ Answered
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-full">
                      <Paperclip className="w-3 h-3" />
                      0 files
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-full">
                      <Mail className="w-3 h-3" />
                      {thread.length} message{thread.length !== 1 ? 's' : ''}
                    </span>
                    {selectedEmail.matchedFaq?.category && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                        <HelpCircle className="w-3 h-3" />
                        {selectedEmail.matchedFaq.category}
                      </span>
                    )}
                  </div>
                </div>

                {/* Thread messages — scrollable */}
                <div className="flex-1 overflow-y-auto">
                  <div className="px-6 py-4 space-y-2">
                    {thread.map((msg, idx) => {
                      const isExpanded  = expandedIds.has(msg.id)
                      const isOutbound  = msg.direction === 'outbound'
                      const senderDisplay = isOutbound ? 'Support Team' : displayName(msg.from)
                      const initial       = isOutbound ? 'ST' : avatarInitial(msg.from)
                      const snippet       = msg.body.replace(/\s+/g, ' ').trim().slice(0, 120)

                      return (
                        <motion.div
                          key={msg.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className={`rounded-xl border transition-all ${
                            isExpanded
                              ? 'border-[#E5E7EB] shadow-sm'
                              : 'border-[#F3F4F6] hover:border-[#E5E7EB]'
                          } ${isOutbound ? 'bg-[#F0FDF4]' : 'bg-white'}`}
                        >
                          {/* Message header — click to toggle */}
                          <button
                            onClick={() => toggleMsg(msg.id)}
                            className="w-full text-left px-4 py-3 flex items-center gap-3"
                          >
                            {/* Avatar */}
                            <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold
                              ${isOutbound ? 'bg-[#991B1B] text-white' : 'bg-[#3B82F6] text-white'}`}>
                              {initial}
                            </div>

                            {/* Sender + meta */}
                            <div className="flex-1 min-w-0">
                              {isExpanded ? (
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[13px] font-semibold text-[#111827]">{senderDisplay}</span>
                                    {isOutbound && (
                                      <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                                        <Send className="w-2.5 h-2.5" />AUTO-REPLY
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-[#9CA3AF] mt-0.5 space-y-0.5">
                                    <p><span className="font-medium text-[#6B7280]">From</span>  {msg.from}</p>
                                    <p><span className="font-medium text-[#6B7280]">To</span>  {msg.to}</p>
                                    <p><span className="font-medium text-[#6B7280]">Subject</span>  {msg.subject}</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-[13px] font-semibold text-[#374151] flex-shrink-0">{senderDisplay}</span>
                                  {isOutbound && (
                                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0">
                                      <Send className="w-2.5 h-2.5" />AUTO-REPLY
                                    </span>
                                  )}
                                  <span className="text-[12px] text-[#9CA3AF] truncate">{snippet}</span>
                                </div>
                              )}
                            </div>

                            {/* Date + chevron */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[11px] text-[#9CA3AF]">{formatDateLong(msg.createdAt)}</span>
                              {isExpanded
                                ? <ChevronUp className="w-4 h-4 text-[#9CA3AF]" />
                                : <ChevronDown className="w-4 h-4 text-[#9CA3AF]" />}
                            </div>
                          </button>

                          {/* Expanded body */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                className="overflow-hidden"
                              >
                                <div className="px-5 pb-5 border-t border-[#F3F4F6]">
                                  <pre className="pt-4 text-[13px] text-[#374151] whitespace-pre-wrap font-sans leading-relaxed">
                                    {msg.body || '(no content)'}
                                  </pre>

                                  {/* Matched FAQ reference (on auto-reply only) */}
                                  {isOutbound && selectedEmail.matchedFaq?.question && (
                                    <div className="mt-4 pt-3 border-t border-[#F3F4F6]">
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <HelpCircle className="w-3.5 h-3.5 text-[#991B1B]" />
                                        <span className="text-[11px] font-bold text-[#991B1B] uppercase tracking-wide">Matched FAQ</span>
                                      </div>
                                      <p className="text-[12px] text-[#374151] italic">"{selectedEmail.matchedFaq.question}"</p>
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      )
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
