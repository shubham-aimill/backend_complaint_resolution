/**
 * GET /api/sync-inbox/stream
 * Proxies to FastAPI SSE stream for sync progress (total/done/counts).
 */
import { NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'

export async function GET() {
  try {
    const res = await fetch(getApiUrl('api/sync-inbox/stream'), {
      method: 'GET',
      cache: 'no-store',
    })
    if (!res.ok || !res.body) {
      return NextResponse.json(
        { error: res.statusText || 'Stream failed' },
        { status: res.status }
      )
    }
    return new Response(res.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Sync stream error:', error)
    return NextResponse.json(
      { error: 'Failed to connect to backend' },
      { status: 502 }
    )
  }
}
