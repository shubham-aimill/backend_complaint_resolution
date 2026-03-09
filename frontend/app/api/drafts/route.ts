/**
 * POST /api/drafts
 * Creates a core system draft incorporating extracted claim details.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createDraft } from '@/lib/drafts'
import { normalizeClaimResponse } from '@/lib/normalizeClaim'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const normalized = normalizeClaimResponse(body)
    if (!normalized?.decisionPack?.claimDraft) {
      return NextResponse.json(
        { error: 'Invalid claim data - decisionPack.claimDraft or complaintDraft required' },
        { status: 400 }
      )
    }

    const draft = createDraft(normalized as import('@/types/claims').ClaimData)

    return NextResponse.json({
      success: true,
      draftId: draft.draftId,
      claimId: draft.claimId,
      draft,
      message: 'Draft created in core system with extracted details',
    })
  } catch (error) {
    console.error('Create draft error:', error)
    return NextResponse.json(
      { error: 'Failed to create draft', details: String(error) },
      { status: 500 }
    )
  }
}
