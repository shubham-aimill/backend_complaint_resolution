'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Mail,
  FileText,
  Image,
  AlertCircle,
  Play,
  RefreshCw,
  Trash2,
  CheckCircle2,
  Clock3,
  Paperclip,
  ChevronRight,
  Inbox,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowRight,
  Send,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ClaimData } from '@/types/claims'
import { getCached, removeCachedByPrefix, setCached } from '@/lib/clientCache'

interface HomePageProps {
  onProcessClaim: (data: ClaimData) => void
  isProcessing: boolean
  setIsProcessing: (processing: boolean) => void
}

interface IngestedClaim {
  id: string
  policyNumber: string
  from: string
  to: string
  subject: string
  emailBody: string
  attachments: Array<{ name: string; path: string; size: number; mimeType: string }>
  createdAt: string
  source: 'sendgrid' | 'demo' | 'imap'
  processingStatus?: 'pending' | 'processed'
}

interface ThreadMessage {
  id: string
  from?: string
  to?: string
  subject?: string
  emailBody?: string
  createdAt?: string
  source?: string
  direction?: string
  attachments?: Array<{ name: string; path: string; size: number; mimeType: string }>
}

interface PolicyOption {
  id: string
  policyNumber: string
  subject: string
  processingStatus?: string
  from?: string
}

const CACHE_KEYS = {
  INGESTED_OPTIONS: 'cache:ingested-claims:options',
  INGESTED_DETAIL_PREFIX: 'cache:ingested-claims:detail:',
}
const TTL = {
  OPTIONS_MS: 2 * 60 * 1000,
  DETAIL_MS: 10 * 60 * 1000,
}

function cleanBody(body: string): string {
  return body.split('\n').map(l => l.replace(/^>+\s?/, '')).join('\n').trim()
}

function avatarInitial(str?: string): string {
  if (!str) return '?'
  const name = str.split('@')[0].replace(/[._+-]/g, ' ').trim()
  return (name.charAt(0) || '?').toUpperCase()
}

function displayName(from?: string): string {
  if (!from) return 'Unknown'
  const match = from.match(/^([^<]+)</)
  if (match) return match[1].trim()
  const local = from.split('@')[0].replace(/[._+-]/g, ' ').trim()
  return local.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (diffDays < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatDateLong(iso?: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function HomePage({ onProcessClaim, isProcessing, setIsProcessing }: HomePageProps) {
  const [policyOptions, setPolicyOptions] = useState<PolicyOption[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedClaim, setSelectedClaim] = useState<IngestedClaim | null>(null)
  const [loadingPolicies, setLoadingPolicies] = useState(true)
  const [loadingClaim, setLoadingClaim] = useState(false)
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [expandedMsgIds, setExpandedMsgIds] = useState<Set<string>>(new Set())
  const [syncingInbox, setSyncingInbox] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncProgress, setSyncProgress] = useState<{ total: number; done: number; ingested: number } | null>(null)
  const [clearingClaims, setClearingClaims] = useState(false)
  const [error, setError] = useState('')

  const fetchPolicyOptions = async () => {
    const cachedOptions = getCached<PolicyOption[]>(CACHE_KEYS.INGESTED_OPTIONS)
    setLoadingPolicies(true)
    setError('')
    if (cachedOptions?.length) {
      setPolicyOptions(cachedOptions)
      setLoadingPolicies(false)
    }
    try {
      const res = await fetch('/api/ingested-claims')
      if (!res.ok) throw new Error('Failed to load complaints')
      const data = await res.json()
      const seen = new Set<string>()
      const options: PolicyOption[] = Array.isArray(data)
        ? data
            // Drop outbound sent-email records — they appear in the thread view only
            .filter((c: { id?: string }) => !c.id?.includes('-OUT-'))
            // Deduplicate by subject+from so the same email never appears twice
            .filter((c: { subject?: string; from?: string }) => {
              const key = `${(c.subject ?? '').trim().toLowerCase()}|${(c.from ?? '').trim().toLowerCase()}`
              if (seen.has(key)) return false
              seen.add(key)
              return true
            })
            .map((c: { id: string; complaintRef?: string; policyNumber?: string; subject?: string; processingStatus?: string; from?: string }) => ({
              id: c.id,
              policyNumber: c.policyNumber ?? c.complaintRef ?? c.id,
              subject: c.subject ?? '',
              processingStatus: c.processingStatus ?? 'pending',
              from: c.from ?? '',
            }))
        : []
      setPolicyOptions(options)
      setCached(CACHE_KEYS.INGESTED_OPTIONS, options, TTL.OPTIONS_MS)
    } catch {
      if (!cachedOptions?.length) {
        setError('Unable to load ingested complaints. Is the backend running on port 8020?')
        setPolicyOptions([])
      }
    } finally {
      setLoadingPolicies(false)
    }
  }

  const handleSyncInbox = useCallback(async () => {
    setSyncingInbox(true)
    setError('')
    setSyncMessage('')
    setSyncProgress(null)
    try {
      const res = await fetch('/api/sync-inbox/stream', { method: 'GET' })
      if (!res.ok || !res.body) throw new Error('Sync stream failed')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim()
          } else if (line.startsWith('data:') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(5).trim())
              if (currentEvent === 'progress') {
                setSyncProgress({ total: data.total ?? 0, done: data.done ?? 0, ingested: data.ingested ?? 0 })
              } else if (currentEvent === 'done') {
                if (data.ingested > 0) {
                  const parts = [`${data.ingested} new complaint(s) ingested`]
                  if (data.skippedDuplicate > 0) parts.push(`${data.skippedDuplicate} duplicate(s) skipped`)
                  setSyncMessage(parts.join('. '))
                } else if (data.scanned === 0) {
                  setSyncMessage(data.hint || 'No new emails')
                } else {
                  setSyncMessage('Inbox up to date')
                }
                removeCachedByPrefix(CACHE_KEYS.INGESTED_DETAIL_PREFIX)
                await fetchPolicyOptions()
                if (data.errors?.length) setError(data.errors.join('; '))
              } else if (currentEvent === 'error') {
                setError(data.errors?.[0] || 'Sync failed')
              }
            } catch { /* ignore */ }
            currentEvent = ''
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync inbox')
    } finally {
      setSyncingInbox(false)
      setSyncProgress(null)
    }
  }, [])

  useEffect(() => {
    const initialize = async () => {
      await fetchPolicyOptions()
      await handleSyncInbox()
    }
    initialize()
  }, [handleSyncInbox])

  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') fetchPolicyOptions() }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  const loadThread = async (id: string) => {
    setLoadingThread(true)
    setThread([])
    try {
      const res = await fetch(`/api/ingested-claims/${encodeURIComponent(id)}/thread`)
      if (res.ok) {
        const data = await res.json()
        const msgs: ThreadMessage[] = Array.isArray(data) ? data : data.thread ?? []
        setThread(msgs)
        // Auto-expand the last message only
        if (msgs.length > 0) {
          setExpandedMsgIds(new Set([msgs[msgs.length - 1].id]))
        }
      }
    } catch { /* silently fail — selectedClaim still shows */ }
    finally { setLoadingThread(false) }
  }

  const handleSelectClaim = async (id: string) => {
    if (id === selectedId) return
    setSelectedId(id)
    setSelectedClaim(null)
    setThread([])
    setLoadingClaim(true)
    setError('')
    const key = `${CACHE_KEYS.INGESTED_DETAIL_PREFIX}${id}`
    const cached = getCached<IngestedClaim>(key)
    if (cached) { setSelectedClaim(cached); setLoadingClaim(false) }
    try {
      const res = await fetch(`/api/ingested-claims/${id}`)
      if (!res.ok) throw new Error('Failed to load complaint')
      const data = await res.json()
      setSelectedClaim(data)
      setCached(key, data, TTL.DETAIL_MS)
    } catch {
      if (!cached) { setError('Unable to load complaint details.'); setSelectedClaim(null) }
    } finally {
      setLoadingClaim(false)
    }
    // Load thread in parallel
    await loadThread(id)
  }

  const handleClearClaims = async () => {
    if (!confirm('Clear all ingested complaints? This cannot be undone.')) return
    setClearingClaims(true)
    setError('')
    setSyncMessage('')
    try {
      const res = await fetch('/api/ingested-claims/clear', { method: 'POST' })
      if (!res.ok) throw new Error('Clear failed')
      setSelectedId(null)
      setSelectedClaim(null)
      setThread([])
      removeCachedByPrefix('cache:ingested-claims:')
      await fetchPolicyOptions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear')
    } finally {
      setClearingClaims(false)
    }
  }

  const handleProcessClaim = async () => {
    if (!selectedClaim) return
    setError('')
    setIsProcessing(true)
    try {
      const res = await fetch('/api/process-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingestedClaimId: selectedClaim.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Processing failed')
      setPolicyOptions(prev =>
        prev.map(o => o.id === selectedClaim.id ? { ...o, processingStatus: 'processed' } : o)
      )
      onProcessClaim(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Complaint processing failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const toggleMsg = (id: string) => {
    setExpandedMsgIds(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const pendingCount   = policyOptions.filter(o => o.processingStatus !== 'processed').length
  const processedCount = policyOptions.filter(o => o.processingStatus === 'processed').length

  // Use thread if loaded, otherwise fall back to the single claim as a thread of 1
  const displayThread: ThreadMessage[] = thread.length > 0
    ? thread
    : selectedClaim
      ? [{ id: selectedClaim.id, from: selectedClaim.from, to: selectedClaim.to, subject: selectedClaim.subject, emailBody: selectedClaim.emailBody, createdAt: selectedClaim.createdAt, source: selectedClaim.source, attachments: selectedClaim.attachments }]
      : []

  return (
    <div className="flex flex-col h-[calc(100vh-68px)] overflow-hidden bg-[#F8FAFC]">

      {/* Top toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#E5E7EB] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-[#FEF2F2]">
            <Inbox className="w-4 h-4 text-[#991B1B]" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-[#111827]">Complaint Inbox</h1>
            <p className="text-[11px] text-[#9CA3AF] font-medium">
              {loadingPolicies ? 'Loading…' : `${policyOptions.length} complaints · ${pendingCount} pending · ${processedCount} processed`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {syncMessage && (
            <span className="text-xs text-[#059669] font-semibold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              {syncMessage}
            </span>
          )}
          <button
            onClick={handleSyncInbox}
            disabled={syncingInbox}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] hover:bg-[#FEE2E2] rounded-lg transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingInbox ? 'animate-spin' : ''}`} />
            {syncingInbox
              ? syncProgress && syncProgress.total > 0
                ? `${syncProgress.done}/${syncProgress.total}`
                : 'Syncing…'
              : 'Refresh'}
          </button>
          <button
            onClick={handleClearClaims}
            disabled={clearingClaims || policyOptions.length === 0}
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

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left panel: Gmail-style inbox list ───────────────────────── */}
        <div className="w-[320px] flex-shrink-0 border-r border-[#E5E7EB] bg-white flex flex-col">
          <div className="flex-1 overflow-y-auto">
            {loadingPolicies && policyOptions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-[#9CA3AF]">
                <RefreshCw className="w-6 h-6 animate-spin" />
                <p className="text-xs font-medium">Loading inbox…</p>
              </div>
            ) : policyOptions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-[#F3F4F6] flex items-center justify-center">
                  <Inbox className="w-6 h-6 text-[#9CA3AF]" />
                </div>
                <p className="text-sm font-semibold text-[#374151]">No complaints yet</p>
                <p className="text-xs text-[#9CA3AF]">Click Refresh to sync your inbox</p>
              </div>
            ) : (
              <ul>
                {policyOptions.map((opt) => {
                  const isSelected  = selectedId === opt.id
                  const isProcessed = opt.processingStatus === 'processed'
                  const senderName  = displayName(opt.from) || opt.subject?.slice(0, 20) || 'Unknown'
                  const initial     = avatarInitial(opt.from || opt.subject)
                  return (
                    <li key={opt.id} className="border-b border-[#F3F4F6]">
                      <button
                        onClick={() => handleSelectClaim(opt.id)}
                        className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-all group
                          ${isSelected
                            ? 'bg-[#FEF2F2] border-l-[3px] border-[#991B1B]'
                            : `${!isProcessed ? 'bg-white' : 'bg-[#FAFAFA]'} hover:bg-[#F8FAFC] border-l-[3px] border-transparent`}`}
                      >
                        {/* Sender avatar */}
                        <div className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-[13px] font-bold mt-0.5
                          ${isSelected ? 'bg-[#991B1B] text-white' : 'bg-[#E5E7EB] text-[#6B7280]'}`}>
                          {initial}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          {/* Row 1: sender name + status badge */}
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className={`text-[12px] truncate ${isProcessed ? 'font-medium text-[#6B7280]' : 'font-bold text-[#111827]'} ${isSelected ? '!text-[#991B1B]' : ''}`}>
                              {senderName}
                            </span>
                            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold flex-shrink-0 px-1.5 py-0.5 rounded-full
                              ${isProcessed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                              {isProcessed
                                ? <><CheckCircle2 className="w-2.5 h-2.5" />Done</>
                                : <><Clock3 className="w-2.5 h-2.5" />Pending</>}
                            </span>
                          </div>
                          {/* Row 2: subject (bold if pending) */}
                          <p className={`text-[12px] truncate ${isProcessed ? 'font-normal text-[#6B7280]' : 'font-semibold text-[#374151]'}`}>
                            {opt.subject || '(no subject)'}
                          </p>
                          {/* Row 3: complaint ID */}
                          <p className="text-[11px] text-[#B0B8C4] truncate mt-0.5">{opt.id}</p>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ── Right panel: Gmail-style thread view ──────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white">
          <AnimatePresence mode="wait">
            {!selectedId ? (
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
                  <p className="text-base font-bold text-[#374151]">Select a complaint</p>
                  <p className="text-sm text-[#9CA3AF] mt-1">Choose a complaint from the inbox to view the full email thread</p>
                </div>
              </motion.div>
            ) : loadingClaim && !selectedClaim ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex items-center justify-center"
              >
                <RefreshCw className="w-6 h-6 animate-spin text-[#991B1B]" />
              </motion.div>
            ) : selectedClaim ? (
              <motion.div
                key={selectedClaim.id}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18 }}
                className="flex-1 flex flex-col min-h-0 overflow-hidden"
              >
                {/* Thread header — sticky */}
                <div className="px-6 py-4 border-b border-[#E5E7EB] flex-shrink-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-bold text-[#111827] leading-tight">
                        {selectedClaim.subject || '(no subject)'}
                      </h2>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {/* Thread count badge */}
                        {displayThread.length > 1 && (
                          <span className="text-[11px] font-semibold bg-[#F3F4F6] text-[#6B7280] px-2 py-0.5 rounded-full">
                            {displayThread.length} messages
                          </span>
                        )}
                        {/* Status */}
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full
                          ${selectedClaim.processingStatus === 'processed'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                          {selectedClaim.processingStatus === 'processed'
                            ? <><CheckCircle2 className="w-3 h-3" /> Processed</>
                            : <><Clock3 className="w-3 h-3" /> Pending</>}
                        </span>
                        {/* Attachments count */}
                        {selectedClaim.attachments?.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[#6B7280]">
                            <Paperclip className="w-3 h-3" />
                            {selectedClaim.attachments.length} attachment{selectedClaim.attachments.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Process button */}
                    <button
                      onClick={handleProcessClaim}
                      disabled={isProcessing || selectedClaim.processingStatus === 'processed'}
                      className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#991B1B] to-[#B91C1C] hover:from-[#7F1D1D] hover:to-[#991B1B] text-white text-sm font-bold rounded-xl shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                    >
                      {isProcessing ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" />Processing…</>
                      ) : selectedClaim.processingStatus === 'processed' ? (
                        <><CheckCircle2 className="w-4 h-4" />Processed</>
                      ) : (
                        <><Play className="w-4 h-4" />Process<ChevronRight className="w-4 h-4" /></>
                      )}
                    </button>
                  </div>
                </div>

                {/* Thread messages — scrollable */}
                <div className="flex-1 overflow-y-auto">
                  <div className="px-6 py-4 space-y-2">

                    {loadingThread && thread.length === 0 && (
                      <div className="flex items-center gap-2 text-xs text-[#9CA3AF] py-2">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Loading thread…
                      </div>
                    )}

                    {displayThread.map((msg, idx) => {
                      const isLast    = idx === displayThread.length - 1
                      const isExpanded = expandedMsgIds.has(msg.id)
                      const isOutbound = msg.source === 'outbound' || msg.direction === 'outbound'
                      const senderDisplay = displayName(msg.from)
                      const initial = avatarInitial(msg.from)
                      const snippet = cleanBody(msg.emailBody || '').replace(/\s+/g, ' ').trim().slice(0, 120)

                      return (
                        <motion.div
                          key={msg.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.04 }}
                          className={`rounded-xl border transition-all ${
                            isExpanded
                              ? 'border-[#E5E7EB] shadow-sm'
                              : 'border-[#F3F4F6] hover:border-[#E5E7EB]'
                          } ${isOutbound ? 'bg-[#F0FDF4]' : 'bg-white'}`}
                        >
                          {/* Message header — always visible, click to toggle */}
                          <button
                            onClick={() => toggleMsg(msg.id)}
                            className="w-full text-left px-4 py-3 flex items-center gap-3"
                          >
                            {/* Avatar */}
                            <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold
                              ${isOutbound ? 'bg-[#991B1B] text-white' : 'bg-[#3B82F6] text-white'}`}>
                              {isOutbound ? 'S' : initial}
                            </div>

                            {/* Sender + meta */}
                            <div className="flex-1 min-w-0">
                              {isExpanded ? (
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[13px] font-semibold text-[#111827]">
                                      {isOutbound ? 'Support Team' : senderDisplay}
                                    </span>
                                    {isOutbound && (
                                      <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                                        <Send className="w-2.5 h-2.5" />Sent
                                      </span>
                                    )}
                                    {isLast && !isOutbound && (
                                      <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Latest</span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-[#9CA3AF] mt-0.5">
                                    {isOutbound ? `to ${msg.to || '—'}` : msg.from}
                                    {msg.createdAt ? ` · ${formatDateLong(msg.createdAt)}` : ''}
                                  </p>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-[13px] font-semibold text-[#374151] flex-shrink-0">
                                    {isOutbound ? 'Support Team' : senderDisplay}
                                  </span>
                                  <span className="text-[12px] text-[#9CA3AF] truncate">{snippet}</span>
                                </div>
                              )}
                            </div>

                            {/* Date + expand icon */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {msg.attachments && msg.attachments.length > 0 && (
                                <Paperclip className="w-3.5 h-3.5 text-[#9CA3AF]" />
                              )}
                              <span className="text-[11px] text-[#9CA3AF]">{formatDate(msg.createdAt)}</span>
                              {isExpanded
                                ? <ChevronUp className="w-4 h-4 text-[#9CA3AF]" />
                                : <ChevronDown className="w-4 h-4 text-[#9CA3AF]" />}
                            </div>
                          </button>

                          {/* Expanded content */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                className="overflow-hidden"
                              >
                                <div className="px-5 pb-4 border-t border-[#F3F4F6]">
                                  {/* Email body */}
                                  <div className="pt-4">
                                    <pre className="text-[13px] text-[#374151] whitespace-pre-wrap font-sans leading-relaxed">
                                      {cleanBody(msg.emailBody || '') || '(no content)'}
                                    </pre>
                                  </div>

                                  {/* Attachments */}
                                  {msg.attachments && msg.attachments.length > 0 && (
                                    <div className="mt-4 pt-3 border-t border-[#F3F4F6]">
                                      <div className="flex items-center gap-1.5 mb-2">
                                        <Paperclip className="w-3.5 h-3.5 text-[#6B7280]" />
                                        <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">
                                          {msg.attachments.length} Attachment{msg.attachments.length !== 1 ? 's' : ''}
                                        </span>
                                      </div>
                                      <div className="grid sm:grid-cols-2 gap-2">
                                        {msg.attachments.map((att) => (
                                          <div
                                            key={att.name}
                                            className="flex items-center gap-2.5 p-2.5 bg-white rounded-lg border border-[#E5E7EB] hover:border-[#CBD5E1] transition-colors"
                                          >
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                                              ${att.mimeType?.startsWith('image/') ? 'bg-[#FEF2F2]' : 'bg-[#F3F4F6]'}`}>
                                              {att.mimeType?.startsWith('image/')
                                                ? <Image className="w-4 h-4 text-[#991B1B]" />
                                                : <FileText className="w-4 h-4 text-[#6B7280]" />}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                              <p className="text-[12px] font-semibold text-[#111827] truncate">{att.name}</p>
                                              <p className="text-[11px] text-[#9CA3AF]">{att.size ? `${(att.size / 1024).toFixed(1)} KB` : ''} {att.mimeType?.split('/')[1]?.toUpperCase()}</p>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Navigate to review for latest inbound */}
                                  {isLast && !isOutbound && (
                                    <div className="mt-4 pt-3 border-t border-[#F3F4F6] flex items-center gap-3">
                                      <button
                                        onClick={handleProcessClaim}
                                        disabled={isProcessing || selectedClaim.processingStatus === 'processed'}
                                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-[#991B1B] to-[#B91C1C] hover:from-[#7F1D1D] hover:to-[#991B1B] rounded-lg transition-all disabled:opacity-50"
                                      >
                                        {isProcessing ? (
                                          <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Processing…</>
                                        ) : selectedClaim.processingStatus === 'processed' ? (
                                          <><CheckCircle2 className="w-3.5 h-3.5" />Already Processed</>
                                        ) : (
                                          <><Play className="w-3.5 h-3.5" />Process this complaint<ArrowRight className="w-3.5 h-3.5" /></>
                                        )}
                                      </button>
                                      {displayThread.length > 1 && (
                                        <span className="text-[11px] text-[#9CA3AF]">
                                          <ArrowLeft className="w-3 h-3 inline mr-1" />
                                          {displayThread.length - 1} earlier message{displayThread.length > 2 ? 's' : ''} in thread
                                        </span>
                                      )}
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
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
