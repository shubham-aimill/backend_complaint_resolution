/**
 * POST /api/send-email
 * Sends an email using SMTP (Gmail) with SENDER_EMAIL and EMAIL_PASSWORD from .env
 */
import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

const SENDER_EMAIL = process.env.SENDER_EMAIL || process.env.MAIL_USERNAME || ''
const EMAIL_PASSWORD = (process.env.EMAIL_PASSWORD || process.env.MAIL_PASSWORD || '').replace(/\s/g, '')

function createTransporter() {
  if (!SENDER_EMAIL || !EMAIL_PASSWORD) {
    throw new Error('Mail credentials not configured. Set SENDER_EMAIL and EMAIL_PASSWORD in .env')
  }
  const isGmail = SENDER_EMAIL.toLowerCase().includes('gmail.com')
  if (isGmail) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: SENDER_EMAIL,
        pass: EMAIL_PASSWORD,
      },
    })
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: SENDER_EMAIL,
      pass: EMAIL_PASSWORD,
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { to, subject, body: emailBody } = body

    if (!to || typeof to !== 'string') {
      return NextResponse.json({ error: 'Recipient email (to) is required' }, { status: 400 })
    }
    if (!emailBody || typeof emailBody !== 'string') {
      return NextResponse.json({ error: 'Email body is required' }, { status: 400 })
    }

    const finalSubject = subject && typeof subject === 'string' ? subject : 'Claim Correspondence'

    if (!SENDER_EMAIL || !EMAIL_PASSWORD) {
      return NextResponse.json(
        { error: 'Mail credentials not configured. Set SENDER_EMAIL and EMAIL_PASSWORD in .env' },
        { status: 503 }
      )
    }

    const transporter = createTransporter()
    const info = await transporter.sendMail({
      from: `"Claims Department" <${SENDER_EMAIL}>`,
      to: to.trim(),
      subject: finalSubject,
      text: emailBody,
      html: emailBody.replace(/\n/g, '<br>'),
    })

    return NextResponse.json({
      success: true,
      messageId: info.messageId,
      message: 'Email sent successfully',
    })
  } catch (err) {
    console.error('Send email error:', err)
    const message = err instanceof Error ? err.message : 'Failed to send email'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
