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

If you have any difficulty locating these documents, please reply and we will
do our best to assist you.

We apologise for the additional step and appreciate your cooperation.

Kind regards,
Customer Support Team
Consumer Electronics
  Email: support@electronics.com  |  Phone: 1-800-ELEC-HELP (Mon–Fri, 9am–6pm)"""


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

Our warranty covers manufacturing defects and hardware failures under normal use.
Damage resulting from accidental drops, liquid exposure, or physical impact falls
outside the scope of warranty coverage.

Options available to you:
  1. Paid repair service — our authorised service centres can assess and repair
     your device. Please contact: repairs@electronics.com for a quote.
  2. Insurance claim — if you have device insurance, this type of damage is
     typically covered. Please contact your insurer directly.
  3. Consumer rights — statutory rights may apply in limited circumstances.
     Please contact your local consumer authority for guidance.

If you believe this decision has been made in error, please reply within 14 days
with any additional evidence and we will be happy to re-evaluate.

We apologise for any inconvenience caused.

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

Our warranty requires that all repairs and servicing be carried out by authorised
service centres only. Third-party repairs or modifications to the device void the
manufacturer's warranty.

Options available to you:
  1. Authorised repair service — our service centres can still repair your device
     on a paid basis. Please contact: repairs@electronics.com for a quote.
  2. Consumer rights — depending on your jurisdiction, statutory rights may still
     apply in certain circumstances. Please contact your local consumer authority.

For all future servicing, please use only our authorised service centres to
preserve your warranty. A list of authorised centres is available at:
  https://support.electronics.com/service-centres

If you believe this decision has been made in error, please reply within 14 days
with any relevant documentation and we will be happy to review.

We apologise for any inconvenience caused.

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

Our complaint resolution service covers smartphones, laptops, tablets, earbuds,
smartwatches, and cameras. For other product types, please contact the relevant
manufacturer or retailer directly.

If you believe your product falls within our supported categories and this
decision has been made in error, please reply within 14 days with your product
model and serial number and we will be happy to re-evaluate.

We apologise for any inconvenience caused.

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

We have good news regarding your complaint (Reference: {complaint_id}) about your
{product_name or 'product'}.

After reviewing the details of your case, we are pleased to confirm that your
complaint has been approved and we will be arranging a {action_label} for you.

What happens next:
{steps}

Please keep this email for your records and quote your reference number
({complaint_id}) in any future correspondence.

If you have any questions at any point during this process, our team is here to help:
  Email: support@electronics.com
  Phone: 1-800-ELEC-HELP  (Monday – Friday, 9am – 6pm)

Thank you for bringing this to our attention. We are sorry for the inconvenience
caused and look forward to getting this resolved for you promptly.

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

Your complaint reference is: {complaint_id}
Please quote this in any future correspondence with us.

If you have any questions in the meantime, please do not hesitate to contact us:
  Email: support@electronics.com
  Phone: 1-800-ELEC-HELP  (Monday – Friday, 9am – 6pm)

We appreciate your patience and are committed to resolving this matter fairly
and as quickly as possible.

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
    reject_reason: Optional[str] = None,
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
                reject_reason=reject_reason,
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
