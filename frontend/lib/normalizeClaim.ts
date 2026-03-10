/**
 * Normalize backend complaint response to frontend claim shape.
 *
 * Key renames handled here:
 *   complaintId           → claimId
 *   ingestedComplaintId   → ingestedClaimId
 *   decisionPack.complaintDraft     → decisionPack.claimDraft
 *   decisionPack.customerGrounding  → decisionPack.policyGrounding
 *   decisionPack.customerInfo       → decisionPack.policyHolderInfo
 *   decisionPack.resolutionAssessment → decisionPack.policyAssessment
 *     └─ recordsFound     → clausesFound
 *     └─ customerVerified → coverageConfirmed
 *     └─ topMatchScore    → topSimilarityScore
 *   decisionPack.audit    → top-level auditTrail
 *   processingMetrics     → filled with defaults for insurance-era fields
 *   processingSummary     → filled with defaults for missing fields
 */

export type RecordLike = Record<string, unknown>

function mapComplaintDraftToClaimDraft(complaintDraft: RecordLike | null | undefined): RecordLike {
  if (!complaintDraft || typeof complaintDraft !== 'object') return {}
  return {
    ...complaintDraft,
    policyNumber: complaintDraft.policyNumber ?? complaintDraft.complaintRef,
    policyId: complaintDraft.policyId ?? complaintDraft.complaintRef,
    claimantName: complaintDraft.claimantName ?? complaintDraft.customerName,
    contactEmail: complaintDraft.contactEmail ?? complaintDraft.customerEmail,
    lossDate: complaintDraft.lossDate ?? complaintDraft.complaintDate,
    lossType: complaintDraft.lossType ?? complaintDraft.complaintType,
    lossLocation:
      complaintDraft.lossLocation ??
      complaintDraft.location ??
      complaintDraft.propertyAddress ??
      complaintDraft.productOrService,
    location:
      complaintDraft.location ??
      complaintDraft.lossLocation ??
      complaintDraft.propertyAddress ??
      complaintDraft.productOrService,
    propertyAddress: complaintDraft.propertyAddress ?? complaintDraft.productOrService,
  }
}

/**
 * Map resolutionAssessment (backend) → policyAssessment (frontend).
 * Sub-fields are renamed to match the frontend DecisionPack type.
 */
function mapResolutionAssessment(ra: RecordLike | null | undefined): RecordLike | null {
  if (!ra || typeof ra !== 'object') return null
  return {
    ...ra,
    clausesFound:       ra.clausesFound       ?? ra.recordsFound      ?? 0,
    coverageConfirmed:  ra.coverageConfirmed   ?? ra.customerVerified  ?? false,
    topSimilarityScore: ra.topSimilarityScore  ?? ra.topMatchScore     ?? 0,
    recommendedActions: ra.recommendedActions  ?? [],
  }
}

/**
 * Map customerInfo (backend) → policyHolderInfo (frontend).
 * Adds aliases for insurance-era fields the frontend type still references.
 */
function mapCustomerInfo(ci: RecordLike | null | undefined): RecordLike | null {
  if (!ci || typeof ci !== 'object') return null
  return {
    ...ci,
    // Electronics backend sends customer_status; frontend also checks policy_status
    policy_status:  ci.policy_status  ?? ci.customer_status,
    // complaint_ref acts as policy_number
    policy_number:  ci.policy_number  ?? ci.complaint_ref  ?? ci.customer_id,
  }
}

/**
 * Normalize a claim/complaint from the backend so the frontend has claimDraft and consistent field names.
 * Call this on the response from process-complaint or GET complaints/:id.
 */
export function normalizeClaimResponse<T extends RecordLike>(data: T): T {
  if (!data || typeof data !== 'object') return data

  // ── Top-level key renames ────────────────────────────────────────────────
  const claimId         = (data.claimId         ?? data.complaintId)         as string | undefined
  const ingestedClaimId = (data.ingestedClaimId  ?? data.ingestedComplaintId) as string | undefined

  // ── DecisionPack normalization ───────────────────────────────────────────
  const dp = data.decisionPack as RecordLike | undefined
  if (!dp) {
    return {
      ...data,
      claimId,
      ingestedClaimId,
    } as T
  }

  // claimDraft ← complaintDraft
  const complaintDraft    = dp.complaintDraft as RecordLike | undefined
  const existingClaimDraft = dp.claimDraft    as RecordLike | undefined
  const claimDraft =
    existingClaimDraft && Object.keys(existingClaimDraft).length > 0
      ? { ...existingClaimDraft, ...mapComplaintDraftToClaimDraft(complaintDraft) }
      : mapComplaintDraftToClaimDraft(complaintDraft)

  // policyGrounding ← customerGrounding
  const policyGrounding =
    (dp.policyGrounding as unknown[]) ??
    (dp.customerGrounding as unknown[]) ??
    []

  // policyHolderInfo ← customerInfo
  const policyHolderInfo =
    dp.policyHolderInfo != null
      ? mapCustomerInfo(dp.policyHolderInfo as RecordLike)
      : mapCustomerInfo(dp.customerInfo as RecordLike | undefined)

  // policyAssessment ← resolutionAssessment
  const policyAssessment =
    dp.policyAssessment != null
      ? mapResolutionAssessment(dp.policyAssessment as RecordLike)
      : mapResolutionAssessment(dp.resolutionAssessment as RecordLike | undefined)

  // processingSummary — fill defaults for missing fields
  const ps = dp.processingSummary as RecordLike | undefined
  const processingSummary = ps
    ? {
        totalTime:      ps.totalTime      ?? ps.stepsCompleted ?? 0,
        stepsCompleted: ps.stepsCompleted ?? 0,
        stepsWithErrors:ps.stepsWithErrors ?? 0,
        automationLevel:ps.automationLevel ?? 1,
        ...ps,
      }
    : undefined

  // ── auditTrail at top level ← decisionPack.audit ────────────────────────
  const auditTrail = (data.auditTrail as unknown[]) ?? (dp.audit as unknown[]) ?? []

  // ── processingMetrics — fill defaults for insurance-era fields ──────────
  const pm = data.processingMetrics as RecordLike | undefined
  const processingMetrics: RecordLike = {
    totalProcessingTime:    pm?.totalProcessingTime    ?? 0,
    averageHandleTime:      pm?.averageHandleTime      ?? 0,
    fieldsAutoPopulated:    pm?.fieldsAutoPopulated     ?? 0,
    overrideRate:           pm?.overrideRate            ?? 0,
    ragHitRate:             pm?.ragHitRate              ?? 0,
    stepsCompleted:         pm?.stepsCompleted          ?? 0,
    stepsFailed:            pm?.stepsFailed             ?? 0,
    successRate:            pm?.successRate             ?? 1,
    ...(pm ?? {}),
  }

  return {
    ...data,
    claimId,
    ingestedClaimId,
    auditTrail,
    processingMetrics,
    decisionPack: {
      ...dp,
      claimDraft: Object.keys(claimDraft).length ? claimDraft : dp.claimDraft ?? complaintDraft ?? {},
      policyGrounding,
      policyHolderInfo,
      policyAssessment,
      processingSummary,
    },
  } as T
}

/**
 * Get a single draft object for display, from either claimDraft or complaintDraft.
 * Use in components when you don't control the API response.
 */
export function getClaimDraft(decisionPack: RecordLike | null | undefined): RecordLike {
  if (!decisionPack) return {}
  const raw = (decisionPack.claimDraft ?? decisionPack.complaintDraft) as RecordLike | undefined
  if (!raw) return {}
  return mapComplaintDraftToClaimDraft(raw)
}
