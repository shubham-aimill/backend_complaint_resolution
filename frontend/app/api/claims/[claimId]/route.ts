/**
 * GET /api/claims/[claimId]
 * Proxies to FastAPI backend server and normalizes complaintDraft -> claimDraft for frontend.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'
import { normalizeClaimResponse } from '@/lib/normalizeClaim'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ claimId: string }> }
) {
  try {
    const { claimId } = await params
    if (!claimId) {
      return NextResponse.json(
        { error: 'claimId required' },
        { status: 400 }
      )
    }

    // Proxy to FastAPI server (backend uses complaints)
    const encodedClaimId = encodeURIComponent(claimId)
    const response = await fetch(getApiUrl(`api/complaints/${encodedClaimId}`), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return NextResponse.json(
        { error: error.detail || 'Claim not found' },
        { status: response.status }
      )
    }

    const claim = await response.json()
    return NextResponse.json(normalizeClaimResponse(claim))
  } catch (error) {
    console.error('Load claim error:', error)
    return NextResponse.json(
      { error: 'Failed to load claim' },
      { status: 500 }
    )
  }
}
