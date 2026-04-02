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
import threading

from backend.common.config import ENV_FILE, IMAP_SYNC_CACHE_FILE
from backend.faq_resolution.service import get_faq_dedup_ids, process_faq_email, save_faq_email
from backend.ingested_complaints.service import (
    add_dedup_keys_to_set,
    add_email_to_thread,
    claim_ack_slot,
    get_existing_message_ids,
    get_thread_by_complaint_id,
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
                    os.environ[key.strip()] = val.strip().strip("'\"")


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
                        "You are a customer complaint email classifier for a consumer electronics company. "
                        "Reply ONLY with 'yes' if the email is a genuine customer complaint requiring "
                        "investigation or action — this includes: product defects, hardware or software "
                        "failures, warranty claims, billing errors, delivery problems, poor service, "
                        "refund or replacement requests, safety concerns, or escalations. "
                        "Reply ONLY with 'no' for: spam, marketing or promotional emails, newsletters, "
                        "order confirmations, subscription notifications, general enquiries, or any "
                        "email that does not describe a specific problem or customer dissatisfaction."
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


def _send_complaint_ack(
    to_addr: str,
    customer_name: str,
    original_subject: str,
    complaint_id: str,
    original_message_id: Optional[str] = None,
) -> None:
    """
    Send an automated complaint-received acknowledgement via SMTP.

    The reply is sent IN-THREAD by setting In-Reply-To / References so the
    customer's email client groups it with their original message.
    """
    _load_env()
    sender_email = os.environ.get("SENDER_EMAIL", "")
    email_password = os.environ.get("EMAIL_PASSWORD", "").replace(" ", "")
    if not sender_email or not email_password:
        raise ValueError("Email credentials not set (SENDER_EMAIL / EMAIL_PASSWORD).")

    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))

    greeting = f"Dear {customer_name}," if customer_name else "Dear Valued Customer,"
    body_lines = [
        greeting,
        "",
        "Thank you for reaching out to Consumer Electronics Customer Support.",
        "We have received your complaint and it has been logged in our system.",
        "",
        f"Your Complaint Reference: {complaint_id}",
        "",
        "What happens next:",
        "  1. Our support team will review your complaint within 1–2 business days.",
        "  2. You will receive a follow-up email with the outcome or next steps.",
        "  3. If we require additional information we will contact you directly.",
        "",
        "Please quote your complaint reference number in any future correspondence.",
        "",
        "For urgent matters you can reach us at:",
        "  Phone: 1-800-ELEC-HELP  (Monday – Friday, 9am – 6pm)",
        "  Email: support@electronics.com",
        "",
        "We apologise for any inconvenience caused and will work to resolve this",
        "as quickly as possible.",
        "",
        "Kind regards,",
        "Customer Support Team",
        "Consumer Electronics",
    ]
    text_body = "\n".join(body_lines)

    subj = original_subject if original_subject.lower().startswith("re:") else f"Re: {original_subject}"

    msg = MIMEMultipart("alternative")
    msg["From"] = f"Customer Support <{sender_email}>"
    msg["To"] = to_addr
    msg["Subject"] = subj

    if original_message_id:
        mid = original_message_id.strip()
        if not mid.startswith("<"):
            mid = f"<{mid}>"
        msg["In-Reply-To"] = mid
        msg["References"] = mid

    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(text_body.replace("\n", "<br>"), "html"))

    server = smtplib.SMTP(smtp_host, smtp_port)
    server.starttls()
    server.login(sender_email, email_password)
    server.send_message(msg)
    server.quit()


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


# ── UID cache helpers ──────────────────────────────────────────────────────

def _load_sync_cache() -> Dict[str, Any]:
    """Load the IMAP UID sync cache from disk."""
    try:
        if IMAP_SYNC_CACHE_FILE.exists():
            return json.loads(IMAP_SYNC_CACHE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        pass
    return {}


def _save_sync_cache(cache: Dict[str, Any]) -> None:
    """Persist the IMAP UID sync cache to disk."""
    try:
        IMAP_SYNC_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        IMAP_SYNC_CACHE_FILE.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    except OSError as e:
        print(f"Warning: could not save IMAP sync cache: {e}", file=sys.stderr)


def _cache_key(account: str, mailbox: str) -> str:
    return f"{account.lower()}:{mailbox}"


def _get_last_uid(cache: Dict[str, Any], account: str, mailbox: str) -> Optional[int]:
    """Return last synced UID for this account+mailbox, or None if first sync."""
    key = _cache_key(account, mailbox)
    val = cache.get(key, {}).get("lastUID")
    try:
        return int(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _set_last_uid(cache: Dict[str, Any], account: str, mailbox: str, uid: int) -> None:
    """Update the cache with the latest UID seen."""
    import datetime
    key = _cache_key(account, mailbox)
    cache[key] = {
        "lastUID": uid,
        "syncedAt": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _extract_email_address(addr: str) -> str:
    """Pull the bare address out of 'Display Name <addr@example.com>' or plain 'addr@example.com'."""
    addr = addr.strip()
    if "<" in addr and ">" in addr:
        return addr[addr.index("<") + 1 : addr.index(">")].strip().lower()
    return addr.lower()


def _is_own_email(from_addr: str, own_addresses: set) -> bool:
    """
    Return True if the email was sent FROM one of our own support addresses.

    Auto-replies and FAQ replies are sent from SENDER_EMAIL.  When IMAP is
    connected to that same account, Gmail's 'All Mail' folder contains those
    sent items.  We must never re-ingest our own outbound mail as a new
    complaint or FAQ query.
    """
    bare = _extract_email_address(from_addr)
    return bare in own_addresses


def _checkpoint_uid(
    cache: Dict[str, Any],
    account: str,
    mailbox: str,
    current_max: int,
    last_saved: Optional[int],
) -> None:
    """
    Persist the UID cache to disk if current_max has advanced past last_saved.

    Called after each email (regardless of disposition — ingested, FAQ, skipped,
    or errored) so that a mid-sync restart never re-processes already-seen UIDs
    and never re-fires auto-reply emails.
    """
    if current_max > (last_saved or 0):
        _set_last_uid(cache, account, mailbox, current_max)
        _save_sync_cache(cache)


# ── Main sync function ─────────────────────────────────────────────────────

# Prevents two concurrent IMAP sync threads from racing each other and
# writing duplicate complaints. Non-blocking: the second caller returns
# immediately rather than queuing, so the UI never hangs.
_SYNC_LOCK = threading.Lock()


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
    if not _SYNC_LOCK.acquire(blocking=False):
        return {
            "success": True,
            "ingested": 0,
            "scanned": 0,
            "skippedNoComplaint": 0,
            "skippedDuplicate": 0,
            "faqAnswered": 0,
            "faqError": 0,
            "errors": [],
            "note": "sync already in progress — skipped",
        }
    try:
        return _sync_inbox_impl(progress_callback)
    finally:
        _SYNC_LOCK.release()


def _sync_inbox_impl(
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """Internal implementation — always called with _SYNC_LOCK held."""
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

    def parse_uid_list(data: list) -> List[str]:
        """Parse UID search response into a list of UID strings."""
        if not data or data[0] is None:
            return []
        raw = data[0]
        s = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
        return [u for u in s.split() if u.isdigit()]

    try:
        ctx = ssl.create_default_context()
        if not ssl_verify:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

        mail = imaplib.IMAP4_SSL(host, port, ssl_context=ctx)
        mail.login(user, password)

        # Load UID cache to only fetch emails we haven't seen before
        sync_cache = _load_sync_cache()

        mailboxes_to_try = [mailbox]
        if "gmail" in host.lower() and mailbox.upper() == "INBOX":
            mailboxes_to_try = ["[Gmail]/All Mail", "[Google Mail]/All Mail", "INBOX"]

        uids: List[str] = []
        last_uid: Optional[int] = None
        active_mailbox: str = mailbox

        for mbox in mailboxes_to_try:
            try:
                status, _ = mail.select(mbox)
                if status != "OK":
                    continue

                last_uid = _get_last_uid(sync_cache, user, mbox)

                if last_uid is not None:
                    # Only fetch emails with UID strictly greater than last seen
                    search_criteria = f"UID {last_uid + 1}:*"
                    _, data = mail.uid("search", None, search_criteria)
                    all_uids = parse_uid_list(data)
                    # Filter out the boundary UID itself (IMAP returns it when no newer exist)
                    uids = [u for u in all_uids if int(u) > last_uid]
                    result["cachedSyncFrom"] = last_uid
                    result["newOnly"] = True
                else:
                    # First sync: fall back to ALL/UNSEEN limited to max_emails
                    search_term = "ALL" if include_read else "UNSEEN"
                    _, data = mail.uid("search", None, search_term)
                    all_uids = parse_uid_list(data)
                    if len(all_uids) > max_emails:
                        all_uids = all_uids[-max_emails:]
                    uids = all_uids
                    result["newOnly"] = False

                if uids or last_uid is not None:
                    active_mailbox = mbox
                    result["mailboxUsed"] = mbox
                    break
            except Exception:
                continue

        if not uids:
            result["success"] = True
            result["hint"] = (
                "No new emails since last sync. "
                if last_uid is not None
                else (
                    "Inbox is empty or no emails found. "
                    "For Gmail, enable 'All Mail' in IMAP settings, "
                    "or set IMAP_MAILBOX='[Gmail]/All Mail' in .env"
                )
            )
            mail.logout()
            return result

        result["scanned"] = len(uids)
        # Combine complaint dedup IDs with FAQ dedup IDs so emails processed
        # (and replied to) in a previous sync are never re-processed even after
        # a backend restart.
        existing_ids = get_existing_message_ids()
        existing_ids |= get_faq_dedup_ids()

        # Build the set of our own email addresses so we can skip self-sent mail.
        # Auto-replies and FAQ replies are sent FROM SENDER_EMAIL.  Because IMAP
        # connects to that same account, Gmail returns those sent items in
        # 'All Mail'.  Without this guard, every outbound auto-reply would be
        # re-ingested as a new complaint on the next sync.
        own_emails: set = set()
        for env_key in ("SENDER_EMAIL", "IMAP_USER"):
            addr = os.environ.get(env_key, "").strip().lower()
            if addr:
                own_emails.add(addr)
        # Also add the IMAP login user (same account in typical single-mailbox setups)
        if user:
            own_emails.add(user.strip().lower())

        total = len(uids)
        done = 0
        max_uid_seen: int = last_uid or 0
        # How often to flush the UID cache to disk during the loop.
        # Saving after every email is safe and cheap (small JSON file).
        # This prevents re-processing (and re-firing auto-replies) if the
        # process is killed or the server restarts mid-sync.
        UID_CHECKPOINT_EVERY = 1

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
            current_uid = int(uid)
            if current_uid > max_uid_seen:
                max_uid_seen = current_uid
            try:
                _, msg_data = mail.uid("fetch", uid, "(RFC822)")
                raw = _extract_raw_message(
                    list(msg_data) if hasattr(msg_data, "__iter__") else msg_data
                )
                if not raw:
                    result["errors"].append(f"Message {uid}: could not extract raw bytes")
                    # Still advance past this UID so we don't retry forever
                    _checkpoint_uid(sync_cache, user, active_mailbox, max_uid_seen, last_uid)
                    continue

                msg = email.message_from_bytes(raw, policy=email_policy.default)

                subject    = _decode_header_value(msg.get("Subject", "(No subject)") or "(No subject)")
                from_addr  = _format_address(msg.get("From", ""))
                to_addr    = _format_address(msg.get("To", ""))
                message_id  = _decode_header_value(msg.get("Message-ID", "")).strip() or None
                in_reply_to = _decode_header_value(msg.get("In-Reply-To", "")).strip() or None
                references_raw = _decode_header_value(msg.get("References", "")).strip()
                references  = [r.strip() for r in references_raw.split() if r.strip()] if references_raw else []
                date_hdr    = msg.get("Date", "")
                dedup_key   = message_id or f"{subject}|{from_addr}|{date_hdr}"

                # ── Self-email guard ───────────────────────────────────────
                # Skip any email sent FROM our own support address.  These are
                # auto-replies / FAQ replies that appear in Gmail's 'All Mail'
                # because IMAP is connected to the same account.  They must
                # never be re-ingested as complaints or FAQ queries.
                if _is_own_email(from_addr, own_emails):
                    result["skippedNoComplaint"] += 1
                    _checkpoint_uid(sync_cache, user, active_mailbox, max_uid_seen, last_uid)
                    continue

                if is_duplicate_email(
                    subject, from_addr, message_id or "", date_hdr, existing_ids,
                    in_reply_to=in_reply_to, references=references,
                ):
                    result["skippedDuplicate"] += 1
                    # Checkpoint so restart skips this UID too
                    _checkpoint_uid(sync_cache, user, active_mailbox, max_uid_seen, last_uid)
                    continue

                body_text = _extract_body_text(msg)

                # FAQ check — answer, store, and skip complaint ingestion
                try:
                    faq_result = process_faq_email(
                        from_addr, to_addr, subject, body_text,
                        message_id=message_id,
                    )
                    if faq_result.get("is_faq"):
                        matched_faq = None
                        if faq_result.get("faq_question"):
                            matched_faq = {
                                "question": faq_result["faq_question"],
                                "answer":   faq_result.get("answer", ""),
                                "category": faq_result.get("faq_category", ""),
                            }
                        elif faq_result.get("answered") and faq_result.get("answer"):
                            matched_faq = {
                                "question": None,
                                "answer":   faq_result["answer"],
                                "category": "",
                            }
                        save_faq_email(
                            from_addr, to_addr, subject, body_text, matched_faq,
                            message_id=message_id,
                        )
                        # Also add to dedup set so a re-scan doesn't re-trigger the FAQ reply
                        add_dedup_keys_to_set(existing_ids, subject, from_addr, message_id or "", dedup_key)
                        if faq_result.get("answered"):
                            result["faqAnswered"] += 1
                        else:
                            result["faqError"] += 1
                            err = faq_result.get("error", "unknown")
                            print(f"FAQ answer failed for '{subject[:60]}': {err}", file=sys.stderr)
                        # Checkpoint BEFORE continuing so restart doesn't re-fire the auto-reply
                        _checkpoint_uid(sync_cache, user, active_mailbox, max_uid_seen, last_uid)
                        continue
                except Exception as e:
                    print(f"FAQ processing error (continuing) for '{subject[:60]}': {e}", file=sys.stderr)

                # Complaint filter
                if not _classify_complaint_by_llm(subject, body_text):
                    result["skippedNoComplaint"] += 1
                    _checkpoint_uid(sync_cache, user, active_mailbox, max_uid_seen, last_uid)
                    continue

                # Format date for display
                date_str = ""
                if msg.get("Date"):
                    try:
                        dt = email.utils.parsedate_to_datetime(msg.get("Date"))
                        date_str = dt.strftime("%B %d, %Y %I:%M %p")
                    except Exception:
                        date_str = str(msg.get("Date", ""))

                attachment_files: List[Tuple[str, bytes, str]] = []
                if msg.is_multipart():
                    for part in msg.walk():
                        if part.get_content_disposition() == "attachment":
                            filename = part.get_filename() or f"attachment-{len(attachment_files)+1}"
                            payload = part.get_payload(decode=True)
                            if payload:
                                ct = part.get_content_type() or "application/octet-stream"
                                attachment_files.append((filename, payload, ct))

                complaint_record = save_ingested_complaint(
                    from_addr, to_addr, subject, body_text.strip(),
                    attachment_files, "imap",
                    message_id=dedup_key,
                    email_message_id_for_display=message_id,
                    in_reply_to=in_reply_to,
                    references=references,
                    email_date_display=date_str or None,
                )
                result["ingested"] += 1
                add_dedup_keys_to_set(existing_ids, subject, from_addr, message_id or "", dedup_key)
                # Checkpoint immediately after successful ingestion
                _checkpoint_uid(sync_cache, user, active_mailbox, max_uid_seen, last_uid)

                # ── Auto-acknowledgement ───────────────────────────────────
                # Send a "complaint received" reply in the same email thread
                # and record it as an outbound entry so the UI shows it.
                #
                # Guard: claim_ack_slot() atomically sets ackSent=True on the
                # complaint record under _WRITE_LOCK before the SMTP call.
                # If the flag was already set (previous run sent the ack) it
                # returns False and we skip — no duplicate ack is ever sent
                # even if the SMTP succeeded but the thread-record write
                # failed, or the backend restarted mid-flight.
                try:
                    if not claim_ack_slot(complaint_record["id"]):
                        pass  # ack already sent — skip silently
                    else:
                        sender_email = os.environ.get("SENDER_EMAIL", "")
                        customer_name = _format_address(from_addr).split("<")[0].strip()
                        ack_body_lines = [
                            f"Dear {customer_name}," if customer_name else "Dear Valued Customer,",
                            "",
                            "Thank you for reaching out to Consumer Electronics Customer Support.",
                            "We have received your complaint and it has been logged in our system.",
                            "",
                            f"Your Complaint Reference: {complaint_record['id']}",
                            "",
                            "What happens next:",
                            "  1. Our support team will review your complaint within 1–2 business days.",
                            "  2. You will receive a follow-up email with the outcome or next steps.",
                            "  3. If we require additional information we will contact you directly.",
                            "",
                            "Please quote your complaint reference in any future correspondence.",
                            "",
                            "For urgent matters you can reach us at:",
                            "  Phone: 1-800-ELEC-HELP  (Monday – Friday, 9am – 6pm)",
                            "  Email: support@electronics.com",
                            "",
                            "We apologise for any inconvenience and will resolve this promptly.",
                            "",
                            "Kind regards,",
                            "Customer Support Team",
                            "Consumer Electronics",
                        ]
                        ack_body = "\n".join(ack_body_lines)
                        ack_subject = subject if subject.lower().startswith("re:") else f"Re: {subject}"

                        _send_complaint_ack(
                            to_addr=from_addr,
                            customer_name=customer_name,
                            original_subject=subject,
                            complaint_id=complaint_record["id"],
                            original_message_id=message_id,
                        )

                        # Record the sent ack in the thread so the UI shows it.
                        # Failure here is non-fatal — ackSent flag already guards
                        # against re-sending on the next sync.
                        add_email_to_thread(
                            complaint_id=complaint_record["id"],
                            from_addr=f"Customer Support <{sender_email}>",
                            to_addr=from_addr,
                            subject=ack_subject,
                            email_body=ack_body,
                            direction="outbound",
                            email_type="acknowledgement",
                            in_reply_to=message_id,
                        )
                except Exception as ack_err:
                    # Ack failure must not block ingestion
                    print(f"Ack email failed for {complaint_record['id']}: {ack_err}", file=sys.stderr)

                if not include_read:
                    mail.store(uid, "+FLAGS", "\\Seen")

            except Exception as e:
                result["errors"].append(f"Message {uid}: {e}")
                # Still advance past failed UIDs
                _checkpoint_uid(sync_cache, user, active_mailbox, max_uid_seen, last_uid)

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

        # Final flush to guarantee the file is up to date
        if max_uid_seen > (last_uid or 0):
            _set_last_uid(sync_cache, user, active_mailbox, max_uid_seen)
            _save_sync_cache(sync_cache)
            result["lastUIDSaved"] = max_uid_seen

        result["success"] = len(result["errors"]) == 0
        mail.logout()

    except Exception as e:
        result["errors"].append(str(e))

    return result


# ── Independent FAQ sync ───────────────────────────────────────────────────
# Separate lock + separate IMAP UID cache key so the FAQ sync never
# interferes with the complaint inbox sync.

_FAQ_SYNC_LOCK = threading.Lock()


def sync_faq_inbox(
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """
    Independent FAQ-only inbox sync.

    Connects to the same IMAP mailbox as sync_inbox but uses a separate UID
    cache key (``{user}:{mailbox}:faq``) so it never blocks or is blocked by
    the complaint sync.  For each email it only runs the FAQ classifier;
    complaints and non-FAQ emails are skipped without being ingested.

    Returns:
        Dict with success, scanned, faqAnswered, faqError, skipped, errors.
    """
    if not _FAQ_SYNC_LOCK.acquire(blocking=False):
        return {
            "success": True,
            "scanned": 0,
            "faqAnswered": 0,
            "faqError": 0,
            "skipped": 0,
            "errors": [],
            "note": "FAQ sync already in progress — skipped",
        }
    try:
        return _sync_faq_inbox_impl(progress_callback)
    finally:
        _FAQ_SYNC_LOCK.release()


def _sync_faq_inbox_impl(
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """Internal FAQ sync — always called with _FAQ_SYNC_LOCK held."""
    _load_env()

    host     = os.environ.get("IMAP_HOST", "imap.gmail.com")
    port     = int(os.environ.get("IMAP_PORT", "993"))
    user     = os.environ.get("SENDER_EMAIL") or os.environ.get("IMAP_USER", "")
    password = (os.environ.get("EMAIL_PASSWORD") or os.environ.get("IMAP_PASSWORD", "")).replace(" ", "")
    mailbox  = os.environ.get("IMAP_MAILBOX", "INBOX")

    result: Dict[str, Any] = {
        "success": False,
        "scanned": 0,
        "faqAnswered": 0,
        "faqError": 0,
        "skipped": 0,
        "errors": [],
    }

    if not user or not password:
        result["errors"].append("IMAP credentials not configured.")
        return result

    include_read = os.environ.get("IMAP_SYNC_INCLUDE_READ", "true").lower() in ("true", "1", "yes")
    max_emails   = int(os.environ.get("IMAP_SYNC_MAX_EMAILS", "100"))
    ssl_verify   = os.environ.get("IMAP_SSL_VERIFY", "false").lower() not in ("false", "0", "no")

    # Separate cache key so FAQ UID tracking is independent of complaint sync
    FAQ_CACHE_SUFFIX = ":faq"

    def faq_cache_key(account: str, mbox: str) -> str:
        return f"{_cache_key(account, mbox)}{FAQ_CACHE_SUFFIX}"

    def get_faq_last_uid(cache: Dict[str, Any]) -> Optional[int]:
        val = cache.get(faq_cache_key(user, active_mailbox), {}).get("lastUID")
        try:
            return int(val) if val is not None else None
        except (TypeError, ValueError):
            return None

    def set_faq_last_uid(cache: Dict[str, Any], uid: int) -> None:
        import datetime
        key = faq_cache_key(user, active_mailbox)
        cache[key] = {
            "lastUID": uid,
            "syncedAt": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    def checkpoint(cache: Dict[str, Any], cur: int, last: Optional[int]) -> None:
        if cur > (last or 0):
            set_faq_last_uid(cache, cur)
            _save_sync_cache(cache)

    try:
        ctx = ssl.create_default_context()
        if not ssl_verify:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

        mail = imaplib.IMAP4_SSL(host, port, ssl_context=ctx)
        mail.login(user, password)

        sync_cache = _load_sync_cache()

        mailboxes_to_try = [mailbox]
        if "gmail" in host.lower() and mailbox.upper() == "INBOX":
            mailboxes_to_try = ["[Gmail]/All Mail", "[Google Mail]/All Mail", "INBOX"]

        uids: List[str] = []
        active_mailbox: str = mailbox
        last_faq_uid: Optional[int] = None

        for mbox in mailboxes_to_try:
            try:
                status, _ = mail.select(mbox)
                if status != "OK":
                    continue
                active_mailbox = mbox
                last_faq_uid = get_faq_last_uid(sync_cache)

                if last_faq_uid:
                    search_query = f"UID {last_faq_uid + 1}:*"
                    _, data = mail.uid("search", None, search_query)
                else:
                    if include_read:
                        _, data = mail.uid("search", None, "ALL")
                    else:
                        _, data = mail.uid("search", None, "UNSEEN")

                raw = data[0]
                s = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
                found = [u for u in s.split() if u.isdigit()]

                if found:
                    uids = found[-max_emails:]
                    break
            except Exception:
                continue

        if not uids:
            result["success"] = True
            result["hint"] = "No new emails since last FAQ sync." if last_faq_uid else "No emails found."
            mail.logout()
            return result

        result["scanned"] = len(uids)

        # Own-email addresses — never process our own replies as FAQ queries
        own_emails: set = set()
        for env_key in ("SENDER_EMAIL", "IMAP_USER"):
            addr = os.environ.get(env_key, "").strip().lower()
            if addr:
                own_emails.add(addr)
        if user:
            own_emails.add(user.strip().lower())

        # Build existing FAQ dedup set so we never re-process/re-reply
        faq_known_ids = get_faq_dedup_ids()

        total = len(uids)
        done  = 0
        max_uid_seen: int = last_faq_uid or 0

        if progress_callback:
            try:
                progress_callback({"total": total, "done": 0, "faqAnswered": 0, "errorsCount": 0})
            except Exception:
                pass

        for uid in uids:
            current_uid = int(uid)
            if current_uid > max_uid_seen:
                max_uid_seen = current_uid
            try:
                _, msg_data = mail.uid("fetch", uid, "(RFC822)")
                raw_bytes = _extract_raw_message(
                    list(msg_data) if hasattr(msg_data, "__iter__") else msg_data
                )
                if not raw_bytes:
                    result["errors"].append(f"Message {uid}: could not extract raw bytes")
                    checkpoint(sync_cache, max_uid_seen, last_faq_uid)
                    continue

                msg = email.message_from_bytes(raw_bytes, policy=email_policy.default)

                subject    = _decode_header_value(msg.get("Subject", "(No subject)") or "(No subject)")
                from_addr  = _format_address(msg.get("From", ""))
                to_addr    = _format_address(msg.get("To", ""))
                message_id = _decode_header_value(msg.get("Message-ID", "")).strip() or None
                date_hdr   = msg.get("Date", "")
                dedup_key  = message_id or f"{subject}|{from_addr}|{date_hdr}"

                # Skip our own outbound emails
                if _is_own_email(from_addr, own_emails):
                    result["skipped"] += 1
                    checkpoint(sync_cache, max_uid_seen, last_faq_uid)
                    continue

                # Skip already-processed FAQ emails (dedup by messageId or subject|from)
                mid_n = (message_id or "").strip().lower()
                sf_n  = f"{subject.strip().lower()}|{from_addr.strip().lower()}"
                if mid_n in faq_known_ids or sf_n in faq_known_ids:
                    result["skipped"] += 1
                    checkpoint(sync_cache, max_uid_seen, last_faq_uid)
                    continue

                body_text = _extract_body_text(msg)

                try:
                    faq_result = process_faq_email(
                        from_addr, to_addr, subject, body_text,
                        message_id=message_id,
                    )
                    if faq_result.get("is_faq"):
                        matched_faq = None
                        if faq_result.get("faq_question"):
                            matched_faq = {
                                "question": faq_result["faq_question"],
                                "answer":   faq_result.get("answer", ""),
                                "category": faq_result.get("faq_category", ""),
                            }
                        elif faq_result.get("answered") and faq_result.get("answer"):
                            matched_faq = {
                                "question": None,
                                "answer":   faq_result["answer"],
                                "category": "",
                            }
                        save_faq_email(
                            from_addr, to_addr, subject, body_text, matched_faq,
                            message_id=message_id,
                        )
                        # Update in-memory dedup so further UIDs in this same run
                        # won't re-process the same email
                        if mid_n:
                            faq_known_ids.add(mid_n)
                        faq_known_ids.add(sf_n)

                        if faq_result.get("answered"):
                            result["faqAnswered"] += 1
                        else:
                            result["faqError"] += 1
                    else:
                        result["skipped"] += 1
                except Exception as faq_err:
                    print(f"FAQ-only sync error for '{subject[:60]}': {faq_err}", file=sys.stderr)
                    result["faqError"] += 1

                checkpoint(sync_cache, max_uid_seen, last_faq_uid)

            except Exception as e:
                result["errors"].append(f"Message {uid}: {e}")
                checkpoint(sync_cache, max_uid_seen, last_faq_uid)

            done += 1
            if progress_callback:
                try:
                    progress_callback({
                        "total": total,
                        "done": done,
                        "faqAnswered": result["faqAnswered"],
                        "errorsCount": len(result["errors"]),
                    })
                except Exception:
                    pass

        # Final flush
        if max_uid_seen > (last_faq_uid or 0):
            set_faq_last_uid(sync_cache, max_uid_seen)
            _save_sync_cache(sync_cache)

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
