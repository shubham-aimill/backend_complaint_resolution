"""
Ingested Complaints Service.

Manages raw complaints ingested from email before AI processing.
Handles CRUD, deduplication, and attachment file storage.
"""

import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from backend.common.config import (
    INGESTED_COMPLAINTS_FILE,
    INGESTED_DIR,
    PROJECT_ROOT,
    ensure_data_dir,
)


# Serialises all writes to ingested-complaints.json.  Prevents two concurrent
# IMAP sync threads from both passing the in-memory dedup check and then both
# writing the same complaint to disk.
_WRITE_LOCK = threading.Lock()


# ── Deduplication helpers ──────────────────────────────────────────────────

def _normalize(s: str) -> str:
    return s.strip().lower()

def _strip_brackets(mid: str) -> str:
    return mid.replace("<", "").replace(">", "").strip()

def _subject_from_key(subject: str, from_addr: str) -> str:
    return _normalize(f"{subject}|{from_addr}")

def get_existing_message_ids() -> Set[str]:
    """
    Build the full deduplication set from every record in the store.

    For each record we add:
      - subject|from  (catches re-sends of the same email)
      - messageId  (canonical RFC 5322 ID, with and without angle-brackets)
      - inReplyTo   (outbound OUT-... entries store the inbound message's ID here;
                     adding it means any incoming email whose Message-ID matches
                     an already-replied-to ID is recognised as known)
      - references[]  (thread chain; any ID already in the chain is known)

    This covers the case where an outbound auto-reply is stored but has no
    messageId of its own — its inReplyTo still points to the original inbound
    complaint's messageId, so re-scans of that original email are caught.
    """
    complaints = _load_complaints()
    ids: Set[str] = set()
    for c in complaints:
        # subject|from dedup (works even when Message-ID is absent)
        ids.add(_subject_from_key(c.get("subject", ""), c.get("from", "")))

        # Own messageId
        mid = c.get("messageId", "")
        if mid:
            ids.add(_normalize(mid))
            ids.add(_normalize(_strip_brackets(mid)))

        # inReplyTo — critical for outbound (OUT-...) entries:
        # their inReplyTo == the original inbound complaint's messageId.
        # Adding it means a duplicate scan of that inbound email is caught.
        irt = c.get("inReplyTo", "")
        if irt:
            ids.add(_normalize(irt))
            ids.add(_normalize(_strip_brackets(irt)))

        # references — full thread chain; every ID in it is "already seen"
        for ref in c.get("references", []):
            if ref:
                ids.add(_normalize(ref))
                ids.add(_normalize(_strip_brackets(ref)))

    return ids

def add_dedup_keys_to_set(ids: Set[str], subject: str, from_addr: str, message_id: str, dedup_key: str) -> None:
    ids.add(_subject_from_key(subject, from_addr))
    ids.add(_normalize(dedup_key))
    if message_id:
        ids.add(_normalize(_strip_brackets(message_id)))

def is_duplicate_email(
    subject: str,
    from_addr: str,
    message_id: str,
    date_header: str,
    existing_ids: Set[str],
    in_reply_to: Optional[str] = None,
    references: Optional[List[str]] = None,
) -> bool:
    """
    Return True if this email is already known — either as a stored complaint,
    a FAQ email, or a reply in an already-processed thread.

    Checks (in order):
      1. subject|from  — exact re-send
      2. messageId     — canonical RFC 5322 match
      3. in_reply_to   — this email replies to something we already have
      4. references    — any ancestor in the thread chain is already known
    """
    # 1. subject + sender match
    if _subject_from_key(subject, from_addr) in existing_ids:
        return True

    # 2. own messageId
    dedup_key = message_id or f"{subject}|{from_addr}|{date_header}"
    if _normalize(dedup_key) in existing_ids:
        return True
    if message_id:
        inner = _strip_brackets(message_id)
        if inner and _normalize(inner) in existing_ids:
            return True

    # 3. In-Reply-To points to a known message — this is a thread reply
    if in_reply_to:
        irt_n = _normalize(_strip_brackets(in_reply_to))
        if irt_n and irt_n in existing_ids:
            return True

    # 4. Any References ancestor is already known — thread member
    if references:
        for ref in references:
            ref_n = _normalize(_strip_brackets(ref))
            if ref_n and ref_n in existing_ids:
                return True

    return False


# ── Reference extraction ───────────────────────────────────────────────────

def extract_complaint_reference(text: str) -> Optional[str]:
    """Extract customer/order/complaint reference number from email text."""
    patterns = [
        r"\bCUST\d{3,}\b",
        r"\bORD[-\s]?\d{4,}\b",
        # Put longer alternatives first to avoid "ref" matching inside "reference"
        r"customer\s*(?:id|#|number|reference|ref)\s*[:\-]?\s*([A-Z0-9]{4,})",
        r"complaint\s*(?:id|#|number|reference|ref)\s*[:\-]?\s*([A-Z0-9]{4,})",
        r"order\s*(?:id|#|number|reference|ref)\s*[:\-]?\s*([A-Z0-9]{4,})",
        r"ticket\s*(?:id|#|number|reference|ref)\s*[:\-]?\s*([A-Z0-9]{4,})",
        r"reference\s*(?:#|number)?\s*[:\-]?\s*([A-Z0-9]{5,})",
        r"case\s*(?:#|number)?\s*[:\-]?\s*([A-Z0-9]{5,})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return (match.group(1) if match.lastindex else match.group(0)).strip().upper()
    return None

# Legacy alias


# ── Storage ────────────────────────────────────────────────────────────────

def _load_complaints() -> List[Dict[str, Any]]:
    ensure_data_dir()
    if not INGESTED_COMPLAINTS_FILE.exists():
        return []
    try:
        return json.loads(INGESTED_COMPLAINTS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []

def _save_complaints(complaints: List[Dict[str, Any]]) -> None:
    ensure_data_dir()
    INGESTED_COMPLAINTS_FILE.write_text(json.dumps(complaints, indent=2), encoding="utf-8")

def _iso_now(ms: Optional[int] = None) -> str:
    import datetime
    ts = (ms / 1000.0) if ms else time.time()
    dt = datetime.datetime.utcfromtimestamp(ts)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ── CRUD ───────────────────────────────────────────────────────────────────

def save_ingested_complaint(
    from_addr: str,
    to_addr: str,
    subject: str,
    email_body: str,
    attachment_files: List[Tuple[str, bytes, str]],
    source: str = "imap",
    message_id: Optional[str] = None,
    email_message_id_for_display: Optional[str] = None,
    in_reply_to: Optional[str] = None,
    references: Optional[List[str]] = None,
    email_date_display: Optional[str] = None,
) -> Dict[str, Any]:
    """Save a raw complaint from email to the ingested complaints store."""
    complaint_id = f"ING-{int(time.time() * 1000)}-{uuid.uuid4().hex[:7]}"

    # Try extracting a reference from subject first, then body
    # complaintRef should only be a real customer/order ref (e.g. CUST10001), not a fallback
    extracted_ref = extract_complaint_reference(subject) or extract_complaint_reference(email_body)
    complaint_ref = extracted_ref or None  # None means "not found" — orchestrator will use LLM extraction

    ensure_data_dir()
    complaint_dir = INGESTED_DIR / complaint_id
    complaint_dir.mkdir(parents=True, exist_ok=True)

    attachments: List[Dict[str, Any]] = []
    for name, content, mime_type in attachment_files:
        safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", name)
        file_path = complaint_dir / safe_name
        file_path.write_bytes(content)
        attachments.append({
            "name": name,
            "path": str(file_path),
            "size": len(content),
            "mimeType": mime_type or "application/octet-stream",
        })

    # Compute threadId: root of thread = first References entry, else In-Reply-To, else own Message-ID
    refs = references or []
    thread_id = refs[0] if refs else (in_reply_to or email_message_id_for_display or message_id or complaint_id)

    complaint: Dict[str, Any] = {
        "id":               complaint_id,
        "complaintRef":     complaint_ref,
        "from":             from_addr,
        "to":               to_addr,
        "subject":          subject,
        "emailBody":        email_body,
        "attachments":      attachments,
        "createdAt":        _iso_now(),
        "source":           source,
        "threadId":         thread_id,
        "processingStatus": "pending",
    }
    if message_id:
        complaint["messageId"] = message_id
    if in_reply_to:
        complaint["inReplyTo"] = in_reply_to
    if refs:
        complaint["references"] = refs
    if email_date_display:
        complaint["emailDate"] = email_date_display

    with _WRITE_LOCK:
        complaints = _load_complaints()
        # Last-chance dedup: re-check against the freshly-loaded file so that
        # two threads that both passed the in-memory check don't both write the
        # same email.  We compare on messageId (with and without angle-brackets)
        # and on the subject|from key.
        if message_id:
            mid_norm  = _normalize(message_id)
            mid_inner = _normalize(_strip_brackets(message_id))
            for c in complaints:
                stored = c.get("messageId", "")
                if stored and (_normalize(stored) == mid_norm or _normalize(_strip_brackets(stored)) == mid_inner):
                    return c  # already present — return the existing record
        subj_from = _subject_from_key(subject, from_addr)
        for c in complaints:
            if _subject_from_key(c.get("subject", ""), c.get("from", "")) == subj_from:
                return c  # already present — return the existing record

        # Remove demo records once real emails arrive
        if source in ("imap", "sendgrid"):
            complaints = [c for c in complaints if c.get("source") != "demo"]
        complaints.insert(0, complaint)
        _save_complaints(complaints)
    return complaint

# Alias for email_ingestion/service.py compatibility


def get_all_ingested_complaints() -> List[Dict[str, Any]]:
    """Return all ingested complaints (real emails only if available)."""
    complaints = _load_complaints()
    # Outbound thread entries are not new complaints and must never be processable.
    complaints = [c for c in complaints if c.get("source") != "outbound"]
    has_real = any(c.get("source") in ("imap", "sendgrid") for c in complaints)
    if has_real:
        return [c for c in complaints if c.get("source") != "demo"]
    return complaints

# Alias


def get_ingested_complaint_by_id(complaint_id: str) -> Optional[Dict[str, Any]]:
    return next((c for c in _load_complaints() if c.get("id") == complaint_id), None)

# Alias


def get_thread_by_complaint_id(complaint_id: str) -> List[Dict[str, Any]]:
    """Return all emails in the same thread as the given ingested complaint, sorted oldest-first."""
    all_complaints = _load_complaints()
    target = next((c for c in all_complaints if c.get("id") == complaint_id), None)
    if not target:
        return []
    thread_id = target.get("threadId")
    own_msg_id = target.get("messageId") or target.get("id")
    # Collect all emails that share the same threadId, or reference/reply to each other
    thread: List[Dict[str, Any]] = []
    for c in all_complaints:
        c_thread = c.get("threadId")
        c_refs   = c.get("references", [])
        c_reply  = c.get("inReplyTo", "")
        if (c_thread and thread_id and c_thread == thread_id) or \
           (own_msg_id and own_msg_id in c_refs) or \
           (c_reply and c_reply == own_msg_id):
            thread.append(c)
    # Sort oldest first
    thread.sort(key=lambda x: x.get("createdAt", ""))
    return thread


def get_complaint_references() -> List[Dict[str, str]]:
    """Return lightweight reference list for frontend dropdown."""
    complaints = _load_complaints()
    # Exclude outbound thread entries to prevent re-processing sent emails.
    complaints = [c for c in complaints if c.get("source") != "outbound"]
    has_real = any(c.get("source") in ("imap", "sendgrid") for c in complaints)
    to_show = [c for c in complaints if c.get("source") != "demo"] if has_real else complaints
    return [
        {
            "id":               c["id"],
            "complaintRef":     c.get("complaintRef", c["id"]),
            "subject":          c.get("subject", ""),
            "processingStatus": c.get("processingStatus", "pending"),
            "from":             c.get("from", ""),
            "to":               c.get("to", ""),
            "threadId":         c.get("threadId", ""),
            "createdAt":        c.get("createdAt", ""),
        }
        for c in to_show
    ]

# Alias


def clear_all_ingested_complaints() -> None:
    """Delete all ingested complaints and their attachments."""
    ensure_data_dir()
    if INGESTED_COMPLAINTS_FILE.exists():
        INGESTED_COMPLAINTS_FILE.unlink()
    if INGESTED_DIR.exists():
        import shutil
        for entry in INGESTED_DIR.iterdir():
            if entry.is_dir():
                shutil.rmtree(entry)

# Alias


def add_email_to_thread(
    complaint_id: str,
    from_addr: str,
    to_addr: str,
    subject: str,
    email_body: str,
    direction: str = "outbound",
    email_type: Optional[str] = None,
    rejection_reason: Optional[str] = None,
    rejection_details: Optional[str] = None,
    in_reply_to: Optional[str] = None,
) -> Dict[str, Any]:
    """Append an outbound (or any) email to the thread of an existing ingested complaint."""
    target = get_ingested_complaint_by_id(complaint_id)
    if not target:
        raise ValueError(f"Ingested complaint {complaint_id!r} not found")

    entry_id = f"OUT-{int(time.time() * 1000)}-{uuid.uuid4().hex[:7]}"
    entry: Dict[str, Any] = {
        "id":           entry_id,
        "complaintRef": target.get("complaintRef", complaint_id),
        "from":         from_addr,
        "to":           to_addr,
        "subject":      subject,
        "emailBody":    email_body,
        "attachments":  [],
        "createdAt":    _iso_now(),
        "source":       "outbound",
        "direction":    direction,
        "processingStatus": "thread_only",
        "threadId":     target.get("threadId", complaint_id),
        "inReplyTo":    in_reply_to or target.get("messageId") or complaint_id,
    }
    if email_type:
        entry["emailType"] = email_type
    if rejection_reason:
        entry["rejectionReason"] = rejection_reason
    if rejection_details:
        entry["rejectionDetails"] = rejection_details

    complaints = _load_complaints()
    complaints.insert(0, entry)
    _save_complaints(complaints)
    return entry


def claim_ack_slot(complaint_id: str) -> bool:
    """
    Atomically check-and-set the ``ackSent`` flag on an ingested complaint.

    Acquires ``_WRITE_LOCK``, reads the file fresh, and — if the flag is not
    already set — writes ``ackSent: True`` before returning.

    Returns:
        True  — caller may proceed to send the acknowledgement email.
        False — flag was already set; caller must skip sending.

    This prevents duplicate acknowledgements caused by:
      * SMTP success followed by a JSON-write failure in ``add_email_to_thread``
      * Two concurrent sync threads both passing the in-memory guard
      * Backend restarts between the SMTP call and the thread-record write
    """
    with _WRITE_LOCK:
        complaints = _load_complaints()
        for c in complaints:
            if c.get("id") == complaint_id:
                if c.get("ackSent"):
                    return False  # already claimed by a previous run
                c["ackSent"] = True
                _save_complaints(complaints)
                return True
    return False  # complaint not found — do not send


def mark_ingested_complaint_processed(complaint_id: str) -> bool:
    """Mark an ingested complaint as fully processed through the pipeline."""
    complaints = _load_complaints()
    for c in complaints:
        if c.get("id") == complaint_id:
            c["processingStatus"] = "processed"
            _save_complaints(complaints)
            return True
    return False


def update_complaint_status(complaint_id: str, status: str, rejection_reason: Optional[str] = None, rejection_details: Optional[str] = None) -> bool:
    """Update the status field of a processed complaint by ID."""
    from backend.dashboard.service import get_processed_complaint_by_id, save_processed_complaint
    record = get_processed_complaint_by_id(complaint_id)
    if record is None:
        return False
    record["status"] = status
    if rejection_reason:
        record["rejectionReason"] = rejection_reason
    if rejection_details:
        record["rejectionDetails"] = rejection_details
    save_processed_complaint(record)
    return True


def read_attachment_content(complaint_id: str, attachment_name: str) -> str:
    """Read text content of a saved attachment."""
    complaint = get_ingested_complaint_by_id(complaint_id)
    if not complaint:
        raise ValueError("Complaint not found")
    att = next((a for a in complaint.get("attachments", []) if a.get("name") == attachment_name), None)
    if not att or not Path(att["path"]).exists():
        raise ValueError("Attachment not found")
    ext = Path(att["name"]).suffix.lower()
    if ext in (".txt", ".csv", ".log", ".md"):
        return Path(att["path"]).read_text(encoding="utf-8", errors="replace")
    return f"[Document: {attachment_name}]"
