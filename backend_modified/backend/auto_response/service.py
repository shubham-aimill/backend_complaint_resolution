"""
Auto Email Response Service — Consumer Electronics Complaint Resolution System.

Sends automated email replies to customers based on the auto-decision generated
by the Validation Engine and Decision Engine. Uses the same SMTP configuration
as the FAQ service.

Supported decision codes:
  REQUEST_DOCUMENTS   — politely ask for missing documents (invoice, etc.)
  DESK_REJECT         — inform the customer the complaint cannot be processed
                        (e.g. out of warranty)
  APPROVE_REPAIR      — confirm the complaint is approved for repair
  APPROVE_REPLACEMENT — confirm the complaint is approved for replacement
  INVESTIGATE         — acknowledge receipt and inform of manual review
  TROUBLESHOOTING_REQUIRED — send RAG-generated manual steps to the user
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
                    os.environ[key.strip()] = val.strip().strip("'\"")


# ── Markdown → plain text converter ─────────────────────────────────────────

def _strip_markdown(text: str) -> str:
    """
    Convert LLM-generated markdown to clean plain text suitable for email.

    Handles the most common patterns produced by GPT-style models:
      **bold**  *italic*  `code`  ### headings  - / * bullet  > blockquote
    Numbered lists are preserved as-is (they are already plain text).
    Indented sub-bullets using spaces + dash/asterisk are kept with their
    leading spaces so the step hierarchy is preserved.
    """
    import re

    # Remove horizontal rules
    text = re.sub(r'^[ \t]*[-*_]{3,}[ \t]*$', '', text, flags=re.MULTILINE)

    # ATX headings (#, ##, ###) → plain line (keep text, drop the #s)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)

    # Bold+italic combinations first (order matters)
    text = re.sub(r'\*{3}(.+?)\*{3}', r'\1', text)
    text = re.sub(r'_{3}(.+?)_{3}', r'\1', text)

    # Bold
    text = re.sub(r'\*{2}(.+?)\*{2}', r'\1', text)
    text = re.sub(r'_{2}(.+?)_{2}', r'\1', text)

    # Italic
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'_(.+?)_', r'\1', text)

    # Inline code
    text = re.sub(r'`(.+?)`', r'\1', text)

    # Blockquotes
    text = re.sub(r'^>\s?', '', text, flags=re.MULTILINE)

    # Unordered bullet markers at the start of a line (keep indentation)
    text = re.sub(r'^([ \t]*)[-*+]\s+', r'\1', text, flags=re.MULTILINE)

    # Collapse 3+ consecutive blank lines to 2
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


# ── Email body builders ──────────────────────────────────────────────────────

def _build_troubleshooting_body(
    customer_name: str,
    product_name: str,
    complaint_id: str,
    troubleshooting_steps: str,
) -> str:
    steps = _strip_markdown(troubleshooting_steps)
    return f"""Dear {customer_name or 'Valued Customer'},

Thank you for contacting Consumer Electronics Customer Support. We have received your query regarding your {product_name or 'product'} (Reference: {complaint_id}).

To help resolve this issue quickly, please try the following troubleshooting steps directly from the official product manual:

{steps}

What to do next:
  If these steps resolve your issue, no further action is needed.
  If the issue persists after trying these steps, please reply directly to this email and our technical team will arrange a further investigation or repair.

We appreciate your cooperation and look forward to getting your device working perfectly again.

Kind regards,
Customer Support Team
Consumer Electronics
  Email: support@electronics.com  |  Phone: 1-800-ELEC-HELP (Mon-Fri, 9am-6pm)"""


def _build_request_documents_body(
    customer_name: str,
    product_name: str,
    missing_docs: List[str],
    complaint_id: str,
) -> str:
    doc_list = "\n".join(f"  • {doc.replace('_', ' ').title()}" for doc in missing_docs)
    return f"""Dear {customer_name or 'Valued Customer'},

Thank you for getting in touch with Consumer Electronics Customer Support.

We have received your complaint (Reference: {complaint_id}) regarding your \
{product_name or 'product'} and want to resolve this for you as quickly as possible.

To progress your complaint, we need the following document(s):

{doc_list}

These documents help us verify your purchase and process your claim efficiently.

What to do next:
  • Reply to this email with the document(s) attached, or
  • Contact us quoting your complaint reference: {complaint_id}

Once we receive the required information, our team will review your case and
respond with an outcome within 2 business days.

If you have any difficulty locating these documents, please reply and we'll
do our best to assist you.

We apologise for the additional step and appreciate your cooperation.

Kind regards,
Customer Support Team
Consumer Electronics"""


def _build_desk_reject_body(
    customer_name: str,
    product_name: str,
    complaint_id: str,
    warranty_expiry: Optional[str],
    purchase_date: Optional[str],
    reject_reason: Optional[str] = None,
) -> str:
    name    = customer_name or "Valued Customer"
    product = product_name or "product"

    if reject_reason == "physical_damage":
        return f"""Dear {name},

Thank you for contacting Consumer Electronics Customer Support regarding your
{product} (Complaint Reference: {complaint_id}).

We have carefully reviewed your complaint. Unfortunately, we are unable to process
this complaint under our warranty or guarantee scheme for the following reason:

  Reason: Physical or accidental damage caused by user misuse is not covered
  under the standard manufacturer's warranty.

Options available to you:
  1. Paid repair service — our authorised service centres can assess and repair
     your device. Please contact: repairs@electronics.com for a quote.
  2. Insurance claim — if you have device insurance, this type of damage is
     typically covered. Please contact your insurer directly.

Kind regards,
Customer Support Team
Consumer Electronics"""

    if reject_reason == "unauthorized_repair":
        return f"""Dear {name},

Thank you for contacting Consumer Electronics Customer Support regarding your
{product} (Complaint Reference: {complaint_id}).

We have carefully reviewed your complaint. Unfortunately, we are unable to process
this complaint under our warranty or guarantee scheme for the following reason:

  Reason: The manufacturer's warranty is void as the product has been repaired or
  modified by an unauthorised third party.

Options available to you:
  1. Authorised repair service — our service centres can still repair your device
     on a paid basis. Please contact: repairs@electronics.com for a quote.

Kind regards,
Customer Support Team
Consumer Electronics"""

    if reject_reason == "unsupported_product":
        return f"""Dear {name},

Thank you for contacting Consumer Electronics Customer Support regarding your
{product} (Complaint Reference: {complaint_id}).

We have carefully reviewed your complaint. Unfortunately, we are unable to process
this complaint through our current channel for the following reason:

  Reason: The product described does not fall within our supported consumer
  electronics product categories.

Kind regards,
Customer Support Team
Consumer Electronics"""

    if reject_reason == "product_not_registered":
        return f"""Dear {name},

Thank you for contacting Consumer Electronics Customer Support regarding your
{product} (Complaint Reference: {complaint_id}).

We have reviewed your complaint and verified your customer account. However,
the product in this complaint is not registered under your account details.

  Reason: Product ownership could not be mapped to your customer record.

To help us proceed, please reply with one of the following:
  1. Purchase invoice showing your name and product model/serial number
  2. Proof of product registration under your account
  3. Correct customer ID if a different account was used at purchase

Kind regards,
Customer Support Team
Consumer Electronics"""

    # Default: out of warranty
    warranty_info = ""
    if purchase_date and warranty_expiry:
        warranty_info = (
            f"\nOur records (or the documents provided) indicate that your product was purchased "
            f"on {purchase_date}, and the manufacturer's warranty expired on {warranty_expiry}."
        )

    return f"""Dear {name},

Thank you for contacting Consumer Electronics Customer Support regarding your
{product} (Complaint Reference: {complaint_id}).

We have carefully reviewed your complaint. Unfortunately, we are unable to process
this complaint under our warranty or guarantee scheme for the following reason:

  Reason: The product is outside its manufacturer's warranty period.
{warranty_info}

Options available to you:
  1. Out-of-warranty repair service — we can provide a paid repair quote.
     Please contact our service centre at: repairs@electronics.com

Kind regards,
Customer Support Team
Consumer Electronics"""


def _build_approval_body(
    customer_name: str,
    product_name: str,
    complaint_id: str,
    decision: str,
    next_steps: List[str],
    out_of_warranty: bool = False,
) -> str:
    action_label = "repair" if decision == "APPROVE_REPAIR" else "replacement"

    if out_of_warranty:
        default_steps = (
            f"  1. Our service team will contact you within 48 hours with a cost estimate for the {action_label}.\n"
            f"  2. Please confirm your acceptance of the quote before we proceed.\n"
            f"  3. Payment will be collected before the {action_label} is carried out.\n"
            f"  4. Please have your product and proof of purchase ready."
        )
        paid_notice = (
            f"\nPlease note: as your product is outside its manufacturer warranty period, "
            f"this {action_label} will be carried out on a paid basis. "
            f"A cost estimate will be provided before any work begins."
        )
    else:
        default_steps = (
            f"  1. Our technical team will contact you within 48 hours to arrange the {action_label}.\n"
            f"  2. Please have your product and proof of purchase ready.\n"
            f"  3. If a courier collection is required, we will arrange this at no cost to you."
        )
        paid_notice = ""

    steps = "\n".join(f"  {i+1}. {step}" for i, step in enumerate(next_steps)) if next_steps else default_steps

    return f"""Dear {customer_name or 'Valued Customer'},

We have reviewed your complaint (Reference: {complaint_id}) regarding your
{product_name or 'product'} and are pleased to confirm that we will be arranging a {action_label} for you.
{paid_notice}

What happens next:
{steps}

Please keep this email for your records and quote your reference number
({complaint_id}) in any future correspondence.

Kind regards,
Customer Support Team
Consumer Electronics"""


def _build_customer_not_found_body(
    complaint_id: str,
) -> str:
    return f"""Dear Customer,

Thank you for contacting Consumer Electronics Customer Support.

We have received a complaint submission (Reference: {complaint_id}), however we were
unable to locate a matching customer account in our system.

To process your complaint, we require a verified account with us. Please:

  1. Verify your customer reference number (format: CUST#####) and reply with it, or
  2. Contact us directly so we can locate your account.

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

We have received your complaint (Reference: {complaint_id}) regarding your \
{product_name or 'product'} and want to assure you that we take all customer
concerns seriously.

Your case has been assigned to our specialist team who will carry out a
thorough review of all the details you have provided.

What happens next:
  1. Our team will carefully review your complaint and any documents provided
     within 2 business days.
  2. We may reach out if we need any additional information from you.
  3. You will receive a written outcome with our findings and proposed resolution
     within 5 business days.

Kind regards,
Customer Support Team
Consumer Electronics"""


def _build_auto_closure_body(
    customer_name: str,
    complaint_id: str,
    inactivity_days: int = 7,
) -> str:
    return f"""Dear {customer_name or 'Valued Customer'},

We are writing to inform you that your complaint (Reference: {complaint_id}) has been
automatically closed due to {inactivity_days} days of inactivity.

As we have not received any further communication from you during this period, we have
assumed that the matter has been resolved to your satisfaction, or that no further
action is required.

If your issue remains unresolved, or if you would like to re-open this complaint,
please do not hesitate to contact us:
  Email: support@electronics.com
  Phone: 1-800-ELEC-HELP (Mon-Fri, 9am-6pm)

When contacting us, please quote your original complaint reference: {complaint_id}

We apologise for any inconvenience and thank you for choosing Consumer Electronics.

Kind regards,
Customer Support Team
Consumer Electronics"""


# ── SMTP sender ──────────────────────────────────────────────────────────────

def _send_email(
    to_addr: str,
    subject: str,
    body: str,
    in_reply_to: Optional[str] = None,
    references: Optional[str] = None,
) -> None:
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
    # Thread reply headers — ensures email lands in the same Gmail thread
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"]  = references or in_reply_to
    elif references:
        msg["References"] = references

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
    reject_reason: Optional[str] = None,
    in_reply_to: Optional[str] = None,
    references: Optional[str] = None,
    troubleshooting_steps: Optional[str] = None,
    warranty_status: Optional[str] = None,
    inactivity_days: int = 7,
) -> Dict[str, Any]:
    """
    Send the appropriate automated email response based on the decision code.
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
        # LOGIC: If we have RAG steps, always prioritize sending the troubleshooting guide!
        if troubleshooting_steps:
            subject = f"Troubleshooting Steps for your {product_name or 'device'} — {complaint_id}"
            body = _build_troubleshooting_body(
                customer_name, product_name or "your product", complaint_id, troubleshooting_steps
            )
            decision = "TROUBLESHOOTING_REQUIRED"

        elif decision == "REQUEST_DOCUMENTS":
            subject = f"Action Required: Documents Needed — Complaint {complaint_id}"
            body    = _build_request_documents_body(
                customer_name, product_name or "your product",
                missing_docs or ["purchase_invoice"], complaint_id,
            )

        elif decision == "DESK_REJECT":
            subject = f"Your Complaint Has Been Reviewed — {complaint_id}"
            if reject_reason == "customer_not_found":
                body = _build_customer_not_found_body(complaint_id)
            else:
                body = _build_desk_reject_body(
                    customer_name, product_name or "your product",
                    complaint_id, warranty_expiry, purchase_date,
                    reject_reason=reject_reason,
                )

        elif decision in ("APPROVE_REPAIR", "APPROVE_REPLACEMENT"):
            subject = f"Your Complaint Has Been Approved — {complaint_id}"
            body    = _build_approval_body(
                customer_name, product_name or "your product",
                complaint_id, decision, next_steps or [],
                out_of_warranty=(warranty_status == "OUT_OF_WARRANTY"),
            )

        elif decision == "AUTO_CLOSE":
            subject = f"Your Complaint Has Been Closed — {complaint_id}"
            body    = _build_auto_closure_body(
                customer_name, complaint_id, inactivity_days=inactivity_days,
            )

        else:  # INVESTIGATE or any other fallback
            subject = f"We Have Received Your Complaint — {complaint_id}"
            body    = _build_investigate_body(
                customer_name, product_name or "your product", complaint_id,
            )

        sender_email = os.environ.get("SENDER_EMAIL", "")
        _send_email(to_addr, subject, body, in_reply_to=in_reply_to, references=references)
        return {
            "sent": True, "decision": decision, "to": to_addr, "error": None,
            "subject": subject, "body": body, "sentFrom": sender_email,
        }

    except Exception as exc:
        print(f"Auto-response send failed ({decision} → {to_addr}): {exc}", file=sys.stderr)
        return {"sent": False, "decision": decision, "to": to_addr, "error": str(exc)}