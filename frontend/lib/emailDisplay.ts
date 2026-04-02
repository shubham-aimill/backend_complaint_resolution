/**
 * Email body helpers for inbox / thread views.
 * Legacy ingested records may still have Subject:/From:/To:/Date: lines
 * prepended to emailBody; we strip those for display only.
 */

export function cleanQuotedLines(body: string): string {
  return body.split('\n').map((l) => l.replace(/^>+\s?/, '')).join('\n').trim()
}

/** Remove a leading block of mail header lines we used to embed in emailBody. */
export function stripEmbeddedMailHeaders(body: string): string {
  const normalized = body.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  let i = 0
  const headerRe = /^(Subject|From|To|Date):\s*.*/i
  while (i < lines.length && headerRe.test(lines[i])) {
    i += 1
  }
  if (i < lines.length && lines[i].trim() === '') {
    i += 1
  }
  return lines.slice(i).join('\n').trimStart()
}

/** Body text for snippets and expanded view (no redundant header block). */
export function formatEmailBodyForDisplay(body: string): string {
  return cleanQuotedLines(stripEmbeddedMailHeaders(body))
}
