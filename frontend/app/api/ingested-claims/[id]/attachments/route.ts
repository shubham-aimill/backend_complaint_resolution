/**
 * GET /api/ingested-claims/[id]/attachments?name=filename.jpg
 * Fetches the ingested complaint from FastAPI, then reads the attachment from disk.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiUrl } from '@/lib/api-config'
import fs from 'fs'
import path from 'path'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const name = request.nextUrl.searchParams.get('name')
    if (!name) {
      return NextResponse.json(
        { error: 'name query parameter required' },
        { status: 400 }
      )
    }

    const encodedId = encodeURIComponent(id)
    const response = await fetch(getApiUrl(`api/ingested-complaints/${encodedId}`), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Complaint not found' }, { status: 404 })
    }

    const claim = await response.json()
    const att = claim.attachments?.find((a: { name: string }) => a.name === name)
    if (!att || !att.path) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }

    const projectRoot = path.resolve(process.cwd(), '..')
    const backendModified = path.join(projectRoot, 'backend_modified')
    const filePath = path.isAbsolute(att.path)
      ? att.path
      : path.resolve(backendModified, att.path)

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Attachment file not found' }, { status: 404 })
    }

    const ext = path.extname(att.name).toLowerCase()
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
    const isImage = imageExts.includes(ext) || (att.mimeType || '').startsWith('image/')
    if (!isImage) {
      return NextResponse.json({ error: 'Not an image attachment' }, { status: 400 })
    }

    const buffer = fs.readFileSync(filePath)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': att.mimeType || 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    console.error('Attachment serve error:', error)
    return NextResponse.json({ error: 'Failed to serve attachment' }, { status: 500 })
  }
}
