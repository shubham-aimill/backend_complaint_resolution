import { NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'

export async function POST() {
  try {
    const res = await fetch(getApiUrl('api/sync-faq'), { method: 'POST', cache: 'no-store' })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'FAQ sync failed' }, { status: 500 })
  }
}
