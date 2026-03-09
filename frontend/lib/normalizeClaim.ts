/**
 * Normalize backend complaint response to frontend claim shape.
 * Backend uses complaintDraft (complaintRef, customerName, complaintType, etc.);
 * frontend expects claimDraft (policyNumber, claimantName, lossType, etc.).
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
    lossLocation: complaintDraft.lossLocation ?? complaintDraft.location ?? complaintDraft.propertyAddress ?? complaintDraft.productOrService,
    location: complaintDraft.location ?? complaintDraft.lossLocation ?? complaintDraft.propertyAddress ?? complaintDraft.productOrService,
    propertyAddress: complaintDraft.propertyAddress ?? complaintDraft.productOrService,
  }
}

/**
 * Normalize a claim/complaint from the backend so the frontend has claimDraft and consistent field names.
 * Call this on the response from process-complaint or GET complaints/:id.
 */
export function normalizeClaimResponse<T extends RecordLike>(data: T): T {
  if (!data || typeof data !== 'object') return data
  const dp = data.decisionPack as RecordLike | undefined
  if (!dp) return data

  const complaintDraft = dp.complaintDraft as RecordLike | undefined
  const existingClaimDraft = dp.claimDraft as RecordLike | undefined
  const claimDraft =
    existingClaimDraft && Object.keys(existingClaimDraft).length > 0
      ? { ...existingClaimDraft, ...mapComplaintDraftToClaimDraft(complaintDraft) }
      : mapComplaintDraftToClaimDraft(complaintDraft)

  return {
    ...data,
    decisionPack: {
      ...dp,
      claimDraft: Object.keys(claimDraft).length ? claimDraft : dp.claimDraft ?? complaintDraft ?? {},
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
