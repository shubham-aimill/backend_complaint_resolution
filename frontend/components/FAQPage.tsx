'use client'

import { useEffect, useState } from 'react'
import { HelpCircle, Mail, ChevronDown, ChevronUp, RefreshCw, AlertCircle, Tag, Inbox } from 'lucide-react'

interface FaqEntry {
  question: string
  answer: string
  category: string
}

interface FaqEmail {
  id: string
  from?: string
  subject?: string
  emailBody?: string
  createdAt?: string
  matchedFaq: FaqEntry | null
}

function formatDate(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function avatarInitial(str?: string) {
  return (str ?? '?').trim().charAt(0).toUpperCase()
}

export default function FAQPage() {
  const [faqs, setFaqs] = useState<FaqEntry[]>([])
  const [emails, setEmails] = useState<FaqEmail[]>([])
  const [loadingFaqs, setLoadingFaqs] = useState(true)
  const [loadingEmails, setLoadingEmails] = useState(true)
  const [error, setError] = useState('')
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)
  const [selectedEmail, setSelectedEmail] = useState<FaqEmail | null>(null)
  const [activeTab, setActiveTab] = useState<'faqs' | 'emails'>('emails')

  const fetchFaqs = async () => {
    setLoadingFaqs(true)
    try {
      const res = await fetch('/api/faq')
      if (!res.ok) throw new Error('Failed to load FAQs')
      setFaqs(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load FAQs')
    } finally {
      setLoadingFaqs(false)
    }
  }

  const fetchEmails = async () => {
    setLoadingEmails(true)
    try {
      const res = await fetch('/api/faq/emails')
      if (!res.ok) throw new Error('Failed to load FAQ emails')
      setEmails(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load FAQ emails')
    } finally {
      setLoadingEmails(false)
    }
  }

  useEffect(() => {
    fetchFaqs()
    fetchEmails()
  }, [])

  const categories = Array.from(new Set(faqs.map(f => f.category).filter(Boolean)))

  return (
    <div className="flex flex-col h-[calc(100vh-68px)] overflow-hidden bg-[#F8FAFC]">

      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#E5E7EB] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-[#FEF2F2]">
            <HelpCircle className="w-4 h-4 text-[#991B1B]" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-[#111827]">FAQ Centre</h1>
            <p className="text-[11px] text-[#9CA3AF] font-medium">
              {loadingFaqs ? 'Loading…' : `${faqs.length} FAQ entries · ${emails.length} matching emails`}
            </p>
          </div>
        </div>
        <button
          onClick={() => { fetchFaqs(); fetchEmails() }}
          disabled={loadingFaqs || loadingEmails}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] hover:bg-[#FEE2E2] rounded-lg transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${(loadingFaqs || loadingEmails) ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-3 flex-shrink-0">
        {(['emails', 'faqs'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === tab
                ? 'bg-[#991B1B] text-white'
                : 'bg-white text-[#6B7280] border border-[#E5E7EB] hover:bg-[#F9FAFB]'
            }`}
          >
            {tab === 'emails' ? (
              <span className="flex items-center gap-1.5"><Inbox className="w-3.5 h-3.5" />FAQ Emails {emails.length > 0 && `(${emails.length})`}</span>
            ) : (
              <span className="flex items-center gap-1.5"><HelpCircle className="w-3.5 h-3.5" />FAQ Entries {faqs.length > 0 && `(${faqs.length})`}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0 overflow-hidden mt-3">

        {activeTab === 'emails' ? (
          /* ── FAQ Emails: two-panel ── */
          <>
            {/* Left: email list */}
            <div className="w-[340px] flex-shrink-0 border-r border-[#E5E7EB] bg-white flex flex-col overflow-y-auto">
              {loadingEmails ? (
                <div className="flex items-center justify-center flex-1 text-xs text-[#9CA3AF]">Loading…</div>
              ) : emails.length === 0 ? (
                <div className="flex flex-col items-center justify-center flex-1 gap-2 text-[#9CA3AF]">
                  <Mail className="w-8 h-8 opacity-30" />
                  <p className="text-xs">No FAQ-related emails found</p>
                </div>
              ) : (
                emails.map(email => (
                  <button
                    key={email.id}
                    onClick={() => setSelectedEmail(email)}
                    className={`w-full text-left px-4 py-3 border-b border-[#F3F4F6] transition-colors hover:bg-[#F9FAFB] ${selectedEmail?.id === email.id ? 'bg-[#FEF2F2]' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#991B1B] to-[#B91C1C] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[10px] font-bold text-white">{avatarInitial(email.from)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#111827] truncate">{email.from ?? 'Unknown'}</p>
                        <p className="text-[11px] text-[#374151] truncate mt-0.5">{email.subject ?? '(no subject)'}</p>
                        {email.matchedFaq && (
                          <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                            <Tag className="w-2.5 h-2.5" />Matched FAQ
                          </span>
                        )}
                        <p className="text-[10px] text-[#9CA3AF] mt-1">{formatDate(email.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Right: email detail */}
            <div className="flex-1 overflow-y-auto bg-[#F8FAFC] p-6">
              {!selectedEmail ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-[#9CA3AF]">
                  <Mail className="w-10 h-10 opacity-20" />
                  <p className="text-sm">Select an email to view details</p>
                </div>
              ) : (
                <div className="max-w-2xl mx-auto space-y-4">
                  {/* Email header */}
                  <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
                    <h2 className="text-sm font-bold text-[#111827] mb-3">{selectedEmail.subject ?? '(no subject)'}</h2>
                    <div className="space-y-1 text-xs text-[#6B7280]">
                      <p><span className="font-medium text-[#374151]">From:</span> {selectedEmail.from}</p>
                      <p><span className="font-medium text-[#374151]">Date:</span> {formatDate(selectedEmail.createdAt)}</p>
                    </div>
                    <div className="mt-4 pt-4 border-t border-[#F3F4F6] text-xs text-[#374151] whitespace-pre-wrap leading-relaxed">
                      {selectedEmail.emailBody ?? '(no body)'}
                    </div>
                  </div>

                  {/* Matched FAQ */}
                  {selectedEmail.matchedFaq ? (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <HelpCircle className="w-4 h-4 text-emerald-700" />
                        <p className="text-xs font-bold text-emerald-800">Matched FAQ</p>
                        {selectedEmail.matchedFaq.category && (
                          <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                            {selectedEmail.matchedFaq.category}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-[#111827] mb-2">{selectedEmail.matchedFaq.question}</p>
                      <p className="text-xs text-[#374151] leading-relaxed">{selectedEmail.matchedFaq.answer}</p>
                    </div>
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
                      This email was classified as an FAQ query but no specific FAQ entry was matched.
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          /* ── FAQ Entries list ── */
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-6">
              {loadingFaqs ? (
                <div className="text-xs text-[#9CA3AF] text-center py-12">Loading FAQs…</div>
              ) : faqs.length === 0 ? (
                <div className="text-xs text-[#9CA3AF] text-center py-12">No FAQ entries found</div>
              ) : (
                categories.length > 0
                  ? categories.map(cat => (
                    <div key={cat}>
                      <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wider mb-2">{cat}</p>
                      <div className="space-y-2">
                        {faqs.filter(f => f.category === cat).map((faq, i) => {
                          const key = `${cat}-${i}`
                          const open = expandedFaq === faqs.indexOf(faq)
                          return (
                            <div key={key} className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                              <button
                                onClick={() => setExpandedFaq(open ? null : faqs.indexOf(faq))}
                                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#F9FAFB] transition-colors"
                              >
                                <span className="text-xs font-semibold text-[#111827] pr-4">{faq.question}</span>
                                {open ? <ChevronUp className="w-4 h-4 text-[#9CA3AF] flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-[#9CA3AF] flex-shrink-0" />}
                              </button>
                              {open && (
                                <div className="px-4 pb-4 text-xs text-[#374151] leading-relaxed border-t border-[#F3F4F6] pt-3">
                                  {faq.answer}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                  : faqs.map((faq, i) => {
                    const open = expandedFaq === i
                    return (
                      <div key={i} className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                        <button
                          onClick={() => setExpandedFaq(open ? null : i)}
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#F9FAFB] transition-colors"
                        >
                          <span className="text-xs font-semibold text-[#111827] pr-4">{faq.question}</span>
                          {open ? <ChevronUp className="w-4 h-4 text-[#9CA3AF] flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-[#9CA3AF] flex-shrink-0" />}
                        </button>
                        {open && (
                          <div className="px-4 pb-4 text-xs text-[#374151] leading-relaxed border-t border-[#F3F4F6] pt-3">
                            {faq.answer}
                          </div>
                        )}
                      </div>
                    )
                  })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
