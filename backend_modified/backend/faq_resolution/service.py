"""
FAQ Auto-Resolution Service.

Detects if an incoming customer email is a simple FAQ query (rather than a
genuine complaint), finds the best matching answer from FAQ.csv, and sends
an automated email response so the complaint queue stays clean.
"""

import csv
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.common.config import ENV_FILE, PROJECT_ROOT

FAQ_CSV_FILE = Path(os.getenv("FAQ_CSV_FILE")) if os.getenv("FAQ_CSV_FILE") else PROJECT_ROOT / "data" / "FAQ.csv"

def _load_env() -> None:
    if ENV_FILE.exists():
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    os.environ.setdefault(key.strip(), val.strip().strip("'\""))


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
    Return True if the email looks like a simple information request
    rather than a complaint that needs investigation.
    """
    _load_env()
    text = f"{subject} {body}".lower()

    # Complaint indicators — if present, NOT an FAQ
    complaint_indicators = [
        r"\bformal complaint\b", r"\bescalate\b",
        r"\blegal action\b", r"\btrading standards\b", r"\bombudsman\b",
        r"\brefund request\b", r"\bdemand.*refund\b",
        r"\bnot working\b", r"\bdefective\b", r"\bbroken\b",
        r"\bovercharged\b", r"\bbilling error\b",
        r"\bnot received\b", r"\bnever arrived\b",
        r"\bpoor service\b", r"\bbad experience\b",
        r"\bdissatisfied\b", r"\bunhappy\b",
        r"\bsee attachment\b", r"\battached.*photo\b",
    ]
    for p in complaint_indicators:
        if re.search(p, text, re.IGNORECASE):
            return False

    # FAQ indicators — question-style language
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

    # Use LLM for final decision
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
                        "You are an email classifier for a customer support team. "
                        "Reply ONLY with 'FAQ' if the email is asking a general question "
                        "that could be answered from a knowledge base. "
                        "Reply ONLY with 'COMPLAINT' if it describes a specific problem, "
                        "incident, or dissatisfaction that needs investigation."
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
    """Return the best matching FAQ entry for the question."""
    if not faqs:
        return None

    _load_env()
    api_key = os.environ.get("OPENAI_API_KEY")

    if not api_key:
        q_words = set(question_text.lower().split())
        best, best_score = None, 0
        for faq in faqs:
            score = len(q_words & set(faq["question"].lower().split()))
            if score > best_score:
                best, best_score = faq, score
        return best if best_score >= 2 else None

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
                    "content": "You are an FAQ matcher. Respond ONLY with the FAQ number (Q1, Q2, …) or 'NONE'.",
                },
                {
                    "role": "user",
                    "content": f"Question: {question_text}\n\nFAQ list:\n{faq_context}",
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
        return None
    except Exception as e:
        print(f"LLM FAQ matching error: {e}", file=sys.stderr)
        return faqs[0] if faqs else None


def _send_faq_response_email(
    to_addr: str,
    original_subject: str,
    original_body: str,
    answer: str,
    matched_question: Optional[str] = None,
) -> None:
    """Send automated FAQ reply via SMTP."""
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
        f"Thank you for contacting Customer Support.",
        "",
    ]
    if matched_question:
        body_lines += [f"You asked: {matched_question}", ""]
    body_lines += [
        answer, "",
        "---",
        "This is an automated response. If this does not answer your question, "
        "please reply and our team will respond within 2 business days.",
    ]
    text_body = "\n".join(body_lines)

    msg = MIMEMultipart("alternative")
    msg["From"] = f"Customer Support <{sender_email}>"
    msg["To"] = to_addr
    msg["Subject"] = f"Re: {original_subject}"
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
) -> Dict[str, Any]:
    """
    Check if the email is an FAQ query, find the answer, and send a reply.

    Returns:
        {is_faq, answered, answer, error}
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
                "Thank you for your enquiry. We have received your message and a "
                "member of our team will respond within 2 business days."
            )
            _send_faq_response_email(from_addr, subject, email_body, generic)
            return {"is_faq": True, "answered": True, "answer": generic, "error": None}

        _send_faq_response_email(
            from_addr, subject, email_body,
            faq_match["answer"], faq_match["question"],
        )
        return {
            "is_faq": True,
            "answered": True,
            "answer": faq_match["answer"],
            "faq_question": faq_match["question"],
            "error": None,
        }
    except Exception as e:
        return {"is_faq": True, "answered": False, "answer": None, "error": str(e)}
