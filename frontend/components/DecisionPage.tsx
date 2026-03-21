'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle, FileText, Send, Download, Clock, ArrowRight, ArrowLeft,
  AlertTriangle, Check, X, ChevronDown, ChevronUp, ChevronRight, Mail, Calendar,
  User, MessageSquare, Wrench, RefreshCw, BookOpen,
  Zap, FileCheck, Activity, BarChart2, PenLine, Tag,
} from 'lucide-react'
import { ClaimData } from '@/types/claims'
import { CONFIDENCE } from '@/lib/confidence'
import { getClaimDraft } from '@/lib/normalizeClaim'
import { useMailChain } from '@/lib/hooks/useMailChain'
import { useComplaintDecision } from '@/lib/hooks/useComplaintDecision'
import { useAppointment } from '@/lib/hooks/useAppointment'
import { useEmailDraft } from '@/lib/hooks/useEmailDraft'

interface DecisionPageProps {
  claimData: ClaimData
  onNextStage: () => void
  onPreviousStage: () => void
  onLoadClaim?: (claimId: string) => void
}

const APPOINTMENT_SLOTS = [
  { label: 'Morning',   value: '09:00–12:00', display: '9:00 AM – 12:00 PM' },
  { label: 'Afternoon', value: '12:00–15:00', display: '12:00 PM – 3:00 PM' },
  { label: 'Evening',   value: '15:00–18:00', display: '3:00 PM – 6:00 PM' },
]

function DecisionBadge({ decision }: { decision?: string }) {
  if (!decision) return null
  const cfg: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    APPROVE_REPAIR:       { label: 'Approve Repair',       cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <Wrench className="w-3.5 h-3.5" /> },
    APPROVE_REPLACEMENT:  { label: 'Approve Replacement',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <Check className="w-3.5 h-3.5" /> },
    DESK_REJECT:          { label: 'Desk Reject',          cls: 'bg-rose-50 text-rose-700 border-rose-200',           icon: <X className="w-3.5 h-3.5" /> },
    REQUEST_DOCUMENTS:    { label: 'Request Documents',    cls: 'bg-amber-50 text-amber-700 border-amber-200',         icon: <FileCheck className="w-3.5 h-3.5" /> },
    INVESTIGATE:          { label: 'Investigate',          cls: 'bg-blue-50 text-blue-700 border-blue-200',            icon: <Activity className="w-3.5 h-3.5" /> },
  }
  const c = cfg[decision] ?? { label: decision, cls: 'bg-gray-100 text-gray-700 border-gray-200', icon: <Tag className="w-3.5 h-3.5" /> }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${c.cls}`}>
      {c.icon}{c.label}
    </span>
  )
}

export default function DecisionPage({ claimData, onNextStage, onPreviousStage }: DecisionPageProps) {
  const ingestedId = claimData?.ingestedClaimId ?? (claimData as unknown as Record<string, unknown>)?.ingestedComplaintId as string | undefined

  const mailChainHook  = useMailChain(ingestedId)
  const decisionHook   = useComplaintDecision(claimData, ingestedId)
  const appointmentHook = useAppointment()
  const emailDraftHook  = useEmailDraft()

  // UI state
  const [expandedMailIds, setExpandedMailIds]     = useState<Set<string>>(new Set())
  const [expandedPolicyIds, setExpandedPolicyIds] = useState<Set<string>>(new Set())
  const [showPolicyGrounding, setShowPolicyGrounding] = useState(false)
  const [showAudit, setShowAudit]                 = useState(false)
  const [isCreatingDraft, setIsCreatingDraft]     = useState(false)
  const [draftCreated, setDraftCreated]           = useState(false)
  const [draftError, setDraftError]               = useState<string | null>(null)
  const [isDownloading, setIsDownloading]         = useState(false)
  const [downloadError, setDownloadError]         = useState<string | null>(null)

  // Modals
  const [showDecisionModal, setShowDecisionModal]           = useState(false)
  const [pendingDecision, setPendingDecision]               = useState<'accept' | 'reject' | null>(null)
  const [rejectionReason, setRejectionReason]               = useState('')
  const [showAppointmentModal, setShowAppointmentModal]     = useState(false)
  const [appointmentData, setAppointmentData]               = useState({ date: '', engineerName: '', time: '', location: '' })
  const [showAppointmentConfirm, setShowAppointmentConfirm] = useState(false)

  useEffect(() => { decisionHook.reset() }, [claimData?.claimId])

  // Auto-load mail chain on mount
  useEffect(() => {
    if (ingestedId) mailChainHook.fetch()
  }, [ingestedId])

  // Auto-expand latest message
  useEffect(() => {
    if (mailChainHook.chain.length > 0) {
      const last = mailChainHook.chain[mailChainHook.chain.length - 1]
      setExpandedMailIds(new Set([last.id]))
    }
  }, [mailChainHook.chain])

  if (!claimData || !claimData.decisionPack) {
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto text-center py-24">
        <AlertTriangle className="w-14 h-14 text-amber-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">No Complaint Data</h2>
        <p className="text-gray-500 mb-6">Process a complaint first before making decisions.</p>
        <button onClick={onPreviousStage} className="inline-flex items-center gap-2 px-4 py-2 bg-[#991B1B] text-white rounded-lg text-sm font-medium hover:bg-[#7F1D1D]">
          <ArrowLeft className="w-4 h-4" />Back to Review
        </button>
      </motion.div>
    )
  }

  const { decisionPack } = claimData
  const { evidence = [], documents = [], policyGrounding = [], audit = [] } = decisionPack || {}
  const claimDraft = getClaimDraft(decisionPack as unknown as Record<string, unknown>)
  const d = (claimDraft as Record<string, unknown>) || {}

  const customerName  = String(d.claimantName  || d.customerName  || 'Valued Customer')
  const complaintRef  = String(d.policyNumber  || d.policyId      || claimData.claimId || 'Pending')
  const complaintType = String(d.lossType      || d.complaintType || 'General Complaint')
  const product       = String(d.productOrService || d.description || 'your product')
  const complaintDate = String(d.lossDate      || d.complaintDate || 'the reported date')
  const recipient     = String((claimData.sourceEmailFrom as string) || d.contactEmail || '')
  const today         = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })

  const highConf = evidence.filter(e => e.confidence >= CONFIDENCE.THRESHOLD_HIGH).length
  const confPct  = evidence.length > 0 ? Math.round(evidence.reduce((s, e) => s + e.confidence, 0) / evidence.length * 100) : 0

  // ── Letter templates ─────────────────────────────────────────────────────
  const letters = {
    acknowledgment: `${today}\n\nDear ${customerName},\n\nRE: Complaint Received – Reference ${complaintRef}\n\nThank you for contacting Consumer Electronics Customer Support. We have received your complaint and logged it in our system.\n\nCOMPLAINT DETAILS\n  • Reference: ${complaintRef}\n  • Date: ${complaintDate}\n  • Type: ${complaintType}\n  • Product: ${product}\n\nOur team will review your complaint within 2 business days and follow up with our assessment.\n\nKind regards,\nCustomer Support Team\nConsumer Electronics`,

    acceptance: `${today}\n\nDear ${customerName},\n\nRE: Complaint Approved – Reference ${complaintRef}\n\nWe are pleased to inform you that your complaint regarding your ${product} has been approved.\n\n  • Decision: Approved for ${claimData.autoDecision === 'APPROVE_REPLACEMENT' ? 'replacement' : 'repair'}\n  • Reference: ${complaintRef}\n\nOur technical team will contact you within 48 hours to arrange the next steps.\n\nKind regards,\nCustomer Support Team\nConsumer Electronics`,

    rejection: (reason?: string) => `${today}\n\nDear ${customerName},\n\nRE: Complaint Decision – Reference ${complaintRef}\n\nWe have reviewed your complaint and regret to inform you that we are unable to process it at this time.\n\nREASON\n  ${reason || (claimData.warrantyStatus === 'OUT_OF_WARRANTY' ? 'Your product is outside the warranty period.' : 'Your complaint does not meet the criteria for resolution under our current policy.')}\n\nYour options:\n  1. Out-of-warranty paid repair — contact repairs@electronics.com\n  2. Reply within 14 days with additional evidence for re-evaluation.\n\nKind regards,\nCustomer Support Team\nConsumer Electronics`,

    moreInfo: `${today}\n\nDear ${customerName},\n\nRE: Additional Information Required – Reference ${complaintRef}\n\nWe require the following to proceed with your complaint:\n\n  1. Proof of purchase (invoice/receipt)\n  2. Photos/video of the fault\n  3. Serial number or IMEI\n  4. Any previous repair records\n\nPlease reply with documents attached, quoting reference ${complaintRef}.\n\nKind regards,\nCustomer Support Team\nConsumer Electronics`,
  }

  const openDraft = (type: 'acknowledgment' | 'acceptance' | 'rejection' | 'moreInfo', body?: string) => {
    const subjects: Record<string, string> = {
      acknowledgment: `Complaint Acknowledged – ${complaintRef}`,
      acceptance:     `Complaint Approved – ${complaintRef}`,
      rejection:      `Complaint Decision – ${complaintRef}`,
      moreInfo:       `Additional Information Required – ${complaintRef}`,
    }
    emailDraftHook.open(type, body ?? (type === 'rejection' ? letters.rejection() : letters[type as 'acknowledgment' | 'acceptance' | 'moreInfo']), recipient, subjects[type], claimData.messageId, claimData.threadId)
  }

  const handleConfirmDecision = async () => {
    if (!pendingDecision) return
    const letter  = pendingDecision === 'accept' ? letters.acceptance : letters.rejection(rejectionReason)
    const subject = pendingDecision === 'accept' ? `Complaint Approved – ${complaintRef}` : `Complaint Decision – ${complaintRef}`
    const ok = await decisionHook.decide({ decision: pendingDecision, letter, recipient, subject, rejectionReason: rejectionReason || undefined, inReplyTo: claimData.messageId, references: claimData.threadId })
    if (ok) { setShowDecisionModal(false); setPendingDecision(null); await mailChainHook.fetch() }
  }

  const handleAppointmentSubmit = async () => {
    const complaintId = claimData.claimId || ''
    if (!complaintId || !appointmentData.date || !appointmentData.engineerName || !appointmentData.time || !appointmentData.location) return
    const ok = await appointmentHook.book({ complaintId, ...appointmentData })
    if (ok) {
      setShowAppointmentModal(false)
      setShowAppointmentConfirm(true)
      const slotDisplay = APPOINTMENT_SLOTS.find(s => s.value === appointmentData.time)?.display ?? appointmentData.time
      emailDraftHook.open('appointment_confirmation',
        `Dear ${customerName},\n\nYour engineer visit is confirmed:\n\n  Reference: ${complaintId}\n  Product: ${product}\n  Date: ${appointmentData.date}\n  Time: ${slotDisplay}\n  Location: ${appointmentData.location}\n  Engineer: ${appointmentData.engineerName}\n\nPlease ensure someone is available at the location.\n\nKind regards,\nCustomer Support Team`,
        recipient, `Engineer Visit Confirmed — ${complaintId}`, claimData.messageId, claimData.threadId)
      setAppointmentData({ date: '', engineerName: '', time: '', location: '' })
    }
  }

  const handleDownload = async () => {
    setIsDownloading(true); setDownloadError(null)
    try {
      const res = await fetch('/api/decision-pack/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claimData, claimStatus: decisionHook.status }) })
      if (!res.ok) throw new Error('PDF generation failed')
      const blob = await res.blob()
      const match = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = match?.[1] || `Decision-${claimData.claimId}.pdf`; a.click()
      URL.revokeObjectURL(url)
    } catch (err) { setDownloadError(err instanceof Error ? err.message : 'Failed') }
    finally { setIsDownloading(false) }
  }

  const handleCreateDraft = async () => {
    setIsCreatingDraft(true); setDraftError(null)
    try {
      const res = await fetch('/api/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(claimData) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setDraftCreated(true)
    } catch (err) { setDraftError(err instanceof Error ? err.message : 'Failed') }
    finally { setIsCreatingDraft(false) }
  }

  const isOutbound = (msg: Record<string, unknown>) => msg['source'] === 'outbound' || msg['direction'] === 'outbound'
  const cleanBody = (body: string) => body.split('\n').map(l => l.replace(/^>+\s?/, '')).join('\n').trim()

  return (
    <div className="flex flex-col h-[calc(100vh-68px)] overflow-hidden bg-[#F8FAFC]">

      {/* ── Top navigation bar ─────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#E5E7EB] px-5 py-2.5 flex items-center gap-3 flex-shrink-0">
        {/* Breadcrumb */}
        <button onClick={onPreviousStage} className="flex items-center gap-1 text-xs text-[#6B7280] hover:text-[#111827] transition-colors font-medium flex-shrink-0">
          <ArrowLeft className="w-3.5 h-3.5" />Review
        </button>
        <ChevronRight className="w-3.5 h-3.5 text-[#D1D5DB] flex-shrink-0" />
        <span className="text-xs font-semibold text-[#111827] flex-shrink-0">Resolution</span>
        <div className="w-px h-4 bg-[#E5E7EB] flex-shrink-0" />
        <span className="text-[11px] font-mono text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded truncate max-w-[220px]">
          {claimData.claimId || '—'}
        </span>
        <div className="flex-1" />
        <DecisionBadge decision={claimData.autoDecision} />
        {typeof claimData.decisionConfidence === 'number' && (
          <span className="text-xs text-[#6B7280] font-medium flex-shrink-0">{Math.round(claimData.decisionConfidence * 100)}% confidence</span>
        )}
        <div className="w-px h-4 bg-[#E5E7EB] flex-shrink-0" />
        <button onClick={onNextStage} className="flex items-center gap-1 text-xs text-[#6B7280] hover:text-[#111827] transition-colors font-medium flex-shrink-0">
          Dashboard<ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Three-panel body ────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── LEFT SIDEBAR: Complaint meta ─────────────────────────────── */}
        <div className="w-[268px] flex-shrink-0 border-r border-[#E5E7EB] bg-white flex flex-col overflow-y-auto">
          <div className="p-4 space-y-3">

            {/* Customer card */}
            <div className="rounded-xl border border-[#E5E7EB] p-3.5 bg-[#F9FAFB]">
              <div className="flex items-center gap-2.5 mb-2.5">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#991B1B] to-[#B91C1C] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {customerName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#111827] truncate">{customerName}</p>
                  <p className="text-[11px] text-[#9CA3AF] truncate">{recipient || 'No email'}</p>
                </div>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-[#9CA3AF]">Ref</span><span className="font-medium text-[#374151] font-mono">{complaintRef}</span></div>
                <div className="flex justify-between"><span className="text-[#9CA3AF]">Type</span><span className="font-medium text-[#374151] truncate max-w-[140px] text-right">{complaintType}</span></div>
                <div className="flex justify-between"><span className="text-[#9CA3AF]">Product</span><span className="font-medium text-[#374151] truncate max-w-[140px] text-right">{product}</span></div>
              </div>
            </div>

            {/* DESK_REJECT alert */}
            {claimData.autoDecision === 'DESK_REJECT' && (
              <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-3">
                <div className="flex items-start gap-2 mb-2.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-rose-800">Auto Desk Rejected</p>
                    <p className="text-[11px] text-rose-600 mt-0.5">
                      {claimData.rejectReason === 'customer_not_found' ? 'Customer not found in CRM.' : 'Complaint auto-rejected by system.'}
                    </p>
                  </div>
                </div>
                {!emailDraftHook.sent.rejection ? (
                  <button onClick={() => openDraft('rejection')} className="w-full text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 px-3 py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" />Send Rejection Email
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-rose-700"><Check className="w-3.5 h-3.5" />Email Sent</div>
                )}
              </div>
            )}

            {/* AI Decision + Warranty */}
            <div className="rounded-xl border border-[#E5E7EB] p-3.5 space-y-2.5">
              <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">AI Assessment</p>

              {/* Decision */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#6B7280]">Decision</span>
                <DecisionBadge decision={claimData.autoDecision} />
              </div>

              {/* Confidence bar */}
              {typeof claimData.decisionConfidence === 'number' && (
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-[#9CA3AF]">Confidence</span>
                    <span className="font-semibold text-[#374151]">{Math.round(claimData.decisionConfidence * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${claimData.decisionConfidence >= 0.8 ? 'bg-emerald-500' : claimData.decisionConfidence >= 0.6 ? 'bg-amber-500' : 'bg-rose-500'}`}
                      style={{ width: `${Math.round(claimData.decisionConfidence * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Warranty */}
              {claimData.warrantyStatus && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#6B7280]">Warranty</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    claimData.warrantyStatus === 'WITHIN_WARRANTY' ? 'bg-emerald-50 text-emerald-700' :
                    claimData.warrantyStatus === 'OUT_OF_WARRANTY' ? 'bg-rose-50 text-rose-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {claimData.warrantyStatus === 'WITHIN_WARRANTY' ? 'In Warranty' : claimData.warrantyStatus === 'OUT_OF_WARRANTY' ? 'Out of Warranty' : claimData.warrantyStatus}
                  </span>
                </div>
              )}

              {/* Agent decision override status */}
              {decisionHook.status !== 'pending' && (
                <div className="flex items-center justify-between pt-1 border-t border-[#F3F4F6]">
                  <span className="text-xs text-[#6B7280]">Agent Decision</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${decisionHook.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                    {decisionHook.status === 'accepted' ? 'Accepted' : 'Rejected'}
                  </span>
                </div>
              )}
            </div>

            {/* Evidence stats */}
            <div className="rounded-xl border border-[#E5E7EB] p-3.5 space-y-2">
              <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Evidence</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Fields', value: evidence.length },
                  { label: 'High Conf', value: highConf },
                  { label: 'Avg Conf', value: `${confPct}%` },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <p className="text-base font-bold text-[#111827]">{s.value}</p>
                    <p className="text-[10px] text-[#9CA3AF]">{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-[#F3F4F6]">
                <span className="text-[#9CA3AF]">Documents</span>
                <span className="font-medium text-[#374151]">{documents.length} attached</span>
              </div>
            </div>

            {/* Policy grounding toggle */}
            {policyGrounding.length > 0 && (
              <div className="rounded-xl border border-[#E5E7EB] overflow-hidden">
                <button
                  onClick={() => setShowPolicyGrounding(v => !v)}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-semibold text-[#374151] hover:bg-[#F9FAFB] transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-[#991B1B]" />
                    Policy Grounding
                    <span className="text-[10px] bg-[#F3F4F6] text-[#6B7280] px-1.5 py-0.5 rounded-full">{policyGrounding.length}</span>
                  </div>
                  {showPolicyGrounding ? <ChevronUp className="w-3.5 h-3.5 text-[#9CA3AF]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#9CA3AF]" />}
                </button>
                {showPolicyGrounding && (
                  <div className="border-t border-[#F3F4F6] p-2 space-y-1.5">
                    {policyGrounding.map((p, pi) => {
                      const score = Number(p.score ?? p.similarity ?? 0)
                      const isExp = expandedPolicyIds.has(p.clauseId ?? String(pi))
                      return (
                        <div key={p.clauseId ?? pi} className="rounded-lg border border-[#F3F4F6] bg-[#FAFAFA]">
                          <button
                            onClick={() => setExpandedPolicyIds(prev => { const n = new Set(prev); n.has(p.clauseId ?? String(pi)) ? n.delete(p.clauseId ?? String(pi)) : n.add(p.clauseId ?? String(pi)); return n })}
                            className="w-full text-left px-2.5 py-2 flex items-start justify-between gap-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[10px] font-bold text-[#7F1D1D] truncate">{p.clauseId}</span>
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${score >= 0.8 ? 'bg-emerald-50 text-emerald-700' : score >= 0.6 ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                                  {Math.round(score * 100)}%
                                </span>
                              </div>
                              <p className="text-[11px] text-[#374151] font-medium truncate">{p.title}</p>
                            </div>
                            {isExp ? <ChevronUp className="w-3 h-3 text-[#9CA3AF] flex-shrink-0 mt-0.5" /> : <ChevronDown className="w-3 h-3 text-[#9CA3AF] flex-shrink-0 mt-0.5" />}
                          </button>
                          {isExp && (
                            <div className="px-2.5 pb-2 border-t border-[#F3F4F6]">
                              <p className="text-[11px] text-[#6B7280] mt-1.5 leading-relaxed">{p.snippet || p.content}</p>
                              {p.rationale && <p className="text-[11px] text-[#991B1B] mt-1 italic">{p.rationale}</p>}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Audit trail toggle */}
            {audit.length > 0 && (
              <div className="rounded-xl border border-[#E5E7EB] overflow-hidden">
                <button onClick={() => setShowAudit(v => !v)} className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-semibold text-[#374151] hover:bg-[#F9FAFB]">
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-[#6B7280]" />
                    Audit Trail
                    <span className="text-[10px] bg-[#F3F4F6] text-[#6B7280] px-1.5 py-0.5 rounded-full">{audit.length}</span>
                  </div>
                  {showAudit ? <ChevronUp className="w-3.5 h-3.5 text-[#9CA3AF]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#9CA3AF]" />}
                </button>
                {showAudit && (
                  <div className="border-t border-[#F3F4F6] p-3 space-y-2">
                    {audit.map((ev, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${ev.success ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-[#374151]">{ev.step}</p>
                          <p className="text-[10px] text-[#9CA3AF]">{(ev.duration / 1000).toFixed(2)}s · {new Date(ev.timestamp).toLocaleTimeString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── CENTER: Mail thread + compose ───────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

          {/* Thread subject header */}
          <div className="px-6 py-3 bg-white border-b border-[#E5E7EB] flex-shrink-0">
            <div className="flex items-center gap-3">
              <Mail className="w-4 h-4 text-[#991B1B] flex-shrink-0" />
              <h2 className="text-sm font-bold text-[#111827] truncate flex-1">
                {(claimDraft as Record<string, unknown>)?.subject as string || `Complaint – ${complaintRef}`}
              </h2>
              {mailChainHook.chain.length > 0 && (
                <span className="text-[11px] font-semibold bg-[#F3F4F6] text-[#6B7280] px-2 py-0.5 rounded-full flex-shrink-0">
                  {mailChainHook.chain.length} message{mailChainHook.chain.length !== 1 ? 's' : ''}
                </span>
              )}
              <button
                onClick={() => mailChainHook.fetch()}
                className="text-[#9CA3AF] hover:text-[#374151] transition-colors flex-shrink-0"
                title="Refresh thread"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${mailChainHook.loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Thread messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
            {mailChainHook.loading && mailChainHook.chain.length === 0 ? (
              <div className="flex items-center justify-center py-12 gap-2 text-[#9CA3AF]">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading thread…</span>
              </div>
            ) : mailChainHook.chain.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <div className="w-12 h-12 rounded-xl bg-[#F3F4F6] flex items-center justify-center">
                  <MessageSquare className="w-6 h-6 text-[#9CA3AF]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#374151]">No email thread yet</p>
                  <p className="text-xs text-[#9CA3AF] mt-1">Thread will appear here once the complaint is linked to an ingested email</p>
                </div>
              </div>
            ) : (
              mailChainHook.chain.map((msg, idx) => {
                const isLast     = idx === mailChainHook.chain.length - 1
                const isOut      = isOutbound(msg)
                const isExp      = expandedMailIds.has(msg.id)
                const senderName = isOut ? 'Support Team' : (msg.from?.replace(/<.*>/, '').trim() || 'Unknown')
                const initial    = isOut ? 'S' : (senderName.charAt(0).toUpperCase())
                const snippet    = cleanBody(msg.emailBody || '').replace(/\s+/g, ' ').trim().slice(0, 100)
                const dateStr    = msg.createdAt ? new Date(msg.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    className={`rounded-xl border transition-all ${isExp ? 'border-[#E5E7EB] shadow-sm' : 'border-[#F3F4F6] hover:border-[#E5E7EB]'} ${isOut ? 'bg-[#F0FDF4]' : 'bg-white'}`}
                  >
                    {/* Message header */}
                    <button onClick={() => setExpandedMailIds(prev => { const n = new Set(prev); n.has(msg.id) ? n.delete(msg.id) : n.add(msg.id); return n })} className="w-full text-left px-4 py-3 flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${isOut ? 'bg-[#991B1B] text-white' : 'bg-[#3B82F6] text-white'}`}>
                        {initial}
                      </div>
                      <div className="flex-1 min-w-0">
                        {isExp ? (
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13px] font-semibold text-[#111827]">{senderName}</span>
                              {isOut && <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Sent</span>}
                              {isLast && !isOut && <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Latest</span>}
                            </div>
                            <p className="text-[11px] text-[#9CA3AF] mt-0.5">{isOut ? `to ${msg.to || '—'}` : msg.from} · {dateStr}</p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[13px] font-semibold text-[#374151] flex-shrink-0">{senderName}</span>
                            <span className="text-[12px] text-[#9CA3AF] truncate">{snippet}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[11px] text-[#9CA3AF]">{dateStr}</span>
                        {isExp ? <ChevronUp className="w-4 h-4 text-[#9CA3AF]" /> : <ChevronDown className="w-4 h-4 text-[#9CA3AF]" />}
                      </div>
                    </button>

                    {/* Expanded body */}
                    <AnimatePresence>
                      {isExp && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }} className="overflow-hidden">
                          <div className="px-5 pb-4 border-t border-[#F3F4F6]">
                            <pre className="text-[13px] text-[#374151] whitespace-pre-wrap font-sans leading-relaxed pt-4">
                              {cleanBody(msg.emailBody || '') || '(no content)'}
                            </pre>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )
              })
            )}
          </div>

          {/* ── Compose / Draft area ─────────────────────────────────────── */}
          <div className="border-t border-[#E5E7EB] bg-white flex-shrink-0">
            {emailDraftHook.draft ? (
              <div className="px-6 py-4">
                <div className="rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
                  {/* Compose header */}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-[#F9FAFB] border-b border-[#E5E7EB]">
                    <div className="flex items-center gap-2">
                      <PenLine className="w-3.5 h-3.5 text-[#6B7280]" />
                      <span className="text-xs font-semibold text-[#374151]">
                        {emailDraftHook.draft.type === 'acknowledgment' ? 'Acknowledgment'
                          : emailDraftHook.draft.type === 'acceptance' ? 'Resolution Letter'
                          : emailDraftHook.draft.type === 'moreInfo' ? 'Request Info'
                          : emailDraftHook.draft.type === 'appointment_confirmation' ? 'Appointment Confirmation'
                          : 'Rejection Letter'}
                      </span>
                    </div>
                    <button onClick={emailDraftHook.close} className="text-[#9CA3AF] hover:text-[#374151] transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {/* To field */}
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-[#F3F4F6]">
                    <span className="text-xs text-[#9CA3AF] font-medium w-6">To</span>
                    <input
                      type="email"
                      value={emailDraftHook.draft.recipient}
                      onChange={e => emailDraftHook.updateRecipient(e.target.value)}
                      className="flex-1 text-xs text-[#374151] outline-none bg-transparent"
                      placeholder="recipient@example.com"
                    />
                  </div>
                  {/* Body */}
                  {emailDraftHook.error && (
                    <div className="mx-4 mt-2 p-2.5 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{emailDraftHook.error}
                    </div>
                  )}
                  <textarea
                    value={emailDraftHook.draft.body}
                    onChange={e => emailDraftHook.updateBody(e.target.value)}
                    className="w-full h-36 px-4 py-3 text-[13px] text-[#374151] font-sans leading-relaxed resize-none outline-none bg-white"
                    spellCheck={false}
                  />
                  {/* Send bar */}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-[#F9FAFB] border-t border-[#E5E7EB]">
                    <span className="text-[11px] text-[#9CA3AF]">{emailDraftHook.draft.inReplyTo ? 'Threading reply correctly' : 'New thread'}</span>
                    <button
                      onClick={emailDraftHook.send}
                      disabled={emailDraftHook.sending}
                      className="flex items-center gap-2 px-4 py-1.5 bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60"
                    >
                      {emailDraftHook.sending ? <><Clock className="w-3.5 h-3.5 animate-spin" />Sending…</> : <><Send className="w-3.5 h-3.5" />Send</>}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-6 py-3 flex items-center gap-3">
                <PenLine className="w-3.5 h-3.5 text-[#9CA3AF]" />
                <button onClick={() => openDraft('acknowledgment')} className="text-xs text-[#9CA3AF] hover:text-[#374151] transition-colors">
                  Draft a reply…
                </button>
                <div className="flex items-center gap-1.5 ml-auto">
                  {(['acknowledgment', 'moreInfo'] as const).map(t => (
                    <button key={t} onClick={() => openDraft(t)} className="text-[11px] px-2.5 py-1 rounded-lg border border-[#E5E7EB] text-[#6B7280] hover:border-[#991B1B] hover:text-[#991B1B] transition-colors">
                      {t === 'acknowledgment' ? 'Acknowledge' : 'Request Info'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT SIDEBAR: Actions ───────────────────────────────────────── */}
        <div className="w-[260px] flex-shrink-0 border-l border-[#E5E7EB] bg-white flex flex-col overflow-y-auto">
          <div className="p-4 space-y-3">

            {/* Primary decision actions */}
            <div>
              <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Decision</p>
              {decisionHook.status === 'pending' ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setPendingDecision('accept'); setRejectionReason(''); setShowDecisionModal(true) }}
                    className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm"
                  >
                    <Check className="w-3.5 h-3.5" />Accept
                  </button>
                  <button
                    onClick={() => { setPendingDecision('reject'); setRejectionReason(''); setShowDecisionModal(true) }}
                    className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors shadow-sm"
                  >
                    <X className="w-3.5 h-3.5" />Reject
                  </button>
                </div>
              ) : (
                <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold ${decisionHook.status === 'accepted' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
                  {decisionHook.status === 'accepted' ? <CheckCircle className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  {decisionHook.status === 'accepted' ? 'Complaint Accepted' : 'Complaint Rejected'}
                </div>
              )}
              {decisionHook.error && <p className="text-[11px] text-rose-600 mt-1.5">{decisionHook.error}</p>}
            </div>

            <div className="border-t border-[#F3F4F6]" />

            {/* Email actions */}
            <div>
              <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Email Templates</p>
              <div className="space-y-1.5">
                {[
                  { label: 'Acknowledgment',    type: 'acknowledgment' as const, sent: emailDraftHook.sent.acknowledgment },
                  { label: 'Request Documents', type: 'moreInfo' as const,       sent: emailDraftHook.sent.moreInfo },
                  ...(decisionHook.status === 'accepted' ? [{ label: 'Resolution Letter', type: 'acceptance' as const, sent: emailDraftHook.sent.acceptance }] : []),
                  ...(decisionHook.status === 'rejected' ? [{ label: 'Rejection Letter',  type: 'rejection' as const,  sent: emailDraftHook.sent.rejection  }] : []),
                ].map(({ label, type, sent }) => (
                  <button
                    key={type}
                    onClick={() => openDraft(type)}
                    disabled={sent}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${sent ? 'bg-emerald-50 text-emerald-700 cursor-default' : 'bg-[#F9FAFB] text-[#374151] hover:bg-[#F3F4F6] hover:text-[#991B1B]'}`}
                  >
                    <span>{label}</span>
                    {sent ? <Check className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5 text-[#9CA3AF]" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-[#F3F4F6]" />

            {/* Troubleshooting email */}
            <div>
              <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Communication</p>
              <div className="space-y-1.5">
                <button
                  onClick={() => emailDraftHook.open('moreInfo',
                    `Dear ${customerName},\n\nRE: Troubleshooting – Reference ${complaintRef}\n\nPlease try the following steps:\n\n  1. Power off and restart after 30 seconds.\n  2. Check all cables and connections.\n  3. Ensure firmware is up to date.\n  4. Perform a factory reset if the issue persists.\n\nPlease reply with the outcome.\n\nKind regards,\nCustomer Support Team`,
                    recipient, `Troubleshooting Assistance – ${complaintRef}`, claimData.messageId, claimData.threadId)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium bg-[#F9FAFB] text-[#374151] hover:bg-[#F3F4F6] hover:text-[#374151] transition-colors"
                >
                  <span>Troubleshooting Guide</span>
                  <Zap className="w-3.5 h-3.5 text-[#9CA3AF]" />
                </button>
                <button
                  onClick={() => emailDraftHook.open('acknowledgment',
                    `Dear ${customerName},\n\nRE: Engineer Visit Request – Reference ${complaintRef}\n\nFollowing our assessment of your ${product}, we would like to arrange an in-person engineer visit.\n\nPlease reply with:\n  • Your preferred date(s)\n  • Morning / Afternoon preference\n  • Your address\n\nKind regards,\nCustomer Support Team`,
                    recipient, `Engineer Visit Request – ${complaintRef}`, claimData.messageId, claimData.threadId)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium bg-[#F9FAFB] text-[#374151] hover:bg-[#F3F4F6] transition-colors"
                >
                  <span>Draft Engineer Visit</span>
                  <User className="w-3.5 h-3.5 text-[#9CA3AF]" />
                </button>
                <button
                  onClick={() => emailDraftHook.open('acknowledgment',
                    `Dear ${customerName},\n\nRE: Post-Visit Review – Reference ${complaintRef}\n\nWe hope your recent engineer visit resolved your issue with your ${product}.\n\nWas your issue resolved?\n  ☐ Yes, fully  ☐ Partially  ☐ No\n\nHow would you rate the service?\n  ☐ Excellent  ☐ Good  ☐ Fair  ☐ Poor\n\nKind regards,\nCustomer Support Team`,
                    recipient, `Post-Visit Review – ${complaintRef}`, claimData.messageId, claimData.threadId)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium bg-[#F9FAFB] text-[#374151] hover:bg-[#F3F4F6] transition-colors"
                >
                  <span>Post-Visit Review</span>
                  <FileText className="w-3.5 h-3.5 text-[#9CA3AF]" />
                </button>
              </div>
            </div>

            <div className="border-t border-[#F3F4F6]" />

            {/* Appointment */}
            <div>
              <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Appointment</p>
              {appointmentHook.booked ? (
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200">
                  <CheckCircle className="w-3.5 h-3.5" />Appointment Booked
                </div>
              ) : (
                <button
                  onClick={() => setShowAppointmentModal(true)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium bg-[#F9FAFB] text-[#374151] hover:bg-[#EFF6FF] hover:text-[#1E40AF] transition-colors border border-[#E5E7EB]"
                >
                  <span>Book Engineer Appointment</span>
                  <Calendar className="w-3.5 h-3.5 text-[#9CA3AF]" />
                </button>
              )}
            </div>

            <div className="border-t border-[#F3F4F6]" />

            {/* System actions */}
            <div>
              <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">System</p>
              <div className="space-y-1.5">
                <button
                  onClick={handleCreateDraft}
                  disabled={isCreatingDraft || draftCreated}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${draftCreated ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-[#F9FAFB] text-[#374151] hover:bg-[#F3F4F6]'} disabled:opacity-60`}
                >
                  <span>{draftCreated ? 'Draft Created' : isCreatingDraft ? 'Creating…' : 'Create Draft in Core'}</span>
                  {draftCreated ? <Check className="w-3.5 h-3.5" /> : <BarChart2 className="w-3.5 h-3.5 text-[#9CA3AF]" />}
                </button>
                {draftError && <p className="text-[11px] text-rose-600">{draftError}</p>}

                <button
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium bg-[#F9FAFB] text-[#374151] hover:bg-[#F3F4F6] transition-colors disabled:opacity-60"
                >
                  <span>{isDownloading ? 'Generating PDF…' : 'Download Decision Pack'}</span>
                  <Download className="w-3.5 h-3.5 text-[#9CA3AF]" />
                </button>
                {downloadError && <p className="text-[11px] text-rose-600">{downloadError}</p>}

                <button
                  onClick={async () => { if (claimData.claimId) { await fetch(`/api/complaints/${claimData.claimId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'closed' }) }); decisionHook.reset() } }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium bg-[#F9FAFB] text-[#374151] hover:bg-[#F3F4F6] transition-colors"
                >
                  <span>Close Complaint</span>
                  <CheckCircle className="w-3.5 h-3.5 text-[#9CA3AF]" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Decision Confirm Modal ─────────────────────────────────────────── */}
      {showDecisionModal && pendingDecision && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className={`px-6 py-5 flex items-center gap-3 border-b ${pendingDecision === 'accept' ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${pendingDecision === 'accept' ? 'bg-emerald-100' : 'bg-rose-100'}`}>
                {pendingDecision === 'accept' ? <Check className="w-5 h-5 text-emerald-600" /> : <X className="w-5 h-5 text-rose-600" />}
              </div>
              <div>
                <h2 className={`text-base font-semibold ${pendingDecision === 'accept' ? 'text-emerald-800' : 'text-rose-800'}`}>
                  {pendingDecision === 'accept' ? 'Accept Complaint' : 'Reject Complaint'}
                </h2>
                <p className={`text-xs ${pendingDecision === 'accept' ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {pendingDecision === 'accept' ? 'Approve and send resolution email' : 'Decline and send rejection email'}
                </p>
              </div>
              <button onClick={() => setShowDecisionModal(false)} className="ml-auto text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs text-gray-600 space-y-1">
                <p className="font-semibold text-gray-800 mb-1.5">What will happen:</p>
                <p>1. Status → <span className={`font-semibold ${pendingDecision === 'accept' ? 'text-emerald-600' : 'text-rose-600'}`}>{pendingDecision === 'accept' ? 'Accepted' : 'Rejected'}</span></p>
                <p>2. {pendingDecision === 'accept' ? 'Resolution' : 'Rejection'} email sent to complainant</p>
                <p>3. Email captured in mail thread</p>
              </div>
              {pendingDecision === 'reject' && (
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1.5">Rejection Reason</label>
                  <select value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-rose-200 focus:border-rose-400 outline-none">
                    <option value="">Select a reason…</option>
                    <option value="Your product is outside the warranty period.">Out of warranty</option>
                    <option value="The reported issue is classified as accidental damage and is not covered under the standard warranty.">Accidental damage</option>
                    <option value="Insufficient evidence provided to support the complaint.">Insufficient evidence</option>
                    <option value="The complaint does not meet the criteria for resolution under our current policy.">Does not meet policy criteria</option>
                    <option value="The product has been modified by an unauthorised third party, voiding the warranty.">Unauthorised modification</option>
                  </select>
                </div>
              )}
              {decisionHook.error && (
                <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{decisionHook.error}
                </div>
              )}
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => setShowDecisionModal(false)} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">Cancel</button>
              <button
                onClick={handleConfirmDecision}
                disabled={decisionHook.loading || (pendingDecision === 'reject' && !rejectionReason)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors disabled:opacity-60 ${pendingDecision === 'accept' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}
              >
                {decisionHook.loading ? <><Clock className="w-4 h-4 animate-spin" />Processing…</> : <>{pendingDecision === 'accept' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}Confirm</>}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Appointment Modal ─────────────────────────────────────────────── */}
      {showAppointmentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center gap-3 px-6 py-5 border-b border-[#E5E7EB]">
              <Calendar className="w-5 h-5 text-[#1E40AF]" />
              <h3 className="text-base font-semibold text-[#111827]">Book Appointment</h3>
              <button onClick={() => setShowAppointmentModal(false)} className="ml-auto text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {[
                { label: 'Date', key: 'date', type: 'date' },
                { label: 'Engineer Name', key: 'engineerName', type: 'text', placeholder: 'e.g. James Wilson' },
                { label: 'Location / Address', key: 'location', type: 'text', placeholder: 'Customer address' },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-[#374151] block mb-1">{label}</label>
                  <input type={type} placeholder={placeholder} value={appointmentData[key as keyof typeof appointmentData]}
                    onChange={e => setAppointmentData(p => ({ ...p, [key]: e.target.value }))}
                    className="w-full text-sm border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium text-[#374151] block mb-2">Time Slot</label>
                <div className="grid grid-cols-3 gap-2">
                  {APPOINTMENT_SLOTS.map(slot => (
                    <button key={slot.value} onClick={() => setAppointmentData(p => ({ ...p, time: slot.value }))}
                      className={`py-2 text-xs font-semibold rounded-lg border transition-colors ${appointmentData.time === slot.value ? 'bg-[#1E40AF] text-white border-[#1E40AF]' : 'bg-white text-[#374151] border-[#E5E7EB] hover:border-[#1E40AF] hover:text-[#1E40AF]'}`}
                    >
                      {slot.label}
                    </button>
                  ))}
                </div>
              </div>
              {appointmentHook.error && (
                <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5" />{appointmentHook.error}
                </div>
              )}
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => setShowAppointmentModal(false)} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">Cancel</button>
              <button onClick={handleAppointmentSubmit} disabled={appointmentHook.loading || !appointmentData.date || !appointmentData.engineerName || !appointmentData.time || !appointmentData.location}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E40AF] hover:bg-[#1E3A8A] rounded-xl transition-colors disabled:opacity-60"
              >
                {appointmentHook.loading ? <><Clock className="w-4 h-4 animate-spin" />Booking…</> : <><Calendar className="w-4 h-4" />Confirm</>}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Appointment Confirm Modal ─────────────────────────────────────── */}
      {showAppointmentConfirm && appointmentHook.details && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="bg-emerald-50 rounded-t-2xl px-6 py-5 flex items-center gap-3 border-b border-emerald-100">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-emerald-800">Appointment Confirmed</h2>
                <p className="text-xs text-emerald-600">Engineer visit scheduled</p>
              </div>
            </div>
            <div className="px-6 py-4 space-y-2">
              {[
                { label: 'Appointment ID', value: appointmentHook.details.appointmentId || appointmentHook.details.id || '—' },
                { label: 'Date', value: new Date(appointmentHook.details.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) },
                { label: 'Time', value: appointmentHook.details.time },
                { label: 'Engineer', value: appointmentHook.details.engineerName },
                { label: 'Location', value: appointmentHook.details.location },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">{label}</span>
                  <span className="font-medium text-[#111827]">{value}</span>
                </div>
              ))}
            </div>
            <div className="px-6 pb-5 space-y-2">
              {emailDraftHook.draft && !emailDraftHook.sent.appointment_confirmation && (
                <button
                  onClick={async () => { await emailDraftHook.send(); setShowAppointmentConfirm(false) }}
                  disabled={emailDraftHook.sending}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors disabled:opacity-60"
                >
                  {emailDraftHook.sending ? <><Clock className="w-4 h-4 animate-spin" />Sending…</> : <><Send className="w-4 h-4" />Send Confirmation Email</>}
                </button>
              )}
              <button onClick={() => setShowAppointmentConfirm(false)} className="w-full px-4 py-2.5 text-sm font-medium text-[#374151] bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">Done</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
