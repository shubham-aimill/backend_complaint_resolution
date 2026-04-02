"""
FAQ Auto-Resolution Service.

Detects if an incoming customer email is a simple FAQ query (rather than a
genuine complaint), finds the best matching answer from FAQ.csv, and sends
an automated email response in-thread so the complaint queue stays clean.
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

FAQ_CSV_FILE = Path(os.getenv("FAQ_CSV_FILE")) if os.getenv("FAQ_CSV_FILE") else PROJECT_ROOT / "data" / "FAQ.csv"

# Serialises writes to faq-emails.json to prevent concurrent syncs producing
# duplicate records.
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
                    faqs.append({"question": q, "answer": a, "category": row.get("Category", "").strip()})
    except Exception as e:
        print(f"Error loading FAQ.csv: {e}", file=sys.stderr)
    return faqs


def _is_faq_query(subject: str, body: str) -> bool:
    """
    Return True only if the email is a genuine information-seeking FAQ query.

    Strict exclusion rules come first: any complaint, claim, policy reference,
    repair request, or product issue disqualifies the email immediately.
    """
    _load_env()
    text = f"{subject} {body}".lower()

    # ── Hard exclusions — if any match the email is NOT an FAQ ──────────────
    complaint_indicators = [
        # Explicit complaint / escalation language
        r"\bcomplaint\b", r"\bcomplaints\b",
        r"\bescalate\b", r"\bescalation\b",
        r"\bformal\s+complaint\b",
        r"\blegal\s+action\b", r"\btrading\s+standards\b", r"\bombudsman\b",

        # Claim / policy / insurance — these belong in the complaint queue
        r"\bclaim\b", r"\bclaims\b",
        r"\bfile\s+a\s+claim\b", r"\bsubmit\s+a\s+claim\b",
        r"\bopen\s+a\s+claim\b", r"\bclaim\s+status\b",
        r"\bwarranty\s+claim\b",
        r"\bpolicy\s*[#\d]",        # "Policy #HO456789234"
        r"\bpolicy\s+number\b",
        r"\bpolicy\s+expir",        # "policy will expire"
        r"\binsurance\b",

        # Refund / billing disputes
        r"\brefund\b", r"\brefund\s+request\b", r"\bdemand.*refund\b",
        r"\bovercharged\b", r"\bbilling\s+error\b",

        # Product defects / failures
        r"\bnot\s+working\b", r"\bdefective\b", r"\bfaulty\b",
        r"\bbroken\b", r"\bdamaged\b",
        r"\bstopped\s+working\b", r"\bmalfunction",
        r"\bdead\s+on\s+arrival\b", r"\bdoa\b",
        r"\bno\s+cooling\b", r"\bnot\s+cooling\b",
        r"\bdisconnecting\b", r"\bdisconnected\b",

        # Delivery / order issues
        r"\bnot\s+received\b", r"\bnever\s+arrived\b",
        r"\bmissing\s+order\b", r"\blate\s+delivery\b",

        # Repair / replacement requests
        r"\brepair\s+request\b", r"\bneed\s+repair\b",
        r"\breplacement\b",
        r"\bunder\s+warranty\b",

        # Customer sentiment
        r"\bdissatisfied\b", r"\bunhappy\b", r"\bpoor\s+service\b",
        r"\bbad\s+experience\b",

        # Attachment hints
        r"\bsee\s+attachment\b", r"\battached.*photo\b",
    ]
    for p in complaint_indicators:
        if re.search(p, text, re.IGNORECASE):
            return False

    # ── FAQ positive signals — need at least one ─────────────────────────────
    faq_indicators = [
        r"\bhow\s+(do|can|should|to|does)\b",
        r"\bwhat\s+(is|are|does|do|can)\b",
        r"\bwhen\s+(do|can|should|does|will)\b",
        r"\bwhere\s+(do|can|should|does)\b",
        r"\bcan\s+I\b", r"\bshould\s+I\b",
        r"\bdo\s+I\s+need\b", r"\bis\s+it\s+(possible|required)\b",
        r"\bquestion\b", r"\binquiry\b",
        r"\bneed\s+information\b", r"\bwant\s+to\s+know\b",
        r"\bclarification\b", r"\bexplain\b",
    ]
    has_faq = any(re.search(p, text, re.IGNORECASE) for p in faq_indicators)
    if not has_faq:
        return False

    # ── LLM tiebreaker ───────────────────────────────────────────────────────
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return has_faq

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
                        "You are an email classifier for a consumer electronics customer support team. "
                        "Reply ONLY with 'FAQ' or 'COMPLAINT'.\n\n"
                        "Reply 'FAQ' ONLY when the email is a purely informational question that can be "
                        "answered from a product manual or support knowledge base — e.g. "
                        "'How do I reset my device?', 'What is your return policy?', "
                        "'How do I connect to SmartThings?'.\n\n"
                        "Reply 'COMPLAINT' for ALL of the following:\n"
                        "- Emails describing a specific product defect, failure, or malfunction.\n"
                        "- Repair or replacement requests.\n"
                        "- Billing disputes, overcharges, or refund demands.\n"
                        "- Delivery or order problems.\n"
                        "- Any email mentioning a warranty claim, policy number, insurance, "
                        "or asking how to file or submit a claim.\n"
                        "- Any email whose subject contains 'complaint', 'issue', 'problem', "
                        "'claim', or 'urgent'.\n"
                        "When in doubt, reply 'COMPLAINT'."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Subject: {subject}\n\nBody:\n{body[:2000]}",
                },
            ],
            max_tokens=10,
            temperature=0,
        )
        answer = (response.choices[0].message.content or "").strip().upper()
        return answer.startswith("FAQ")
    except Exception as e:
        print(f"LLM FAQ detection error: {e}", file=sys.stderr)
        return has_faq


def _find_faq_answer(question_text: str, faqs: List[Dict[str, str]]) -> Optional[Dict[str, str]]:
    """
    Return the single best-matching FAQ entry for the question, or None.

    Uses the LLM only to SELECT which entry matches — the answer is always
    taken verbatim from FAQ.csv, never generated.  If the LLM cannot find
    a good match it returns NONE and this function returns None too, so the
    caller can decide whether to send a generic fallback.
    """
    if not faqs:
        return None

    _load_env()
    api_key = os.environ.get("OPENAI_API_KEY")

    if not api_key:
        # Keyword fallback: require at least 3 common meaningful words
        q_words = set(question_text.lower().split())
        best, best_score = None, 0
        for faq in faqs:
            score = len(q_words & set(faq["question"].lower().split()))
            if score > best_score:
                best, best_score = faq, score
        return best if best_score >= 3 else None

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        faq_context = "\n\n".join(
            f"Q{i+1}: {f['question']}\nA{i+1}: {f['answer']}"
            for i, f in enumerate(faqs)
        )
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an FAQ matching assistant for a consumer electronics customer support team. "
                        "Given a customer's question and a list of FAQ entries, identify the single FAQ "
                        "entry that best semantically addresses the customer's question — even if the exact "
                        "wording differs. Prioritise meaning and intent over keyword overlap. "
                        "Respond ONLY with the FAQ number (e.g. Q1, Q3) of the best match, "
                        "or 'NONE' if no FAQ adequately addresses the question. "
                        "Do NOT generate or paraphrase answers — only select a matching entry."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Customer question: {question_text}\n\nFAQ list:\n{faq_context}",
                },
            ],
            max_tokens=10,
            temperature=0,
        )
        answer = (response.choices[0].message.content or "").strip().upper()
        m = re.search(r"Q(\d+)", answer)
        if m:
            idx = int(m.group(1)) - 1
            if 0 <= idx < len(faqs):
                return faqs[idx]
        # LLM said NONE or gave unparseable output — no match
        return None
    except Exception as e:
        print(f"LLM FAQ matching error: {e}", file=sys.stderr)
        # Do NOT fall back to faqs[0] — an incorrect answer is worse than no answer.
        return None


def _send_faq_response_email(
    to_addr: str,
    original_subject: str,
    original_body: str,
    answer: str,
    matched_question: Optional[str] = None,
    original_message_id: Optional[str] = None,
) -> None:
    """
    Send automated FAQ reply via SMTP.

    When original_message_id is provided the reply is sent in-thread by
    setting the In-Reply-To and References headers.
    """
    _load_env()
    sender_email = os.environ.get("SENDER_EMAIL", "")
    email_password = os.environ.get("EMAIL_PASSWORD", "").replace(" ", "")
    if not sender_email or not email_password:
        raise ValueError("Email credentials not set. Configure SENDER_EMAIL and EMAIL_PASSWORD in .env")

    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))

    body_lines = [
        "Dear Valued Customer,",
        "",
        "Thank you for contacting Consumer Electronics Customer Support.",
        "We're happy to help with your enquiry.",
        "",
    ]
    if matched_question:
        body_lines += [
            f"Your question: {matched_question}",
            "",
            "Our answer:",
        ]
    body_lines += [
        answer,
        "",
        "─" * 60,
        "If this response does not fully address your question, or if you",
        "have a more specific issue to report, please reply to this email",
        "and a member of our team will assist you within 2 business days.",
        "",
        "For urgent matters, you can also reach us at:",
        "  Phone: 1-800-ELEC-HELP  (Monday – Friday, 9am – 6pm)",
        "  Email: support@electronics.com",
        "",
        "Kind regards,",
        "Customer Support Team",
        "Consumer Electronics",
    ]
    text_body = "\n".join(body_lines)

    msg = MIMEMultipart("alternative")
    msg["From"] = f"Customer Support <{sender_email}>"
    msg["To"] = to_addr
    # Keep the subject in the Re: prefix so the email client threads it
    subj = original_subject if original_subject.lower().startswith("re:") else f"Re: {original_subject}"
    msg["Subject"] = subj

    # Thread the reply into the original conversation
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


def process_faq_email(
    from_addr: str,
    to_addr: str,
    subject: str,
    email_body: str,
    message_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Check if the email is an FAQ query, find the answer from FAQ.csv, and
    send an in-thread reply.

    Returns: {is_faq, answered, answer, faq_question?, faq_category?, error}
    """
    try:
        if not _is_faq_query(subject, email_body):
            return {"is_faq": False, "answered": False, "answer": None, "error": None}

        faqs = _load_faq_data()
        if not faqs:
            return {"is_faq": True, "answered": False, "answer": None,
                    "error": "FAQ.csv is empty or missing."}

        question_text = f"{subject} {email_body[:500]}"
        faq_match = _find_faq_answer(question_text, faqs)

        if not faq_match:
            generic = (
                "We have received your enquiry and are looking into it.\n\n"
                "One of our support specialists will review your message and respond "
                "with a personalised answer within 2 business days.\n\n"
                "If your matter is urgent, please call us at 1-800-ELEC-HELP "
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
            "is_faq": True,
            "answered": True,
            "answer": faq_match["answer"],
            "faq_question": faq_match["question"],
            "faq_category": faq_match.get("category", ""),
            "error": None,
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
    import datetime, time as _time
    dt = datetime.datetime.utcfromtimestamp(_time.time())
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _normalize_faq(s: str) -> str:
    return s.strip().lower()


def get_faq_dedup_ids() -> Set[str]:
    """
    Return the set of dedup keys already stored in faq-emails.json.

    This is merged into the main existing_ids set at the start of each sync
    so that FAQ emails processed in a previous sync are never re-processed.
    """
    records = _load_faq_emails_store()
    ids: Set[str] = set()
    for r in records:
        mid = r.get("messageId", "")
        if mid:
            ids.add(_normalize_faq(mid))
            ids.add(_normalize_faq(mid.replace("<", "").replace(">", "").strip()))
        subj = r.get("subject", "")
        frm  = r.get("from", "")
        if subj or frm:
            ids.add(_normalize_faq(f"{subj}|{frm}"))
    return ids


def save_faq_email(
    from_addr: str,
    to_addr: str,
    subject: str,
    email_body: str,
    matched_faq: Optional[Dict[str, str]] = None,
    message_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Persist an FAQ email to the FAQ emails store.

    Guarded by _FAQ_WRITE_LOCK and a last-chance dedup check so that
    repeated syncs never store the same email twice.
    """
    import time as _time
    record: Dict[str, Any] = {
        "id":         f"FAQ-{int(_time.time() * 1000)}-{uuid.uuid4().hex[:7]}",
        "from":       from_addr,
        "to":         to_addr,
        "subject":    subject,
        "emailBody":  email_body,
        "createdAt":  _faq_iso_now(),
        "matchedFaq": matched_faq,
    }
    if message_id:
        record["messageId"] = message_id

    with _FAQ_WRITE_LOCK:
        records = _load_faq_emails_store()

        # Last-chance dedup — check both messageId and subject|from
        if message_id:
            mid_n = _normalize_faq(message_id)
            mid_i = _normalize_faq(message_id.replace("<", "").replace(">", "").strip())
            for r in records:
                stored = r.get("messageId", "")
                if stored and (_normalize_faq(stored) == mid_n or
                               _normalize_faq(stored.replace("<", "").replace(">", "").strip()) == mid_i):
                    return r  # already stored — return existing record

        sf = _normalize_faq(f"{subject}|{from_addr}")
        for r in records:
            if _normalize_faq(f"{r.get('subject','')}|{r.get('from','')}") == sf:
                return r  # already stored — return existing record

        records.insert(0, record)
        _save_faq_emails_store(records)
    return record


def get_all_faq_emails() -> List[Dict[str, Any]]:
    """Return all stored FAQ emails (no LLM calls)."""
    return _load_faq_emails_store()


def clear_faq_emails() -> None:
    """Clear all stored FAQ emails."""
    _save_faq_emails_store([])


def get_faq_emails(emails: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Filter a list of email dicts to FAQ queries (runs LLM — prefer get_all_faq_emails for stored data)."""
    faqs = _load_faq_data()
    results: List[Dict[str, Any]] = []
    for email in emails:
        subject = email.get("subject", "")
        body = email.get("emailBody", "")
        if not _is_faq_query(subject, body):
            continue
        question_text = f"{subject} {body[:500]}"
        matched = _find_faq_answer(question_text, faqs)
        entry = dict(email)
        entry["matchedFaq"] = matched
        results.append(entry)
    return results
