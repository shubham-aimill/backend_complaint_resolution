/**
 * Drafts service - creates core-system drafts from extracted claim data.
 * Persists structured draft records incorporating all extracted details.
 */

import fs from 'fs'
import path from 'path'
import type { ClaimData } from '@/types/claims'

// Project root is parent of frontend when running from frontend/
const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const DATA_DIR = path.join(PROJECT_ROOT, 'data')
const DRAFTS_DIR = path.join(DATA_DIR, 'drafts')
const INDEX_FILE = path.join(DRAFTS_DIR, 'drafts-index.json')

export interface CoreDraft {
  draftId: string
  claimId: string
  ingestedClaimId?: string
  status: 'pending' | 'submitted' | 'approved' | 'rejected'
  createdAt: string
  /** Extracted claim fields for core system */
  claimFields: {
    policyNumber: string
    claimantName: string
    contactEmail: string
    contactPhone?: string
    lossDate: string
    lossType: string
    lossLocation?: string
    description: string
    estimatedAmount?: number
    deductible?: number
    propertyAddress?: string
    vehicleInfo?: Record<string, unknown>
  }
  attachments: Array<{
    id: string
    name: string
    type?: string
    mimeType: string
    confidence?: number
  }>
  evidenceSummary?: {
    totalFields: number
    highConfidenceFields: number
    lowConfidenceFields: number
    avgConfidence: number
  }
  policyClauses: Array<{
    clauseId: string
    title: string
    section?: string
    score?: number
  }>
  recommendedActions: string[]
  documentTypes: string[]
}

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true })
}

function getIndex(): Array<{ draftId: string; claimId: string; createdAt: string }> {
  ensureDir()
  if (!fs.existsSync(INDEX_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function saveIndex(index: ReturnType<typeof getIndex>): void {
  ensureDir()
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8')
}

/** Build and save a core system draft from claim data */
export function createDraft(claimData: ClaimData): CoreDraft {
  ensureDir()

  const { claimId, ingestedClaimId, decisionPack } = claimData
  const draftId = `DRAFT-${claimId || `CLM-${Date.now()}`}-${Date.now()}`
  const draft = claimData.decisionPack?.claimDraft
  const policyGrounding = decisionPack?.policyGrounding || []
  const documents = decisionPack?.documents || []
  const policyAssessment = decisionPack?.policyAssessment

  const coreDraft: CoreDraft = {
    draftId,
    claimId: claimId || draftId,
    ingestedClaimId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    claimFields: {
      policyNumber: draft?.policyNumber || '',
      claimantName: draft?.claimantName || '',
      contactEmail: draft?.contactEmail || '',
      contactPhone: draft?.contactPhone,
      lossDate: draft?.lossDate || '',
      lossType: draft?.lossType || 'Other',
      lossLocation: draft?.lossLocation || draft?.location,
      description: draft?.description || '',
      estimatedAmount: draft?.estimatedAmount,
      deductible: draft?.deductible,
      propertyAddress: draft?.propertyAddress,
      vehicleInfo: draft?.vehicleInfo,
    },
    attachments: draft?.attachments || [],
    evidenceSummary: decisionPack?.evidenceSummary,
    policyClauses: policyGrounding.map((p) => ({
      clauseId: p.clauseId,
      title: p.title,
      section: p.section,
      score: p.score ?? p.similarity,
    })),
    recommendedActions: policyAssessment?.recommendedActions || [],
    documentTypes: documents.map((d) => d.type),
  }

  const filePath = path.join(DRAFTS_DIR, `${draftId.replace(/[/\\:]/g, '_')}.json`)
  fs.writeFileSync(filePath, JSON.stringify(coreDraft, null, 2), 'utf-8')

  const index = getIndex()
  index.unshift({ draftId, claimId: coreDraft.claimId, createdAt: coreDraft.createdAt })
  saveIndex(index)

  return coreDraft
}
