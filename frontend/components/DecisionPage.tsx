'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { 
  CheckCircle, FileText, Send, Download, Clock,
  ArrowRight, ArrowLeft, AlertTriangle, Check, X,
  ChevronDown, ChevronUp, Mail, Calendar, MapPin,
  User, MessageSquare, Inbox
} from 'lucide-react'
import ClaimSummaryBar from './ClaimSummaryBar'
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

export default function DecisionPage({ claimData, onNextStage, onPreviousStage, onLoadClaim }: DecisionPageProps) {
  const ingestedId = claimData?.ingestedClaimId ?? (claimData as unknown as Record<string, unknown>)?.ingestedComplaintId as string | undefined

  // ── Reusable hooks ──────────────────────────────────────────────────────
  const mailChainHook = useMailChain(ingestedId)
  const decisionHook = useComplaintDecision(claimData, ingestedId)
  const appointmentHook = useAppointment()
  const emailDraftHook = useEmailDraft()

  // ── Local UI state ──────────────────────────────────────────────────────
  const [isCreatingDraft, setIsCreatingDraft] = useState(false)
  const [draftCreated, setDraftCreated] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [createdDraft, setCreatedDraft] = useState<{
    draftId: string; claimId: string; claimFields: Record<string, unknown>
    attachments: Array<{ name: string; type?: string }>
    policyClauses: Array<{ clauseId: string; title: string; score?: number }>
    recommendedActions: string[]
  } | null>(null)
  const [expandedPolicyIds, setExpandedPolicyIds] = useState<Set<string>>(new Set())
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  // Modal visibility
  const [showMailChainModal, setShowMailChainModal] = useState(false)
  const [expandedMailId, setExpandedMailId] = useState<string | null>(null)
  const [showAppointmentModal, setShowAppointmentModal] = useState(false)
  const [appointmentData, setAppointmentData] = useState({ date: '', engineerName: '', time: '', location: '' })
  const [showAppointmentConfirmModal, setShowAppointmentConfirmModal] = useState(false)
  const [showDecisionModal, setShowDecisionModal] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<'accept' | 'reject' | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [decisionMailChain, setDecisionMailChain] = useState<typeof mailChainHook.chain>([])
  const [decisionMailChainLoading, setDecisionMailChainLoading] = useState(false)

  useEffect(() => { decisionHook.reset() }, [claimData?.claimId])

  if (!claimData || !claimData.decisionPack) {
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-7xl mx-auto text-center py-12">
        <AlertTriangle className="w-16 h-16 text-warning-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">No Complaint Data Available</h2>
        <p className="text-gray-600 mb-6">Please process a complaint first before making decisions.</p>
        <button onClick={onPreviousStage} className="btn-primary flex items-center space-x-2 mx-auto">
          <ArrowLeft className="w-4 h-4" /><span>Back to Review</span>
        </button>
      </motion.div>
    )
  }

  const { decisionPack, processingTime } = claimData
  const { evidence = [], documents = [], policyGrounding = [], audit = [] } = decisionPack || {}
  const claimDraft = getClaimDraft(decisionPack)

  // ── Letter generators ───────────────────────────────────────────────────
  const getDraftFields = () => {
    const d = claimDraft as Record<string, unknown> || {}
    return {
      customerName: (d.claimantName || d.customerName || 'Valued Customer') as string,
      complaintRef: (d.policyNumber || d.policyId || claimData.claimId || 'Pending') as string,
      complaintDate: (d.lossDate || d.complaintDate || 'the reported date') as string,
      complaintType: (d.lossType || d.complaintType || 'your complaint') as string,
      product: (d.productOrService || d.description || 'your product') as string,
    }
  }

  const today = () => new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })

  const generateAcknowledgment = () => {
    const { customerName, complaintRef, complaintDate, complaintType, product } = getDraftFields()
    const docCount = documents?.length || 0
    return `${today()}\n\nDear ${customerName},\n\nRE: Complaint Received – Reference ${complaintRef}\n\nThank you for contacting Consumer Electronics Customer Support. We have received your complaint and it has been logged in our system.\n\nCOMPLAINT DETAILS\n  • Complaint Reference: ${complaintRef}\n  • Date Submitted: ${complaintDate}\n  • Complaint Type: ${complaintType}\n  • Product: ${product}${docCount > 0 ? `\n  • Documents Received: ${docCount}` : ''}\n\nNEXT STEPS\n  1. Our support team will review your complaint within 2 business days.\n  2. You will receive a follow-up email with our assessment and proposed resolution.\n  3. For any urgent queries, please quote your complaint reference: ${complaintRef}.\n\nWe appreciate your patience and are committed to resolving this matter promptly.\n\nKind regards,\n\nCustomer Support Team\nConsumer Electronics\nsupport@electronics.com  |  1-800-ELEC-HELP (Mon–Fri, 9am–6pm)`
  }

  const generateAcceptanceLetter = () => {
    const { customerName, complaintRef, complaintType, product } = getDraftFields()
    const actionLabel = claimData.autoDecision === 'APPROVE_REPLACEMENT' ? 'replacement' : 'repair'
    return `${today()}\n\nDear ${customerName},\n\nRE: Complaint Approved – Reference ${complaintRef}\n\nWe are pleased to inform you that your complaint regarding your ${product} has been reviewed and approved.\n\nCOMPLAINT DETAILS\n  • Complaint Reference: ${complaintRef}\n  • Complaint Type: ${complaintType}\n  • Product: ${product}\n  • Decision: Approved for ${actionLabel}\n\nNEXT STEPS\n  1. Our technical team will contact you within 48 hours to arrange the ${actionLabel}.\n  2. Please have your product and proof of purchase ready.\n  3. If a courier collection is required, we will arrange this at no cost to you.\n\nPlease quote your reference number (${complaintRef}) in any future correspondence.\n\nThank you for bringing this to our attention. We apologise for any inconvenience caused.\n\nKind regards,\n\nCustomer Support Team\nConsumer Electronics\nsupport@electronics.com  |  1-800-ELEC-HELP (Mon–Fri, 9am–6pm)`
  }

  const generateRejectionLetter = (reason?: string) => {
    const { customerName, complaintRef, complaintType, product } = getDraftFields()
    const warrantyStatus = claimData.warrantyStatus
    const reasonText = reason
      ? `  ${reason}\n\n`
      : warrantyStatus === 'OUT_OF_WARRANTY'
        ? `  Your product is outside the manufacturer's warranty period and therefore does not qualify for a free repair or replacement under our warranty scheme.\n\n`
        : `  After reviewing your complaint, we have determined that it does not meet the criteria for resolution under our current policy.\n\n`
    return `${today()}\n\nDear ${customerName},\n\nRE: Complaint Decision – Reference ${complaintRef}\n\nThank you for contacting Consumer Electronics Customer Support regarding your ${product}. We have carefully reviewed your complaint and regret to inform you that we are unable to process it at this time.\n\nCOMPLAINT DETAILS\n  • Complaint Reference: ${complaintRef}\n  • Complaint Type: ${complaintType}\n  • Product: ${product}${warrantyStatus === 'OUT_OF_WARRANTY' ? '\n  • Warranty Status: Out of Warranty' : ''}\n\nREASON\n${reasonText}YOUR OPTIONS\n  1. Out-of-warranty paid repair — contact repairs@electronics.com for a quote.\n  2. If you believe this decision is incorrect, reply within 14 days with additional evidence for re-evaluation.\n  3. For consumer rights guidance, please contact your local consumer authority.\n\nWe apologise for any inconvenience caused.\n\nKind regards,\n\nCustomer Support Team\nConsumer Electronics\nsupport@electronics.com  |  1-800-ELEC-HELP (Mon–Fri, 9am–6pm)`
  }

  const generateMoreInformationRequest = () => {
    const { customerName, complaintRef, complaintType, product } = getDraftFields()
    return `${today()}\n\nDear ${customerName},\n\nRE: Additional Information Required – Reference ${complaintRef}\n\nThank you for contacting Consumer Electronics Customer Support regarding your ${product}. We have reviewed your complaint and require some additional information to proceed.\n\nCOMPLAINT DETAILS\n  • Complaint Reference: ${complaintRef}\n  • Complaint Type: ${complaintType}\n  • Product: ${product}\n\nDOCUMENTS REQUIRED\n  1. Proof of purchase (invoice or receipt) showing product model and purchase date\n  2. Photos or video clearly showing the fault or damage\n  3. Serial number or IMEI of the device\n  4. Any previous repair records or service reports (if applicable)\n\nHOW TO SUBMIT\n  • Reply to this email with the documents attached\n  • Quote your complaint reference ${complaintRef} in all correspondence\n  • Please submit within 14 days to avoid delays\n\nOnce we receive the required documents, we will review and respond within 2 business days.\n\nKind regards,\n\nCustomer Support Team\nConsumer Electronics\nsupport@electronics.com  |  1-800-ELEC-HELP (Mon–Fri, 9am–6pm)`
  }

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleCreateDraft = async () => {
    setIsCreatingDraft(true); setDraftError(null)
    try {
      const res = await fetch('/api/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(claimData) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create draft')
      setDraftCreated(true)
      if (data.draft) setCreatedDraft(data.draft)
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Failed to create draft')
    } finally { setIsCreatingDraft(false) }
  }

  const handleDraftEmail = (type: 'acceptance' | 'rejection' | 'acknowledgment' | 'moreInfo') => {
    const claimNum = claimData.claimId || 'Pending'
    const subjectMap = {
      acknowledgment: `Claim Acknowledgment – Claim Number ${claimNum}`,
      acceptance: `Claim Acceptance – Claim Number ${claimNum}`,
      rejection: `Claim Decision – Claim Number ${claimNum}`,
      moreInfo: `Additional Information Required – Claim Number ${claimNum}`,
    }
    const bodyMap = {
      acknowledgment: generateAcknowledgment(),
      acceptance: generateAcceptanceLetter(),
      rejection: generateRejectionLetter(),
      moreInfo: generateMoreInformationRequest(),
    }
    emailDraftHook.open(type, bodyMap[type], claimData.sourceEmailFrom || claimDraft?.contactEmail || '', subjectMap[type])
  }

  const handleDownloadDecisionPack = async () => {
    setIsDownloading(true); setDownloadError(null)
    try {
      const res = await fetch('/api/decision-pack/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claimData, claimStatus: decisionHook.status }) })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to generate PDF') }
      const blob = await res.blob()
      const match = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)
      const filename = match?.[1] || `Decision-Pack-${claimData.claimId || 'claim'}.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
    } catch (err) { setDownloadError(err instanceof Error ? err.message : 'Failed to download PDF') }
    finally { setIsDownloading(false) }
  }

  const handleCaptureMailChain = async () => {
    setShowMailChainModal(true)
    await mailChainHook.fetch()
  }

  const handleOpenDecisionModal = async (decision: 'accept' | 'reject') => {
    setPendingDecision(decision)
    setRejectionReason('')
    setShowDecisionModal(true)
    setDecisionMailChainLoading(true)
    await mailChainHook.fetch()
    setDecisionMailChain(mailChainHook.chain)
    setDecisionMailChainLoading(false)
  }

  const handleConfirmDecision = async () => {
    if (!pendingDecision) return
    const recipient = claimData.sourceEmailFrom || claimDraft?.contactEmail || ''
    const claimNum = claimData.claimId || 'Pending'
    const letter = pendingDecision === 'accept' ? generateAcceptanceLetter() : generateRejectionLetter(rejectionReason)
    const subject = pendingDecision === 'accept'
      ? `Claim Acceptance – Claim Number ${claimNum}`
      : `Claim Decision – Claim Number ${claimNum}`

    const ok = await decisionHook.decide({
      decision: pendingDecision,
      letter,
      recipient,
      subject,
      rejectionReason: rejectionReason || undefined,
    })
    if (ok) {
      setShowDecisionModal(false)
      setPendingDecision(null)
      await mailChainHook.fetch()
    }
  }

  const handleAppointmentSubmit = async () => {
    const complaintId = claimData.claimId || claimData.decisionPack?.id || null
    if (!complaintId) { return }
    if (!appointmentData.date || !appointmentData.engineerName || !appointmentData.time || !appointmentData.location) return
    const ok = await appointmentHook.book({ complaintId, ...appointmentData })
    if (ok) {
      setShowAppointmentModal(false)
      setAppointmentData({ date: '', engineerName: '', time: '', location: '' })
      setShowAppointmentConfirmModal(true)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto">
      <ClaimSummaryBar claimData={claimData} onBack={onPreviousStage} onContinue={onNextStage} continueLabel="Continue" showClaimDropdown onClaimSelect={onLoadClaim} />

      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-[#2D3748] via-[#4A5568] to-[#2D3748] bg-clip-text text-transparent mb-4">Resolution & Actions</h1>
        <p className="text-lg text-[#718096] max-w-2xl mx-auto">Review the assembled complaint draft and take action</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Decision Pack */}
        <motion.div className="card p-6" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-gradient-to-br from-red-100 to-red-200 rounded-lg"><CheckCircle className="w-5 h-5 text-red-600" /></div>
            <h2 className="text-xl font-bold text-[#2D3748]">Decision Pack</h2>
          </div>
          <div className="space-y-4">
            {/* Complaint Summary */}
            <div className="p-5 bg-gradient-to-br from-red-50 to-red-100 rounded-xl border-l-4 border-red-300 shadow-sm">
              <h3 className="font-semibold text-[#991B1B] mb-3">Complaint Summary</h3>
              <div className="flex flex-col gap-1.5 text-sm">
                <div>
                  <span className="font-medium">Status:</span>{' '}
                  <span className={`font-semibold ${decisionHook.status === 'accepted' ? 'text-emerald-600' : decisionHook.status === 'rejected' ? 'text-rose-600' : 'text-[#64748B]'}`}>
                    {decisionHook.status === 'accepted' ? 'Accepted' : decisionHook.status === 'rejected' ? 'Rejected' : 'Pending'}
                  </span>
                  {claimData.autoDecision && (
                    <span className={`ml-2 font-semibold ${claimData.autoDecision.startsWith('APPROVE') ? 'text-emerald-600' : claimData.autoDecision === 'DESK_REJECT' ? 'text-rose-600' : 'text-amber-600'}`}>
                      · {claimData.autoDecision}{typeof claimData.decisionConfidence === 'number' ? ` (${Math.round(claimData.decisionConfidence * 100)}%)` : ''}
                    </span>
                  )}
                </div>
                <div><span className="font-medium">Complaint Ref:</span> {claimDraft.policyNumber || claimDraft.policyId || '—'}</div>
                <div><span className="font-medium">Name:</span> {claimDraft.claimantName || (claimDraft as Record<string, unknown>).customerName as string || '—'}</div>
                <div><span className="font-medium">Type:</span> {claimDraft.lossType || (claimDraft as Record<string, unknown>).complaintType as string || '—'}</div>
                {claimData.warrantyStatus && (
                  <div>
                    <span className="font-medium">Warranty:</span>{' '}
                    <span className={`font-semibold ${claimData.warrantyStatus === 'WITHIN_WARRANTY' ? 'text-emerald-600' : claimData.warrantyStatus === 'OUT_OF_WARRANTY' ? 'text-rose-600' : 'text-[#64748B]'}`}>
                      {claimData.warrantyStatus === 'WITHIN_WARRANTY' ? 'Within Warranty' : claimData.warrantyStatus === 'OUT_OF_WARRANTY' ? 'Out of Warranty' : claimData.warrantyStatus}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Evidence Summary */}
            <div className="p-5 bg-gradient-to-br from-[#ECFDF5] to-[#D1FAE5] rounded-xl border-l-4 border-[#22C55E] shadow-sm">
              <h3 className="font-semibold text-[#047857] mb-3">Evidence Summary</h3>
              <div className="text-sm text-[#065F46]">
                <div className="mb-2"><span className="font-medium">Documents:</span>{' '}{documents.length > 0 ? `${documents.length} attached` : Array.isArray((claimDraft as Record<string, unknown>)?.attachments) ? `${((claimDraft as Record<string, unknown>).attachments as unknown[]).length} attached` : '0 attached'}</div>
                <div className="mb-2"><span className="font-medium">Fields Extracted:</span> {evidence.length} total</div>
                <div><span className="font-medium">High Confidence:</span> {evidence.filter(e => e.confidence >= CONFIDENCE.THRESHOLD_HIGH).length} fields</div>
              </div>
            </div>

            {/* Complaint Grounding */}
            <div className="p-5 bg-gradient-to-br from-red-50 to-red-100 rounded-xl border-l-4 border-red-300 shadow-sm">
              <h3 className="font-semibold text-[#991B1B] mb-3">Complaint Grounding</h3>
              <div className="text-sm text-[#075985] mb-3">
                <div className="mb-1"><span className="font-medium text-[#2563EB]">Clauses Found:</span> <span className="text-[#2563EB]">{policyGrounding.length || 1}</span></div>
                <div><span className="font-medium text-[#2563EB]">Coverage:</span> <span className="text-[#2563EB]">{claimDraft.coverageFound ? 'Confirmed' : 'Under Review'}</span></div>
              </div>
              {policyGrounding.length > 0 ? (
                <div className="space-y-2">
                  {policyGrounding.map((policy, pi) => {
                    const isExpanded = expandedPolicyIds.has(policy.clauseId)
                    const fullContent = policy.content || policy.snippet || ''
                    const toggle = () => setExpandedPolicyIds(prev => { const n = new Set(prev); n.has(policy.clauseId) ? n.delete(policy.clauseId) : n.add(policy.clauseId); return n })
                    return (
                      <div key={policy.clauseId ?? pi} className="rounded-lg border border-red-200 bg-white overflow-hidden">
                        <button type="button" onClick={toggle} className="w-full p-3 text-left hover:bg-red-50/50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-200">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-xs font-semibold text-[#7F1D1D]">{policy.clauseId}</span>
                                <span className="text-xs font-medium text-[#047857] bg-[#ECFDF5] px-1.5 py-0.5 rounded">{Math.round((policy.score || policy.similarity || 0) * 100)}%</span>
                              </div>
                              <div className="text-xs text-[#7F1D1D] font-medium line-clamp-1">{policy.title}</div>
                              <div className="text-[11px] text-[#991B1B] line-clamp-1 mt-0.5">{policy.snippet || fullContent.slice(0, 100) + '...'}</div>
                            </div>
                            <span className="flex-shrink-0 text-red-400">{isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
                          </div>
                        </button>
                        {isExpanded && fullContent && (
                          <div className="px-3 pb-3 pt-0 border-t border-red-100 bg-red-50/30">
                            <div className="text-xs text-[#7F1D1D] leading-relaxed whitespace-pre-wrap">{fullContent}</div>
                            {policy.rationale && <p className="text-[10px] text-red-600 mt-2 italic">{policy.rationale}</p>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-red-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-[#7F1D1D]">CUSTOMER-NOT-FOUND</span>
                    <span className="text-xs font-medium text-[#047857] bg-[#ECFDF5] px-1.5 py-0.5 rounded">0%</span>
                  </div>
                  <div className="text-xs text-[#7F1D1D] font-medium">Customer Not Found</div>
                  <div className="text-[11px] text-[#991B1B] mt-0.5">No customer found for complaint {claimData.claimId || 'CL789012345'}</div>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Actions */}
        <motion.div className="card p-6" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-gradient-to-br from-red-100 to-red-200 rounded-lg"><FileText className="w-5 h-5 text-red-600" /></div>
            <h2 className="text-xl font-bold text-[#2D3748]">Actions</h2>
          </div>
          <div className="space-y-4">

            {/* Accept / Reject */}
            {decisionHook.status === 'pending' && (
              <div className="p-5 border-2 border-gray-200 rounded-xl bg-gradient-to-br from-gray-50/50 to-white">
                <h3 className="font-semibold text-[#2D3748] mb-2">Make a Decision</h3>
                <p className="text-sm text-[#718096] mb-4">Accept or reject this complaint. An email will be sent to the complainant and captured in the mail chain.</p>
                {decisionHook.error && (
                  <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />{decisionHook.error}
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => handleOpenDecisionModal('accept')} className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm">
                    <Check className="w-4 h-4" /><span>Accept</span>
                  </button>
                  <button onClick={() => handleOpenDecisionModal('reject')} className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-white bg-rose-600 hover:bg-rose-700 transition-colors shadow-sm">
                    <X className="w-4 h-4" /><span>Reject</span>
                  </button>
                </div>
              </div>
            )}
            {decisionHook.status !== 'pending' && (
              <div className={`p-4 rounded-xl border-2 ${decisionHook.status === 'accepted' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                <div className={`flex items-center gap-2 font-semibold ${decisionHook.status === 'accepted' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {decisionHook.status === 'accepted' ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
                  Complaint {decisionHook.status === 'accepted' ? 'Accepted' : 'Rejected'}
                </div>
                <p className="text-sm text-[#718096] mt-1">Decision recorded and email sent to complainant.</p>
              </div>
            )}

            {/* Book an Appointment */}
            <div className="p-5 border-2 border-blue-200 rounded-xl bg-gradient-to-br from-blue-50/50 to-white hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-[#1E40AF] mb-2">Book an Appointment</h3>
              <p className="text-sm text-[#718096] mb-4">Schedule an engineer visit for product inspection or repair</p>
              {appointmentHook.booked ? (
                <div className="flex items-center space-x-2 text-green-600"><Check className="w-5 h-5" /><span className="font-medium">Appointment Booked</span></div>
              ) : (
                <>
                  {appointmentHook.error && <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0" />{appointmentHook.error}</div>}
                  <button onClick={() => setShowAppointmentModal(true)} className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-medium text-white bg-gradient-to-r from-[#1E40AF] to-[#1E3A8A] hover:from-[#1E3A8A] hover:to-[#1E40AF] hover:shadow-lg transition-all duration-300 shadow-md transform hover:-translate-y-0.5">
                    <Calendar className="w-4 h-4" /><span>Book Appointment</span>
                  </button>
                </>
              )}
            </div>

            {/* Create Draft */}
            <div className="p-5 border-2 border-cloud-200 rounded-xl bg-white hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-[#2D3748] mb-2">Create Draft in Core System</h3>
              <p className="text-sm text-[#718096] mb-4">Creates a draft with all extracted details (complaint, complainant, issue info, evidence, complaint clauses) in the core system</p>
              {draftError && <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0" />{draftError}</div>}
              {!draftCreated ? (
                <button onClick={handleCreateDraft} disabled={isCreatingDraft} className="btn-primary w-full disabled:opacity-50">
                  {isCreatingDraft ? <div className="flex items-center justify-center space-x-2"><Clock className="w-4 h-4 animate-spin" /><span>Creating Draft...</span></div> : <span>Create Draft in Core</span>}
                </button>
              ) : (
                <>
                  <div className="flex items-center space-x-2 text-[#047857] mb-4"><Check className="w-5 h-5" /><span className="font-medium">Draft created (Complaint ID: {claimData.claimId})</span></div>
                  {createdDraft && (
                    <div className="mt-4 p-4 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0]">
                      <h4 className="text-sm font-semibold text-[#166534] mb-3">Created Draft Details</h4>
                      <div className="space-y-3 text-sm">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                          {createdDraft.claimFields && Object.entries(createdDraft.claimFields).filter(([, v]) => v != null && v !== '').map(([k, v]) => (
                            <div key={k} className="flex gap-2">
                              <span className="text-[#6B7280] font-medium capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}:</span>
                              <span className="text-[#374151] break-words">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                            </div>
                          ))}
                        </div>
                        {createdDraft.attachments?.length > 0 && (
                          <div><span className="text-[#6B7280] font-medium">Attachments:</span><ul className="mt-1 text-[#374151] list-disc list-inside">{createdDraft.attachments.map((a, i) => <li key={i}>{a.name} {a.type && <span className="text-[#9CA3AF]">({a.type})</span>}</li>)}</ul></div>
                        )}
                        {createdDraft.policyClauses?.length > 0 && (
                          <div><span className="text-[#6B7280] font-medium">Policy Clauses:</span><ul className="mt-1 text-[#374151] space-y-1">{createdDraft.policyClauses.map((p, i) => <li key={i} className="flex justify-between gap-2"><span>{p.clauseId} – {p.title}</span>{p.score != null && <span className="text-[#9CA3AF]">{Math.round(p.score * 100)}%</span>}</li>)}</ul></div>
                        )}
                        {createdDraft.recommendedActions?.length > 0 && (
                          <div><span className="text-[#6B7280] font-medium">Recommended Actions:</span><ul className="mt-1 text-[#374151] list-disc list-inside">{createdDraft.recommendedActions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Send Acknowledgment */}
            <div className="p-5 border-2 border-[#991B1B]/20 rounded-xl bg-gradient-to-br from-red-50/50 to-white hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-[#2D3748] mb-2">Send Customer Acknowledgment</h3>
              <p className="text-sm text-[#718096] mb-4">Generate and send a personalized acknowledgment email to the complainant</p>
              {!emailDraftHook.sent.acknowledgment ? (
                <button onClick={() => handleDraftEmail('acknowledgment')} className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-[#991B1B] bg-white border-2 border-[#991B1B]/40 hover:bg-red-50 hover:border-[#991B1B]/60 transition-colors">
                  <Mail className="w-4 h-4" />Draft Acknowledgement
                </button>
              ) : (
                <div className="flex items-center space-x-2 text-success-600"><Check className="w-5 h-5" /><span className="font-medium">Acknowledgment Sent</span></div>
              )}
            </div>

            {/* Request Additional Information */}
            <div className="p-5 border-2 border-amber-200 rounded-xl bg-gradient-to-br from-amber-50/50 to-white hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-[#92400E] mb-2">Request Additional Information</h3>
              <p className="text-sm text-[#718096] mb-4">Draft and send a professional request for additional documentation or information needed to process the complaint</p>
              {!emailDraftHook.sent.moreInfo ? (
                <button onClick={() => handleDraftEmail('moreInfo')} className="text-sm font-medium text-amber-700 bg-white border border-amber-300 hover:bg-amber-50 px-4 py-2 rounded-lg transition-colors w-full">Draft Email</button>
              ) : (
                <div className="flex items-center space-x-2 text-amber-600"><Check className="w-5 h-5" /><span className="font-medium">Information Request Sent</span></div>
              )}
            </div>

            {/* Resolution Letter (after accept) */}
            {decisionHook.status === 'accepted' && (
              <div className="p-5 border-2 border-emerald-200 rounded-xl bg-gradient-to-br from-emerald-50/50 to-white hover:shadow-md transition-shadow">
                <h3 className="font-semibold text-[#047857] mb-2">Send Complaint Resolution Letter</h3>
                <p className="text-sm text-[#718096] mb-3">Draft and send a professional letter to notify the complainant that their complaint has been resolved</p>
                {!emailDraftHook.sent.acceptance ? (
                  <button type="button" onClick={() => handleDraftEmail('acceptance')} className="text-sm font-medium text-emerald-700 bg-white border border-emerald-300 hover:bg-emerald-50 px-4 py-2 rounded-lg transition-colors">Draft Email</button>
                ) : (
                  <div className="flex items-center space-x-2 text-emerald-600"><Check className="w-5 h-5" /><span className="font-medium">Resolution Letter Sent</span></div>
                )}
              </div>
            )}

            {/* Rejection Letter (after reject) */}
            {decisionHook.status === 'rejected' && (
              <div className="p-5 border-2 border-rose-200 rounded-xl bg-gradient-to-br from-rose-50/50 to-white hover:shadow-md transition-shadow">
                <h3 className="font-semibold text-[#B91C1C] mb-2">Send Complaint Rejection Letter</h3>
                <p className="text-sm text-[#718096] mb-3">Draft and send a professional letter to notify the complainant that their complaint cannot be upheld</p>
                {!emailDraftHook.sent.rejection ? (
                  <button type="button" onClick={() => handleDraftEmail('rejection')} className="text-sm font-medium text-rose-700 bg-white border border-rose-300 hover:bg-rose-50 px-4 py-2 rounded-lg transition-colors">Draft Email</button>
                ) : (
                  <div className="flex items-center space-x-2 text-rose-600"><Check className="w-5 h-5" /><span className="font-medium">Rejection Letter Sent</span></div>
                )}
              </div>
            )}

            {/* Capture Mail Chain */}
            <div className="p-5 border-2 border-purple-200 rounded-xl bg-gradient-to-br from-purple-50/50 to-white hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-[#7C3AED] mb-2">Capture Chain of Mail</h3>
              <p className="text-sm text-[#718096] mb-4">Capture and save the complete email conversation history for this complaint</p>
              <button onClick={handleCaptureMailChain} className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-medium text-white bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] hover:from-[#6D28D9] hover:to-[#7C3AED] transition-all duration-300 shadow-md hover:shadow-lg transform hover:-translate-y-0.5">
                <Mail className="w-4 h-4" /><span>Capture Mail Chain</span>
              </button>
            </div>

            {/* Download Decision Pack */}
            <div className="p-5 border-2 border-cloud-200 rounded-xl bg-white hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-[#2D3748] mb-2">Download Decision Pack</h3>
              <p className="text-sm text-[#718096] mb-4">Download the decision pack including complaint status, summary, and evidence as a structured PDF</p>
              {downloadError && <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0" />{downloadError}</div>}
              <button onClick={handleDownloadDecisionPack} disabled={isDownloading} className="btn-secondary w-full flex items-center justify-center space-x-2 disabled:opacity-50">
                {isDownloading ? <><Clock className="w-4 h-4 animate-spin" /><span>Generating PDF...</span></> : <><Download className="w-4 h-4" /><span>Download PDF</span></>}
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Email Draft Panel */}
      {emailDraftHook.draft && (
        <motion.div className="mt-8 card p-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">
              {emailDraftHook.draft.type === 'acknowledgment' ? 'Customer Acknowledgment' : emailDraftHook.draft.type === 'acceptance' ? 'Complaint Resolution Letter' : emailDraftHook.draft.type === 'moreInfo' ? 'Additional Information Request' : 'Complaint Rejection Letter'}
            </h3>
            <button onClick={emailDraftHook.close} className="text-gray-500 hover:text-gray-700 p-1" aria-label="Close"><X className="w-5 h-5" /></button>
          </div>
          <p className="text-sm text-[#64748B] mb-3">Edit the recipient and draft below, then click Send to dispatch to the complainant.</p>
          {emailDraftHook.error && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0" />{emailDraftHook.error}</div>}
          <div className="mb-4">
            <label className="flex items-center gap-2 text-sm font-medium text-[#374151] mb-1.5"><Mail className="w-4 h-4 text-[#6B7280]" />To (recipient)</label>
            <input type="email" value={emailDraftHook.draft.recipient} onChange={e => emailDraftHook.updateRecipient(e.target.value)} placeholder="complainant@example.com" className="w-full px-3 py-2 text-sm text-[#334155] bg-white border border-[#E2E8F0] rounded-lg focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none" />
            {claimData.sourceEmailFrom && <p className="text-[11px] text-[#9CA3AF] mt-1">Pre-filled from original FNOL email</p>}
          </div>
          <textarea value={emailDraftHook.draft.body} onChange={e => emailDraftHook.updateBody(e.target.value)} className="w-full min-h-[280px] p-4 text-sm text-[#334155] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg font-sans leading-relaxed resize-y focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none" spellCheck={false} />
          <div className="mt-4 flex justify-end">
            <button onClick={emailDraftHook.send} disabled={emailDraftHook.sending} className="btn-primary flex items-center space-x-2 disabled:opacity-50">
              {emailDraftHook.sending ? <><Clock className="w-4 h-4 animate-spin" /><span>Sending...</span></> : <><Send className="w-4 h-4" /><span>Send</span></>}
            </button>
          </div>
        </motion.div>
      )}

      {/* Audit Timeline */}
      <motion.div className="mt-8 card p-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <h3 className="text-lg font-semibold mb-4">Audit Timeline</h3>
        <div className="space-y-3">
          {audit.map((event, index) => (
            <div key={index} className="flex items-center space-x-3">
              <div className={`w-3 h-3 rounded-full ${event.success ? 'bg-success-500' : 'bg-danger-500'}`}></div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{event.step}</span>
                  <span className="text-sm text-gray-500">{(event.duration / 1000).toFixed(2)}s</span>
                </div>
                <div className="text-sm text-gray-600">
                  {new Date(event.timestamp).toLocaleTimeString()}
                  {event.agent && ` · ${event.agent}`}
                  {event.modelVersion && ` · ${event.modelVersion}`}
                  {event.fallbackUsed && <span className="text-warning-600 ml-2">(Fallback used)</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <button onClick={onPreviousStage} className="btn-secondary flex items-center space-x-2"><ArrowLeft className="w-4 h-4" /><span>Back to Review</span></button>
        <button onClick={onNextStage} className="btn-primary flex items-center space-x-2"><span>View Dashboard</span><ArrowRight className="w-4 h-4" /></button>
      </div>

      {/* Decision Modal (Accept / Reject) */}
      {showDecisionModal && pendingDecision && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
            <div className={`rounded-t-xl px-6 py-5 flex items-center gap-3 border-b ${pendingDecision === 'accept' ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${pendingDecision === 'accept' ? 'bg-emerald-100' : 'bg-rose-100'}`}>
                {pendingDecision === 'accept' ? <Check className="w-6 h-6 text-emerald-600" /> : <X className="w-6 h-6 text-rose-600" />}
              </div>
              <div>
                <h2 className={`text-lg font-semibold ${pendingDecision === 'accept' ? 'text-emerald-800' : 'text-rose-800'}`}>{pendingDecision === 'accept' ? 'Accept Complaint' : 'Reject Complaint'}</h2>
                <p className={`text-sm ${pendingDecision === 'accept' ? 'text-emerald-600' : 'text-rose-600'}`}>{pendingDecision === 'accept' ? 'Approve and send resolution email' : 'Decline and send rejection email'}</p>
              </div>
              <button onClick={() => setShowDecisionModal(false)} className="ml-auto text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              {/* What will happen */}
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-700 space-y-1">
                <p className="font-medium text-gray-900 mb-2">What will happen:</p>
                <p>1. Complaint status will be updated to <span className={`font-semibold ${pendingDecision === 'accept' ? 'text-emerald-600' : 'text-rose-600'}`}>{pendingDecision === 'accept' ? 'Accepted' : 'Rejected'}</span></p>
                <p>2. A {pendingDecision === 'accept' ? 'resolution' : 'rejection'} email will be sent to the complainant</p>
                <p>3. The email will be captured in the mail chain</p>
              </div>

              {/* Rejection reason */}
              {pendingDecision === 'reject' && (
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">Rejection Reason</label>
                  <select value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-rose-200 focus:border-rose-400 outline-none bg-white">
                    <option value="">Select a reason...</option>
                    <option value="Product is outside the warranty period and does not qualify for free repair or replacement.">Out of warranty</option>
                    <option value="The reported issue is classified as accidental damage and is not covered under the standard warranty.">Accidental damage – not covered</option>
                    <option value="Insufficient evidence provided to support the complaint. Please resubmit with required documentation.">Insufficient evidence</option>
                    <option value="The complaint does not meet the criteria for resolution under our current policy.">Does not meet policy criteria</option>
                    <option value="The product has been modified or repaired by an unauthorised third party, voiding the warranty.">Unauthorised modification</option>
                  </select>
                </div>
              )}

              {/* Mail chain preview */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-purple-500" />Mail Chain Context</p>
                {decisionMailChainLoading ? (
                  <div className="text-sm text-gray-400 text-center py-4">Loading thread…</div>
                ) : mailChainHook.chain.length === 0 ? (
                  <div className="text-sm text-gray-400 text-center py-4">No prior emails in thread.</div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {mailChainHook.chain.slice(-3).map((msg, i) => (
                      <div key={msg.id ?? i} className="p-3 rounded-lg border border-gray-200 bg-white text-xs">
                        <div className="flex justify-between text-gray-500 mb-1">
                          <span className="font-medium text-gray-700">{msg.from?.replace(/<.*>/, '').trim() || 'Unknown'}</span>
                          <span>{msg.createdAt ? new Date(msg.createdAt).toLocaleDateString('en-GB') : ''}</span>
                        </div>
                        <div className="text-gray-600 truncate">{msg.subject}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {decisionHook.error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0" />{decisionHook.error}</div>}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button onClick={() => setShowDecisionModal(false)} className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleConfirmDecision} disabled={decisionHook.loading || (pendingDecision === 'reject' && !rejectionReason)} className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${pendingDecision === 'accept' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}>
                {decisionHook.loading ? <><Clock className="w-4 h-4 animate-spin" />Processing...</> : <>{pendingDecision === 'accept' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}Confirm {pendingDecision === 'accept' ? 'Acceptance' : 'Rejection'}</>}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Book Appointment Modal */}
      {showAppointmentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-[#2D3748] flex items-center gap-2"><Calendar className="w-5 h-5 text-[#1E40AF]" />Book an Appointment</h3>
              <button onClick={() => { setShowAppointmentModal(false); setAppointmentData({ date: '', engineerName: '', time: '', location: '' }) }} className="text-gray-500 hover:text-gray-700 p-1" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-[#64748B] mb-4">Schedule an appointment with an engineer for product inspection or repair</p>
            {appointmentHook.error && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0" />{appointmentHook.error}</div>}
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[#374151] mb-1.5"><Calendar className="w-4 h-4 text-[#6B7280]" />Date</label>
                <input type="date" value={appointmentData.date} onChange={e => setAppointmentData({ ...appointmentData, date: e.target.value })} className="w-full px-3 py-2 text-sm text-[#334155] bg-white border border-[#E2E8F0] rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none" />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[#374151] mb-1.5"><User className="w-4 h-4 text-[#6B7280]" />Engineer Name</label>
                <input type="text" value={appointmentData.engineerName} onChange={e => setAppointmentData({ ...appointmentData, engineerName: e.target.value })} placeholder="Enter engineer name" className="w-full px-3 py-2 text-sm text-[#334155] bg-white border border-[#E2E8F0] rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none" />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[#374151] mb-1.5"><Clock className="w-4 h-4 text-[#6B7280]" />Time</label>
                <input type="time" value={appointmentData.time} onChange={e => setAppointmentData({ ...appointmentData, time: e.target.value })} className="w-full px-3 py-2 text-sm text-[#334155] bg-white border border-[#E2E8F0] rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none" />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[#374151] mb-1.5"><MapPin className="w-4 h-4 text-[#6B7280]" />Location</label>
                <input type="text" value={appointmentData.location} onChange={e => setAppointmentData({ ...appointmentData, location: e.target.value })} placeholder="Enter location address" className="w-full px-3 py-2 text-sm text-[#334155] bg-white border border-[#E2E8F0] rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowAppointmentModal(false); setAppointmentData({ date: '', engineerName: '', time: '', location: '' }) }} className="flex-1 px-4 py-2 text-sm font-medium text-[#64748B] bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleAppointmentSubmit} disabled={appointmentHook.loading} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-[#1E40AF] hover:bg-[#1E3A8A] disabled:opacity-60 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-2">
                {appointmentHook.loading ? <><Clock className="w-4 h-4 animate-spin" />Booking...</> : <><Calendar className="w-4 h-4" />Book Appointment</>}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Appointment Confirmation Modal */}
      {showAppointmentConfirmModal && appointmentHook.details && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="bg-green-50 rounded-t-xl px-6 py-5 flex items-center gap-3 border-b border-green-100">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center"><CheckCircle className="w-6 h-6 text-green-600" /></div>
              <div><h2 className="text-lg font-semibold text-green-800">Appointment Confirmed</h2><p className="text-sm text-green-600">Engineer visit has been scheduled</p></div>
            </div>
            <div className="px-6 py-5 space-y-3">
              {[
                { label: 'Appointment ID', value: appointmentHook.details.appointmentId || appointmentHook.details.id || '—' },
                { label: 'Complaint Ref', value: appointmentHook.details.complaintId },
                { label: 'Date', value: new Date(appointmentHook.details.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) },
                { label: 'Time', value: appointmentHook.details.time },
                { label: 'Engineer', value: appointmentHook.details.engineerName },
                { label: 'Location', value: appointmentHook.details.location },
                { label: 'Booked At', value: appointmentHook.details.bookedAt || new Date().toLocaleString() },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-start text-sm">
                  <span className="text-[#6B7280] font-medium w-36 shrink-0">{label}</span>
                  <span className="text-[#111827] text-right">{value}</span>
                </div>
              ))}
            </div>
            <div className="px-6 pb-5">
              <button onClick={() => setShowAppointmentConfirmModal(false)} className="w-full px-4 py-2 text-sm font-medium text-white bg-[#1E40AF] hover:bg-[#1E3A8A] rounded-lg transition-colors">Done</button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Mail Chain Modal */}
      {showMailChainModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-[#7C3AED]" />
                <h2 className="text-base font-semibold text-[#111827]">Mail Chain</h2>
                <span className="text-xs font-medium text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded">{mailChainHook.chain.length} email{mailChainHook.chain.length !== 1 ? 's' : ''}</span>
              </div>
              <button onClick={() => setShowMailChainModal(false)} className="text-[#9CA3AF] hover:text-[#374151]"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
              {mailChainHook.loading ? (
                <div className="text-sm text-[#9CA3AF] text-center py-8">Loading thread…</div>
              ) : mailChainHook.chain.length === 0 ? (
                <div className="text-sm text-[#9CA3AF] text-center py-8">No thread emails found for this complaint.</div>
              ) : (
                mailChainHook.chain.map((msg, idx) => {
                  const isCustomer = !msg.from?.toLowerCase().includes('aimill') && !msg.from?.toLowerCase().includes('support')
                  const isExpanded = expandedMailId === msg.id
                  const dateStr = msg.createdAt ? new Date(msg.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
                  const bodyPreview = (msg.emailBody || '').replace(/^(Subject|From|To|Date):.*\n/gm, '').trim().slice(0, 100)
                  return (
                    <div key={msg.id ?? idx} className={`rounded-lg border ${isCustomer ? 'border-[#E5E7EB] bg-white' : 'border-[#BFDBFE] bg-[#EFF6FF]'}`}>
                      <button className="w-full text-left px-4 py-3 flex items-start gap-3" onClick={() => setExpandedMailId(isExpanded ? null : msg.id)}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isCustomer ? 'bg-[#6B7280]' : 'bg-[#1E40AF]'}`}>
                          {isCustomer ? <Inbox className="w-3.5 h-3.5 text-white" /> : <Send className="w-3.5 h-3.5 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[#111827] truncate">{msg.from?.replace(/<.*>/, '').trim() || 'Unknown'}</span>
                            <span className="text-[10px] text-[#9CA3AF] shrink-0">{dateStr}</span>
                          </div>
                          <div className="text-[11px] text-[#6B7280] truncate">{msg.subject}</div>
                          {!isExpanded && <div className="text-[11px] text-[#9CA3AF] truncate mt-0.5">{bodyPreview}…</div>}
                        </div>
                        <ChevronDown className={`w-4 h-4 text-[#9CA3AF] shrink-0 mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-3 border-t border-[#E5E7EB] pt-2">
                          <pre className="text-[11px] text-[#374151] whitespace-pre-wrap font-sans leading-relaxed max-h-52 overflow-y-auto">{msg.emailBody || '(no body)'}</pre>
                        </div>
                      )}
                      {msg.inReplyTo && idx > 0 && <div className="px-4 pb-1.5 text-[10px] text-[#9CA3AF]">↩ reply</div>}
                    </div>
                  )
                })
              )}
            </div>
            <div className="px-6 py-4 border-t border-[#E5E7EB]">
              <button onClick={() => setShowMailChainModal(false)} className="w-full px-4 py-2 text-sm font-medium text-white bg-[#7C3AED] hover:bg-[#6D28D9] rounded-lg transition-colors">Close</button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}
