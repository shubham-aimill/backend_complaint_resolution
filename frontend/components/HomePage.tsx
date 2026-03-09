'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Mail,
  FileText,
  Image,
  AlertCircle,
  Play,
  Clock,
  CheckCircle,
  Inbox,
  RefreshCw,
  Trash2,
} from 'lucide-react'
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
  /** Original email body text - NOT extracted document content */
  emailBody: string
  attachments: Array<{ name: string; path: string; size: number; mimeType: string }>
  createdAt: string
  source: 'sendgrid' | 'demo' | 'imap'
}

interface PolicyOption {
  id: string
  policyNumber: string
  subject: string
}

const CACHE_KEYS = {
  INGESTED_OPTIONS: 'cache:ingested-claims:options',
  INGESTED_DETAIL_PREFIX: 'cache:ingested-claims:detail:',
}
const TTL = {
  OPTIONS_MS: 2 * 60 * 1000,
  DETAIL_MS: 10 * 60 * 1000,
}

export default function HomePage({ onProcessClaim, isProcessing, setIsProcessing }: HomePageProps) {
  const [policyOptions, setPolicyOptions] = useState<PolicyOption[]>([])
  const [selectedClaim, setSelectedClaim] = useState<IngestedClaim | null>(null)
  const [loadingPolicies, setLoadingPolicies] = useState(true)
  const [loadingClaim, setLoadingClaim] = useState(false)
  const [syncingInbox, setSyncingInbox] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncProgress, setSyncProgress] = useState<{ total: number; done: number; ingested: number } | null>(null)
  const [clearingClaims, setClearingClaims] = useState(false)
  const [error, setError] = useState('')
  const [processingSteps, setProcessingSteps] = useState<string[]>([])
  const [currentStep, setCurrentStep] = useState('')

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
      // Backend returns { id, complaintRef, subject }; map to { id, policyNumber, subject } for dropdown
      const options: PolicyOption[] = Array.isArray(data)
        ? data.map((c: { id: string; complaintRef?: string; policyNumber?: string; subject?: string }) => ({
            id: c.id,
            policyNumber: c.policyNumber ?? c.complaintRef ?? c.id,
            subject: c.subject ?? '',
          }))
        : []
      setPolicyOptions(options)
      setCached(CACHE_KEYS.INGESTED_OPTIONS, options, TTL.OPTIONS_MS)
    } catch (err) {
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
                setSyncProgress({
                  total: data.total ?? 0,
                  done: data.done ?? 0,
                  ingested: data.ingested ?? 0,
                })
              } else if (currentEvent === 'done') {
                const d = data
                if (d.ingested > 0) {
                  const parts = [`${d.ingested} new complaint(s) ingested`]
                  if (d.skippedDuplicate > 0) parts.push(`${d.skippedDuplicate} duplicate(s) skipped`)
                  setSyncMessage(parts.join('. '))
                } else if (d.scanned > 0 && d.skippedNoComplaint === d.scanned) {
                  setSyncMessage(`Scanned ${d.scanned} — none matched complaint keywords`)
                } else if (d.scanned > 0 && d.skippedDuplicate === d.scanned) {
                  setSyncMessage(`Scanned ${d.scanned} — all already ingested`)
                } else if (d.scanned === 0) {
                  setSyncMessage(d.hint || 'No emails to sync')
                } else {
                  setSyncMessage('No new complaint emails to ingest')
                }
                removeCachedByPrefix(CACHE_KEYS.INGESTED_DETAIL_PREFIX)
                await fetchPolicyOptions()
                if (d.errors?.length) setError(d.errors.join('; '))
              } else if (currentEvent === 'error') {
                setError(data.errors?.[0] || 'Sync failed')
              }
            } catch (_) {
              // ignore parse errors for non-JSON lines
            }
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
    // Load existing policies first, then auto-sync inbox on page load
    const initialize = async () => {
      await fetchPolicyOptions()
      await handleSyncInbox()
    }
    initialize()
  }, [handleSyncInbox])

  // Refetch list when user returns to the tab (e.g. mail arrived via SendGrid webhook)
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') fetchPolicyOptions()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  const handleClearClaims = async () => {
    if (!confirm('Clear all ingested complaints? This cannot be undone.')) return
    setClearingClaims(true)
    setError('')
    setSyncMessage('')
    try {
      const res = await fetch('/api/ingested-claims/clear', { method: 'POST' })
      if (!res.ok) throw new Error('Clear failed')
      setSelectedClaim(null)
      removeCachedByPrefix('cache:ingested-claims:')
      await fetchPolicyOptions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear')
    } finally {
      setClearingClaims(false)
    }
  }


  const handleSelectPolicy = async (claimId: string) => {
    if (!claimId) {
      setSelectedClaim(null)
      return
    }
    setLoadingClaim(true)
    setError('')
    const detailCacheKey = `${CACHE_KEYS.INGESTED_DETAIL_PREFIX}${claimId}`
    const cachedDetail = getCached<IngestedClaim>(detailCacheKey)
    if (cachedDetail) {
      setSelectedClaim(cachedDetail)
      setLoadingClaim(false)
    }
    try {
      const res = await fetch(`/api/ingested-claims/${claimId}`)
      if (!res.ok) throw new Error('Failed to load complaint')
      const data = await res.json()
      setSelectedClaim(data)
      setCached(detailCacheKey, data, TTL.DETAIL_MS)
    } catch (err) {
      if (!cachedDetail) {
        setError('Unable to load complaint details.')
        setSelectedClaim(null)
      }
    } finally {
      setLoadingClaim(false)
    }
  }

  const handleProcessClaim = async () => {
    if (!selectedClaim) return
    setError('')
    setIsProcessing(true)
    setProcessingSteps([])
    setCurrentStep('')

    const steps = [
      'Loading complaint data from ingested inbox...',
      'Extracting information from email and attachments...',
      'Analyzing documents and images (Vision)...',
      'Assembling decision pack and saving to history...',
    ]

    for (let i = 0; i < steps.length; i++) {
      setCurrentStep(steps[i])
      setProcessingSteps((prev) => [...prev, steps[i]])
      await new Promise((resolve) => setTimeout(resolve, 700))
    }

    try {
      const res = await fetch('/api/process-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingestedClaimId: selectedClaim.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Processing failed')
      onProcessClaim(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Complaint processing failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const canProcess = !!selectedClaim && !isProcessing

  return (
    <div className="relative min-h-screen">
      {/* Grid Background */}
      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(37, 99, 235, 0.06) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(37, 99, 235, 0.06) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
        }}
      />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Hero Section */}
        <div className="text-center mb-16 pt-12 relative">
          <div className="absolute inset-0 -top-20 -bottom-20 flex items-center justify-center pointer-events-none">
            <div className="w-full max-w-2xl h-64 bg-gradient-radial from-[#991B1B]/10 via-[#B91C1C]/5 to-transparent rounded-full blur-3xl" />
          </div>
          <div className="relative z-10">
            <span className="inline-block text-xs font-semibold text-[#991B1B] uppercase tracking-widest mb-6">
              Complaint Inbox
            </span>
            <h1 className="text-6xl font-bold text-[#0F172A] mb-6 tracking-tight leading-tight">
              Complaint Management
              <br />
              <span className="bg-gradient-to-r from-[#991B1B] to-[#B91C1C] bg-clip-text text-transparent">
                Inbox Portal
              </span>
            </h1>
            <p className="text-xl text-[#475569] max-w-2xl mx-auto mb-3 font-medium leading-relaxed">
              Select a complaint to review and process the submission
            </p>
            <p className="text-base text-[#64748B] max-w-xl mx-auto">
              Complaint submissions and supporting documentation are ingested automatically
            </p>
          </div>
        </div>

        {/* Action Bar: Auto Sync Status & Clear All */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10 relative z-10">
          <div className="flex items-center gap-3">
            {syncingInbox && (
              <div className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-[#991B1B] bg-white border border-[#E2E8F0] rounded-xl">
                <RefreshCw className="w-4 h-4 animate-spin" />
                {syncProgress && syncProgress.total > 0
                  ? `Syncing ${syncProgress.done} of ${syncProgress.total}${syncProgress.ingested > 0 ? ` (${syncProgress.ingested} new)` : ''}`
                  : 'Syncing inbox…'}
              </div>
            )}
            <button
              onClick={handleClearClaims}
              disabled={clearingClaims || loadingPolicies || policyOptions.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-[#64748B] bg-white border border-[#E2E8F0] hover:border-[#dc2626] hover:text-[#dc2626] rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Clear all ingested complaints"
            >
              <Trash2 className={`w-4 h-4 ${clearingClaims ? 'animate-pulse' : ''}`} />
              Clear All
            </button>
          </div>
          {syncMessage && (
            <span className="text-sm text-[#059669] font-medium">{syncMessage}</span>
          )}
        </div>

        {/* Complaint Selection & Content */}
        <div className="grid lg:grid-cols-2 gap-8 mb-16 relative z-10">
          {/* Left: Complaint Selector & Email Preview */}
          <div className="card-glass p-8 h-full flex flex-col relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-[#991B1B]/5 via-transparent to-[#B91C1C]/5 pointer-events-none" />
            <div className="relative z-10 flex flex-col h-full">
              <div className="flex items-center space-x-2 mb-6">
                <div className="p-2 bg-gradient-to-br from-[#991B1B]/10 to-[#B91C1C]/10 rounded-lg">
                  <Inbox className="w-5 h-5 text-[#991B1B]" />
                </div>
                <h2 className="text-sm font-semibold text-[#475569] uppercase tracking-wider">
                  Auto-Ingested Complaints
                </h2>
              </div>

              {/* Complaint Dropdown */}
              <div className="space-y-2 mb-6">
                <label className="block text-sm font-medium text-[#334155]">Case / Reference</label>
                <select
                  value={selectedClaim?.id ?? ''}
                  onChange={(e) => handleSelectPolicy(e.target.value)}
                  disabled={loadingPolicies}
                  className="w-full px-4 py-3 bg-white/80 border border-[#E2E8F0] rounded-xl text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#991B1B]/30 focus:border-[#991B1B] transition-all appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394A3B8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                    backgroundSize: '20px',
                    paddingRight: '44px',
                  }}
                >
                  <option value="">
                    {loadingPolicies ? 'Loading...' : 'Select a complaint to view details'}
                  </option>
                  {policyOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.policyNumber} — {opt.subject.slice(0, 50)}{opt.subject.length > 50 ? '...' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Email Body (Read-only) */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center space-x-2 mb-3">
                  <Mail className="w-4 h-4 text-[#991B1B]" />
                  <span className="text-xs font-semibold text-[#475569] uppercase tracking-wider">
                    Email Content
                  </span>
                </div>
                <div className="flex-1 min-h-[280px] overflow-auto">
                  {loadingClaim ? (
                    <div className="flex items-center justify-center h-full text-[#94A3B8]">
                      <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                      Loading...
                    </div>
                  ) : selectedClaim ? (
                    <pre className="w-full p-4 bg-white/60 rounded-xl border border-[#E2E8F0] text-sm text-[#334155] whitespace-pre-wrap font-sans leading-relaxed">
                      {selectedClaim.emailBody || 'No email content available'}
                    </pre>
                  ) : (
                    <div className="h-full flex items-center justify-center p-8 border-2 border-dashed border-[#E2E8F0] rounded-xl bg-white/30 text-[#94A3B8] text-sm text-center">
                      Select a complaint to view the submitted content
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Attachments */}
          <div className="card-glass p-8 h-full flex flex-col relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-[#B91C1C]/5 via-transparent to-[#991B1B]/5 pointer-events-none" />
            <div className="relative z-10 flex flex-col h-full">
              <div className="flex items-center space-x-2 mb-6">
                <div className="p-2 bg-gradient-to-br from-[#B91C1C]/10 to-[#991B1B]/10 rounded-lg">
                  <FileText className="w-5 h-5 text-[#991B1B]" />
                </div>
                <h2 className="text-sm font-semibold text-[#475569] uppercase tracking-wider">
                  Attachments
                </h2>
              </div>

              <div className="flex-1 min-h-[340px] overflow-auto">
                {selectedClaim?.attachments && selectedClaim.attachments.length > 0 ? (
                  <div className="space-y-3">
                    {selectedClaim.attachments.map((att) => (
                      <div
                        key={att.name}
                        className="flex items-center justify-between p-4 bg-white/60 backdrop-blur-sm rounded-xl border border-[#E2E8F0] hover:border-[#CBD5E1] hover:shadow-md transition-all"
                      >
                        <div className="flex items-center space-x-3 min-w-0 flex-1">
                          {att.mimeType.startsWith('image/') ? (
                            <div className="p-2 bg-[#FEF2F2] rounded-lg">
                              <Image className="w-4 h-4 text-[#991B1B] flex-shrink-0" />
                            </div>
                          ) : (
                            <div className="p-2 bg-[#FFE4E6] rounded-lg">
                              <FileText className="w-4 h-4 text-[#B91C1C] flex-shrink-0" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-[#0F172A] truncate">
                              {att.name}
                            </p>
                            <p className="text-xs text-[#94A3B8] font-medium">
                              {(att.size / 1024).toFixed(1)} KB
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : selectedClaim ? (
                  <div className="h-full flex items-center justify-center p-8 border-2 border-dashed border-[#E2E8F0] rounded-xl bg-white/30 text-[#94A3B8] text-sm text-center">
                    No attachments for this complaint
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center p-8 border-2 border-dashed border-[#E2E8F0] rounded-xl bg-white/30 text-[#94A3B8] text-sm text-center">
                    Select a complaint to view attachments
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 flex items-start space-x-2 p-4 bg-red-50 border border-red-100 rounded-xl">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Process Button */}
        <div className="text-center mb-16 relative z-10">
          <button
            onClick={handleProcessClaim}
            disabled={!canProcess}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 active:scale-100 transition-transform duration-200"
          >
            {isProcessing ? (
              <div className="flex items-center space-x-3">
                <Clock className="w-5 h-5 animate-spin" />
                <span>Processing...</span>
              </div>
            ) : (
              <div className="flex items-center space-x-3">
                <Play className="w-5 h-5" />
                <span>Process Complaint</span>
              </div>
            )}
          </button>
        </div>

        {/* Processing Steps */}
        {isProcessing && (
          <div className="card-glass p-8 relative overflow-hidden z-10">
            <div className="absolute inset-0 bg-gradient-to-br from-[#FEF2F2]/50 via-transparent to-[#FFE4E6]/50 pointer-events-none" />
            <div className="relative z-10">
              <h3 className="text-sm font-semibold text-[#475569] uppercase tracking-wider mb-6">
                Processing Steps
              </h3>
              <div className="space-y-3">
                {processingSteps.map((step, index) => (
                  <div
                    key={index}
                    className="flex items-center space-x-4 p-4 bg-white/60 backdrop-blur-sm rounded-xl border border-[#E2E8F0]"
                  >
                    <div className="p-1.5 bg-gradient-to-br from-[#10B981] to-[#059669] rounded-full">
                      <CheckCircle className="w-4 h-4 text-white flex-shrink-0" />
                    </div>
                    <span className="text-sm text-[#334155] font-medium">{step}</span>
                  </div>
                ))}
                {currentStep && !processingSteps.includes(currentStep) && (
                  <div className="flex items-center space-x-4 p-4 bg-gradient-to-r from-[#FEF2F2] to-[#FFE4E6] rounded-xl border border-[#FECACA]">
                    <div className="p-1.5 bg-gradient-to-br from-[#991B1B] to-[#B91C1C] rounded-full">
                      <Clock className="w-4 h-4 text-white animate-spin flex-shrink-0" />
                    </div>
                    <span className="text-sm text-[#991B1B] font-semibold">{currentStep}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
