/**
 * GET /api/faq
 * Returns all FAQ entries from FAQ.csv via FastAPI backend.
 */
import { NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'

export async function GET() {
  try {
    const res = await fetch(getApiUrl('api/faq'), {
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.detail || 'Failed to fetch FAQs' }, { status: res.status })
    }
    return NextResponse.json(await res.json())
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    const offline = err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')
    return NextResponse.json(
      { error: offline ? 'Backend not reachable' : 'Failed to fetch FAQs' },
      { status: offline ? 503 : 500 }
    )
  }
}
