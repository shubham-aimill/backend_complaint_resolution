"""
Ingested Complaints Service.

Manages raw complaints ingested from email before AI processing.
Handles CRUD, deduplication, and attachment file storage.
"""

import json
import re
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


# ── Deduplication helpers ──────────────────────────────────────────────────

def _normalize(s: str) -> str:
    return s.strip().lower()

def _subject_from_key(subject: str, from_addr: str) -> str:
    return _normalize(f"{subject}|{from_addr}")

def get_existing_message_ids() -> Set[str]:
    complaints = _load_complaints()
    ids: Set[str] = set()
    for c in complaints:
        ids.add(_subject_from_key(c.get("subject", ""), c.get("from", "")))
        mid = c.get("messageId", "")
        if mid:
            ids.add(_normalize(mid))
            ids.add(_normalize(mid.replace("<", "").replace(">", "").strip()))
    return ids

def add_dedup_keys_to_set(ids: Set[str], subject: str, from_addr: str, message_id: str, dedup_key: str) -> None:
    ids.add(_subject_from_key(subject, from_addr))
    ids.add(_normalize(dedup_key))
    if message_id:
        ids.add(_normalize(message_id.replace("<", "").replace(">", "").strip()))

def is_duplicate_email(subject: str, from_addr: str, message_id: str, date_header: str, existing_ids: Set[str]) -> bool:
    if _subject_from_key(subject, from_addr) in existing_ids:
        return True
    dedup_key = message_id or f"{subject}|{from_addr}|{date_header}"
    if _normalize(dedup_key) in existing_ids:
        return True
    if message_id:
        inner = message_id.replace("<", "").replace(">", "").strip()
        if inner and _normalize(inner) in existing_ids:
            return True
    return False


# ── Reference extraction ───────────────────────────────────────────────────

def extract_complaint_reference(text: str) -> Optional[str]:
    """Extract customer/order/complaint reference number from email text."""
    patterns = [
        r"\bCUST\d{3,}\b",
        r"\bORD[-\s]?\d{4,}\b",
        r"customer\s*(?:id|#|number|ref|reference)\s*[:\-]?\s*([A-Z0-9]{4,})",
        r"complaint\s*(?:id|#|number|ref|reference)\s*[:\-]?\s*([A-Z0-9]{4,})",
        r"order\s*(?:id|#|number|ref|reference)\s*[:\-]?\s*([A-Z0-9]{4,})",
        r"ticket\s*(?:id|#|number|ref|reference)\s*[:\-]?\s*([A-Z0-9]{4,})",
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
) -> Dict[str, Any]:
    """Save a raw complaint from email to the ingested complaints store."""
    complaint_id = f"ING-{int(time.time() * 1000)}-{uuid.uuid4().hex[:7]}"

    # Try extracting a reference from subject first, then body
    extracted_ref = extract_complaint_reference(subject) or extract_complaint_reference(email_body)
    if not extracted_ref and (email_message_id_for_display or message_id):
        mid = email_message_id_for_display or message_id or ""
        inner = mid.replace("<", "").replace(">", "").strip()
        extracted_ref = inner or complaint_id
    complaint_ref = extracted_ref or complaint_id

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

    complaint: Dict[str, Any] = {
        "id":           complaint_id,
        "complaintRef": complaint_ref,
        "from":         from_addr,
        "to":           to_addr,
        "subject":      subject,
        "emailBody":    email_body,
        "attachments":  attachments,
        "createdAt":    _iso_now(),
        "source":       source,
    }
    if message_id:
        complaint["messageId"] = message_id

    complaints = _load_complaints()
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
    has_real = any(c.get("source") in ("imap", "sendgrid") for c in complaints)
    if has_real:
        return [c for c in complaints if c.get("source") != "demo"]
    return complaints

# Alias


def get_ingested_complaint_by_id(complaint_id: str) -> Optional[Dict[str, Any]]:
    return next((c for c in _load_complaints() if c.get("id") == complaint_id), None)

# Alias


def get_complaint_references() -> List[Dict[str, str]]:
    """Return lightweight reference list for frontend dropdown."""
    complaints = _load_complaints()
    has_real = any(c.get("source") in ("imap", "sendgrid") for c in complaints)
    to_show = [c for c in complaints if c.get("source") != "demo"] if has_real else complaints
    return [
        {
            "id":           c["id"],
            "complaintRef": c.get("complaintRef", c["id"]),
            "subject":      c.get("subject", ""),
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
