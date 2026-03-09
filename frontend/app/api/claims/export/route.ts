/**
 * GET /api/claims/export
 * Delegates to backend dashboard (Python) for CSV export.
 */
import { NextResponse } from 'next/server'
import { runPython } from '@/lib/backend'

const CSV_HEADERS =
  'claimId,ingestedClaimId,policyNumber,claimantName,contactEmail,contactPhone,lossDate,lossType,lossLocation,description,status,createdAt\n'

export async function GET() {
  try {
    const csv = await runPython('backend.dashboard', ['csv'])
    const content = csv.trim() || CSV_HEADERS
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="claims-history.csv"',
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
