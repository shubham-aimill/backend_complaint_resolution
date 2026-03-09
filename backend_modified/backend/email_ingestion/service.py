"""
Email Ingestion Service.

Connects to IMAP inbox, reads customer emails, filters for genuine
complaints (vs spam / FAQ queries), and saves them for AI processing.
"""

import email
import email.utils
import json
import os
import re
import ssl
import sys
from email import policy as email_policy
from email.header import decode_header
from typing import Any, Callable, Dict, List, Optional, Tuple

import imaplib

from backend.common.config import ENV_FILE
from backend.faq_resolution.service import process_faq_email
from backend.ingested_complaints.service import (
    add_dedup_keys_to_set,
    get_existing_message_ids,
    is_duplicate_email,
    save_ingested_complaint,
)


def _load_env() -> None:
    if ENV_FILE.exists():
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    os.environ.setdefault(key.strip(), val.strip().strip("'\""))


# ── Complaint keyword detection ────────────────────────────────────────────

def _has_relevant_keywords(subject: str, body: str) -> bool:
    """Return True if the email contains keywords suggesting a customer complaint."""
    text = f"{subject} {body}".lower()
    patterns = [
    r"\bcomplaint\b", r"\bcomplaints\b",
    r"\bdissatisfied\b", r"\bdissatisfaction\b",
    r"\bunhappy\b", r"\bunacceptable\b",

    r"\brefund\b", r"\brefunds\b",
    r"\bdefective\b", r"\bfaulty\b", r"\bbroken\b",
    r"\bdamaged\b", r"\bnot working\b",
    r"\bstopped working\b",
    r"\bmalfunction\b", r"\bmalfunctioning\b",

    # technical / device issues
    r"\btechnical issue\b",
    r"\bdevice issue\b",
    r"\bconnectivity issue\b",
    r"\bnetwork issue\b",
    r"\bwifi issue\b",
    r"\bdisconnect\b", r"\bdisconnected\b",
    r"\boffline\b",
    r"\bunable to connect\b",
    r"\bcan't connect\b",
    r"\bdevice offline\b",

    # billing
    r"\bbilling error\b", r"\bovercharged\b",
    r"\bwrong charge\b", r"\bincorrect bill\b",

    # delivery
    r"\bnot received\b", r"\bnever arrived\b",
    r"\bmissing order\b",
    r"\blate delivery\b", r"\bdelayed\b",
    r"\bdelivery issue\b",

    # service
    r"\bpoor service\b", r"\bbad service\b",
    r"\brude staff\b",
    r"\bunprofessional\b",

    # escalation
    r"\bescalate\b", r"\bescalation\b",
    r"\blegal action\b",
    r"\bconsumer court\b",
    r"\bombudsman\b",

    # compensation
    r"\bcompensation\b",
    r"\breimbursement\b",

    # warranty / returns
    r"\bwarranty\b",
    r"\breturn\b",
    r"\breplacement\b",

    # app issues
    r"\bapp.*not working\b",
    r"\bcan.*t.*access\b",
    ]
    return any(re.search(p, text, re.IGNORECASE) for p in patterns)


def _has_strong_keywords(subject: str, body: str) -> bool:
    """Return True if email has strong / unambiguous complaint indicators."""
    text = f"{subject} {body}".lower()
    strong = [
        r"\bformal complaint\b",
        r"\bescalate.*complaint\b",
        r"\blegal action\b",
        r"\btrading standards\b",
        r"\bombudsman\b",
        r"\brefund.*request\b",
        r"\brequest.*refund\b",
        r"\bdemand.*refund\b",
    ]
    return any(re.search(p, text, re.IGNORECASE) for p in strong)


def _classify_complaint_by_llm(subject: str, body: str) -> bool:
    """Use LLM to decide if an email is a genuine customer complaint."""
    if not _has_relevant_keywords(subject, body):
        return False

    if os.environ.get("COMPLAINT_FILTER_ENABLED", "true").lower() == "false":
        return True

    has_strong = _has_strong_keywords(subject, body)
    api_key = os.environ.get("OPENAI_API_KEY")

    if not api_key:
        return has_strong

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a customer complaint email classifier. "
                        "Reply ONLY with 'yes' if the email is a genuine customer complaint "
                        "(dissatisfaction, refund request, defective product, billing error, "
                        "delivery problem, poor service, or escalation). "
                        "Reply ONLY with 'no' for spam, newsletters, or unrelated emails."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Subject: {subject}\n\nBody:\n{body[:3000]}",
                },
            ],
            max_tokens=5,
            temperature=0,
        )
        answer = (response.choices[0].message.content or "").strip().lower()
        is_complaint = answer.startswith("yes")
        if not is_complaint and has_strong:
            return True
        return is_complaint
    except Exception as e:
        print(f"LLM complaint classification error: {e}", file=sys.stderr)
        return has_strong


# ── Email parsing helpers ──────────────────────────────────────────────────

def _strip_html(html: str) -> str:
    text = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", html, flags=re.IGNORECASE)
    text = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _get_part_text(part: email.message.Message) -> str:
    payload = part.get_payload(decode=True)
    if payload is None:
        return ""
    charset = part.get_content_charset() or "utf-8"
    for enc in (charset, "utf-8", "iso-8859-1", "cp1252", "latin-1"):
        try:
            return payload.decode(enc, errors="strict")
        except (LookupError, ValueError, UnicodeDecodeError):
            continue
    return payload.decode("utf-8", errors="replace")


def _decode_header_value(header_val: Any) -> str:
    if header_val is None or header_val == "":
        return ""
    if isinstance(header_val, bytes):
        return header_val.decode("utf-8", errors="replace")
    if isinstance(header_val, str):
        return header_val
    try:
        decoded = decode_header(header_val)
        parts = []
        for part, charset in decoded:
            if part is None:
                continue
            if isinstance(part, bytes):
                ch = charset or "utf-8"
                try:
                    parts.append(part.decode(ch, errors="replace"))
                except (LookupError, ValueError):
                    parts.append(part.decode("utf-8", errors="replace"))
            else:
                parts.append(str(part))
        return "".join(parts).strip()
    except Exception:
        return str(header_val)


def _format_address(addr: Any) -> str:
    if addr is None:
        return ""
    if isinstance(addr, (list, tuple)):
        return ", ".join(_format_address(a) for a in addr)
    return _decode_header_value(addr)


def _extract_body_text(msg: email.message.Message) -> str:
    """Extract plain-text body, skipping attachments."""
    body_plain = ""
    body_html = ""

    if not msg.is_multipart():
        ct = msg.get_content_type()
        if ct == "text/plain":
            return _get_part_text(msg)
        if ct == "text/html":
            return _strip_html(_get_part_text(msg))
        return ""

    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        disposition = part.get("Content-Disposition", "")
        if disposition and "attachment" in disposition.lower():
            continue
        if part.get_filename():
            continue
        ct = part.get_content_type()
        if ct == "text/plain" and not body_plain:
            body_plain = _get_part_text(part)
        elif ct == "text/html" and not body_html:
            body_html = _get_part_text(part)

    if body_plain.strip():
        return body_plain
    if body_html.strip():
        return _strip_html(body_html)
    return ""


def _build_full_email_body(subject: str, from_addr: str, to_addr: str, date_str: str, body_text: str) -> str:
    lines = []
    if subject:    lines.append(f"Subject: {subject}")
    if from_addr:  lines.append(f"From: {from_addr}")
    if to_addr:    lines.append(f"To: {to_addr}")
    if date_str:   lines.append(f"Date: {date_str}")
    if lines:      lines.append("")
    if body_text:  lines.append(body_text.strip())
    return "\n".join(lines)


def _extract_raw_message(msg_data: list) -> Optional[bytes]:
    if not msg_data:
        return None
    for item in msg_data:
        if isinstance(item, tuple) and len(item) >= 2:
            raw = item[1]
            if isinstance(raw, bytes) and len(raw) > 100:
                return raw
        elif isinstance(item, bytes) and len(item) > 100 and b"From:" in item:
            return item
    if msg_data and isinstance(msg_data[0], tuple) and len(msg_data[0]) >= 2:
        raw = msg_data[0][1]
        if isinstance(raw, bytes):
            return raw
    return None


# ── Main sync function ─────────────────────────────────────────────────────

def sync_inbox(
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """
    Connect to IMAP inbox, scan emails, filter genuine complaints, save them.

    If progress_callback is provided, it is called after each email with
    { total, done, ingested, skippedDuplicate, skippedNoComplaint, ... }.

    Returns:
        Dict with success, ingested, scanned, skippedNoComplaint,
        skippedDuplicate, faqAnswered, faqError, errors.
    """
    _load_env()

    host     = os.environ.get("IMAP_HOST", "imap.gmail.com")
    port     = int(os.environ.get("IMAP_PORT", "993"))
    user     = os.environ.get("SENDER_EMAIL") or os.environ.get("IMAP_USER", "")
    password = (os.environ.get("EMAIL_PASSWORD") or os.environ.get("IMAP_PASSWORD", "")).replace(" ", "")
    mailbox  = os.environ.get("IMAP_MAILBOX", "INBOX")

    result: Dict[str, Any] = {
        "success": False,
        "ingested": 0,
        "scanned": 0,
        "skippedNoComplaint": 0,
        "skippedDuplicate": 0,
        "faqAnswered": 0,
        "faqError": 0,
        "errors": [],
    }

    if not user or not password:
        result["errors"].append("IMAP credentials not configured. Set SENDER_EMAIL and EMAIL_PASSWORD in .env")
        return result

    include_read = os.environ.get("IMAP_SYNC_INCLUDE_READ", "true").lower() in ("true", "1", "yes")
    max_emails   = int(os.environ.get("IMAP_SYNC_MAX_EMAILS", "100"))
    ssl_verify   = os.environ.get("IMAP_SSL_VERIFY", "false").lower() not in ("false", "0", "no")

    def parse_uids(data: list) -> List[str]:
        if not data or data[0] is None:
            return []
        raw = data[0]
        s = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
        return [u for u in s.split() if u]

    try:
        ctx = ssl.create_default_context()
        if not ssl_verify:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

        mail = imaplib.IMAP4_SSL(host, port, ssl_context=ctx)
        mail.login(user, password)

        mailboxes_to_try = [mailbox]
        if "gmail" in host.lower() and mailbox.upper() == "INBOX":
            mailboxes_to_try = ["[Gmail]/All Mail", "[Google Mail]/All Mail", "INBOX"]

        uids: List[str] = []
        for mbox in mailboxes_to_try:
            try:
                status, _ = mail.select(mbox)
                if status != "OK":
                    continue
                _, data = mail.search(None, "ALL" if include_read else "UNSEEN")
                uids = parse_uids(data)
                if len(uids) > max_emails:
                    uids = uids[-max_emails:]
                if uids:
                    result["mailboxUsed"] = mbox
                    break
            except Exception:
                continue

        if not uids:
            result["success"] = True
            result["hint"] = (
                "Inbox is empty or no emails found. "
                "For Gmail, enable 'All Mail' in IMAP settings, "
                "or set IMAP_MAILBOX='[Gmail]/All Mail' in .env"
            )
            mail.logout()
            return result

        result["scanned"] = len(uids)
        existing_ids = get_existing_message_ids()

        total = len(uids)
        done = 0
        if progress_callback:
            try:
                progress_callback({
                    "total": total,
                    "done": 0,
                    "ingested": 0,
                    "skippedDuplicate": 0,
                    "skippedNoComplaint": 0,
                    "faqAnswered": 0,
                    "errorsCount": 0,
                })
            except Exception:
                pass

        for uid in uids:
            try:
                _, msg_data = mail.fetch(uid, "(RFC822)")
                raw = _extract_raw_message(
                    list(msg_data) if hasattr(msg_data, "__iter__") else msg_data
                )
                if not raw:
                    result["errors"].append(f"Message {uid}: could not extract raw bytes")
                    continue

                msg = email.message_from_bytes(raw, policy=email_policy.default)

                subject    = _decode_header_value(msg.get("Subject", "(No subject)") or "(No subject)")
                from_addr  = _format_address(msg.get("From", ""))
                to_addr    = _format_address(msg.get("To", ""))
                message_id = _decode_header_value(msg.get("Message-ID", "")).strip() or None
                date_hdr   = msg.get("Date", "")
                dedup_key  = message_id or f"{subject}|{from_addr}|{date_hdr}"

                if is_duplicate_email(subject, from_addr, message_id or "", date_hdr, existing_ids):
                    result["skippedDuplicate"] += 1
                    continue

                body_text = _extract_body_text(msg)

                # FAQ check — answer and skip ingestion
                try:
                    faq_result = process_faq_email(from_addr, to_addr, subject, body_text)
                    if faq_result.get("is_faq"):
                        if faq_result.get("answered"):
                            result["faqAnswered"] += 1
                        else:
                            result["faqError"] += 1
                            err = faq_result.get("error", "unknown")
                            print(f"FAQ answer failed: {err}", file=sys.stderr)
                        continue
                except Exception as e:
                    print(f"FAQ processing error (continuing): {e}", file=sys.stderr)

                # Complaint filter
                if not _classify_complaint_by_llm(subject, body_text):
                    result["skippedNoComplaint"] += 1
                    continue

                # Format date for display
                date_str = ""
                if msg.get("Date"):
                    try:
                        dt = email.utils.parsedate_to_datetime(msg.get("Date"))
                        date_str = dt.strftime("%B %d, %Y %I:%M %p")
                    except Exception:
                        date_str = str(msg.get("Date", ""))

                full_body = _build_full_email_body(subject, from_addr, to_addr, date_str, body_text)

                attachment_files: List[Tuple[str, bytes, str]] = []
                if msg.is_multipart():
                    for part in msg.walk():
                        if part.get_content_disposition() == "attachment":
                            filename = part.get_filename() or f"attachment-{len(attachment_files)+1}"
                            payload = part.get_payload(decode=True)
                            if payload:
                                ct = part.get_content_type() or "application/octet-stream"
                                attachment_files.append((filename, payload, ct))

                save_ingested_complaint(
                    from_addr, to_addr, subject, full_body,
                    attachment_files, "imap",
                    message_id=dedup_key,
                    email_message_id_for_display=message_id,
                )
                result["ingested"] += 1
                add_dedup_keys_to_set(existing_ids, subject, from_addr, message_id or "", dedup_key)

                if not include_read:
                    mail.store(uid, "+FLAGS", "\\Seen")

            except Exception as e:
                result["errors"].append(f"Message {uid}: {e}")

            done += 1
            if progress_callback:
                try:
                    progress_callback({
                        "total": total,
                        "done": done,
                        "ingested": result["ingested"],
                        "skippedDuplicate": result["skippedDuplicate"],
                        "skippedNoComplaint": result["skippedNoComplaint"],
                        "faqAnswered": result["faqAnswered"],
                        "errorsCount": len(result["errors"]),
                    })
                except Exception:
                    pass

        result["success"] = len(result["errors"]) == 0
        mail.logout()

    except Exception as e:
        result["errors"].append(str(e))

    return result


def main() -> int:
    r = sync_inbox()
    print(json.dumps(r, indent=2))
    return 0 if r.get("success") else 1


if __name__ == "__main__":
    sys.exit(main())
