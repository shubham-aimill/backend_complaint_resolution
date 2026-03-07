"""
Auto Email Response Service — Consumer Electronics Complaint Resolution System.

Sends automated email replies to customers based on the auto-decision generated
by the Validation Engine and Decision Engine. Uses the same SMTP configuration
as the FAQ service.

Supported decision codes:
  REQUEST_DOCUMENTS  — politely ask for missing documents (invoice, etc.)
  DESK_REJECT        — inform the customer the complaint cannot be processed
                       (e.g. out of warranty)
  APPROVE_REPAIR     — confirm the complaint is approved for repair
  APPROVE_REPLACEMENT — confirm the complaint is approved for replacement
  INVESTIGATE        — acknowledge receipt and inform of manual review
"""

import os
import smtplib
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.common.config import ENV_FILE


# ── Env loading ─────────────────────────────────────────────────────────────

def _load_env() -> None:
    if ENV_FILE.exists():
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    os.environ.setdefault(key.strip(), val.strip().strip("'\""))


# ── Email body builders ──────────────────────────────────────────────────────

def _build_request_documents_body(
    customer_name: str,
    product_name: str,
    missing_docs: List[str],
    complaint_id: str,
) -> str:
    doc_list = "\n".join(f"  • {doc.replace('_', ' ').title()}" for doc in missing_docs)
    return f"""Dear {customer_name or 'Valued Customer'},

Thank you for contacting our Customer Support team regarding your {product_name or 'product'}.

We have received your complaint (Reference: {complaint_id}) and are committed to resolving 
your issue as quickly as possible. However, we are unable to proceed without the following 
required documents:

{doc_list}

Please reply to this email with the above documents attached, or upload them at:
  https://support.electronics.com/complaints/{complaint_id}

Once we receive the required information, we will review your complaint and respond 
within 2 business days.

We apologise for any inconvenience caused and appreciate your patience.

Kind regards,
Customer Support Team
Consumer Electronics"""


def _build_desk_reject_body(
    customer_name: str,
    product_name: str,
    complaint_id: str,
    warranty_expiry: Optional[str],
    purchase_date: Optional[str],
) -> str:
    warranty_info = ""
    if purchase_date and warranty_expiry:
        warranty_info = (
            f"\nOur records (or the documents provided) indicate that your product was purchased "
            f"on {purchase_date}, and the manufacturer's warranty expired on {warranty_expiry}."
        )

    return f"""Dear {customer_name or 'Valued Customer'},

Thank you for contacting Consumer Electronics Customer Support regarding your 
{product_name or 'product'} (Complaint Reference: {complaint_id}).

We have carefully reviewed your complaint. Unfortunately, we are unable to process 
this complaint under our warranty or guarantee scheme for the following reason:

  Reason: The product is outside its manufacturer's warranty period.
{warranty_info}

Options available to you:
  1. Out-of-warranty repair service — we can provide a paid repair quote.
     Please contact our service centre at: repairs@electronics.com
  2. Extended warranty — if you purchased an extended warranty, please provide
     your extended warranty certificate number.
  3. Consumer rights — depending on your jurisdiction, statutory consumer rights
     may still apply. Please contact your local consumer authority for guidance.

If you believe this decision has been made in error, or if you have additional 
evidence (e.g. a different purchase date or extended warranty), please reply to 
this email within 14 days and we will be happy to re-evaluate your case.

We apologise for any inconvenience caused.

Kind regards,
Customer Support Team
Consumer Electronics"""


def _build_approval_body(
    customer_name: str,
    product_name: str,
    complaint_id: str,
    decision: str,
    next_steps: List[str],
) -> str:
    action_label = "repair" if decision == "APPROVE_REPAIR" else "replacement"
    steps = "\n".join(f"  {i+1}. {step}" for i, step in enumerate(next_steps)) if next_steps else (
        f"  1. Our technical team will contact you within 48 hours to arrange the {action_label}.\n"
        f"  2. Please have your product and proof of purchase ready.\n"
        f"  3. If a courier collection is required, we will arrange this at no cost to you."
    )
    return f"""Dear {customer_name or 'Valued Customer'},

Great news! We have reviewed your complaint (Reference: {complaint_id}) regarding your 
{product_name or 'product'} and are pleased to inform you that your complaint has been 
APPROVED for {action_label.upper()}.

Next steps:
{steps}

Please keep this email for your records. If you have any questions in the meantime, 
do not hesitate to contact us:
  Email: support@electronics.com
  Phone: 1-800-ELEC-HELP (Mon–Fri, 9am–6pm)

Thank you for your patience throughout this process. We are committed to ensuring 
you have the best possible experience with our products.

Kind regards,
Customer Support Team
Consumer Electronics"""


def _build_investigate_body(
    customer_name: str,
    product_name: str,
    complaint_id: str,
) -> str:
    return f"""Dear {customer_name or 'Valued Customer'},

Thank you for contacting Consumer Electronics Customer Support.

We have received your complaint (Reference: {complaint_id}) regarding your 
{product_name or 'product'} and have assigned it to our specialist team for review.

What happens next:
  1. A member of our team will review all the information and documents you have 
     provided within 2 business days.
  2. We may contact you if we require any additional information.
  3. You will receive a follow-up email with our findings and proposed resolution 
     within 5 business days.

You can check the status of your complaint at any time at:
  https://support.electronics.com/complaints/{complaint_id}

We appreciate your patience and will work hard to resolve your complaint fairly 
and promptly.

Kind regards,
Customer Support Team
Consumer Electronics"""


# ── SMTP sender ──────────────────────────────────────────────────────────────

def _send_email(to_addr: str, subject: str, body: str) -> None:
    """Send a plain-text email via SMTP using credentials from .env."""
    _load_env()
    sender_email   = os.environ.get("SENDER_EMAIL", "")
    email_password = os.environ.get("EMAIL_PASSWORD", "").replace(" ", "")
    smtp_host      = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port      = int(os.environ.get("SMTP_PORT", "587"))

    if not sender_email or not email_password:
        raise ValueError(
            "Email credentials not configured. "
            "Set SENDER_EMAIL and EMAIL_PASSWORD in .env"
        )

    msg = MIMEMultipart("alternative")
    msg["From"]    = f"Customer Support <{sender_email}>"
    msg["To"]      = to_addr
    msg["Subject"] = subject

    # Plain text version
    msg.attach(MIMEText(body, "plain"))
    # HTML version (simple line-break conversion)
    html_body = body.replace("\n", "<br>")
    msg.attach(MIMEText(f"<pre style='font-family:Arial,sans-serif'>{html_body}</pre>", "html"))

    server = smtplib.SMTP(smtp_host, smtp_port)
    server.starttls()
    server.login(sender_email, email_password)
    server.send_message(msg)
    server.quit()


# ── Public API ───────────────────────────────────────────────────────────────

def send_auto_response(
    to_addr: str,
    customer_name: str,
    complaint_id: str,
    decision: str,
    product_name: Optional[str] = None,
    missing_docs: Optional[List[str]] = None,
    warranty_expiry: Optional[str] = None,
    purchase_date: Optional[str] = None,
    next_steps: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Send the appropriate automated email response based on the decision code.

    Args:
        to_addr:        Customer's email address.
        customer_name:  Customer's display name.
        complaint_id:   Complaint reference ID.
        decision:       One of REQUEST_DOCUMENTS, DESK_REJECT, APPROVE_REPAIR,
                        APPROVE_REPLACEMENT, INVESTIGATE.
        product_name:   Name/model of the product.
        missing_docs:   List of missing document labels (for REQUEST_DOCUMENTS).
        warranty_expiry: Warranty expiry date string (for DESK_REJECT).
        purchase_date:  Purchase date string (for DESK_REJECT).
        next_steps:     Custom next-step instructions (for APPROVE_* decisions).

    Returns:
        {"sent": bool, "decision": str, "to": str, "error": str | None}
    """
    _load_env()

    if not to_addr or "@" not in to_addr:
        return {
            "sent": False,
            "decision": decision,
            "to": to_addr,
            "error": "Invalid or missing recipient email address.",
        }

    try:
        if decision == "REQUEST_DOCUMENTS":
            subject = f"Action Required: Documents Needed — Complaint {complaint_id}"
            body    = _build_request_documents_body(
                customer_name, product_name or "your product",
                missing_docs or ["purchase_invoice"], complaint_id,
            )

        elif decision == "DESK_REJECT":
            subject = f"Your Complaint Has Been Reviewed — {complaint_id}"
            body    = _build_desk_reject_body(
                customer_name, product_name or "your product",
                complaint_id, warranty_expiry, purchase_date,
            )

        elif decision in ("APPROVE_REPAIR", "APPROVE_REPLACEMENT"):
            subject = f"Your Complaint Has Been Approved — {complaint_id}"
            body    = _build_approval_body(
                customer_name, product_name or "your product",
                complaint_id, decision, next_steps or [],
            )

        else:  # INVESTIGATE or any other fallback
            subject = f"We Have Received Your Complaint — {complaint_id}"
            body    = _build_investigate_body(
                customer_name, product_name or "your product", complaint_id,
            )

        _send_email(to_addr, subject, body)
        return {"sent": True, "decision": decision, "to": to_addr, "error": None}

    except Exception as exc:
        print(f"Auto-response send failed ({decision} → {to_addr}): {exc}", file=sys.stderr)
        return {"sent": False, "decision": decision, "to": to_addr, "error": str(exc)}
