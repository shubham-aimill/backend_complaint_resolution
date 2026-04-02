'use client'

/**
 * Structured mail headers — kept out of the message body in the UI.
 */
export function MailMetaPanel({
  subject,
  from: fromAddr,
  to: toAddr,
  dateLabel = 'Date',
  dateValue,
}: {
  subject?: string
  from?: string
  to?: string
  dateLabel?: string
  dateValue?: string
}) {
  const rows: { label: string; value: string }[] = []
  if (subject?.trim()) rows.push({ label: 'Subject', value: subject.trim() })
  if (fromAddr?.trim()) rows.push({ label: 'From', value: fromAddr.trim() })
  if (toAddr?.trim()) rows.push({ label: 'To', value: toAddr.trim() })
  if (dateValue?.trim()) rows.push({ label: dateLabel, value: dateValue.trim() })
  if (!rows.length) return null

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 mb-3">
      <dl className="space-y-1.5">
        {rows.map(({ label, value }) => (
          <div key={label} className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0.5 text-[12px] leading-snug">
            <dt className="font-semibold text-[#6B7280] shrink-0">{label}</dt>
            <dd className="text-[#111827] break-words min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
