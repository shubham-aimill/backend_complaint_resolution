/**
 * GET /api/ingested-claims/[id]/attachments?name=filename.jpg
 * Serves attachment file. Uses backend to get claim, then reads file from path.
 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { runPython } from '@/lib/backend'

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

    const stdout = await runPython('backend.ingested_complaints', ['get', id])
    const trimmed = stdout.trim()
    if (trimmed === 'null') {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
    }

    const claim = JSON.parse(trimmed)
    const att = claim.attachments?.find((a: { name: string }) => a.name === name)
    if (!att || !att.path) {
      return NextResponse.json(
        { error: 'Attachment not found' },
        { status: 404 }
      )
    }

    const projectRoot = path.resolve(process.cwd(), '..')
    const backendModified = path.join(projectRoot, 'backend_modified')
    const filePath = path.isAbsolute(att.path)
      ? att.path
      : path.resolve(backendModified, att.path)

    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: 'Attachment file not found' },
        { status: 404 }
      )
    }

    const ext = path.extname(att.name).toLowerCase()
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
    const isImage =
      imageExts.includes(ext) ||
      (att.mimeType || '').startsWith('image/')
    if (!isImage) {
      return NextResponse.json(
        { error: 'Not an image attachment' },
        { status: 400 }
      )
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
    return NextResponse.json(
      { error: 'Failed to serve attachment' },
      { status: 500 }
    )
  }
}
