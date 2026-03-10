'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { 
  CheckCircle, 
  FileText, 
  Send, 
  Download, 
  Clock,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Mail,
  Calendar,
  MapPin,
  User
} from 'lucide-react'
import ClaimSummaryBar from './ClaimSummaryBar'
import { ClaimData } from '@/types/claims'
import { CONFIDENCE } from '@/lib/confidence'
import { getClaimDraft } from '@/lib/normalizeClaim'

interface DecisionPageProps {
  claimData: ClaimData
  onNextStage: () => void
  onPreviousStage: () => void
  onLoadClaim?: (claimId: string) => void
}

export default function DecisionPage({ claimData, onNextStage, onPreviousStage, onLoadClaim }: DecisionPageProps) {
  const [isCreatingDraft, setIsCreatingDraft] = useState(false)
  const [isSendingAck, setIsSendingAck] = useState(false)
  const [draftCreated, setDraftCreated] = useState(false)
  const [claimStatus, setClaimStatus] = useState<'pending' | 'accepted' | 'rejected'>('pending')
  const [ackSent, setAckSent] = useState(false)
  const [acceptanceSent, setAcceptanceSent] = useState(false)
  const [denialSent, setDenialSent] = useState(false)
  const [moreInfoSent, setMoreInfoSent] = useState(false)
  const [expandedPolicyIds, setExpandedPolicyIds] = useState<Set<string>>(new Set())
  const [emailDraftType, setEmailDraftType] = useState<'acceptance' | 'rejection' | 'acknowledgment' | 'moreInfo' | null>(null)
  const [emailDraftContent, setEmailDraftContent] = useState('')
  const [emailDraftRecipient, setEmailDraftRecipient] = useState('')
  const [sendEmailError, setSendEmailError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [createdDraft, setCreatedDraft] = useState<{
    draftId: string
    claimId: string
    claimFields: Record<string, unknown>
    attachments: Array<{ name: string; type?: string }>
    policyClauses: Array<{ clauseId: string; title: string; score?: number }>
    recommendedActions: string[]
  } | null>(null)
  const [showAppointmentModal, setShowAppointmentModal] = useState(false)
  const [appointmentData, setAppointmentData] = useState({
    date: '',
    engineerName: '',
    time: '',
    location: ''
  })
  const [appointmentError, setAppointmentError] = useState<string | null>(null)

  useEffect(() => {
    setClaimStatus('pending')
  }, [claimData?.claimId])

  // Handle null claimData
  if (!claimData || !claimData.decisionPack) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-7xl mx-auto text-center py-12"
      >
        <AlertTriangle className="w-16 h-16 text-warning-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">No Complaint Data Available</h2>
        <p className="text-gray-600 mb-6">
          Please process a complaint first before making decisions.
        </p>
        <button
          onClick={onPreviousStage}
          className="btn-primary flex items-center space-x-2 mx-auto"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Review</span>
        </button>
      </motion.div>
    )
  }

  const { decisionPack, processingTime } = claimData
  const { 
    evidence = [], 
    documents = [], 
    policyGrounding = [], 
    audit = [] 
  } = decisionPack || {}
  const claimDraft = getClaimDraft(decisionPack)

  const handleCreateDraft = async () => {
    setIsCreatingDraft(true)
    setDraftError(null)
    try {
      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(claimData),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create draft')
      }
      setDraftCreated(true)
      if (data.draft) setCreatedDraft(data.draft)
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Failed to create draft')
    } finally {
      setIsCreatingDraft(false)
    }
  }


  const generateAcknowledgment = () => {
    const draft = claimDraft as Record<string, unknown> || {}
    const claimantName = draft.claimantName || 'Valued Policyholder'
    const policyRef = draft.policyNumber || draft.policyId || 'on file'
    const claimNumber = claimData.claimId || 'Pending'
    const lossDate = draft.lossDate || 'the reported date'
    const lossType = draft.lossType || 'the reported incident'
    const lossLocation = draft.lossLocation || draft.location || draft.propertyAddress || ''
    const description = draft.description ? (draft.description.length > 200 ? `${draft.description.slice(0, 200)}...` : draft.description) : ''
    const estimatedAmount = draft.estimatedAmount
    const deductible = draft.deductible
    const docCount = documents?.length || 0
    const docList = documents?.length ? documents.map((d) => d.name || d.type).filter(Boolean).slice(0, 5).join(', ') + (documents.length > 5 ? ' and others' : '') : ''
    const hasCoverageMatch = policyGrounding.length > 0
    const policyAssessment = decisionPack?.policyAssessment

    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

    let letter = `${today}\n\n`
    letter += `Dear ${claimantName},\n\n`
    letter += `RE: First Notice of Loss – Claim Number ${claimNumber}\n`
    letter += `Policy Reference: ${policyRef}\n\n`
    letter += `Thank you for submitting your First Notice of Loss. We have received and logged your claim as of today's date.\n\n`
    letter += `CLAIM SUMMARY\n`
    letter += `  • Incident Date: ${lossDate}\n`
    letter += `  • Loss Type: ${lossType}\n`
    if (lossLocation) letter += `  • Location: ${lossLocation}\n`
    if (description) letter += `  • Description: ${description}\n`
    if (estimatedAmount != null) letter += `  • Estimated Amount: $${Number(estimatedAmount).toLocaleString()}\n`
    if (deductible != null) letter += `  • Applicable Deductible: $${Number(deductible).toLocaleString()}\n`
    letter += `\n`
    letter += `DOCUMENTS RECEIVED\n`
    if (docCount > 0) {
      letter += `  We have received ${docCount} document(s) in support of your claim${docList ? `: ${docList}` : '.'}\n\n`
    } else {
      letter += `  Supporting documents may be submitted at your earliest convenience.\n\n`
    }
    letter += `COVERAGE ASSESSMENT\n`
    if (hasCoverageMatch && policyAssessment?.coverageConfirmed) {
      letter += `  Our preliminary review indicates that your policy may provide coverage for this loss, subject to verification. We have identified relevant policy provisions and will complete a full review shortly.\n\n`
    } else {
      letter += `  We are reviewing your policy to determine applicable coverage. A claims specialist will contact you with our assessment.\n\n`
    }
    letter += `NEXT STEPS\n`
    letter += `  1. A dedicated claims adjuster will be assigned within 24–48 business hours.\n`
    letter += `  2. You will receive a follow-up call or email to discuss your claim and any additional information needed.\n`
    letter += `  3. For urgent inquiries, please reference Claim Number ${claimNumber} when contacting our Claims Department.\n\n`
    letter += `We are committed to processing your claim efficiently and will keep you informed throughout the process.\n\n`
    letter += `Sincerely,\n\n`
    letter += `Claims Department\n`
    letter += `Insurance Claims Team`

    return letter
  }

  const generateAcceptanceLetter = () => {
    const draft = claimDraft || {}
    const claimantName = draft.claimantName || 'Valued Policyholder'
    const policyRef = draft.policyNumber || draft.policyId || 'on file'
    const claimNumber = claimData.claimId || 'Pending'
    const lossDate = draft.lossDate || 'the reported date'
    const lossType = draft.lossType || 'the reported incident'
    const estimatedAmount = draft.estimatedAmount
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    let letter = `${today}\n\n`
    letter += `Dear ${claimantName},\n\n`
    letter += `RE: Claim Acceptance – Claim Number ${claimNumber}\n`
    letter += `Policy Reference: ${policyRef}\n\n`
    letter += `We are pleased to inform you that your claim has been approved.\n\n`
    letter += `CLAIM DETAILS\n`
    letter += `  • Incident Date: ${lossDate}\n`
    letter += `  • Loss Type: ${lossType}\n`
    if (estimatedAmount != null) letter += `  • Approved Amount: $${Number(estimatedAmount).toLocaleString()}\n`
    letter += `\n`
    letter += `NEXT STEPS\n`
    letter += `  1. Payment will be processed within 5–10 business days.\n`
    letter += `  2. You will receive a separate confirmation when the payment is issued.\n`
    letter += `  3. If you have any questions, please reference Claim Number ${claimNumber} when contacting us.\n\n`
    letter += `Thank you for your patience throughout this process.\n\n`
    letter += `Sincerely,\n\n`
    letter += `Claims Department\n`
    letter += `Insurance Claims Team`
    return letter
  }

  const generateRejectionLetter = () => {
    const draft = claimDraft || {}
    const claimantName = draft.claimantName || 'Valued Policyholder'
    const policyRef = draft.policyNumber || draft.policyId || 'on file'
    const claimNumber = claimData.claimId || 'Pending'
    const lossDate = draft.lossDate || 'the reported date'
    const lossType = draft.lossType || 'the reported incident'
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    let letter = `${today}\n\n`
    letter += `Dear ${claimantName},\n\n`
    letter += `RE: Claim Decision – Claim Number ${claimNumber}\n`
    letter += `Policy Reference: ${policyRef}\n\n`
    letter += `Thank you for submitting your claim. After a thorough review of your policy and the circumstances of your loss, we regret to inform you that we are unable to provide coverage for this claim.\n\n`
    letter += `CLAIM REVIEWED\n`
    letter += `  • Incident Date: ${lossDate}\n`
    letter += `  • Loss Type: ${lossType}\n`
    letter += `\n`
    letter += `REASON FOR DENIAL\n`
    letter += `  Based on the terms and conditions of your policy, this loss does not fall within the scope of covered perils. Our determination is based on the policy provisions applicable to your coverage.\n\n`
    letter += `YOUR OPTIONS\n`
    letter += `  1. If you believe this decision was made in error, you may submit an appeal with additional documentation within 30 days.\n`
    letter += `  2. For questions regarding your policy coverage, please contact our Customer Service department.\n`
    letter += `  3. Reference Claim Number ${claimNumber} in all correspondence.\n\n`
    letter += `We understand this may be disappointing and encourage you to reach out if you have any questions.\n\n`
    letter += `Sincerely,\n\n`
    letter += `Claims Department\n`
    letter += `Insurance Claims Team`
    return letter
  }

  const generateMoreInformationRequest = () => {
    const draft = claimDraft || {}
    const claimantName = draft.claimantName || 'Valued Policyholder'
    const policyRef = draft.policyNumber || draft.policyId || 'on file'
    const claimNumber = claimData.claimId || 'Pending'
    const lossDate = draft.lossDate || 'the reported date'
    const lossType = draft.lossType || 'the reported incident'
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    let letter = `${today}\n\n`
    letter += `Dear ${claimantName},\n\n`
    letter += `RE: Additional Information Required – Claim Number ${claimNumber}\n`
    letter += `Policy Reference: ${policyRef}\n\n`
    letter += `Thank you for submitting your First Notice of Loss. We have reviewed your claim and require additional information to proceed with our assessment.\n\n`
    letter += `CLAIM DETAILS\n`
    letter += `  • Incident Date: ${lossDate}\n`
    letter += `  • Loss Type: ${lossType}\n`
    letter += `  • Claim Number: ${claimNumber}\n`
    letter += `\n`
    letter += `ADDITIONAL INFORMATION REQUIRED\n`
    letter += `To complete our review of your claim, we need the following information:\n\n`
    letter += `  1. Detailed incident report or statement describing the events leading to the loss\n`
    letter += `  2. Supporting documentation (photographs, receipts, estimates, police reports, etc.)\n`
    letter += `  3. Any relevant medical records or reports (if applicable)\n`
    letter += `  4. Contact information for any witnesses or third parties involved\n`
    letter += `  5. Any other documentation that may support your claim\n\n`
    letter += `SUBMISSION INSTRUCTIONS\n`
    letter += `  • Please submit all requested documents within 14 business days\n`
    letter += `  • You may submit documents via email, mail, or through our online portal\n`
    letter += `  • Reference Claim Number ${claimNumber} in all correspondence\n`
    letter += `  • If you have questions about what documents are needed, please contact our Claims Department\n\n`
    letter += `NEXT STEPS\n`
    letter += `  Once we receive the requested information, we will:\n`
    letter += `  1. Review all submitted documentation\n`
    letter += `  2. Complete our coverage assessment\n`
    letter += `  3. Provide you with a decision on your claim within 5-10 business days\n\n`
    letter += `We appreciate your cooperation in providing this information, as it will help us process your claim more efficiently.\n\n`
    letter += `If you have any questions or need assistance, please do not hesitate to contact our Claims Department. Reference Claim Number ${claimNumber} in all communications.\n\n`
    letter += `Sincerely,\n\n`
    letter += `Claims Department\n`
    letter += `Insurance Claims Team`
    return letter
  }

  const handleDraftEmail = (type: 'acceptance' | 'rejection' | 'acknowledgment' | 'moreInfo') => {
    const content = type === 'acceptance'
      ? generateAcceptanceLetter()
      : type === 'rejection'
        ? generateRejectionLetter()
        : type === 'moreInfo'
          ? generateMoreInformationRequest()
          : generateAcknowledgment()
    const recipient = claimData.sourceEmailFrom || claimDraft?.contactEmail || ''
    setEmailDraftType(type)
    setEmailDraftContent(content)
    setEmailDraftRecipient(recipient)
  }

  const handleCloseEmailDraft = () => {
    setEmailDraftType(null)
    setEmailDraftContent('')
    setEmailDraftRecipient('')
    setSendEmailError(null)
  }

  const handleDownloadDecisionPack = async () => {
    setIsDownloading(true)
    setDownloadError(null)
    try {
      const res = await fetch('/api/decision-pack/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimData, claimStatus }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to generate PDF')
      }
      const blob = await res.blob()
      const contentDisposition = res.headers.get('Content-Disposition')
      const match = contentDisposition?.match(/filename="([^"]+)"/)
      const filename = match?.[1] || `Decision-Pack-${claimData.claimId || 'claim'}.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Failed to download PDF')
    } finally {
      setIsDownloading(false)
    }
  }

  const handleSendFromDraft = async () => {
    if (!emailDraftType) return
    const recipient = emailDraftRecipient?.trim()
    if (!recipient) {
      setSendEmailError('Please enter a recipient email address.')
      return
    }
    setIsSendingAck(true)
    setSendEmailError(null)
    try {
      const claimNum = claimData.claimId || 'Pending'
      const subjectMap = {
        acknowledgment: `Claim Acknowledgment – Claim Number ${claimNum}`,
        acceptance: `Claim Acceptance – Claim Number ${claimNum}`,
        rejection: `Claim Decision – Claim Number ${claimNum}`,
        moreInfo: `Additional Information Required – Claim Number ${claimNum}`,
      }
      const subject = subjectMap[emailDraftType]
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipient,
          subject,
          body: emailDraftContent,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send email')
      }
      if (emailDraftType === 'acknowledgment') setAckSent(true)
      else if (emailDraftType === 'acceptance') setAcceptanceSent(true)
      else if (emailDraftType === 'rejection') setDenialSent(true)
      else if (emailDraftType === 'moreInfo') setMoreInfoSent(true)
      handleCloseEmailDraft()
    } catch (err) {
      setSendEmailError(err instanceof Error ? err.message : 'Failed to send email')
    } finally {
      setIsSendingAck(false)
    }
  }

  const handleBookAppointment = () => {
    setShowAppointmentModal(true)
    setAppointmentError(null)
  }

  const handleCloseAppointmentModal = () => {
    setShowAppointmentModal(false)
    setAppointmentData({
      date: '',
      engineerName: '',
      time: '',
      location: ''
    })
    setAppointmentError(null)
  }

  const handleAppointmentSubmit = async () => {
    // Validate fields
    if (!appointmentData.date || !appointmentData.engineerName || !appointmentData.time || !appointmentData.location) {
      setAppointmentError('Please fill in all fields')
      return
    }

    try {
      // Here you would typically make an API call to save the appointment
      console.log('Appointment booked:', appointmentData)
      alert(`Appointment booked successfully!\n\nDate: ${appointmentData.date}\nEngineer: ${appointmentData.engineerName}\nTime: ${appointmentData.time}\nLocation: ${appointmentData.location}`)
      handleCloseAppointmentModal()
    } catch (err) {
      setAppointmentError(err instanceof Error ? err.message : 'Failed to book appointment')
    }
  }

  const handleCaptureMailChain = () => {
    // Placeholder for capturing mail chain functionality
    alert('Capture Chain of Mail functionality will be implemented here')
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-6xl mx-auto"
    >
      <ClaimSummaryBar
        claimData={claimData}
        onBack={onPreviousStage}
        onContinue={onNextStage}
        continueLabel="Continue"
        showClaimDropdown
        onClaimSelect={onLoadClaim}
      />
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-[#2D3748] via-[#4A5568] to-[#2D3748] bg-clip-text text-transparent mb-4">
          Resolution & Actions
        </h1>
        <p className="text-lg text-[#718096] max-w-2xl mx-auto">
          Review the assembled complaint draft and take action
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Decision Pack */}
        <motion.div 
          className="card p-6"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-gradient-to-br from-red-100 to-red-200 rounded-lg">
              <CheckCircle className="w-5 h-5 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-[#2D3748]">Decision Pack</h2>
          </div>
          
          <div className="space-y-4">
            {/* Complaint Summary */}
            <div className="p-5 bg-gradient-to-br from-red-50 to-red-100 rounded-xl border-l-4 border-red-300 shadow-sm">
              <h3 className="font-semibold text-[#991B1B] mb-3">Complaint Summary</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="col-span-2">
                  <span className="font-medium">Complaint Resolution Status:</span>{' '}
                  <span className={`font-semibold ${claimStatus === 'accepted' ? 'text-emerald-600' : claimStatus === 'rejected' ? 'text-rose-600' : 'text-[#64748B]'}`}>
                    {claimStatus === 'accepted' ? 'Accepted' : claimStatus === 'rejected' ? 'Rejected' : 'Pending'}
                  </span>
                </div>
                <div><span className="font-medium">Complaint:</span> {claimDraft.policyNumber || claimDraft.policyId || '—'}</div>
                <div><span className="font-medium">Complainant Name:</span> {claimDraft.claimantName || claimDraft.customerName || '—'}</div>
                <div><span className="font-medium">Issue Date:</span> {claimDraft.lossDate || claimDraft.complaintDate || '—'}</div>
                <div><span className="font-medium">Type:</span> {claimDraft.lossType || claimDraft.complaintType || '—'}</div>
                <div><span className="font-medium">Product:</span> {claimDraft.lossLocation || claimDraft.location || claimDraft.propertyAddress || claimDraft.productOrService || '—'}</div>
                {claimDraft.deductible && (
                  <div><span className="font-medium">Deductible:</span> ${claimDraft.deductible}</div>
                )}
              </div>
            </div>

            {/* Evidence Summary */}
            <div className="p-5 bg-gradient-to-br from-[#ECFDF5] to-[#D1FAE5] rounded-xl border-l-4 border-[#22C55E] shadow-sm">
              <h3 className="font-semibold text-[#047857] mb-3">Evidence Summary</h3>
              <div className="text-sm text-[#065F46]">
                <div className="mb-2">
                  <span className="font-medium">Documents:</span>{' '}
                  {documents.length > 0
                    ? `${documents.length} attached`
                    : Array.isArray((claimDraft as Record<string, unknown>)?.attachments)
                      ? `${((claimDraft as Record<string, unknown>).attachments as unknown[]).length} attached`
                      : '0 attached'}
                </div>
                <div className="mb-2">
                  <span className="font-medium">Fields Extracted:</span> {evidence.length} total
                </div>
                <div>
                  <span className="font-medium">High Confidence:</span> {evidence.filter(e => e.confidence >= CONFIDENCE.THRESHOLD_HIGH).length} fields
                </div>
              </div>
            </div>

            {/* Complaint Grounding – expandable clauses */}
            <div className="p-5 bg-gradient-to-br from-red-50 to-red-100 rounded-xl border-l-4 border-red-300 shadow-sm">
              <h3 className="font-semibold text-[#991B1B] mb-3">Complaint Grounding</h3>
              <div className="text-sm text-[#075985] mb-3">
                <div className="mb-1">
                  <span className="font-medium text-[#2563EB]">Clauses Found:</span> <span className="text-[#2563EB]">{policyGrounding.length || 1}</span>
                </div>
                <div>
                  <span className="font-medium text-[#2563EB]">Coverage:</span> <span className="text-[#2563EB]">{claimDraft.coverageFound ? 'Confirmed' : 'Under Review'}</span>
                </div>
              </div>
              {policyGrounding.length > 0 ? (
                <div className="space-y-2">
                  {policyGrounding.map((policy) => {
                    const isExpanded = expandedPolicyIds.has(policy.clauseId)
                    const fullContent = policy.content || policy.snippet || ''
                    const toggle = () => {
                      setExpandedPolicyIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(policy.clauseId)) next.delete(policy.clauseId)
                        else next.add(policy.clauseId)
                        return next
                      })
                    }
                    return (
                      <div key={policy.clauseId} className="rounded-lg border border-red-200 bg-white overflow-hidden">
                        <button
                          type="button"
                          onClick={toggle}
                          className="w-full p-3 text-left hover:bg-red-50/50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-200"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-xs font-semibold text-[#7F1D1D]">{policy.clauseId}</span>
                                <span className="text-xs font-medium text-[#047857] bg-[#ECFDF5] px-1.5 py-0.5 rounded">
                                  {Math.round((policy.score || policy.similarity || 0) * 100)}%
                                </span>
                              </div>
                              <div className="text-xs text-[#7F1D1D] font-medium line-clamp-1">
                                {policy.title}
                              </div>
                              <div className="text-[11px] text-[#991B1B] line-clamp-1 mt-0.5">
                                {policy.snippet || fullContent.slice(0, 100) + '...'}
                              </div>
                            </div>
                            <span className="flex-shrink-0 text-red-400">
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </span>
                          </div>
                        </button>
                        {isExpanded && fullContent && (
                          <div className="px-3 pb-3 pt-0 border-t border-red-100 bg-red-50/30">
                            <div className="text-xs text-[#7F1D1D] leading-relaxed whitespace-pre-wrap">
                              {fullContent}
                            </div>
                            {policy.rationale && (
                              <p className="text-[10px] text-red-600 mt-2 italic">{policy.rationale}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-red-200 bg-white overflow-hidden">
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-[#7F1D1D]">CUSTOMER-NOT-FOUND</span>
                          <span className="text-xs font-medium text-[#047857] bg-[#ECFDF5] px-1.5 py-0.5 rounded">
                            0%
                          </span>
                        </div>
                        <div className="text-xs text-[#7F1D1D] font-medium">
                          Customer Not Found
                        </div>
                        <div className="text-[11px] text-[#991B1B] mt-0.5">
                          No customer found for complaint CL789012345
                        </div>
                      </div>
                      <span className="flex-shrink-0 text-red-400">
                        <ChevronDown className="w-4 h-4" />
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Actions */}
        <motion.div 
          className="card p-6"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-gradient-to-br from-red-100 to-red-200 rounded-lg">
              <FileText className="w-5 h-5 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-[#2D3748]">Actions</h2>
          </div>
          
          <div className="space-y-4">
            {/* Create Draft in Core */}
            <div className="p-5 border-2 border-cloud-200 rounded-xl bg-white hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-[#2D3748] mb-2">Create Draft in Core System</h3>
              <p className="text-sm text-[#718096] mb-4">
                Creates a draft with all extracted details (complaint, complainant, issue info, evidence, complaint clauses) in the core system
              </p>
              
              {draftError && (
                <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {draftError}
                </div>
              )}
              {!draftCreated ? (
                <button
                  onClick={handleCreateDraft}
                  disabled={isCreatingDraft}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  {isCreatingDraft ? (
                    <div className="flex items-center justify-center space-x-2">
                      <Clock className="w-4 h-4 animate-spin" />
                      <span>Creating Draft...</span>
                    </div>
                  ) : (
                    <span>Create Draft in Core</span>
                  )}
                </button>
              ) : (
                <>
                  <div className="flex items-center space-x-2 text-[#047857] mb-4">
                    <Check className="w-5 h-5" />
                    <span className="font-medium">Draft created with extracted details (Complaint ID: {claimData.claimId})</span>
                  </div>
                  {createdDraft && (
                    <div className="mt-4 p-4 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0]">
                      <h4 className="text-sm font-semibold text-[#166534] mb-3">Created Draft Details</h4>
                      <div className="space-y-3 text-sm">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                          {createdDraft.claimFields && Object.entries(createdDraft.claimFields)
                            .filter(([, v]) => v != null && v !== '')
                            .map(([k, v]) => (
                              <div key={k} className="flex gap-2">
                                <span className="text-[#6B7280] font-medium capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}:</span>
                                <span className="text-[#374151] break-words">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                              </div>
                            ))}
                        </div>
                        {createdDraft.attachments?.length > 0 && (
                          <div>
                            <span className="text-[#6B7280] font-medium">Attachments:</span>
                            <ul className="mt-1 text-[#374151] list-disc list-inside">
                              {createdDraft.attachments.map((a, i) => (
                                <li key={i}>{a.name} {a.type && <span className="text-[#9CA3AF]">({a.type})</span>}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {createdDraft.policyClauses?.length > 0 && (
                          <div>
                            <span className="text-[#6B7280] font-medium">Policy Clauses:</span>
                            <ul className="mt-1 text-[#374151] space-y-1">
                              {createdDraft.policyClauses.map((p, i) => (
                                <li key={i} className="flex justify-between gap-2">
                                  <span>{p.clauseId} – {p.title}</span>
                                  {p.score != null && <span className="text-[#9CA3AF]">{Math.round(p.score * 100)}%</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {createdDraft.recommendedActions?.length > 0 && (
                          <div>
                            <span className="text-[#6B7280] font-medium">Recommended Actions:</span>
                            <ul className="mt-1 text-[#374151] list-disc list-inside">
                              {createdDraft.recommendedActions.map((a, i) => <li key={i}>{a}</li>)}
                            </ul>
                          </div>
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
              <p className="text-sm text-[#718096] mb-4">
                Generate and send a personalized acknowledgment email to the complainant
              </p>
              
              {!ackSent ? (
                <button
                  onClick={() => handleDraftEmail('acknowledgment')}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-[#991B1B] bg-white border-2 border-[#991B1B]/40 hover:bg-red-50 hover:border-[#991B1B]/60 transition-colors"
                >
                  <Mail className="w-4 h-4" />
                  Draft Acknowledgement
                </button>
              ) : (
                <div className="flex items-center space-x-2 text-success-600">
                  <Check className="w-5 h-5" />
                  <span className="font-medium">Acknowledgment Sent</span>
                </div>
              )}
            </div>

            {/* Request Additional Information */}
            <div className="p-5 border-2 border-amber-200 rounded-xl bg-gradient-to-br from-amber-50/50 to-white hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-[#92400E] mb-2">Request Additional Information</h3>
              <p className="text-sm text-[#718096] mb-4">
                Draft and send a professional request for additional documentation or information needed to process the complaint
              </p>
              
              {!moreInfoSent ? (
                <button
                  onClick={() => handleDraftEmail('moreInfo')}
                  className="text-sm font-medium text-amber-700 bg-white border border-amber-300 hover:bg-amber-50 px-4 py-2 rounded-lg transition-colors w-full"
                >
                  Draft Email
                </button>
              ) : (
                <div className="flex items-center space-x-2 text-amber-600">
                  <Check className="w-5 h-5" />
                  <span className="font-medium">Information Request Sent</span>
                </div>
              )}
            </div>

            {/* Send Complaint Resolution Letter – appears when Resolve Complaint is clicked */}
            {claimStatus === 'accepted' && (
              <div className="p-5 border-2 border-emerald-200 rounded-xl bg-gradient-to-br from-emerald-50/50 to-white hover:shadow-md transition-shadow">
                <h3 className="font-semibold text-[#047857] mb-2">Send Complaint Resolution Letter</h3>
                <p className="text-sm text-[#718096] mb-3">
                  Draft and send a professional letter to notify the complainant that their complaint has been resolved
                </p>
                {!acceptanceSent ? (
                  <button
                    type="button"
                    onClick={() => handleDraftEmail('acceptance')}
                    className="text-sm font-medium text-emerald-700 bg-white border border-emerald-300 hover:bg-emerald-50 px-4 py-2 rounded-lg transition-colors"
                  >
                    Draft Email
                  </button>
                ) : (
                  <div className="flex items-center space-x-2 text-emerald-600">
                    <Check className="w-5 h-5" />
                    <span className="font-medium">Resolution Letter Sent</span>
                  </div>
                )}
              </div>
            )}

            {/* Send Complaint Rejection Letter – appears when Reject Complaint is clicked */}
            {claimStatus === 'rejected' && (
              <div className="p-5 border-2 border-rose-200 rounded-xl bg-gradient-to-br from-rose-50/50 to-white hover:shadow-md transition-shadow">
                <h3 className="font-semibold text-[#B91C1C] mb-2">Send Complaint Rejection Letter</h3>
                <p className="text-sm text-[#718096] mb-3">
                  Draft and send a professional letter to notify the complainant that their complaint cannot be upheld
                </p>
                {!denialSent ? (
                  <button
                    type="button"
                    onClick={() => handleDraftEmail('rejection')}
                    className="text-sm font-medium text-rose-700 bg-white border border-rose-300 hover:bg-rose-50 px-4 py-2 rounded-lg transition-colors"
                  >
                    Draft Email
                  </button>
                ) : (
                  <div className="flex items-center space-x-2 text-rose-600">
                    <Check className="w-5 h-5" />
                    <span className="font-medium">Rejection Letter Sent</span>
                  </div>
                )}
              </div>
            )}

            {/* Book an Appointment */}
            <div className="p-5 border-2 border-blue-200 rounded-xl bg-gradient-to-br from-blue-50/50 to-white hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-[#1E40AF] mb-2">Book an Appointment</h3>
              <p className="text-sm text-[#718096] mb-4">
                Schedule an appointment with an engineer for product inspection or repair
              </p>
              <button
                onClick={handleBookAppointment}
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-medium text-white bg-gradient-to-r from-[#1E40AF] to-[#1E3A8A] hover:from-[#1E3A8A] hover:to-[#1E40AF] transition-all duration-300 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
              >
                <Calendar className="w-4 h-4" />
                <span>Book Appointment</span>
              </button>
            </div>

            {/* Capture Chain of Mail */}
            <div className="p-5 border-2 border-purple-200 rounded-xl bg-gradient-to-br from-purple-50/50 to-white hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-[#7C3AED] mb-2">Capture Chain of Mail</h3>
              <p className="text-sm text-[#718096] mb-4">
                Capture and save the complete email conversation history for this complaint
              </p>
              <button
                onClick={handleCaptureMailChain}
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-medium text-white bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] hover:from-[#6D28D9] hover:to-[#7C3AED] transition-all duration-300 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
              >
                <Mail className="w-4 h-4" />
                <span>Capture Mail Chain</span>
              </button>
            </div>

            {/* Download Decision Pack */}
            <div className="p-5 border-2 border-cloud-200 rounded-xl bg-white hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-[#2D3748] mb-2">Download Decision Pack</h3>
              <p className="text-sm text-[#718096] mb-4">
                Download the decision pack including complaint status, summary, and evidence as a structured PDF
              </p>
              {downloadError && (
                <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {downloadError}
                </div>
              )}
              <button
                onClick={handleDownloadDecisionPack}
                disabled={isDownloading}
                className="btn-secondary w-full flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {isDownloading ? (
                  <>
                    <Clock className="w-4 h-4 animate-spin" />
                    <span>Generating PDF...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download PDF</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Editable Email Draft (Acknowledgment / Acceptance / Denial) */}
      {emailDraftType && (
        <motion.div 
          className="mt-8 card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">
              {emailDraftType === 'acknowledgment' 
                ? 'Customer Acknowledgment' 
                : emailDraftType === 'acceptance' 
                  ? 'Complaint Resolution Letter' 
                  : emailDraftType === 'moreInfo'
                    ? 'Additional Information Request'
                    : 'Complaint Rejection Letter'}
            </h3>
            <button
              onClick={handleCloseEmailDraft}
              className="text-gray-500 hover:text-gray-700 p-1"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-[#64748B] mb-3">
            Edit the recipient and draft below, then click Send to dispatch to the complainant.
          </p>
          {sendEmailError && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {sendEmailError}
            </div>
          )}
          <div className="mb-4">
            <label className="flex items-center gap-2 text-sm font-medium text-[#374151] mb-1.5">
              <Mail className="w-4 h-4 text-[#6B7280]" />
              To (recipient)
            </label>
            <input
              type="email"
              value={emailDraftRecipient}
              onChange={(e) => setEmailDraftRecipient(e.target.value)}
              placeholder="complainant@example.com"
              className="w-full px-3 py-2 text-sm text-[#334155] bg-white border border-[#E2E8F0] rounded-lg focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none"
            />
            {claimData.sourceEmailFrom && (
              <p className="text-[11px] text-[#9CA3AF] mt-1">
                Pre-filled from original FNOL email
              </p>
            )}
          </div>
          <textarea
            value={emailDraftContent}
            onChange={(e) => setEmailDraftContent(e.target.value)}
            className="w-full min-h-[280px] p-4 text-sm text-[#334155] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg font-sans leading-relaxed resize-y focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none"
            placeholder="Draft content will appear here..."
            spellCheck={false}
          />
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleSendFromDraft}
              disabled={isSendingAck}
              className="btn-primary flex items-center space-x-2 disabled:opacity-50"
            >
              {isSendingAck ? (
                <>
                  <Clock className="w-4 h-4 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Send</span>
                </>
              )}
            </button>
          </div>
        </motion.div>
      )}

      {/* Audit Timeline */}
      <motion.div 
        className="mt-8 card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h3 className="text-lg font-semibold mb-4">Audit Timeline</h3>
        <div className="space-y-3">
          {audit.map((event, index) => (
            <div key={index} className="flex items-center space-x-3">
              <div className={`w-3 h-3 rounded-full ${
                event.success ? 'bg-success-500' : 'bg-danger-500'
              }`}></div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{event.step}</span>
                  <span className="text-sm text-gray-500">
                  {(event.duration / 1000).toFixed(2)}s
                </span>
                </div>
                <div className="text-sm text-gray-600">
                  {new Date(event.timestamp).toLocaleTimeString()}
                  {event.agent && ` · ${event.agent}`}
                  {event.modelVersion && ` · ${event.modelVersion}`}
                  {event.fallbackUsed && (
                    <span className="text-warning-600 ml-2">(Fallback used)</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <button
          onClick={onPreviousStage}
          className="btn-secondary flex items-center space-x-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Review</span>
        </button>
        
        <button
          onClick={onNextStage}
          className="btn-primary flex items-center space-x-2"
        >
          <span>View Dashboard</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Book Appointment Modal */}
      {showAppointmentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-[#2D3748] flex items-center gap-2">
                <Calendar className="w-5 h-5 text-[#1E40AF]" />
                Book an Appointment
              </h3>
              <button
                onClick={handleCloseAppointmentModal}
                className="text-gray-500 hover:text-gray-700 p-1"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-[#64748B] mb-4">
              Schedule an appointment with an engineer for product inspection or repair
            </p>

            {appointmentError && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {appointmentError}
              </div>
            )}

            <div className="space-y-4">
              {/* Date Field */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[#374151] mb-1.5">
                  <Calendar className="w-4 h-4 text-[#6B7280]" />
                  Date
                </label>
                <input
                  type="date"
                  value={appointmentData.date}
                  onChange={(e) => setAppointmentData({ ...appointmentData, date: e.target.value })}
                  className="w-full px-3 py-2 text-sm text-[#334155] bg-white border border-[#E2E8F0] rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                />
              </div>

              {/* Engineer Name Field */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[#374151] mb-1.5">
                  <User className="w-4 h-4 text-[#6B7280]" />
                  Engineer Name
                </label>
                <input
                  type="text"
                  value={appointmentData.engineerName}
                  onChange={(e) => setAppointmentData({ ...appointmentData, engineerName: e.target.value })}
                  placeholder="Enter engineer name"
                  className="w-full px-3 py-2 text-sm text-[#334155] bg-white border border-[#E2E8F0] rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                />
              </div>

              {/* Time Field */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[#374151] mb-1.5">
                  <Clock className="w-4 h-4 text-[#6B7280]" />
                  Time
                </label>
                <input
                  type="time"
                  value={appointmentData.time}
                  onChange={(e) => setAppointmentData({ ...appointmentData, time: e.target.value })}
                  className="w-full px-3 py-2 text-sm text-[#334155] bg-white border border-[#E2E8F0] rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                />
              </div>

              {/* Location Field */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[#374151] mb-1.5">
                  <MapPin className="w-4 h-4 text-[#6B7280]" />
                  Location
                </label>
                <input
                  type="text"
                  value={appointmentData.location}
                  onChange={(e) => setAppointmentData({ ...appointmentData, location: e.target.value })}
                  placeholder="Enter location address"
                  className="w-full px-3 py-2 text-sm text-[#334155] bg-white border border-[#E2E8F0] rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleCloseAppointmentModal}
                className="flex-1 px-4 py-2 text-sm font-medium text-[#64748B] bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAppointmentSubmit}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-[#1E40AF] hover:bg-[#1E3A8A] rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Calendar className="w-4 h-4" />
                Book Appointment
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  )
} 
