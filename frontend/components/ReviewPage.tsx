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
  Tag,
  Activity,
  Info,
  Package,
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  BadgeCheck,
  Mail,
  FileImage,
  Receipt
} from 'lucide-react'
import ClaimSummaryBar from './ClaimSummaryBar'
import { ClaimData, Document, FieldEvidence, PolicyHit } from '@/types/claims'
import { CONFIDENCE } from '@/lib/confidence'
import { getClaimDraft } from '@/lib/normalizeClaim'

/** Image preview with graceful "unavailable" fallback when the file can't be served */
function ImagePreview({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = React.useState<'loading' | 'ok' | 'error'>('loading')
  return (
    <div className="rounded-lg overflow-hidden bg-[#F3F4F6] flex items-center justify-center min-h-[100px]">
      {state !== 'error' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className={`max-w-full max-h-48 object-contain ${state === 'loading' ? 'opacity-0 absolute' : ''}`}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      )}
      {state === 'loading' && (
        <span className="text-xs text-[#9CA3AF]">Loading image…</span>
      )}
      {state === 'error' && (
        <div className="flex flex-col items-center gap-1 py-4 text-[#9CA3AF]">
          <FileImage className="w-8 h-8" />
          <span className="text-xs">Image not available on this machine</span>
        </div>
      )}
    </div>
  )
}

/** Render flat KPI key-values (e.g. from damage photos, water leakage images) */
function ImageKpiContent({ keyFields }: { keyFields: Record<string, unknown> }) {
  const formatLabel = (key: string) =>
    key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
  const entries = Object.entries(keyFields).filter(
    ([k, v]) => !String(k).startsWith('_') && v != null && v !== ''
  )
  if (entries.length === 0) return null
  return (
    <div className="grid gap-x-4 gap-y-2 text-xs" style={{ gridTemplateColumns: 'auto 1fr' }}>
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <span className="font-medium text-[#6B7280]">{formatLabel(k)}:</span>
          <span className="text-[#374151] break-words">{String(v)}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

/** Render structured keyFields for any document type (Invoice, Police Report, Repair Estimate, etc.) */
function StructuredDocContent({ doc }: { doc: Document }) {
  const keyFields = doc.keyFields as Record<string, unknown> | undefined
  if (!keyFields || Object.keys(keyFields).length === 0) return null

  const formatLabel = (key: string) =>
    key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()

  const renderValue = (val: unknown): React.ReactNode => {
    if (val == null || val === '') return '—'
    if (typeof val === 'string') return val
    if (typeof val === 'number') return String(val)
    if (Array.isArray(val)) {
      if (val.length === 0) return '—'
      return (
        <ul className="list-disc list-inside space-y-0.5 mt-1">
          {val.map((item, i) => (
            <li key={i} className="text-[#374151]">
              {typeof item === 'object' && item !== null && !Array.isArray(item)
                ? Object.entries(item as Record<string, unknown>).map(([k, v]) => (
                    <span key={k} className="mr-2">
                      <span className="font-medium text-[#6B7280]">{formatLabel(k)}:</span>{' '}
                      {String(v)}
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
        <div className="mt-1 space-y-1 pl-2 border-l-2 border-[#E5E7EB]">
          {Object.entries(val as Record<string, unknown>).map(([k, v]) => (
            <div key={k} className="text-xs">
              <span className="font-medium text-[#6B7280]">{formatLabel(k)}:</span>{' '}
              <span className="text-[#374151]">{renderValue(v)}</span>
            </div>
          ))}
        </div>
      )
    }
    return String(val)
  }

  const renderSection = (sectionKey: string, sectionVal: unknown) => {
    const title = formatLabel(sectionKey)
    if (Array.isArray(sectionVal) && sectionVal.length > 0) {
      const first = sectionVal[0]
      const isTable =
        typeof first === 'object' && first !== null && !Array.isArray(first)
      if (isTable) {
        const keys = Object.keys(first as Record<string, unknown>)
        return (
          <div key={sectionKey}>
            <div className="text-xs font-semibold text-[#991B1B] uppercase tracking-wider mb-2">
              {title}
            </div>
            <div className="bg-[#F9FAFB] rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#FEF2F2]">
                    {keys.map((k) => (
                      <th
                        key={k}
                        className="px-3 py-2 text-left font-semibold text-[#991B1B]"
                      >
                        {formatLabel(k)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sectionVal.map((row: unknown, i: number) => (
                    <tr key={i} className="border-t border-[#E5E7EB]">
                      {keys.map((k) => (
                        <td key={k} className="px-3 py-2 text-[#374151]">
                          {renderValue((row as Record<string, unknown>)[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }
    }
    return (
      <div key={sectionKey}>
        <div className="text-xs font-semibold text-[#991B1B] uppercase tracking-wider mb-2">
          {title}
        </div>
        <div className="bg-[#F9FAFB] rounded-lg p-3 text-xs">
          {typeof sectionVal === 'object' && sectionVal !== null && !Array.isArray(sectionVal) ? (
            <div className="grid gap-x-4 gap-y-2" style={{ gridTemplateColumns: 'auto 1fr' }}>
              {Object.entries(sectionVal as Record<string, unknown>).map(([k, v]) => (
                <React.Fragment key={k}>
                  <span className="font-medium text-[#6B7280] min-w-0">
                    {formatLabel(k)}:
                  </span>
                  <span className="text-[#374151] break-words">{renderValue(v)}</span>
                </React.Fragment>
              ))}
            </div>
          ) : (
            <span className="text-[#374151]">{renderValue(sectionVal)}</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-h-[400px] overflow-y-auto">
      {Object.entries(keyFields).map(([sectionKey, sectionVal]) =>
        renderSection(sectionKey, sectionVal)
      )}
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

const SUMMARY_PREVIEW_LENGTH = 280

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
  const { 
    evidence = [], 
    documents = [], 
  } = decisionPack || {}
  const claimDraft = getClaimDraft(decisionPack)

  // Calculate overall confidence
  const overallConfidence = useMemo(() => {
    if (evidence.length === 0) return 0
    const avg = evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length
    return Math.round(avg * 100)
  }, [evidence])

  // Group fields by category
  const groupedFields = useMemo(() => categorizeFields(evidence), [evidence])

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= CONFIDENCE.THRESHOLD_HIGH) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]">High</span>
    } else if (confidence >= CONFIDENCE.THRESHOLD_MEDIUM) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA]">Medium</span>
    } else {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]">Review</span>
    }
  }

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

  return (
    <div className="max-w-[1920px] mx-auto">
      <ClaimSummaryBar
        claimData={claimData}
        onBack={onPreviousStage}
        onContinue={onNextStage}
        continueLabel="Continue"
        showClaimDropdown
        onClaimSelect={onLoadClaim}
      />

      {/* Main Content - Two Column Layout */}
      <div className="px-4 py-8">
        <div className="grid grid-cols-12 gap-6">
          {/* Left Column - Source Documents (Compact) */}
          <div className="col-span-12 lg:col-span-4">
            <motion.div 
              className="card p-5 h-fit sticky top-[88px]"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="flex items-center space-x-2 mb-4">
                <FileText className="w-4 h-4 text-[#991B1B]" />
                <h2 className="text-sm font-bold text-[#111827] uppercase tracking-wider">Source Documents</h2>
                <span className="ml-auto text-xs font-medium text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded">
                  {documents.length}
                </span>
              </div>
              
              <div className="space-y-2">
                {documents.map((doc) => {
                  const isSelected = selectedDoc === doc.id
                  const isImageDoc =
                    doc.type === 'DamagePhoto' || doc.mimeType?.startsWith('image/')
                  const imageUrl =
                    isImageDoc &&
                    ingestedClaimId &&
                    `/api/ingested-claims/${ingestedClaimId}/attachments?name=${encodeURIComponent(doc.name)}`

                  return (
                    <div
                      key={doc.id}
                      className={`rounded-lg border cursor-pointer transition-all overflow-hidden ${
                        isSelected
                          ? 'border-[#991B1B] bg-[#FEF2F2] shadow-sm'
                          : 'border-[#E5E7EB] hover:border-[#CBD5E1] hover:bg-[#F9FAFB] bg-white'
                      }`}
                      onClick={() => setSelectedDoc(isSelected ? null : doc.id)}
                    >
                      <div className="p-3">
                        <div className="flex items-start justify-between mb-2 gap-2">
                          <div className="flex items-center space-x-2 flex-1 min-w-0 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
                            {isImageDoc ? (
                              <FileImage className="w-4 h-4 text-[#991B1B] flex-shrink-0" />
                            ) : doc.type === 'CorrespondenceRecord' ? (
                              <Mail className="w-4 h-4 text-[#3B82F6] flex-shrink-0" />
                            ) : doc.type === 'Invoice' || doc.type === 'Receipt' ? (
                              <Receipt className="w-4 h-4 text-[#10B981] flex-shrink-0" />
                            ) : (
                              <FileText className="w-4 h-4 text-[#6B7280] flex-shrink-0" />
                            )}
                            <span className="text-xs font-semibold text-[#111827] whitespace-nowrap">
                              {doc.name}
                            </span>
                          </div>
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
                            doc.type === 'CorrespondenceRecord'
                              ? 'bg-[#EFF6FF] text-[#1D4ED8]'
                              : doc.type === 'Invoice' || doc.type === 'Receipt'
                                ? 'bg-[#ECFDF5] text-[#047857]'
                                : isImageDoc
                                  ? 'bg-[#FEF2F2] text-[#991B1B]'
                                  : 'bg-[#F3F4F6] text-[#6B7280]'
                          }`}>
                            {doc.type === 'CorrespondenceRecord' ? 'Email' : doc.type}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-1">
                            <div
                              className={`w-1.5 h-1.5 rounded-full ${
                                doc.confidence >= CONFIDENCE.THRESHOLD_HIGH
                                  ? 'bg-[#10B981]'
                                  : doc.confidence >= CONFIDENCE.THRESHOLD_MEDIUM
                                    ? 'bg-[#3B82F6]'
                                    : 'bg-[#F59E0B]'
                              }`}
                            />
                            <span className="text-xs text-[#6B7280]">
                              {Math.round(doc.confidence * 100)}%
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Image preview + detailed summary + extracted KPIs for image documents */}
                      {isImageDoc && isSelected && (() => {
                        const analysisError = (doc.metadata as Record<string, unknown>)?.analysisError as string | undefined
                        return (
                          <div className="border-t border-[#E5E7EB] bg-white/80 p-3 space-y-3">
                            {/* Image preview */}
                            {imageUrl ? (
                              <ImagePreview src={imageUrl as string} alt={doc.name} />
                            ) : null}
                            {/* Analysis error state */}
                            {analysisError ? (
                              <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-3 flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-[#B45309] flex-shrink-0 mt-0.5" />
                                <div>
                                  <div className="text-xs font-semibold text-[#B45309] mb-1">Image Analysis Unavailable</div>
                                  <div className="text-xs text-[#92400E]">
                                    The original image file could not be found on this machine. It may have been processed on a different computer.
                                  </div>
                                </div>
                              </div>
                            ) : doc.content && typeof doc.content === 'string' && doc.content.trim() ? (
                              /* Detailed Summary */
                              <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-3">
                                <div className="text-xs font-semibold text-[#991B1B] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                  <FileText className="w-3.5 h-3.5" />
                                  Image Analysis Summary
                                </div>
                                <div className="text-xs text-[#1C1917] leading-relaxed whitespace-pre-wrap">
                                  {doc.content}
                                </div>
                              </div>
                            ) : null}
                            {/* Extracted KPIs */}
                            {doc.keyFields && Object.keys(doc.keyFields as object).length > 0 ? (
                              <div>
                                <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2">
                                  Extracted KPIs
                                </div>
                                <ImageKpiContent keyFields={doc.keyFields as Record<string, unknown>} />
                              </div>
                            ) : null}
                            {/* No data at all */}
                            {!analysisError && !doc.content && (!doc.keyFields || Object.keys(doc.keyFields as object).length === 0) && (
                              <p className="text-xs text-[#6B7280] italic">No analysis data extracted</p>
                            )}
                          </div>
                        )
                      })()}
                      {/* Text document content when selected */}
                      {!isImageDoc && isSelected && (
                        <div className="border-t border-[#E5E7EB] bg-white/80 p-3 space-y-3">
                          {/* Extracted fields (keyFields) */}
                          {doc.keyFields &&
                          Object.keys(doc.keyFields as object).length > 0 ? (
                            <>
                              <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
                                {doc.type === 'CorrespondenceRecord' ? 'Extracted Fields' : 'Structured Content'}
                              </div>
                              <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
                                <StructuredDocContent doc={doc} />
                              </div>
                            </>
                          ) : null}
                          {/* Raw content / email body */}
                          {doc.content && typeof doc.content === 'string' && doc.content.trim() ? (
                            <>
                              <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
                                {doc.type === 'CorrespondenceRecord' ? 'Email Body' : 'Content'}
                              </div>
                              <div className={`rounded-lg p-3 ${doc.type === 'CorrespondenceRecord' ? 'bg-[#EFF6FF] border border-[#BFDBFE]' : 'bg-[#F9FAFB]'}`}>
                                <p className="text-xs text-[#374151] leading-relaxed whitespace-pre-wrap">
                                  {expandedDocId === doc.id
                                    ? doc.content
                                    : doc.content.length > SUMMARY_PREVIEW_LENGTH
                                      ? `${doc.content.slice(0, SUMMARY_PREVIEW_LENGTH).trim()}...`
                                      : doc.content}
                                </p>
                                {doc.content.length > SUMMARY_PREVIEW_LENGTH && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setExpandedDocId(expandedDocId === doc.id ? null : doc.id)
                                    }}
                                    className="mt-2 text-xs font-medium text-[#1D4ED8] hover:underline"
                                  >
                                    {expandedDocId === doc.id ? 'View less' : 'View full email'}
                                  </button>
                                )}
                              </div>
                            </>
                          ) : !doc.keyFields || Object.keys(doc.keyFields as object).length === 0 ? (
                            <p className="text-xs text-[#6B7280] italic">No structured content extracted</p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
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
                <h2 className="text-base font-bold text-[#111827] uppercase tracking-wider">Extracted Fields</h2>
                <span className="ml-auto text-xs font-medium text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded">
                  {evidence.length} fields
                </span>
              </div>

              {/* Grouped Fields by Category */}
              <div className="space-y-6">
                {Object.entries(groupedFields).map(([category, fields]) => {
                  if (fields.length === 0) return null
                  
                  return (
                    <div key={category} className="border-b border-[#E5E7EB] pb-6 last:border-0 last:pb-0">
                      <h3 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-4">
                        {category}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {fields.map((field) => {
                          const fieldName = field.fieldName || field.field || ''
                          const fieldKey = (fieldName || (field.field || '')).toLowerCase().replace(/\s/g, '')
                          const isLongField = ['description', 'losslocation', 'location', 'details'].includes(fieldKey)
                          const Icon = getFieldIcon(fieldName)
                          const isSelected = selectedField === fieldName

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
                              onClick={() => setSelectedField(isSelected ? null : fieldName)}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center space-x-2 flex-1 min-w-0">
                                  <Icon className="w-4 h-4 text-[#6B7280] flex-shrink-0" />
                                  <span className="text-sm font-medium text-[#111827] capitalize truncate">
                                    {fieldName.replace(/([A-Z])/g, ' $1').trim()}
                                  </span>
                                </div>
                                {getConfidenceBadge(field.confidence)}
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
                                      <span className="font-medium">Source:</span>{' '}
                                      {typeof field.sourceLocator === 'string' 
                                        ? field.sourceLocator 
                                        : field.sourceLocator.docId}
                                    </div>
                                    <div>
                                      <span className="font-medium">Rationale:</span> {field.rationale}
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Complaint Grounding Section */}
              {(decisionPack?.policyHolderInfo || decisionPack?.warrantyStatus || decisionPack?.matchedProduct || decisionPack?.productCategory || (decisionPack?.policyGrounding && decisionPack.policyGrounding.length > 0)) && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="mt-6 pt-6 border-t-2 border-[#E5E7EB]"
                >
                  <div className="flex items-center space-x-2 mb-4">
                    <BookOpen className="w-5 h-5 text-[#991B1B]" />
                    <h2 className="text-base font-bold text-[#111827] uppercase tracking-wider">Complaint Grounding</h2>
                    {decisionPack?.policyGrounding && decisionPack.policyGrounding.length > 0 && (
                      <span className="ml-auto text-xs font-medium text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded">
                        {decisionPack.policyGrounding.length} match{decisionPack.policyGrounding.length !== 1 ? 'es' : ''}
                      </span>
                    )}
                  </div>

                  <div className="space-y-4">

                    {/* Customer Profile */}
                    {decisionPack?.policyHolderInfo && Object.keys(decisionPack.policyHolderInfo).length > 0 && (
                      <div className="bg-gradient-to-br from-red-50 to-red-100/80 rounded-xl border border-red-200 p-5">
                        <h3 className="text-xs font-semibold text-[#991B1B] uppercase tracking-wider mb-3 flex items-center space-x-1.5">
                          <User className="w-3.5 h-3.5" />
                          <span>Customer Profile</span>
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="bg-white rounded-lg p-3 border border-red-100">
                            <div className="text-xs text-[#6B7280] mb-1">Full Name</div>
                            <div className="text-sm font-semibold text-[#111827]">
                              {decisionPack.policyHolderInfo.full_name || '—'}
                            </div>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-red-100">
                            <div className="text-xs text-[#6B7280] mb-1">Customer ID</div>
                            <div className="text-sm font-semibold text-[#111827] font-mono">
                              {decisionPack.policyHolderInfo.customer_id || '—'}
                            </div>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-red-100">
                            <div className="text-xs text-[#6B7280] mb-1">Email</div>
                            <div className="text-sm font-semibold text-[#111827] break-all">
                              {decisionPack.policyHolderInfo.email_id || '—'}
                            </div>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-red-100">
                            <div className="text-xs text-[#6B7280] mb-1">Phone</div>
                            <div className="text-sm font-semibold text-[#111827]">
                              {decisionPack.policyHolderInfo.phone_number || '—'}
                            </div>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-red-100">
                            <div className="text-xs text-[#6B7280] mb-1">Customer Since</div>
                            <div className="text-sm font-semibold text-[#111827]">
                              {decisionPack.policyHolderInfo.customer_since || '—'}
                            </div>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-red-100">
                            <div className="text-xs text-[#6B7280] mb-1">Status</div>
                            <div className={`text-sm font-semibold ${
                              decisionPack.policyHolderInfo.customer_status === 'ACTIVE'
                                ? 'text-[#059669]'
                                : decisionPack.policyHolderInfo.customer_status
                                  ? 'text-[#B45309]'
                                  : 'text-[#6B7280]'
                            }`}>
                              {decisionPack.policyHolderInfo.customer_status || '—'}
                            </div>
                          </div>
                          {decisionPack.policyHolderInfo.loyalty_tier && (
                            <div className="bg-white rounded-lg p-3 border border-red-100">
                              <div className="text-xs text-[#6B7280] mb-1">Loyalty Tier</div>
                              <div className="text-sm font-semibold text-[#111827]">
                                {decisionPack.policyHolderInfo.loyalty_tier}
                              </div>
                            </div>
                          )}
                          <div className="bg-white rounded-lg p-3 border border-red-100 md:col-span-2">
                            <div className="text-xs text-[#6B7280] mb-1">Address</div>
                            <div className="text-sm font-semibold text-[#111827]">
                              {(() => {
                                const parts: string[] = []
                                if (decisionPack.policyHolderInfo.address_line1) parts.push(decisionPack.policyHolderInfo.address_line1)
                                if (decisionPack.policyHolderInfo.address_line2) parts.push(decisionPack.policyHolderInfo.address_line2)
                                const city = [
                                  decisionPack.policyHolderInfo.city,
                                  decisionPack.policyHolderInfo.state,
                                  decisionPack.policyHolderInfo.postal_code,
                                ].filter(Boolean).join(', ')
                                if (city) parts.push(city)
                                return parts.length > 0 ? parts.join(', ') : '—'
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Complaint Status & History */}
                    {decisionPack?.policyHolderInfo && (
                      decisionPack.policyHolderInfo.total_complaints != null ||
                      decisionPack.policyHolderInfo.complaint_type ||
                      decisionPack.policyHolderInfo.current_status ||
                      decisionPack.policyHolderInfo.priority_level ||
                      decisionPack.policyHolderInfo.assigned_team
                    ) && (
                      <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
                        <h3 className="text-xs font-semibold text-[#991B1B] uppercase tracking-wider mb-3 flex items-center space-x-1.5">
                          <Activity className="w-3.5 h-3.5" />
                          <span>Complaint Status &amp; History</span>
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {decisionPack.policyHolderInfo.total_complaints != null && (
                            <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                              <div className="text-xs text-[#6B7280] mb-1">Total Complaints</div>
                              <div className="text-sm font-semibold text-[#111827]">
                                {decisionPack.policyHolderInfo.total_complaints}
                              </div>
                            </div>
                          )}
                          {decisionPack.policyHolderInfo.open_complaints != null && (
                            <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                              <div className="text-xs text-[#6B7280] mb-1">Open</div>
                              <div className={`text-sm font-semibold ${
                                Number(decisionPack.policyHolderInfo.open_complaints) > 0 ? 'text-[#DC2626]' : 'text-[#059669]'
                              }`}>
                                {decisionPack.policyHolderInfo.open_complaints}
                              </div>
                            </div>
                          )}
                          {decisionPack.policyHolderInfo.complaint_type && (
                            <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                              <div className="text-xs text-[#6B7280] mb-1">Complaint Type</div>
                              <div className="text-sm font-semibold text-[#111827]">
                                {decisionPack.policyHolderInfo.complaint_type}
                              </div>
                            </div>
                          )}
                          {decisionPack.policyHolderInfo.current_status && (
                            <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                              <div className="text-xs text-[#6B7280] mb-1">Current Status</div>
                              <div className="text-sm font-semibold text-[#111827]">
                                {decisionPack.policyHolderInfo.current_status}
                              </div>
                            </div>
                          )}
                          {decisionPack.policyHolderInfo.priority_level && (
                            <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                              <div className="text-xs text-[#6B7280] mb-1">Priority</div>
                              <div className={`text-sm font-semibold ${
                                decisionPack.policyHolderInfo.priority_level === 'HIGH' ? 'text-[#DC2626]'
                                : decisionPack.policyHolderInfo.priority_level === 'MEDIUM' ? 'text-[#B45309]'
                                : 'text-[#059669]'
                              }`}>
                                {decisionPack.policyHolderInfo.priority_level}
                              </div>
                            </div>
                          )}
                          {decisionPack.policyHolderInfo.is_escalated != null && (
                            <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                              <div className="text-xs text-[#6B7280] mb-1">Escalated</div>
                              <div className={`text-sm font-semibold ${
                                decisionPack.policyHolderInfo.is_escalated ? 'text-[#DC2626]' : 'text-[#059669]'
                              }`}>
                                {decisionPack.policyHolderInfo.is_escalated ? 'Yes' : 'No'}
                              </div>
                            </div>
                          )}
                          {decisionPack.policyHolderInfo.assigned_team && (
                            <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                              <div className="text-xs text-[#6B7280] mb-1">Assigned Team</div>
                              <div className="text-sm font-semibold text-[#111827]">
                                {decisionPack.policyHolderInfo.assigned_team}
                              </div>
                            </div>
                          )}
                          {decisionPack.policyHolderInfo.sla_hours != null && (
                            <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#E5E7EB]">
                              <div className="text-xs text-[#6B7280] mb-1">SLA (hours)</div>
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
                      const warrantyStatus = decisionPack?.warrantyStatus
                      const matchedProduct = decisionPack?.matchedProduct
                      const productCategory = decisionPack?.productCategory
                      const warrantyResult = (decisionPack?.validationResults ?? []).find(
                        (r: Record<string, unknown>) => r.check === 'warranty_validation'
                      ) as Record<string, unknown> | undefined

                      const hasData = warrantyStatus || matchedProduct || productCategory || warrantyResult
                      if (!hasData) return null

                      const purchaseDate = warrantyResult?.purchaseDate as string | undefined
                      const expiryDate = warrantyResult?.expiryDate as string | undefined
                      const warrantyMonths = warrantyResult?.warrantyMonths as number | undefined
                      const warrantyNotes = warrantyResult?.notes as string | undefined

                      const daysRemaining = expiryDate
                        ? Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86400000)
                        : null

                      const isWithin = warrantyStatus === 'WITHIN_WARRANTY'
                      const isOut = warrantyStatus === 'OUT_OF_WARRANTY'

                      const borderColor = isWithin ? 'border-emerald-200' : isOut ? 'border-red-200' : 'border-amber-200'
                      const bgGradient = isWithin
                        ? 'from-emerald-50 to-emerald-100/60'
                        : isOut
                        ? 'from-red-50 to-red-100/60'
                        : 'from-amber-50 to-amber-100/60'
                      const statusTextColor = isWithin ? 'text-emerald-700' : isOut ? 'text-red-700' : 'text-amber-700'
                      const StatusIcon = isWithin ? ShieldCheck : isOut ? ShieldX : ShieldAlert

                      return (
                        <div className={`rounded-xl border-2 ${borderColor} bg-gradient-to-br ${bgGradient} p-5`}>
                          {/* Header */}
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xs font-semibold text-[#991B1B] uppercase tracking-wider flex items-center space-x-1.5">
                              <Package className="w-3.5 h-3.5" />
                              <span>Product &amp; Warranty Coverage</span>
                            </h3>
                            {/* Warranty status badge */}
                            <div className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                              isWithin
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : isOut
                                ? 'bg-red-100 text-red-800 border border-red-300'
                                : 'bg-amber-100 text-amber-800 border border-amber-300'
                            }`}>
                              <StatusIcon className="w-3.5 h-3.5" />
                              <span>{isWithin ? 'Within Warranty' : isOut ? 'Out of Warranty' : 'Warranty Unknown'}</span>
                            </div>
                          </div>

                          {/* Product info grid */}
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                            {(matchedProduct?.productName || productCategory) && (
                              <div className="bg-white/80 rounded-lg p-2.5 border border-white/60">
                                <div className="text-xs text-[#6B7280] mb-0.5">Product</div>
                                <div className="text-sm font-semibold text-[#111827]">
                                  {matchedProduct?.productName || productCategory || '—'}
                                </div>
                              </div>
                            )}
                            {productCategory && (
                              <div className="bg-white/80 rounded-lg p-2.5 border border-white/60">
                                <div className="text-xs text-[#6B7280] mb-0.5">Category</div>
                                <div className="text-sm font-semibold text-[#111827]">{productCategory}</div>
                              </div>
                            )}
                            {matchedProduct?.brandName && (
                              <div className="bg-white/80 rounded-lg p-2.5 border border-white/60">
                                <div className="text-xs text-[#6B7280] mb-0.5">Brand</div>
                                <div className="text-sm font-semibold text-[#111827]">{matchedProduct.brandName}</div>
                              </div>
                            )}
                            {matchedProduct?.modelNumber && (
                              <div className="bg-white/80 rounded-lg p-2.5 border border-white/60">
                                <div className="text-xs text-[#6B7280] mb-0.5">Model</div>
                                <div className="text-sm font-semibold text-[#111827] font-mono">{matchedProduct.modelNumber}</div>
                              </div>
                            )}
                            {matchedProduct?.price != null && (
                              <div className="bg-white/80 rounded-lg p-2.5 border border-white/60">
                                <div className="text-xs text-[#6B7280] mb-0.5">Purchase Price</div>
                                <div className="text-sm font-semibold text-[#111827]">
                                  ₹{Number(matchedProduct.price).toLocaleString()}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Warranty dates row */}
                          {(purchaseDate || expiryDate || warrantyMonths != null) && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                              {purchaseDate && (
                                <div className="bg-white/80 rounded-lg p-2.5 border border-white/60">
                                  <div className="text-xs text-[#6B7280] mb-0.5">Purchase Date</div>
                                  <div className="text-sm font-semibold text-[#111827]">
                                    {new Date(purchaseDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                  </div>
                                </div>
                              )}
                              {warrantyMonths != null && (
                                <div className="bg-white/80 rounded-lg p-2.5 border border-white/60">
                                  <div className="text-xs text-[#6B7280] mb-0.5">Warranty Period</div>
                                  <div className="text-sm font-semibold text-[#111827]">{warrantyMonths} months</div>
                                </div>
                              )}
                              {expiryDate && (
                                <div className="bg-white/80 rounded-lg p-2.5 border border-white/60">
                                  <div className="text-xs text-[#6B7280] mb-0.5">Warranty Expires</div>
                                  <div className={`text-sm font-semibold ${isOut ? 'text-red-700' : 'text-[#111827]'}`}>
                                    {new Date(expiryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                  </div>
                                </div>
                              )}
                              {daysRemaining !== null && (
                                <div className={`rounded-lg p-2.5 border ${
                                  daysRemaining > 30
                                    ? 'bg-emerald-50 border-emerald-200'
                                    : daysRemaining > 0
                                    ? 'bg-amber-50 border-amber-200'
                                    : 'bg-red-50 border-red-200'
                                }`}>
                                  <div className="text-xs text-[#6B7280] mb-0.5">
                                    {daysRemaining > 0 ? 'Days Remaining' : 'Days Expired'}
                                  </div>
                                  <div className={`text-sm font-bold ${
                                    daysRemaining > 30 ? 'text-emerald-700'
                                    : daysRemaining > 0 ? 'text-amber-700'
                                    : 'text-red-700'
                                  }`}>
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
                                <BadgeCheck className={`w-4 h-4 flex-shrink-0 mt-0.5 ${statusTextColor}`} />
                                <div>
                                  <div className="text-xs font-semibold text-[#374151] mb-1">Warranty Assessment</div>
                                  <p className="text-xs text-[#6B7280] leading-relaxed">{warrantyNotes}</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Standard coverage terms */}
                          <div className="mt-3 bg-white/70 rounded-lg p-3 border border-white/60">
                            <div className="text-xs font-semibold text-[#374151] mb-2">Standard Warranty T&amp;C</div>
                            <ul className="space-y-1">
                              {[
                                'Manufacturing defects and hardware failures covered under warranty',
                                'Physical or accidental damage is not covered (drops, liquid ingress, misuse)',
                                'Warranty void if repaired by unauthorized third-party technicians',
                                'Warranty is non-transferable and applies to original purchaser only',
                                'Software issues and data loss are excluded from warranty coverage',
                              ].map((term, i) => (
                                <li key={i} className="flex items-start space-x-1.5 text-xs text-[#6B7280]">
                                  <span className="text-[#9CA3AF] mt-0.5 flex-shrink-0">•</span>
                                  <span>{term}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Grounding Matches */}
                    {decisionPack?.policyGrounding && decisionPack.policyGrounding.length > 0 && (
                      <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
                        <h3 className="text-xs font-semibold text-[#991B1B] uppercase tracking-wider mb-3 flex items-center space-x-1.5">
                          <Tag className="w-3.5 h-3.5" />
                          <span>Matched Resolution Rules</span>
                        </h3>
                        <div className="space-y-3">
                          {decisionPack.policyGrounding.map((hit, idx) => {
                            const score = Number(hit.score ?? hit.similarity ?? 0)
                            const isCustomerRecord = !String(hit.clauseId ?? '').startsWith('RES-')
                            const recommendation = String(hit.rationale ?? '')
                            return (
                              <div
                                key={hit.clauseId ?? idx}
                                className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4"
                              >
                                <div className="flex items-start justify-between gap-3 mb-2">
                                  <div className="flex items-center space-x-2 flex-1 min-w-0">
                                    {isCustomerRecord
                                      ? <User className="w-3.5 h-3.5 text-[#3B82F6] flex-shrink-0" />
                                      : <BookOpen className="w-3.5 h-3.5 text-[#991B1B] flex-shrink-0" />
                                    }
                                    <span className="text-sm font-semibold text-[#111827] truncate">
                                      {hit.title || hit.clauseId}
                                    </span>
                                  </div>
                                  <div className="flex items-center space-x-2 flex-shrink-0">
                                    {hit.section && (
                                      <span className="text-xs text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded">
                                        {hit.section}
                                      </span>
                                    )}
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                                      score >= 0.8
                                        ? 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]'
                                        : score >= 0.6
                                          ? 'bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]'
                                          : 'bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB]'
                                    }`}>
                                      {Math.round(score * 100)}%
                                    </span>
                                  </div>
                                </div>
                                {hit.snippet && (
                                  <p className="text-xs text-[#6B7280] leading-relaxed mb-2 line-clamp-3">
                                    {hit.snippet}
                                  </p>
                                )}
                                {recommendation && (
                                  <div className="flex items-start space-x-1.5 mt-2 pt-2 border-t border-[#E5E7EB]">
                                    <Info className="w-3 h-3 text-[#991B1B] flex-shrink-0 mt-0.5" />
                                    <span className="text-xs text-[#374151]">{recommendation}</span>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                  </div>
                </motion.div>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  )
}
