"""
FAQ Auto-Resolution Service.

Detects if an incoming customer email is a simple FAQ query (rather than a
genuine complaint), then delegates to rag/service.py for product-scoped
manual-grounded answers.

Flow:
  email arrives → _is_faq_query() → if FAQ:
    → rag.service.process_faq_email()
        → identify product_id from email
        → verify customer + product + warranty
        → semantic_search(product_id=...) [HARD filtered to that product]
        → generate_answer() with product-specific prompt
        → send personalised reply with page citations
"""

import csv
import json
import os
import re
import sys
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from backend.common.config import ENV_FILE, PROJECT_ROOT

FAQ_CSV_FILE = (
    Path(os.getenv("FAQ_CSV_FILE"))
    if os.getenv("FAQ_CSV_FILE")
    else PROJECT_ROOT / "data" / "FAQ.csv"
)

_FAQ_WRITE_LOCK = threading.Lock()


def _load_env() -> None:
    if ENV_FILE.exists():
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    os.environ[key.strip()] = val.strip().strip("'\"")


def _load_faq_data() -> List[Dict[str, str]]:
    faqs: List[Dict[str, str]] = []
    if not FAQ_CSV_FILE.exists():
        print(f"Warning: FAQ.csv not found at {FAQ_CSV_FILE}", file=sys.stderr)
        return faqs
    try:
        with open(FAQ_CSV_FILE, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                q = row.get("Question", "").strip()
                a = row.get("Answer", "").strip()
                if q and a:
                    faqs.append({
                        "question": q,
                        "answer":   a,
                        "category": row.get("Category", "").strip(),
                    })
    except Exception as e:
        print(f"Error loading FAQ.csv: {e}", file=sys.stderr)
    return faqs


def _is_faq_query(subject: str, body: str) -> bool:
    """
    Return True only if the email is a genuine information-seeking FAQ query.
    Strict exclusions come first — any complaint/claim/repair disqualifies.
    """
    _load_env()
    text = f"{subject} {body}".lower()

    complaint_indicators = [
        r"\bcomplaint\b", r"\bcomplaints\b",
        r"\bescalate\b", r"\bescalation\b",
        r"\bformal\s+complaint\b",
        r"\blegal\s+action\b", r"\btrading\s+standards\b", r"\bombudsman\b",
        r"\bclaim\b", r"\bclaims\b",
        r"\bfile\s+a\s+claim\b", r"\bsubmit\s+a\s+claim\b",
        r"\bopen\s+a\s+claim\b", r"\bclaim\s+status\b",
        r"\bwarranty\s+claim\b",
        r"\bpolicy\s*[#\d]",
        r"\bpolicy\s+number\b",
        r"\bpolicy\s+expir",
        r"\binsurance\b",
        r"\brefund\b", r"\brefund\s+request\b",
        r"\bnot\s+working\b", r"\bdefective\b", r"\bbroken\b",
        r"\bnot\s+cooling\b", r"\bno\s+picture\b", r"\bno\s+sound\b",
        r"\bwater\s+leak\b", r"\bdissatisfied\b", r"\bunhappy\b",
    ]
    for pattern in complaint_indicators:
        if re.search(pattern, text, re.IGNORECASE):
            return False

    faq_indicators = [
        r"\bhow\s+(do|can|should|to|does)\b",
        r"\bwhat\s+(is|are|does|do)\b",
        r"\bcan\s+I\b",
        r"\bhow\s+to\b",
        r"\bsteps\s+to\b",
        r"\bquestion\b",
        r"\binquiry\b",
        r"\bwant\s+to\s+know\b",
        r"\bhelp\s+me\s+(understand|set|configure|connect|use)\b",
        r"\bwhere\s+(is|are|can|do)\b",
    ]
    if not any(re.search(p, text, re.IGNORECASE) for p in faq_indicators):
        return False

    _load_env()
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return True
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        resp   = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role":    "system",
                    "content": (
                        "You classify Samsung customer emails. "
                        "Reply ONLY with 'FAQ' or 'COMPLAINT'. "
                        "FAQ = how-to questions, usage help, feature questions. "
                        "COMPLAINT = broken product, refund, warranty claim, repair request."
                    ),
                },
                {"role": "user", "content": f"Subject: {subject}\n\n{body[:1500]}"},
            ],
            max_tokens=5,
            temperature=0,
        )
        return (resp.choices[0].message.content or "").strip().upper().startswith("FAQ")
    except Exception:
        return True


def _find_faq_answer(
    question_text: str, faqs: List[Dict[str, str]]
) -> Optional[Dict[str, str]]:
    """
    Find best matching FAQ entry. Used as last-resort fallback before
    RAG manual search.
    """
    if not faqs:
        return None

    _load_env()
    api_key = os.environ.get("OPENAI_API_KEY")

    if not api_key:
        q_words    = set(question_text.lower().split())
        best, best_score = None, 0
        for faq in faqs:
            score = len(q_words & set(faq["question"].lower().split()))
            if score > best_score:
                best, best_score = faq, score
        return best if best_score >= 3 else None

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        model  = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        faq_context = "\n\n".join(
            f"Q{i+1}: {f['question']}\nA{i+1}: {f['answer']}"
            for i, f in enumerate(faqs)
        )
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role":    "system",
                    "content": (
                        "You are an FAQ matcher for Samsung customer support. "
                        "Given a customer question and a list of FAQ entries, "
                        "reply ONLY with the number of the best matching answer "
                        "(e.g. 'A3') or 'NONE' if no FAQ is a good match. "
                        "A match requires the FAQ to directly answer the question."
                    ),
                },
                {
                    "role":    "user",
                    "content": f"Customer question: {question_text}\n\nFAQ list:\n{faq_context}",
                },
            ],
            max_tokens=10,
            temperature=0,
        )
        reply = (response.choices[0].message.content or "").strip()
        m     = re.search(r"A(\d+)", reply, re.IGNORECASE)
        if m:
            idx = int(m.group(1)) - 1
            if 0 <= idx < len(faqs):
                return faqs[idx]
    except Exception as e:
        print(f"FAQ matching error: {e}", file=sys.stderr)

    return None


def _send_faq_response_email(
    to_addr: str,
    subject: str,
    original_body: str,
    answer: str,
    matched_question: Optional[str] = None,
    original_message_id: Optional[str] = None,
) -> None:
    """Send FAQ auto-reply via SMTP."""
    _load_env()
    sender   = os.environ.get("SENDER_EMAIL", "")
    password = os.environ.get("EMAIL_PASSWORD", "").replace(" ", "")
    if not sender or not password:
        raise ValueError("SENDER_EMAIL and EMAIL_PASSWORD not set in .env")

    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    body_text = (
        f"Thank you for contacting Samsung Customer Support.\n\n"
        f"{answer}\n\n"
        f"---\n"
        f"This is an automated response. If this does not answer your question, "
        f"please reply and a support agent will assist you.\n\n"
        f"Samsung Customer Support | 1-800-SAMSUNG | samsung.com/in/support"
    )

    msg            = MIMEMultipart("alternative")
    msg["From"]    = f"Samsung Support <{sender}>"
    msg["To"]      = to_addr
    msg["Subject"] = f"Re: {subject}"
    if original_message_id:
        msg["In-Reply-To"] = original_message_id
        msg["References"]  = original_message_id

    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_text.replace("\n", "<br>"), "html"))

    server = smtplib.SMTP(
        os.environ.get("SMTP_HOST", "smtp.gmail.com"),
        int(os.environ.get("SMTP_PORT", "587")),
    )
    server.starttls()
    server.login(sender, password)
    server.send_message(msg)
    server.quit()


# ══════════════════════════════════════════════════════════════════════════
# PUBLIC API — called by email_ingestion/service.py
# ══════════════════════════════════════════════════════════════════════════

def process_faq_email(
    from_addr: str,
    to_addr: str,
    subject: str,
    email_body: str,
    message_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Main entry point. Delegates to rag.service.process_faq_email for
    product-scoped, manual-grounded answers.

    Falls back to FAQ.csv matching if RAG is unavailable.
    """
    try:
        # ── Step 1: Is this an FAQ or complaint? ──────────────────────────
        if not _is_faq_query(subject, email_body):
            return {"is_faq": False, "answered": False, "answer": None, "error": None}

        # ── Step 2: Try RAG service (product-scoped manual answers) ───────
        try:
            from backend.rag.service import process_faq_email as rag_process_faq_email
            rag_result = rag_process_faq_email(
                from_addr=from_addr,
                to_addr=to_addr,
                subject=subject,
                email_body=email_body,
                message_id=message_id,
            )
            # RAG handled it — return result (includes verification, sources, page refs)
            if rag_result.get("answered"):
                return rag_result
        except Exception as rag_err:
            print(f"RAG service error, falling back to FAQ.csv: {rag_err}", file=sys.stderr)

        # ── Step 3: FAQ.csv fallback (if RAG unavailable or failed) ───────
        faqs = _load_faq_data()
        if not faqs:
            return {
                "is_faq":   True,
                "answered": False,
                "answer":   None,
                "error":    "FAQ.csv is empty or missing and RAG service failed.",
            }

        question_text = f"{subject} {email_body[:500]}"
        faq_match = _find_faq_answer(question_text, faqs)

        if not faq_match:
            generic = (
                "We have received your enquiry and are looking into it.\n\n"
                "One of our support specialists will review your message and respond "
                "with a personalised answer within 2 business days.\n\n"
                "If your matter is urgent, please call us at 1-800-SAMSUNG "
                "(Monday – Friday, 9am – 6pm)."
            )
            _send_faq_response_email(
                from_addr, subject, email_body, generic,
                original_message_id=message_id,
            )
            return {"is_faq": True, "answered": True, "answer": generic, "error": None}

        _send_faq_response_email(
            from_addr, subject, email_body,
            faq_match["answer"], faq_match["question"],
            original_message_id=message_id,
        )
        return {
            "is_faq":        True,
            "answered":      True,
            "answer":        faq_match["answer"],
            "faq_question":  faq_match["question"],
            "faq_category":  faq_match.get("category", ""),
            "error":         None,
        }

    except Exception as e:
        return {"is_faq": True, "answered": False, "answer": None, "error": str(e)}


def get_all_faqs() -> List[Dict[str, str]]:
    """Return all FAQ entries from FAQ.csv."""
    return _load_faq_data()


# ── FAQ email storage (populated during inbox sync) ────────────────────────

def _load_faq_emails_store() -> List[Dict[str, Any]]:
    from backend.common.config import FAQ_EMAILS_FILE, ensure_data_dir
    ensure_data_dir()
    if not FAQ_EMAILS_FILE.exists():
        return []
    try:
        return json.loads(FAQ_EMAILS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _save_faq_emails_store(records: List[Dict[str, Any]]) -> None:
    from backend.common.config import FAQ_EMAILS_FILE, ensure_data_dir
    ensure_data_dir()
    FAQ_EMAILS_FILE.write_text(json.dumps(records, indent=2), encoding="utf-8")


def _faq_iso_now() -> str:
    import datetime
    import time as _time
    dt = datetime.datetime.utcfromtimestamp(_time.time())
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def save_faq_email(
    from_addr: str,
    to_addr: str,
    subject: str,
    body_text: str,
    matched_faq: Optional[Dict[str, Any]],
    message_id: Optional[str] = None,
) -> None:
    """Save a FAQ email record to faq-emails.json with camelCase field names matching the frontend FaqEmail interface."""
    now = _faq_iso_now()
    # Composite dedup key for emails without a Message-ID header
    dedup_subject_from = f"{subject.strip().lower()}|{from_addr.strip().lower()}"
    record: Dict[str, Any] = {
        "id":               str(uuid.uuid4()),
        "from":             from_addr,
        "to":               to_addr,
        "subject":          subject,
        "emailBody":        body_text,
        "createdAt":        now,
        "matchedFaq":       matched_faq,
        # Dedup keys stored so get_faq_dedup_ids can rebuild the full set on restart
        "messageId":        message_id,
        "dedupSubjectFrom": dedup_subject_from,
    }
    with _FAQ_WRITE_LOCK:
        store = _load_faq_emails_store()
        store.append(record)
        _save_faq_emails_store(store)


def get_all_faq_emails() -> List[Dict[str, Any]]:
    return _load_faq_emails_store()


def clear_faq_emails() -> int:
    with _FAQ_WRITE_LOCK:
        store = _load_faq_emails_store()
        count = len(store)
        _save_faq_emails_store([])
        return count


def get_faq_dedup_ids() -> Set[str]:
    """Return the full dedup set from disk: both messageId and subject|from composite keys."""
    store = _load_faq_emails_store()
    ids: Set[str] = set()
    for r in store:
        mid = r.get("messageId") or r.get("message_id")
        if mid:
            ids.add(mid.strip().lower())
        sf = r.get("dedupSubjectFrom")
        if sf:
            ids.add(sf)
    return ids