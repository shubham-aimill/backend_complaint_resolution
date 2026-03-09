/**
 * GET /api/dashboard/kpis
 * Proxies to FastAPI backend and normalizes to camelCase for frontend.
 */
import { NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'

export async function GET() {
  try {
    const response = await fetch(getApiUrl('api/dashboard/kpis'), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return NextResponse.json(
        { error: error.detail || 'Failed to load dashboard KPIs' },
        { status: response.status }
      )
    }

    const raw = await response.json()
    const recent = raw.recentComplaints ?? raw.recentClaims ?? []
    const kpis = {
      totalClaims: raw.totalClaims ?? raw.totalComplaints ?? 0,
      claimsThisWeek: raw.claimsThisWeek ?? raw.complaintsThisWeek ?? 0,
      claimsThisMonth: raw.claimsThisMonth ?? raw.complaintsThisMonth ?? 0,
      claimsByLossType: raw.claimsByLossType ?? raw.complaintsByType ?? {},
      coverageMatchRate: raw.coverageMatchRate ?? 0,
      avgConfidence: raw.avgConfidence ?? raw.avgResolutionConfidence ?? 0,
      totalDocumentsProcessed: raw.totalDocumentsProcessed ?? raw.totalComplaints ?? 0,
      claimsByDate: raw.claimsByDate ?? raw.complaintsByDate ?? [],
      recentClaims: recent.map((c: Record<string, unknown>) => ({
        claimId: c.claimId ?? c.complaintId,
        policyNumber: c.policyNumber ?? c.customerRef,
        claimantName: c.claimantName ?? c.customerName,
        lossType: c.lossType ?? c.complaintType ?? 'Other',
        createdAt: c.createdAt ?? '',
        policyMatches: c.policyMatches ?? 0,
      })),
      complaintsByDecision: raw.complaintsByDecision ?? {},
      warrantyStatusCounts: raw.warrantyStatusCounts ?? {},
      complaintsByCategory: raw.complaintsByCategory ?? {},
      autoEmailsSent: raw.autoEmailsSent ?? 0,
      autoEmailsAttempted: raw.autoEmailsAttempted ?? 0,
    }
    return NextResponse.json(kpis)
  } catch (error) {
    console.error('Dashboard KPIs error:', error)
    return NextResponse.json(
      { error: 'Failed to load dashboard KPIs' },
      { status: 500 }
    )
  }
}
