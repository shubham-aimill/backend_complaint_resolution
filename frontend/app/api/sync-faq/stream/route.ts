import { NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'

export async function GET() {
  try {
    const res = await fetch(getApiUrl('api/sync-faq/stream'), {
      cache: 'no-store',
      headers: { Accept: 'text/event-stream' },
    })
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: 'FAQ sync stream failed' }, { status: 500 })
    }
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch {
    return NextResponse.json({ error: 'FAQ sync stream failed' }, { status: 500 })
  }
}
