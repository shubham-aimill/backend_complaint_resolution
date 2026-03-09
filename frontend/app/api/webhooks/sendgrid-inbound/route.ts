/**
 * SendGrid Inbound Parse Webhook
 * Delegates to backend ingested_complaints save-webhook (Python).
 */
import { NextRequest, NextResponse } from 'next/server'
import { runPython } from '@/lib/backend'

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    const from = (formData.get('from') as string) || ''
    const to = (formData.get('to') as string) || ''
    const subject = (formData.get('subject') as string) || ''
    const text = (formData.get('text') as string) || ''
    const html = (formData.get('html') as string) || ''
    const emailBody = text || (html ? stripHtml(html) : '')

    const attachmentCount = parseInt((formData.get('attachments') as string) || '0', 10)
    const attachmentFiles: Array<{ name: string; buffer: string; mimeType: string }> = []

    for (let i = 1; i <= attachmentCount; i++) {
      const file = formData.get(`attachment${i}`) as File | null
      if (file && file instanceof File && file.size > 0) {
        const buffer = Buffer.from(await file.arrayBuffer())
        attachmentFiles.push({
          name: file.name || `attachment-${i}`,
          buffer: buffer.toString('base64'),
          mimeType: file.type || 'application/octet-stream',
        })
      }
    }

    const payload = JSON.stringify({
      from,
      to,
      subject,
      emailBody,
      attachmentFiles,
    })

    const stdout = await runPython('backend.ingested_complaints', ['save-webhook'], payload)
    const result = JSON.parse(stdout.trim())
    return NextResponse.json(
      {
        success: true,
        claimId: result.complaintId ?? result.claimId,
        policyNumber: result.complaintRef ?? result.policyNumber,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('SendGrid Inbound Parse error:', error)
    return NextResponse.json(
      { error: 'Failed to process incoming email' },
      { status: 500 }
    )
  }
}
