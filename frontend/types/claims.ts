export type ProcessingStage = 'home' | 'review' | 'decision' | 'dashboard'

export interface ProcessedClaimSummary {
  claimId: string
  ingestedClaimId?: string
  policyNumber?: string
  claimantName?: string
  createdAt: string
}

export type DocumentType = 'PoliceReport' | 'RepairEstimate' | 'DamagePhoto' | 'Invoice' | 'MedicalRecord' | 'IncidentReport' | 'Other' | 'CorrespondenceRecord' | 'PhotoEvidence' | 'Receipt' | 'Screenshot' | 'ContractOrAgreement'

export type LossType = 'Collision' | 'Water' | 'Fire' | 'Theft' | 'Liability' | 'Other' | 'AutoCollision' | 'PropertyDamage'

export interface Document {
  id: string
  name: string
  mimeType: string
  type: DocumentType
  content?: string
  keyFields?: Record<string, any>
  confidence: number
  sourceUrl?: string
  metadata?: Record<string, any>
}

export interface FieldEvidence {
  field: string
  fieldName?: string
  value: string
  confidence: number
  sourceLocator: string | {
    docId: string
    textOffsets?: [number, number]
    page?: number
    boundingBox?: [number, number, number, number]
  }
  rationale: string
}

export interface PolicyHit {
  clauseId: string
  title: string
  snippet?: string
  content?: string
  score?: number
  similarity?: number
  sourceRef?: string
  sourceDocument?: string
  section?: string
  rationale: string
}

export interface AuditEvent {
  step: string
  timestamp: string
  duration: number
  agent?: string
  status: 'completed' | 'failed' | 'completed_with_fallback'
  details?: Record<string, any>
  modelVersion?: string
  success?: boolean
  fallbackUsed?: boolean
  error?: string
}

export interface ClaimDraft {
  id?: string
  policyId?: string
  policyNumber?: string
  claimantName: string
  contactEmail: string
  contactPhone?: string
  lossDate: string
  lossType: LossType
  lossLocation?: string
  description: string
  location?: string
  estimatedAmount?: number
  vehicleInfo?: Record<string, any>
  propertyAddress?: string
  attachments: Array<{
    id: string
    name: string
    type?: string
    mimeType: string
    confidence?: number
  }>
  deductible?: number
  coverageFound?: boolean
  createdAt?: string
  source?: string
  confidence?: number
}

export interface PolicyHolderInfo {
  // Core customer fields (electronics backend)
  customer_id?: string
  first_name?: string
  last_name?: string
  full_name?: string
  email_id?: string
  phone_number?: string
  address_line1?: string
  address_line2?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
  customer_since?: string
  customer_status?: string
  loyalty_tier?: string
  total_complaints?: number
  open_complaints?: number
  preferred_contact?: string
  complaint_ref?: string
  complaint_id?: string
  product_id?: string
  complaint_type?: string
  current_status?: string
  priority_level?: string
  severity_level?: string
  is_escalated?: boolean
  assigned_team?: string
  sla_hours?: number
  // Aliases / insurance-era fields (mapped by normalizeClaim.ts)
  policy_number?: string
  policy_status?: string
  // Insurance-specific (not populated by electronics backend, kept for type compat)
  risk_profile?: string
  credit_score?: number
  policy_type?: string
  effective_date?: string
  expiration_date?: string
  premium_amount?: number
  premium_frequency?: string
  payment_status?: string
  total_coverage_limit?: number
  aggregate_deductible?: number
  carrier_name?: string
  agent_name?: string
  agent_contact?: string
}

export interface DecisionPack {
  id?: string
  claimDraft: ClaimDraft
  evidence: FieldEvidence[]
  documents: Document[]
  policyGrounding: PolicyHit[]
  policyHolderInfo?: PolicyHolderInfo
  audit: AuditEvent[]
  evidenceSummary?: {
    totalFields: number
    highConfidenceFields: number
    lowConfidenceFields: number
    avgConfidence: number
  }
  documentAnalysis?: {
    totalDocuments: number
    documentTypes: string[]
    avgDocumentConfidence: number
    missingDocuments: string[]
    presentDocuments?: string[]
  }
  policyAssessment?: {
    clausesFound: number
    coverageConfirmed: boolean
    topSimilarityScore: number
    recommendedActions: string[]
    // Raw backend fields (also present after normalization)
    recordsFound?: number
    customerVerified?: boolean
    topMatchScore?: number
    autoDecision?: string
    decisionConfidence?: number
  }
  processingSummary?: {
    totalTime: number
    stepsCompleted: number
    stepsWithErrors: number
    automationLevel: number
  }
  createdAt?: string

  // ── Electronics-specific fields from backend ────────────────────────────
  /** Current warranty status: WITHIN_WARRANTY | OUT_OF_WARRANTY | UNKNOWN */
  warrantyStatus?: string
  /** Product category detected (Smartphone, Laptop, etc.) */
  productCategory?: string
  /** Matched product from product catalogue */
  matchedProduct?: {
    productId?: string
    productName?: string
    brandName?: string
    modelNumber?: string
    price?: number
  }
  /** Full validation results from warranty, document, product, eligibility checks */
  validationResults?: Array<{
    check: string
    passed: boolean
    autoDecision?: string
    rejectReason?: string
    notes?: string
    [key: string]: unknown
  }>
  /** Final decision code */
  autoDecision?: string
  /** Decision confidence score (0–1) */
  decisionConfidence?: number
  /** Human-readable rationale for the decision */
  decisionRationale?: string
  /** Recommended next step for the agent */
  recommendedNextStep?: string
  /** Specific reason for desk rejection */
  rejectReason?: string
}

export interface ProcessingMetrics {
  totalProcessingTime: number
  averageHandleTime: number
  fieldsAutoPopulated: number
  overrideRate: number
  ragHitRate: number
  stepsCompleted: number
  stepsFailed: number
  successRate: number
}

export interface ClaimData {
  claimId?: string
  ingestedClaimId?: string
  /** Email address of the original FNOL sender (ingested claim 'from' field) */
  sourceEmailFrom?: string
  decisionPack: DecisionPack
  auditTrail: AuditEvent[]
  processingMetrics: ProcessingMetrics
  createdAt: string
  status: string

  // ── Electronics-specific top-level fields ─────────────────────────────
  /** Final auto-decision code (APPROVE_REPAIR | APPROVE_REPLACEMENT | DESK_REJECT | etc.) */
  autoDecision?: string
  /** Decision confidence score (0–1) */
  decisionConfidence?: number
  /** Recommended next step for the handling agent */
  recommendedNextStep?: string
  /** Warranty status: WITHIN_WARRANTY | OUT_OF_WARRANTY | UNKNOWN */
  warrantyStatus?: string
  /** Product category detected */
  productCategory?: string
  /** Specific reason for desk rejection */
  rejectReason?: string

  // ── Email threading fields (from original ingested complaint) ────────────
  /** RFC822 Message-ID of the original inbound email — used for In-Reply-To */
  messageId?: string
  /** Root thread ID of the email chain — used for References header */
  threadId?: string

  // Legacy compatibility
  processingTime?: number
  autoPopulatedFields?: number
  totalFields?: number
  ragHitRate?: number
  overrideRate?: number
}