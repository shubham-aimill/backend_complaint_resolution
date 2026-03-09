/**
 * GET/POST /api/claims
 * Proxies to FastAPI backend server.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'
import type { ClaimData } from '@/types/claims'

/** GET /api/claims - List processed claim summaries */
export async function GET() {
  try {
    // Proxy to FastAPI server (backend uses complaints)
    const response = await fetch(getApiUrl('api/complaints'), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return NextResponse.json(
        { error: error.detail || 'Failed to list claims' },
        { status: response.status }
      )
    }

    const summaries = await response.json()
    return NextResponse.json(summaries)
  } catch (error) {
    console.error('List claims error:', error)
    return NextResponse.json(
      { error: 'Failed to list claims' },
      { status: 500 }
    )
  }
}

/** POST /api/claims - Save a processed claim */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ClaimData
    if (!body?.decisionPack) {
      return NextResponse.json(
        { error: 'Invalid claim data' },
        { status: 400 }
      )
    }

    // Proxy to FastAPI server (backend uses complaints)
    const response = await fetch(getApiUrl('api/complaints'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return NextResponse.json(
        { error: error.detail || 'Failed to save claim' },
        { status: response.status }
      )
    }

    const result = await response.json()
    return NextResponse.json(result)
  } catch (error) {
    console.error('Save claim error:', error)
    return NextResponse.json(
      { error: 'Failed to save claim' },
      { status: 500 }
    )
  }
}
