/**
 * POST /api/decision-pack/pdf
 * Generates a structured PDF of the Decision Pack including Claim Status.
 * Uses jsPDF (no external font files) for compatibility with serverless/bundled environments.
 */
import { NextRequest, NextResponse } from 'next/server'
import { jsPDF } from 'jspdf'
import { normalizeClaimResponse, getClaimDraft } from '@/lib/normalizeClaim'

interface PdfRequestBody {
  claimData: {
    claimId?: string
    decisionPack?: {
      claimDraft?: Record<string, unknown>
      evidence?: Array<{ field: string; value: string; confidence: number }>
      documents?: Array<{ name: string; type?: string }>
      policyGrounding?: Array<{
        clauseId: string
        title: string
        content?: string
        snippet?: string
        score?: number
        similarity?: number
        rationale?: string
      }>
      evidenceSummary?: { totalFields: number; highConfidenceFields: number }
    }
  }
  claimStatus: 'pending' | 'accepted' | 'rejected'
}

const MARGIN = 20
const LINE_HEIGHT = 6
const PAGE_HEIGHT = 297

function addSectionTitle(doc: jsPDF, title: string, y: number): number {
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(3, 105, 161)
  doc.text(title, MARGIN, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(51, 65, 85)
  return y + LINE_HEIGHT
}

function addKeyValue(doc: jsPDF, key: string, value: unknown, y: number): number {
  const str = value != null && value !== '' ? String(value) : '—'
  doc.text(`${key}: ${str}`, MARGIN + 5, y)
  return y + LINE_HEIGHT
}

function addText(doc: jsPDF, text: string, x: number, y: number, maxWidth: number): number {
  const lines = doc.splitTextToSize(text, maxWidth)
  doc.text(lines, x, y)
  return y + lines.length * LINE_HEIGHT
}

/** Add text with automatic page breaks when content overflows */
function addTextWithPageBreaks(doc: jsPDF, text: string, x: number, y: number, maxWidth: number): number {
  const lines = doc.splitTextToSize(text, maxWidth)
  const bottomMargin = MARGIN + 20

  for (const line of lines) {
    if (y > PAGE_HEIGHT - bottomMargin) {
      doc.addPage()
      y = MARGIN
    }
    doc.text(line, x, y)
    y += LINE_HEIGHT
  }
  return y
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PdfRequestBody
    const { claimData, claimStatus = 'pending' } = body || {}

    if (!claimData?.decisionPack) {
      return NextResponse.json({ error: 'claimData with decisionPack is required' }, { status: 400 })
    }

    const normalized = normalizeClaimResponse(claimData as Record<string, unknown>)
    const pack = normalized.decisionPack as Record<string, unknown> | undefined
    const claimDraft = getClaimDraft(pack) as Record<string, unknown>

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    let y = 20

    const claimId = (normalized.claimId ?? claimData.claimId) || 'N/A'
    const evidence = (pack?.evidence || []) as Array<{ field: string; value: string; confidence: number }>
    const documents = (pack?.documents || []) as Array<{ name: string; type?: string }>
    const policyGrounding = (pack?.policyGrounding || []) as Array<{ clauseId: string; title: string; content?: string; snippet?: string; score?: number; similarity?: number; rationale?: string }>
    const evidenceSummary = pack?.evidenceSummary as { totalFields: number; highConfidenceFields: number } | undefined
    const maxWidth = 210 - MARGIN * 2

    // Header
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text('Decision Pack', MARGIN, y)
    y += 8

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 139)
    doc.text(`Claim ID: ${claimId}`, MARGIN, y)
    y += 5
    doc.text(`Generated: ${new Date().toLocaleString()}`, MARGIN, y)
    y += 10

    // Claim Status – prominent
    const statusText = claimStatus === 'accepted' ? 'Accepted' : claimStatus === 'rejected' ? 'Rejected' : 'Pending'
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    if (claimStatus === 'accepted') doc.setTextColor(4, 120, 87)
    else if (claimStatus === 'rejected') doc.setTextColor(185, 28, 28)
    else doc.setTextColor(100, 116, 139)
    doc.text(`Claim Status: ${statusText}`, MARGIN, y)
    doc.setTextColor(51, 65, 85)
    y += 10

    // Claim Summary
    y = addSectionTitle(doc, 'Claim Summary', y)
    y = addKeyValue(doc, 'Policy', claimDraft.policyNumber || claimDraft.policyId, y)
    y = addKeyValue(doc, 'Claimant', claimDraft.claimantName, y)
    y = addKeyValue(doc, 'Loss Date', claimDraft.lossDate, y)
    y = addKeyValue(doc, 'Loss Type', claimDraft.lossType, y)
    y = addKeyValue(doc, 'Location', claimDraft.lossLocation || claimDraft.location || claimDraft.propertyAddress, y)
    if (claimDraft.deductible != null) y = addKeyValue(doc, 'Deductible', `$${claimDraft.deductible}`, y)
    y += 5

    // Evidence Summary
    y = addSectionTitle(doc, 'Evidence Summary', y)
    y = addKeyValue(doc, 'Documents Attached', documents.length, y)
    y = addKeyValue(doc, 'Fields Extracted', evidence.length, y)
    if (evidenceSummary) {
      y = addKeyValue(doc, 'High Confidence Fields', evidenceSummary.highConfidenceFields, y)
    }
    y += 5

    // Policy Grounding
    if (policyGrounding.length > 0) {
      y = addSectionTitle(doc, 'Policy Grounding', y)
      y = addKeyValue(doc, 'Clauses Found', policyGrounding.length, y)
      y = addKeyValue(doc, 'Coverage', claimDraft.coverageFound ? 'Confirmed' : 'Under Review', y)
      y += 3

      for (const policy of policyGrounding) {
        if (y > PAGE_HEIGHT - 50) {
          doc.addPage()
          y = MARGIN
        }
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.setTextColor(12, 74, 110)
        y = addText(doc, `${policy.clauseId} – ${policy.title}`, MARGIN + 5, y, maxWidth - 5)
        doc.setFont('helvetica', 'normal')
        const score = policy.score ?? policy.similarity ?? 0
        doc.text(`Match: ${Math.round(score * 100)}%`, MARGIN + 5, y)
        y += LINE_HEIGHT
        const content = policy.content || policy.snippet || ''
        if (content) {
          doc.setFontSize(9)
          doc.setTextColor(71, 85, 105)
          y = addTextWithPageBreaks(doc, content, MARGIN + 10, y, maxWidth - 10)
          doc.setTextColor(51, 65, 85)
        }
        if (policy.rationale) {
          if (y > PAGE_HEIGHT - 50) {
            doc.addPage()
            y = MARGIN
          }
          doc.setFontSize(8)
          doc.setTextColor(148, 163, 184)
          doc.setFont('helvetica', 'italic')
          y = addTextWithPageBreaks(doc, `Rationale: ${policy.rationale}`, MARGIN + 10, y, maxWidth - 10)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(51, 65, 85)
        }
        y += 5
      }
    }

    const buffer = doc.output('arraybuffer')
    const filename = `Decision-Pack-${claimId.replace(/[/\\?%*:|"<>]/g, '-')}.pdf`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
      },
    })
  } catch (err) {
    console.error('PDF generation error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate PDF' },
      { status: 500 }
    )
  }
}
