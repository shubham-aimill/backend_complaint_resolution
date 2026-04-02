'use client'

import React, { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  FileText,
  Search,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Shield,
  User,
  Calendar,
  MapPin,
  FileCheck,
  Clock,
  TrendingUp,
  ImageIcon,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Activity,
  Info,
  Package,
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  BadgeCheck,
  Mail,
  FileImage,
  Receipt,
  X,
  Send,
} from 'lucide-react'
import ClaimSummaryBar from './ClaimSummaryBar'
import { ClaimData, Document, FieldEvidence, PolicyHit } from '@/types/claims'
import { CONFIDENCE } from '@/lib/confidence'
import { getClaimDraft } from '@/lib/normalizeClaim'
import { useMailChain } from '@/lib/hooks/useMailChain'
import { useComplaintDecision } from '@/lib/hooks/useComplaintDecision'

/** Image preview with graceful fallback */
function ImagePreview({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = React.useState<'loading' | 'ok' | 'error'>('loading')
  return (
    <div className="rounded-xl overflow-hidden bg-[#F3F4F6] flex items-center justify-center min-h-[120px] border border-[#E5E7EB]">
      {state !== 'error' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className={`max-w-full max-h-56 object-contain ${state === 'loading' ? 'opacity-0 absolute' : ''}`}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      )}
      {state === 'loading' && <span className="text-xs text-[#9CA3AF]">Loading image…</span>}
      {state === 'error' && (
        <div className="flex flex-col items-center gap-2 py-6 text-[#9CA3AF]">
          <FileImage className="w-10 h-10" />
          <span className="text-xs">Image not available on this machine</span>
        </div>
      )}
    </div>
  )
}

/** Doc-type icon + accent colours */
function docTypeConfig(type: string, isImage: boolean): { icon: React.ElementType; accent: string; bg: string; badge: string } {
  if (isImage)              return { icon: FileImage,  accent: 'text-[#991B1B]', bg: 'bg-[#FEF2F2]', badge: 'bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]' }
  if (type === 'Invoice')   return { icon: Receipt,    accent: 'text-[#047857]', bg: 'bg-[#ECFDF5]', badge: 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]' }
  if (type === 'Receipt')   return { icon: Receipt,    accent: 'text-[#047857]', bg: 'bg-[#ECFDF5]', badge: 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]' }
  if (type === 'CorrespondenceRecord') return { icon: Mail, accent: 'text-[#1D4ED8]', bg: 'bg-[#EFF6FF]', badge: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]' }
  if (type === 'ContractOrAgreement') return { icon: FileCheck, accent: 'text-[#7C3AED]', bg: 'bg-[#F5F3FF]', badge: 'bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]' }
  if (type === 'Screenshot') return { icon: ImageIcon, accent: 'text-[#0369A1]', bg: 'bg-[#F0F9FF]', badge: 'bg-[#F0F9FF] text-[#0369A1] border-[#BAE6FD]' }
  return { icon: FileText, accent: 'text-[#6B7280]', bg: 'bg-[#F3F4F6]', badge: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]' }
}

const formatLabel = (key: string) =>
  key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()

/** Flat key-value property grid used inside doc detail panels */
function PropGrid({ entries, accent = 'text-[#991B1B]' }: { entries: [string, unknown][]; accent?: string }) {
  const renderVal = (val: unknown): React.ReactNode => {
    if (val == null || val === '') return <span className="text-[#9CA3AF] italic">—</span>
    if (typeof val === 'boolean') return val ? 'Yes' : 'No'
    if (typeof val === 'number') return String(val)
    if (typeof val === 'string') return val
    if (Array.isArray(val)) {
      if (val.length === 0) return <span className="text-[#9CA3AF] italic">—</span>
      return (
        <ul className="list-disc list-inside space-y-0.5 mt-0.5">
          {val.map((item, i) => (
            <li key={i} className="text-[#374151]">
              {typeof item === 'object' && item !== null && !Array.isArray(item)
                ? Object.entries(item as Record<string, unknown>).map(([k, v]) => (
                    <span key={k} className="mr-2">
                      <span className="font-medium text-[#6B7280]">{formatLabel(k)}:</span>{' '}
                      {String(v ?? '—')}
                    </span>
                  ))
                : String(item)}
            </li>
          ))}
        </ul>
      )
    }
    if (typeof val === 'object' && val !== null) {
      return (
        <div className="mt-1 space-y-0.5 pl-2 border-l-2 border-[#E5E7EB]">
          {Object.entries(val as Record<string, unknown>).map(([k, v]) => (
            <div key={k} className="text-xs">
              <span className="font-medium text-[#6B7280]">{formatLabel(k)}:</span>{' '}
              {renderVal(v)}
            </div>
          ))}
        </div>
      )
    }
    return String(val)
  }

  const clean = entries.filter(([k, v]) => !String(k).startsWith('_') && v != null && v !== '')
  if (clean.length === 0) return null
  return (
    <div className="divide-y divide-[#F3F4F6]">
      {clean.map(([k, v]) => (
        <div key={k} className="flex items-start gap-3 py-2 px-1">
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${accent} min-w-[110px] flex-shrink-0 pt-0.5`}>
            {formatLabel(k)}
          </span>
          <span className="text-xs text-[#374151] break-words flex-1">{renderVal(v)}</span>
        </div>
      ))}
    </div>
  )
}

/** Array-of-objects → HTML table */
function KeyFieldsTable({ rows, keys }: { rows: Record<string, unknown>[]; keys: string[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]" style={{ scrollbarWidth: 'thin' }}>
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-[#F9FAFB]">
            {keys.map(k => (
              <th key={k} className="px-3 py-2 text-left font-semibold text-[#374151] border-b border-[#E5E7EB] whitespace-nowrap">
                {formatLabel(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFB]'}>
              {keys.map(k => (
                <td key={k} className="px-3 py-2 text-[#374151] border-b border-[#F3F4F6]">
                  {String(row[k] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Full structured document detail panel — adapts to doc type */
function DocDetailPanel({
  doc,
  imageUrl,
  expandedDocId,
  setExpandedDocId,
}: {
  doc: Document
  imageUrl: string | false
  expandedDocId: string | null
  setExpandedDocId: (id: string | null) => void
}) {
  const isImage = doc.type === 'DamagePhoto' || doc.type === 'PhotoEvidence' || (doc.mimeType ?? '').startsWith('image/')
  const { accent, bg, badge } = docTypeConfig(doc.type, isImage)
  const keyFields = doc.keyFields as Record<string, unknown> | undefined
  const meta = doc.metadata as Record<string, unknown> | undefined
  const analysisError = meta?.analysisError as string | undefined
  const parseNote = meta?.parseNote as string | undefined
  const content = typeof doc.content === 'string' ? doc.content.trim() : ''
  const isExpanded = expandedDocId === doc.id
  const PREVIEW_LEN = 400

  // Separate array-of-object fields (tables) from scalar/object fields
  const tableFields: { key: string; rows: Record<string, unknown>[]; keys: string[] }[] = []
  const scalarFields: [string, unknown][] = []
  if (keyFields) {
    Object.entries(keyFields).forEach(([k, v]) => {
      if (String(k).startsWith('_')) return
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
        tableFields.push({ key: k, rows: v as Record<string, unknown>[], keys: Object.keys(v[0] as object) })
      } else {
        scalarFields.push([k, v])
      }
    })
  }

  const hasKeyFields = scalarFields.length > 0 || tableFields.length > 0

  return (
    <div className={`mt-3 rounded-xl border border-[#E5E7EB] overflow-hidden`}>
      {/* Panel header */}
      <div className={`${bg} px-4 py-2.5 flex items-center gap-2 border-b border-[#E5E7EB]`}>
        <FileText className={`w-3.5 h-3.5 ${accent} flex-shrink-0`} />
        <span className={`text-xs font-bold ${accent} truncate flex-1`}>{doc.name}</span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badge} flex-shrink-0`}>
          {doc.type === 'CorrespondenceRecord' ? 'Email' : doc.type}
        </span>
        <span className="text-[10px] text-[#6B7280] flex-shrink-0">{Math.round(doc.confidence * 100)}%</span>
      </div>

      <div className="bg-white p-4 space-y-4">
        {/* ── IMAGE DOCUMENTS ─────────────────────────────── */}
        {isImage && (
          <>
            {imageUrl && <ImagePreview src={imageUrl as string} alt={doc.name} />}
            {analysisError ? (
              <div className="flex items-start gap-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 text-[#B45309] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-[#B45309]">Vision Analysis Unavailable</p>
                  <p className="text-xs text-[#92400E] mt-0.5">Image file not found on this machine — it may have been processed on a different device.</p>
                </div>
              </div>
            ) : (
              <>
                {content && (
                  <div>
                    <div className={`flex items-center gap-1.5 mb-2`}>
                      <Info className={`w-3.5 h-3.5 ${accent}`} />
                      <span className={`text-[11px] font-bold uppercase tracking-wider ${accent}`}>AI Vision Analysis</span>
                    </div>
                    <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3">
                      <p className="text-xs text-[#1C1917] leading-relaxed whitespace-pre-wrap">{content}</p>
                    </div>
                  </div>
                )}
                {hasKeyFields && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Activity className={`w-3.5 h-3.5 ${accent}`} />
                      <span className={`text-[11px] font-bold uppercase tracking-wider ${accent}`}>Extracted Findings</span>
                    </div>
                    <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg overflow-hidden">
                      <PropGrid entries={scalarFields} accent={accent} />
                    </div>
                  </div>
                )}
                {!content && !hasKeyFields && (
                  <p className="text-xs text-[#9CA3AF] italic text-center py-2">No analysis data available</p>
                )}
              </>
            )}
          </>
        )}

        {/* ── TEXT / PDF / DOC DOCUMENTS ──────────────────── */}
        {!isImage && (
          <>
            {/* Parse note for scanned PDFs */}
            {parseNote && (
              <div className="flex items-start gap-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-3">
                <AlertTriangle className="w-3.5 h-3.5 text-[#B45309] flex-shrink-0 mt-0.5" />
                <p className="text-xs text-[#92400E]">{parseNote}</p>
              </div>
            )}

            {/* Extracted / structured key fields */}
            {hasKeyFields && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <FileCheck className={`w-3.5 h-3.5 ${accent}`} />
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${accent}`}>
                    {doc.type === 'CorrespondenceRecord' ? 'Extracted Fields' : 'Structured Data'}
                  </span>
                </div>
                {scalarFields.length > 0 && (
                  <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg overflow-hidden mb-3">
                    <PropGrid entries={scalarFields} accent={accent} />
                  </div>
                )}
                {tableFields.map(({ key, rows, keys }) => (
                  <div key={key} className="mb-3">
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${accent} mb-1.5`}>{formatLabel(key)}</p>
                    <KeyFieldsTable rows={rows} keys={keys} />
                  </div>
                ))}
              </div>
            )}

            {/* Raw content block */}
            {content && !content.startsWith('[') && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#6B7280]" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#6B7280]">
                      {doc.type === 'CorrespondenceRecord' ? 'Email Body' : 'Document Text'}
                    </span>
                  </div>
                  {content.length > PREVIEW_LEN && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setExpandedDocId(isExpanded ? null : doc.id) }}
                      className="text-[11px] font-medium text-[#1D4ED8] hover:underline flex items-center gap-0.5"
                    >
                      {isExpanded ? <><ChevronUp className="w-3 h-3" />Show less</> : <><ChevronDown className="w-3 h-3" />Show full</>}
                    </button>
                  )}
                </div>
                <div className={`bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3 ${doc.type === 'CorrespondenceRecord' ? 'bg-[#EFF6FF] border-[#BFDBFE]' : ''}`}>
                  <p className="text-xs text-[#374151] leading-relaxed whitespace-pre-wrap font-mono">
                    {isExpanded || content.length <= PREVIEW_LEN
                      ? content
                      : `${content.slice(0, PREVIEW_LEN).trim()}…`}
                  </p>
                </div>
              </div>
            )}

            {/* Scanned PDF placeholder */}
            {content.startsWith('[') && (
              <div className="flex items-center gap-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3">
                <Info className="w-4 h-4 text-[#6B7280] flex-shrink-0" />
                <p className="text-xs text-[#6B7280]">{content}</p>
              </div>
            )}

            {!hasKeyFields && !content && (
              <p className="text-xs text-[#9CA3AF] italic text-center py-2">No content extracted from this document</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface ReviewPageProps {
  claimData: ClaimData
  onNextStage: () => void
  onPreviousStage: () => void
  onLoadClaim?: (claimId: string) => void
}

// Group fields by category
const categorizeFields = (evidence: FieldEvidence[]) => {
  const categories = {
    'Complaint Metadata': ['policyId', 'policyNumber', 'claimId'],
    'Contact Details': ['claimantName', 'contactEmail', 'contactPhone'],
    'Incident Details': ['lossDate', 'lossType', 'lossLocation', 'location', 'description', 'deductible', 'estimatedAmount']
  }

  const grouped: Record<string, FieldEvidence[]> = {
    'Complaint Metadata': [],
    'Contact Details': [],
    'Incident Details': []
  }

  evidence.forEach((field) => {
    const fieldName = (field.fieldName || field.field || '').toLowerCase()
    let categorized = false

    for (const [category, fields] of Object.entries(categories)) {
      if (fields.some(f => fieldName.includes(f.toLowerCase()))) {
        grouped[category].push(field)
        categorized = true
        break
      }
    }

    if (!categorized) {
      grouped['Incident Details'].push(field)
    }
  })

  return grouped
}


export default function ReviewPage({ claimData, onNextStage, onPreviousStage, onLoadClaim }: ReviewPageProps) {
  const [selectedField, setSelectedField] = useState<string | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null)
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null)

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
          Please process a complaint first before reviewing.
        </p>
        <button
          onClick={onPreviousStage}
          className="btn-primary flex items-center space-x-2 mx-auto"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Ingest</span>
        </button>
      </motion.div>
    )
  }

  const { decisionPack, claimId, status, ingestedClaimId } = claimData
  const [showMailChain, setShowMailChain] = useState(false)
  const mailChainHook = useMailChain(ingestedClaimId)
  const [showDeskRejectConfirm, setShowDeskRejectConfirm] = useState(false)
  const [deskRejectDone, setDeskRejectDone] = useState(false)
  const decisionHook = useComplaintDecision(claimData, ingestedClaimId)
  const { evidence = [], documents = [] } = decisionPack || {};
  const claimDraft = getClaimDraft(
    decisionPack as unknown as Record<string, unknown>
  );
  const sourceDocuments = useMemo(
    () =>
      documents.filter(doc => {
        const source = (doc.metadata as Record<string, unknown> | undefined)
          ?.source;
        return !(
          doc.type === 'CorrespondenceRecord' && source === 'email_body'
        );
      }),
    [documents]
  );

  // Calculate overall confidence
  const overallConfidence = useMemo(() => {
    if (evidence.length === 0) return 0
    const avg = evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length
    return Math.round(avg * 100)
  }, [evidence])

  // Group fields by category
  const groupedFields = useMemo(() => categorizeFields(evidence), [evidence])


  const getFieldIcon = (fieldName: string) => {
    const iconMap: Record<string, any> = {
      policyId: Shield,
      policyNumber: Shield,
      claimantName: User,
      contactEmail: FileText,
      contactPhone: FileText,
      lossDate: Calendar,
      lossType: FileCheck,
      lossLocation: MapPin,
      location: MapPin,
      description: FileText,
      deductible: TrendingUp
    }

    const field = (fieldName || '').toLowerCase()
    for (const [key, Icon] of Object.entries(iconMap)) {
      if (field.includes(key.toLowerCase())) {
        return Icon
      }
    }
    return FileText
  }

  const getStatusColor = (status?: string) => {
    if (!status) return 'bg-[#E5E7EB] text-[#374151]'
    const s = status.toLowerCase()
    if (s.includes('complete') || s.includes('approved')) return 'bg-[#ECFDF5] text-[#047857]'
    if (s.includes('pending') || s.includes('processing')) return 'bg-[#FEE2E2] text-[#B91C1C]'
    if (s.includes('reject') || s.includes('error')) return 'bg-[#FEF2F2] text-[#B91C1C]'
    return 'bg-[#FFFBEB] text-[#B45309]'
  }

  const isDeskReject = claimData.autoDecision === 'DESK_REJECT'

  return (
    <div className="max-w-[1920px] mx-auto">
      <ClaimSummaryBar
        claimData={claimData}
        onBack={onPreviousStage}
        onContinue={onNextStage}
        continueLabel="Continue"
        continueDisabled={isDeskReject}
        continueTooltip="This complaint has been desk rejected and cannot proceed to resolution"
        showClaimDropdown
        onClaimSelect={onLoadClaim}
      />

      {/* Desk Reject Banner */}
      {isDeskReject && (
        <div className="mx-4 mb-4 flex items-start gap-3 p-4 rounded-xl bg-rose-50 border-2 border-rose-300">
          <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-rose-800">Complaint Desk Rejected — Cannot Proceed</p>
            <p className="text-xs text-rose-600 mt-0.5">
              {claimData.rejectReason === 'customer_not_found'
                ? 'Customer record not found in CRM. This complaint cannot be processed without a verified account.'
                : claimData.rejectReason === 'physical_damage'
                  ? 'Physical or accidental damage is not covered under the standard warranty.'
                  : claimData.rejectReason === 'unauthorized_repair'
                    ? 'Product was repaired by an unauthorised third party, voiding the warranty.'
                    : claimData.rejectReason === 'unsupported_product'
                      ? 'Product type is not supported through this complaint channel.'
                      : 'Product is outside its warranty period. This complaint has been automatically rejected.'}
            </p>
            <p className="text-xs text-rose-500 mt-1">The "Continue to Resolution" button is disabled. You may go back to the inbox.</p>
          </div>
        </div>
      )}

      {/* Main Content - Two Column Layout */}
      <div className="px-4 py-8">
        <div className="grid grid-cols-12 gap-6">
          {/* Left Column - Source Documents */}
          <div className="col-span-12 lg:col-span-4">
            <motion.div
              className="card p-5 h-fit sticky top-[88px]"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              {/* Header */}
              <div className="flex items-center space-x-2 mb-4">
                <FileText className="w-4 h-4 text-[#991B1B]" />
                <h2 className="text-sm font-bold text-[#111827] uppercase tracking-wider">
                  Source Documents
                </h2>
                <span className="ml-auto text-xs font-medium text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded">
                  {sourceDocuments.length}
                </span>
              </div>

              {/* Document tiles */}
              <div className="space-y-1.5">
                {sourceDocuments.map(doc => {
                  const isSelected = selectedDoc === doc.id
                  const isImageDoc =
                    doc.type === 'DamagePhoto' ||
                    doc.type === 'PhotoEvidence' ||
                    (doc.mimeType ?? '').startsWith('image/')
                  const { icon: DocIcon, accent, badge } = docTypeConfig(doc.type, isImageDoc)
                  const confPct = Math.round(doc.confidence * 100)

                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => setSelectedDoc(isSelected ? null : doc.id)}
                      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-all flex items-center gap-3 ${
                        isSelected
                          ? 'border-[#991B1B] bg-[#FEF2F2] shadow-sm'
                          : 'border-[#E5E7EB] bg-white hover:border-[#CBD5E1] hover:bg-[#F9FAFB]'
                      }`}
                    >
                      <DocIcon className={`w-4 h-4 ${accent} flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#111827] truncate">{doc.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] font-medium px-1.5 py-0 rounded border ${badge}`}>
                            {doc.type === 'CorrespondenceRecord' ? 'Email' : doc.type}
                          </span>
                          {/* Confidence bar */}
                          <div className="flex items-center gap-1 flex-1">
                            <div className="flex-1 h-1 bg-[#E5E7EB] rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  confPct >= 80 ? 'bg-[#10B981]' : confPct >= 60 ? 'bg-[#3B82F6]' : 'bg-[#F59E0B]'
                                }`}
                                style={{ width: `${confPct}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-[#6B7280] tabular-nums">{confPct}%</span>
                          </div>
                        </div>
                      </div>
                      <ChevronDown className={`w-3.5 h-3.5 text-[#9CA3AF] flex-shrink-0 transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                    </button>
                  )
                })}

                {sourceDocuments.length === 0 && (
                  <p className="text-xs text-[#9CA3AF] italic text-center py-4">No source documents</p>
                )}
              </div>

              {/* Detail panel — shown below tiles when a doc is selected */}
              {selectedDoc && (() => {
                const doc = sourceDocuments.find(d => d.id === selectedDoc)
                if (!doc) return null
                const isImageDoc =
                  doc.type === 'DamagePhoto' ||
                  doc.type === 'PhotoEvidence' ||
                  (doc.mimeType ?? '').startsWith('image/')
                const imageUrl: string | false =
                  isImageDoc && ingestedClaimId
                    ? `/api/ingested-claims/${ingestedClaimId}/attachments?name=${encodeURIComponent(doc.name)}`
                    : false
                return (
                  <DocDetailPanel
                    doc={doc}
                    imageUrl={imageUrl}
                    expandedDocId={expandedDocId}
                    setExpandedDocId={setExpandedDocId}
                  />
                )
              })()}
            </motion.div>
          </div>

          {/* Center Column - Extracted Fields (Dominant) */}
          <div className="col-span-12 lg:col-span-8">
            <motion.div
              className="card p-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center space-x-2 mb-6">
                <Search className="w-5 h-5 text-[#991B1B]" />
                <h2 className="text-base font-bold text-[#111827] uppercase tracking-wider">
                  Extracted Fields
                </h2>
                <span className="ml-auto text-xs font-medium text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded">
                  {evidence.length} fields
                </span>
              </div>

              {/* Grouped Fields by Category */}
              <div className="space-y-6">
                {Object.entries(groupedFields).map(([category, fields]) => {
                  if (fields.length === 0) return null;

                  return (
                    <div
                      key={category}
                      className="border-b border-[#E5E7EB] pb-6 last:border-0 last:pb-0"
                    >
                      <h3 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-4">
                        {category}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {fields.map(field => {
                          const fieldName =
                            field.fieldName || field.field || '';
                          const fieldKey = (fieldName || field.field || '')
                            .toLowerCase()
                            .replace(/\s/g, '');
                          const isLongField = [
                            'description',
                            'losslocation',
                            'location',
                            'details',
                          ].includes(fieldKey);
                          const Icon = getFieldIcon(fieldName);
                          const isSelected = selectedField === fieldName;

                          return (
                            <div
                              key={fieldName}
                              className={`p-4 rounded-lg border transition-all cursor-pointer ${
                                isLongField ? 'md:col-span-2' : ''
                              } ${
                                isSelected
                                  ? 'border-[#991B1B] bg-[#FEF2F2] shadow-sm'
                                  : 'border-[#E5E7EB] hover:border-[#CBD5E1] hover:bg-[#F9FAFB] bg-white'
                              }`}
                              onClick={() =>
                                setSelectedField(isSelected ? null : fieldName)
                              }
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center space-x-2 flex-1 min-w-0">
                                  <Icon className="w-4 h-4 text-[#6B7280] flex-shrink-0" />
                                  <span className="text-sm font-medium text-[#111827] capitalize truncate">
                                    {fieldName
                                      .replace(/([A-Z])/g, ' $1')
                                      .trim()}
                                  </span>
                                </div>
                              </div>

                              <div
                                className={`text-sm text-[#374151] font-medium mb-1 break-words ${
                                  isLongField ? 'line-clamp-6' : 'truncate'
                                }`}
                                title={String(field.value)}
                              >
                                {String(field.value)}
                              </div>

                              {isSelected && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  className="mt-3 pt-3 border-t border-[#E5E7EB]"
                                >
                                  <div className="text-xs text-[#6B7280] space-y-1">
                                    <div>
                                      <span className="font-medium">
                                        Source:
                                      </span>{' '}
                                      {typeof field.sourceLocator === 'string'
                                        ? field.sourceLocator
                                        : field.sourceLocator.docId}
                                    </div>
                                    <div>
                                      <span className="font-medium">
                                        Rationale:
                                      </span>{' '}
                                      {field.rationale}
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Complaint Grounding Section */}
              {(decisionPack?.policyHolderInfo ||
                decisionPack?.warrantyStatus ||
                decisionPack?.matchedProduct ||
                decisionPack?.productCategory) && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="mt-6 pt-6 border-t-2 border-[#E5E7EB]"
                >
                  <div className="flex items-center space-x-2 mb-4">
                    <BookOpen className="w-5 h-5 text-[#991B1B]" />
                    <h2 className="text-base font-bold text-[#111827] uppercase tracking-wider">
                      Complaint Grounding
                    </h2>
                  </div>

                  <div className="space-y-4">
                    {/* Customer Profile */}
                    {decisionPack?.policyHolderInfo &&
                      Object.keys(decisionPack.policyHolderInfo).length > 0 && (
                        <div className="bg-gradient-to-br from-red-50 to-red-100/80 rounded-xl border border-red-200 p-5">
                          <h3 className="text-xs font-semibold text-[#991B1B] uppercase tracking-wider mb-3 flex items-center space-x-1.5">
                            <User className="w-3.5 h-3.5" />
                            <span>Customer Profile</span>
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="bg-white rounded-lg p-3 border border-red-100">
                              <div className="text-xs text-[#6B7280] mb-1">
                                Full Name
                              </div>
                              <div className="text-sm font-semibold text-[#111827]">
                                {decisionPack.policyHolderInfo.full_name || '—'}
                              </div>
                            </div>
                            <div className="bg-white rounded-lg p-3 border border-red-100">
                              <div className="text-xs text-[#6B7280] mb-1">
                                Customer ID
                              </div>
                              <div className="text-sm font-semibold text-[#111827] font-mono">
                                {decisionPack.policyHolderInfo.customer_id ||
                                  '—'}
                              </div>
                            </div>
                            <div className="bg-white rounded-lg p-3 border border-red-100">
                              <div className="text-xs text-[#6B7280] mb-1">
                                Email
                              </div>
                              <div className="text-sm font-semibold text-[#111827] break-all">
                                {decisionPack.policyHolderInfo.email_id || '—'}
                              </div>
                            </div>
                            <div className="bg-white rounded-lg p-3 border border-red-100">
                              <div className="text-xs text-[#6B7280] mb-1">
                                Phone
                              </div>
                              <div className="text-sm font-semibold text-[#111827]">
                                {decisionPack.policyHolderInfo.phone_number ||
                                  '—'}
                              </div>
                            </div>
                            <div className="bg-white rounded-lg p-3 border border-red-100">
                              <div className="text-xs text-[#6B7280] mb-1">
                                Customer Since
                              </div>
                              <div className="text-sm font-semibold text-[#111827]">
                                {decisionPack.policyHolderInfo.customer_since ||
                                  '—'}
                              </div>
                            </div>
                            <div className="bg-white rounded-lg p-3 border border-red-100">
                              <div className="text-xs text-[#6B7280] mb-1">
                                Status
                              </div>
                              <div
                                className={`text-sm font-semibold ${
                                  decisionPack.policyHolderInfo
                                    .customer_status === 'ACTIVE'
                                    ? 'text-[#059669]'
                                    : decisionPack.policyHolderInfo
                                          .customer_status
                                      ? 'text-[#B45309]'
                                      : 'text-[#6B7280]'
                                }`}
                              >
                                {decisionPack.policyHolderInfo
                                  .customer_status || '—'}
                              </div>
                            </div>
                            {decisionPack.policyHolderInfo.loyalty_tier && (
                              <div className="bg-white rounded-lg p-3 border border-red-100">
                                <div className="text-xs text-[#6B7280] mb-1">
                                  Loyalty Tier
                                </div>
                                <div className="text-sm font-semibold text-[#111827]">
                                  {decisionPack.policyHolderInfo.loyalty_tier}
                                </div>
                              </div>
                            )}
                            <div className="bg-white rounded-lg p-3 border border-red-100 md:col-span-2">
                              <div className="text-xs text-[#6B7280] mb-1">
                                Address
                              </div>
                              <div className="text-sm font-semibold text-[#111827]">
                                {(() => {
                                  const parts: string[] = [];
                                  if (
                                    decisionPack.policyHolderInfo.address_line1
                                  )
                                    parts.push(
                                      decisionPack.policyHolderInfo
                                        .address_line1
                                    );
                                  if (
                                    decisionPack.policyHolderInfo.address_line2
                                  )
                                    parts.push(
                                      decisionPack.policyHolderInfo
                                        .address_line2
                                    );
                                  const city = [
                                    decisionPack.policyHolderInfo.city,
                                    decisionPack.policyHolderInfo.state,
                                    decisionPack.policyHolderInfo.postal_code,
                                  ]
                                    .filter(Boolean)
                                    .join(', ');
                                  if (city) parts.push(city);
                                  return parts.length > 0
                                    ? parts.join(', ')
                                    : '—';
                                })()}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                    {/* Complaint Status & History */}
                    {decisionPack?.policyHolderInfo &&
                      (decisionPack.policyHolderInfo.total_complaints != null ||
                        decisionPack.policyHolderInfo.complaint_type ||
                        decisionPack.policyHolderInfo.current_status ||
                        decisionPack.policyHolderInfo.priority_level ||
                        decisionPack.policyHolderInfo.assigned_team) && (
                        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
                          <h3 className="text-xs font-semibold text-[#991B1B] uppercase tracking-wider mb-3 flex items-center space-x-1.5">
                            <Activity className="w-3.5 h-3.5" />
                            <span>Complaint Status &amp; History</span>
                          </h3>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {decisionPack.policyHolderInfo.total_complaints !=
                              null && (
                              <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                                <div className="text-xs text-[#6B7280] mb-1">
                                  Total Complaints
                                </div>
                                <div className="text-sm font-semibold text-[#111827]">
                                  {
                                    decisionPack.policyHolderInfo
                                      .total_complaints
                                  }
                                </div>
                              </div>
                            )}
                            {decisionPack.policyHolderInfo.open_complaints !=
                              null && (
                              <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                                <div className="text-xs text-[#6B7280] mb-1">
                                  Open
                                </div>
                                <div
                                  className={`text-sm font-semibold ${
                                    Number(
                                      decisionPack.policyHolderInfo
                                        .open_complaints
                                    ) > 0
                                      ? 'text-[#DC2626]'
                                      : 'text-[#059669]'
                                  }`}
                                >
                                  {
                                    decisionPack.policyHolderInfo
                                      .open_complaints
                                  }
                                </div>
                              </div>
                            )}
                            {decisionPack.policyHolderInfo.complaint_type && (
                              <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                                <div className="text-xs text-[#6B7280] mb-1">
                                  Complaint Type
                                </div>
                                <div className="text-sm font-semibold text-[#111827]">
                                  {decisionPack.policyHolderInfo.complaint_type}
                                </div>
                              </div>
                            )}
                            {decisionPack.policyHolderInfo.current_status && (
                              <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                                <div className="text-xs text-[#6B7280] mb-1">
                                  Current Status
                                </div>
                                <div className="text-sm font-semibold text-[#111827]">
                                  {decisionPack.policyHolderInfo.current_status}
                                </div>
                              </div>
                            )}
                            {decisionPack.policyHolderInfo.priority_level && (
                              <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                                <div className="text-xs text-[#6B7280] mb-1">
                                  Priority
                                </div>
                                <div
                                  className={`text-sm font-semibold ${
                                    decisionPack.policyHolderInfo
                                      .priority_level === 'HIGH'
                                      ? 'text-[#DC2626]'
                                      : decisionPack.policyHolderInfo
                                            .priority_level === 'MEDIUM'
                                        ? 'text-[#B45309]'
                                        : 'text-[#059669]'
                                  }`}
                                >
                                  {decisionPack.policyHolderInfo.priority_level}
                                </div>
                              </div>
                            )}
                            {decisionPack.policyHolderInfo.is_escalated !=
                              null && (
                              <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                                <div className="text-xs text-[#6B7280] mb-1">
                                  Escalated
                                </div>
                                <div
                                  className={`text-sm font-semibold ${
                                    decisionPack.policyHolderInfo.is_escalated
                                      ? 'text-[#DC2626]'
                                      : 'text-[#059669]'
                                  }`}
                                >
                                  {decisionPack.policyHolderInfo.is_escalated
                                    ? 'Yes'
                                    : 'No'}
                                </div>
                              </div>
                            )}
                            {decisionPack.policyHolderInfo.assigned_team && (
                              <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                                <div className="text-xs text-[#6B7280] mb-1">
                                  Assigned Team
                                </div>
                                <div className="text-sm font-semibold text-[#111827]">
                                  {decisionPack.policyHolderInfo.assigned_team}
                                </div>
                              </div>
                            )}
                            {decisionPack.policyHolderInfo.sla_hours !=
                              null && (
                              <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                                <div className="text-xs text-[#6B7280] mb-1">
                                  SLA (hours)
                                </div>
                                <div className="text-sm font-semibold text-[#111827]">
                                  {decisionPack.policyHolderInfo.sla_hours}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                    {/* Product & Warranty Coverage */}
                    {(() => {
                      const warrantyStatus = decisionPack?.warrantyStatus;
                      const matchedProduct = decisionPack?.matchedProduct;
                      const productCategory = decisionPack?.productCategory;
                      const warrantyResult = (
                        decisionPack?.validationResults ?? []
                      ).find(
                        (r: Record<string, unknown>) =>
                          r.check === 'warranty_validation'
                      ) as Record<string, unknown> | undefined;

                      const hasData =
                        warrantyStatus ||
                        matchedProduct ||
                        productCategory ||
                        warrantyResult;
                      if (!hasData) return null;

                      const purchaseDate = warrantyResult?.purchaseDate as
                        | string
                        | undefined;
                      const expiryDate = warrantyResult?.expiryDate as
                        | string
                        | undefined;
                      const warrantyMonths = warrantyResult?.warrantyMonths as
                        | number
                        | undefined;
                      const warrantyNotes = warrantyResult?.notes as
                        | string
                        | undefined;

                      const daysRemaining = expiryDate
                        ? Math.ceil(
                            (new Date(expiryDate).getTime() - Date.now()) /
                              86400000
                          )
                        : null;

                      const isWithin = warrantyStatus === 'WITHIN_WARRANTY';
                      const isOut = warrantyStatus === 'OUT_OF_WARRANTY';

                      const borderColor = isWithin
                        ? 'border-emerald-200'
                        : isOut
                          ? 'border-red-200'
                          : 'border-amber-200';
                      const bgGradient = isWithin
                        ? 'from-emerald-50 to-emerald-100/60'
                        : isOut
                          ? 'from-red-50 to-red-100/60'
                          : 'from-amber-50 to-amber-100/60';
                      const statusTextColor = isWithin
                        ? 'text-emerald-700'
                        : isOut
                          ? 'text-red-700'
                          : 'text-amber-700';
                      const StatusIcon = isWithin
                        ? ShieldCheck
                        : isOut
                          ? ShieldX
                          : ShieldAlert;
                      const productInfoCards: Array<{
                        label: string;
                        value: React.ReactNode;
                        mono?: boolean;
                      }> = [
                        ...(matchedProduct?.productName || productCategory
                          ? [
                              {
                                label: 'Product',
                                value:
                                  matchedProduct?.productName ||
                                  productCategory ||
                                  '—',
                              },
                            ]
                          : []),
                        ...(productCategory
                          ? [{ label: 'Category', value: productCategory }]
                          : []),
                        ...(matchedProduct?.brandName
                          ? [
                              {
                                label: 'Brand',
                                value: matchedProduct.brandName,
                              },
                            ]
                          : []),
                        ...(matchedProduct?.modelNumber
                          ? [
                              {
                                label: 'Model',
                                value: matchedProduct.modelNumber,
                                mono: true,
                              },
                            ]
                          : []),
                        ...(matchedProduct?.price != null
                          ? [
                              {
                                label: 'Purchase Price',
                                value: `₹${Number(matchedProduct.price).toLocaleString()}`,
                              },
                            ]
                          : []),
                      ];

                      return (
                        <div
                          className={`rounded-xl border-2 ${borderColor} bg-gradient-to-br ${bgGradient} p-5`}
                        >
                          {/* Header */}
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xs font-semibold text-[#991B1B] uppercase tracking-wider flex items-center space-x-1.5">
                              <Package className="w-3.5 h-3.5" />
                              <span>Product &amp; Warranty Coverage</span>
                            </h3>
                            {/* Warranty status badge */}
                            <div
                              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                                isWithin
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : isOut
                                    ? 'bg-red-100 text-red-800 border border-red-300'
                                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                              }`}
                            >
                              <StatusIcon className="w-3.5 h-3.5" />
                              <span>
                                {isWithin
                                  ? 'Within Warranty'
                                  : isOut
                                    ? 'Out of Warranty'
                                    : 'Warranty Unknown'}
                              </span>
                            </div>
                          </div>

                          {/* Product info grid */}
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                            {productInfoCards.map((card, index) => {
                              const isLast =
                                index === productInfoCards.length - 1;
                              const remainder = productInfoCards.length % 3;
                              const spanClass = isLast
                                ? remainder === 1
                                  ? 'md:col-span-3'
                                  : remainder === 2
                                    ? 'md:col-span-2'
                                    : ''
                                : '';

                              return (
                                <div
                                  key={card.label}
                                  className={`bg-white/80 rounded-lg p-2.5 border border-white/60 ${spanClass}`}
                                >
                                  <div className="text-xs text-[#6B7280] mb-0.5">
                                    {card.label}
                                  </div>
                                  <div
                                    className={`text-sm font-semibold text-[#111827] ${card.mono ? 'font-mono' : ''}`}
                                  >
                                    {card.value}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Warranty dates row */}
                          {(purchaseDate ||
                            expiryDate ||
                            warrantyMonths != null) && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                              {purchaseDate && (
                                <div className="bg-white/80 rounded-lg p-2.5 border border-white/60">
                                  <div className="text-xs text-[#6B7280] mb-0.5">
                                    Purchase Date
                                  </div>
                                  <div className="text-sm font-semibold text-[#111827]">
                                    {new Date(purchaseDate).toLocaleDateString(
                                      'en-IN',
                                      {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                      }
                                    )}
                                  </div>
                                </div>
                              )}
                              {warrantyMonths != null && (
                                <div className="bg-white/80 rounded-lg p-2.5 border border-white/60">
                                  <div className="text-xs text-[#6B7280] mb-0.5">
                                    Warranty Period
                                  </div>
                                  <div className="text-sm font-semibold text-[#111827]">
                                    {warrantyMonths} months
                                  </div>
                                </div>
                              )}
                              {expiryDate && (
                                <div className="bg-white/80 rounded-lg p-2.5 border border-white/60">
                                  <div className="text-xs text-[#6B7280] mb-0.5">
                                    Warranty Expires
                                  </div>
                                  <div
                                    className={`text-sm font-semibold ${isOut ? 'text-red-700' : 'text-[#111827]'}`}
                                  >
                                    {new Date(expiryDate).toLocaleDateString(
                                      'en-IN',
                                      {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                      }
                                    )}
                                  </div>
                                </div>
                              )}
                              {daysRemaining !== null && (
                                <div
                                  className={`rounded-lg p-2.5 border ${
                                    daysRemaining > 30
                                      ? 'bg-emerald-50 border-emerald-200'
                                      : daysRemaining > 0
                                        ? 'bg-amber-50 border-amber-200'
                                        : 'bg-red-50 border-red-200'
                                  }`}
                                >
                                  <div className="text-xs text-[#6B7280] mb-0.5">
                                    {daysRemaining > 0
                                      ? 'Days Remaining'
                                      : 'Days Expired'}
                                  </div>
                                  <div
                                    className={`text-sm font-bold ${
                                      daysRemaining > 30
                                        ? 'text-emerald-700'
                                        : daysRemaining > 0
                                          ? 'text-amber-700'
                                          : 'text-red-700'
                                    }`}
                                  >
                                    {Math.abs(daysRemaining)} days
                                    {daysRemaining <= 0 ? ' ago' : ''}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* T&C / Coverage notes */}
                          {warrantyNotes && (
                            <div className="bg-white/70 rounded-lg p-3 border border-white/60">
                              <div className="flex items-start space-x-2">
                                <BadgeCheck
                                  className={`w-4 h-4 flex-shrink-0 mt-0.5 ${statusTextColor}`}
                                />
                                <div>
                                  <div className="text-xs font-semibold text-[#374151] mb-1">
                                    Warranty Assessment
                                  </div>
                                  <p className="text-xs text-[#6B7280] leading-relaxed">
                                    {warrantyNotes}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Standard coverage terms */}
                          <div className="mt-3 bg-white/70 rounded-lg p-3 border border-white/60">
                            <div className="text-xs font-semibold text-[#374151] mb-2">
                              Standard Warranty T&amp;C
                            </div>
                            <ul className="space-y-1">
                              {[
                                'Manufacturing defects and hardware failures covered under warranty',
                                'Physical or accidental damage is not covered (drops, liquid ingress, misuse)',
                                'Warranty void if repaired by unauthorized third-party technicians',
                                'Warranty is non-transferable and applies to original purchaser only',
                                'Software issues and data loss are excluded from warranty coverage',
                              ].map((term, i) => (
                                <li
                                  key={i}
                                  className="flex items-start space-x-1.5 text-xs text-[#6B7280]"
                                >
                                  <span className="text-[#9CA3AF] mt-0.5 flex-shrink-0">
                                    •
                                  </span>
                                  <span>{term}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      );
                    })()}

                  </div>
                </motion.div>
              )}
            </motion.div>

            {/* Desk Reject Confirmation Modal */}
            {showDeskRejectConfirm && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white rounded-xl shadow-2xl w-full max-w-md"
                >
                  <div className="bg-rose-50 rounded-t-xl px-6 py-5 flex items-center gap-3 border-b border-rose-100">
                    <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
                      <X className="w-5 h-5 text-rose-600" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-rose-800">Desk Reject Complaint</h2>
                      <p className="text-xs text-rose-600 mt-0.5">Customer not found in CRM — reject without further review</p>
                    </div>
                    <button onClick={() => setShowDeskRejectConfirm(false)} className="ml-auto text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="px-6 py-4 space-y-3">
                    <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-700 space-y-1">
                      <p className="font-medium text-gray-900 mb-1.5">What will happen:</p>
                      <p>1. Complaint status will be updated to <span className="font-semibold text-rose-600">Rejected</span></p>
                      <p>2. A rejection email will be sent to the complainant</p>
                      <p>3. Reason: Customer not found in CRM</p>
                    </div>
                    {decisionHook.error && (
                      <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        {decisionHook.error}
                      </div>
                    )}
                  </div>
                  <div className="px-6 pb-5 flex gap-3">
                    <button
                      onClick={() => setShowDeskRejectConfirm(false)}
                      className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        const d = (claimDraft as Record<string, unknown>) || {}
                        const customerName = String(d.claimantName || d.customerName || 'Valued Customer')
                        const complaintRef = String(d.policyNumber || d.policyId || claimData.claimId || 'Pending')
                        const product = String(d.productOrService || d.description || 'your product')
                        const recipient = String((claimData.sourceEmailFrom as string) || d.contactEmail || '')
                        const today = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
                        const letter = `${today}\n\nDear ${customerName},\n\nRE: Complaint Decision – Reference ${complaintRef}\n\nThank you for contacting Consumer Electronics Customer Support regarding your ${product}.\n\nAfter reviewing your complaint, we were unable to locate a matching customer record in our system. As a result, we are unable to process your complaint at this time.\n\nREASON\n  Your complaint could not be verified against our customer records.\n\nYOUR OPTIONS\n  1. If you believe this is an error, please reply with your customer ID or order reference.\n  2. For new customer registration, please visit our website.\n\nWe apologise for any inconvenience.\n\nKind regards,\nCustomer Support Team\nConsumer Electronics`
                        const ok = await decisionHook.decide({
                          decision: 'reject',
                          letter,
                          recipient,
                          subject: `Complaint Decision – Reference ${complaintRef}`,
                          rejectionReason: 'Customer not found in CRM',
                          inReplyTo: claimData.messageId,
                          references: claimData.threadId,
                        })
                        if (ok) {
                          setDeskRejectDone(true)
                          setShowDeskRejectConfirm(false)
                        }
                      }}
                      disabled={decisionHook.loading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors disabled:opacity-60"
                    >
                      {decisionHook.loading ? (
                        <><Clock className="w-4 h-4 animate-spin" />Processing...</>
                      ) : (
                        <><Send className="w-4 h-4" />Confirm Desk Reject</>
                      )}
                    </button>
                  </div>
                </motion.div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
