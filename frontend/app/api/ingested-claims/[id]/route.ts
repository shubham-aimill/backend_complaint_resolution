/**
 * GET /api/ingested-claims/[id]
 * Proxies to FastAPI backend server.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json(
        { error: 'Claim ID required' },
        { status: 400 }
      )
    }

    // Proxy to FastAPI server (backend uses ingested-complaints)
    const encodedId = encodeURIComponent(id)
    const response = await fetch(getApiUrl(`api/ingested-complaints/${encodedId}`), {
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
    return NextResponse.json(claim)
  } catch (error) {
    console.error('Error fetching claim:', error)
    return NextResponse.json(
      { error: 'Failed to fetch claim' },
      { status: 500 }
    )
  }
}
