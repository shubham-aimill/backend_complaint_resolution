/**
 * POST /api/sync-inbox
 * Proxies to FastAPI backend server.
 */
import { NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'

export async function POST() {
  try {
    // Proxy to FastAPI server
    const response = await fetch(getApiUrl('api/sync-inbox'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return NextResponse.json(
        {
          success: false,
          ingested: 0,
          scanned: 0,
          skippedNoFnol: 0,
          skippedDuplicate: 0,
          errors: [error.detail || String(error)],
        },
        { status: response.status }
      )
    }

    const result = await response.json()
    return NextResponse.json({
      success: result.success,
      ingested: result.ingested,
      scanned: result.scanned,
      skippedNoFnol: result.skippedNoFnol ?? result.skippedNoComplaint ?? 0,
      skippedDuplicate: result.skippedDuplicate ?? 0,
      errors: result.errors ?? [],
      hint: result.hint,
    })
  } catch (error) {
    console.error('Sync inbox error:', error)
    return NextResponse.json(
      {
        success: false,
        ingested: 0,
        scanned: 0,
        skippedNoFnol: 0,
        skippedDuplicate: 0,
        errors: [String(error)],
      },
      { status: 500 }
    )
  }
}
