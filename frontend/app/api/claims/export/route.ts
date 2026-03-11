/**
 * GET /api/claims/export
 * Proxies to FastAPI backend for CSV export of all processed complaints.
 */
import { NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'

export async function GET() {
  try {
    const response = await fetch(getApiUrl('api/complaints/export/csv'), {
      method: 'GET',
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return NextResponse.json(
        { error: (error as { detail?: string }).detail || 'Failed to export CSV' },
        { status: response.status }
      )
    }

    const csv = await response.text()
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="complaints-history.csv"',
      },
    })
  } catch (error) {
    console.error('Export CSV error:', error)
    return NextResponse.json(
      { error: 'Failed to export CSV' },
      { status: 500 }
    )
  }
}
