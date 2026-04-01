/**
 * GET /api/faq/emails
 * Returns ingested emails that are FAQ queries (not complaints).
 */
import { NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'

export async function GET() {
  try {
    const res = await fetch(getApiUrl('api/faq/emails'), {
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.detail || 'Failed to fetch FAQ emails' }, { status: res.status })
    }
    return NextResponse.json(await res.json())
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    const offline = err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')
    return NextResponse.json(
      { error: offline ? 'Backend not reachable' : 'Failed to fetch FAQ emails' },
      { status: offline ? 503 : 500 }
    )
  }
}
