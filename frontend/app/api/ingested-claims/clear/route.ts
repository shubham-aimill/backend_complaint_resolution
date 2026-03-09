/**
 * POST /api/ingested-claims/clear
 * Proxies to FastAPI backend server.
 */
import { NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'

export async function POST() {
  try {
    // Proxy to FastAPI server (backend uses ingested-complaints)
    const response = await fetch(getApiUrl('api/ingested-complaints/clear'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return NextResponse.json(
        { error: error.detail || 'Failed to clear claims' },
        { status: response.status }
      )
    }

    const result = await response.json()
    return NextResponse.json(result)
  } catch (error) {
    console.error('Clear ingested claims error:', error)
    return NextResponse.json(
      { error: 'Failed to clear claims' },
      { status: 500 }
    )
  }
}
