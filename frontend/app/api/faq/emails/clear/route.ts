import { NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'

export async function POST() {
  try {
    const res = await fetch(getApiUrl('api/faq/emails/clear'), { method: 'POST' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.detail || 'Failed to clear FAQ emails' }, { status: res.status })
    }
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ error: 'Backend not reachable' }, { status: 503 })
  }
}
