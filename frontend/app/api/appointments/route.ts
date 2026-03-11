/**
 * POST /api/appointments  — Book an engineer visit appointment
 * GET  /api/appointments  — List appointments (optional ?complaintId=xxx filter)
 * Proxies to FastAPI backend.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { complaintId, date, time, engineerName, location, notes } = body

    if (!complaintId || !date || !time || !engineerName || !location) {
      return NextResponse.json(
        { error: 'complaintId, date, time, engineerName and location are required' },
        { status: 400 }
      )
    }

    const response = await fetch(getApiUrl('api/appointments'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ complaintId, date, time, engineerName, location, notes }),
    })

    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || 'Failed to book appointment' },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Book appointment error:', error)
    return NextResponse.json({ error: 'Failed to book appointment' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const complaintId = request.nextUrl.searchParams.get('complaintId')
    const url = complaintId
      ? getApiUrl(`api/appointments?complaintId=${encodeURIComponent(complaintId)}`)
      : getApiUrl('api/appointments')

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || 'Failed to fetch appointments' },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('List appointments error:', error)
    return NextResponse.json({ error: 'Failed to fetch appointments' }, { status: 500 })
  }
}
