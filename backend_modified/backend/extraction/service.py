"""
Extraction Service — Consumer Electronics Complaint Resolution System.

Uses OpenAI to extract structured complaint information from customer emails
and attachments (documents + images via Vision API).

Updated for consumer electronics focus: extracts product model, serial number,
purchase date and electronics-specific complaint types.
"""

import base64
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

from backend.common.config import INGESTED_COMPLAINTS_FILE, ENV_FILE

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

DOCUMENT_TYPES = [
    "Invoice",
    "Receipt",
    "Screenshot",
    "ContractOrAgreement",
    "PhotoEvidence",
    "CorrespondenceRecord",
    "Other",
]

# Consumer electronics complaint type categories
ELECTRONICS_COMPLAINT_TYPES = [
    "Hardware Defect",        # physical damage, broken screen, dead pixels
    "Software / Firmware",    # crashes, freezing, update failures
    "Battery / Charging",     # won't charge, fast drain, swollen battery
    "Connectivity",           # Bluetooth, WiFi, NFC issues
    "Display / Audio",        # screen issues, speaker, microphone problems
    "Performance",            # slow, lagging, overheating
    "Dead on Arrival",        # DOA — product never worked
    "Delivery / Packaging",   # damaged in transit, wrong item
    "Billing / Overcharge",   # charged incorrectly
    "Warranty Claim",         # warranty-related complaint
    "Other",
]


def _load_env() -> None:
    if ENV_FILE.exists():
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    os.environ.setdefault(key.strip(), val.strip().strip("'\""))


def _get_openai_client() -> Any:
    try:
        from openai import OpenAI
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not set")
        return OpenAI(api_key=api_key)
    except ImportError as e:
        raise ImportError("Install openai: pip install openai") from e


def _is_image_file(file_path: str, mime_type: str) -> bool:
    if Path(file_path).suffix.lower() in IMAGE_EXTENSIONS:
        return True
    return (mime_type or "").lower().startswith("image/")


def _read_text_file(file_path: str) -> str:
    p = Path(file_path)
    if not p.exists():
        return ""
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""


def extract_from_email(email_body: str, client: Any) -> Dict[str, Any]:
    """
    Extract structured complaint fields from the email body.

    Electronics-specific additions:
      - productModel:   exact model name/number
      - serialNumber:   device serial or IMEI
      - purchaseDate:   when the product was purchased (for warranty check)
      - complaintType:  mapped to electronics categories
    """
    complaint_type_list = ", ".join(ELECTRONICS_COMPLAINT_TYPES)
    system_prompt = (
        "You are an expert customer complaint analyst for a Consumer Electronics company. "
        "Extract structured complaint information from the provided customer email. "
        "Be precise and only extract information that is explicitly stated or confidently inferred. "
        "Return valid JSON only. Include a confidence (0.0-1.0) for each extracted field."
    )
    user_prompt = f"""Extract complaint fields from this consumer electronics customer email:

{email_body}

Return a JSON object with this exact structure (use null for missing fields):
{{
  "customerName": "value or null",
  "customerEmail": "value or null",
  "customerPhone": "value or null",
  "complaintRef": "any customer/order/ticket/case reference number or null",
  "complaintDate": "YYYY-MM-DD or null",
  "purchaseDate": "YYYY-MM-DD when the product was purchased, or null",
  "complaintType": "one of: {complaint_type_list} — or null",
  "productOrService": "full product name and model (e.g. NovaTech ProMax X15 Smartphone) or null",
  "productModel": "exact model number if mentioned (e.g. NT-X15-PRO) or null",
  "serialNumber": "device serial number or IMEI if mentioned, or null",
  "description": "full description of the complaint in customer's words or null",
  "desiredResolution": "what the customer wants (repair, replacement, refund, etc.) or null",
  "estimatedAmount": number or null,
  "_confidence": {{ "customerName": 0.0-1.0, "productOrService": 0.0-1.0, ... }}
}}
Return ONLY valid JSON, no markdown."""

    model = os.environ.get("OPENAI_MODEL", "gpt-4o")
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=1500,
        )
        content = response.choices[0].message.content or "{}"
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
        data = json.loads(content)

        field_conf = data.get("_confidence") or {}
        for k in ("customerName", "customerEmail", "customerPhone", "complaintRef",
                  "complaintDate", "purchaseDate", "complaintType", "productOrService",
                  "productModel", "serialNumber", "description"):
            if k not in field_conf and k in data and data[k] not in (None, ""):
                field_conf[k] = 0.85
        data["_confidence"] = field_conf
        return data

    except json.JSONDecodeError as e:
        return {"_parse_error": str(e)}
    except Exception as e:
        return {"_error": str(e)}


def extract_from_document(filename: str, content: str, client: Any) -> Dict[str, Any]:
    """
    Classify complaint document and extract key fields.

    For electronics complaints, also extracts:
      - purchaseDate, serialNumber from invoices/receipts
      - defect details from photos
    """
    if not content or not content.strip():
        return {"type": "Other", "confidence": 0.3, "keyFields": {}}

    schemas = """
For Invoice: invoiceNumber, vendor, customer, lineItems, total, purchaseDate, productModel, serialNumber.
For Receipt: receiptNumber, vendor, purchaseDate, items, total, productModel.
For Screenshot: platform, content_description, timestamp, relevantText.
For ContractOrAgreement: parties, terms, signedDate, relevantClauses.
For CorrespondenceRecord: sender, recipient, date, summary.
For PhotoEvidence: subject, description, condition, relevantDetails, defectType, severity.
For Other: extract relevant keyFields as flat object.
Return ONLY valid JSON: {"type": "...", "confidence": 0.0-1.0, "keyFields": {}}"""

    user_prompt = f"""Classify and extract from this consumer electronics complaint document:
FILENAME: {filename}
CONTENT:
{content[:4000]}{"..." if len(content) > 4000 else ""}
Classify as one of: {", ".join(DOCUMENT_TYPES)}
{schemas}"""

    model = os.environ.get("OPENAI_MODEL", "gpt-4o")
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "Extract structured key fields from consumer electronics complaint documents. Return valid JSON only."},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=1500,
        )
        raw = response.choices[0].message.content or "{}"
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        data = json.loads(raw)
        key_fields = data.get("keyFields", {}) or {}
        return {
            "type":      data.get("type", "Other"),
            "confidence": float(data.get("confidence", 0.6)),
            "keyFields": key_fields if isinstance(key_fields, dict) else {},
        }
    except Exception:
        return {"type": "Other", "confidence": 0.5, "keyFields": {}}


def analyze_image_evidence(image_path: str, client: Any) -> Dict[str, Any]:
    """Analyze image evidence using OpenAI Vision API."""
    p = Path(image_path)
    if not p.exists():
        return {"_error": f"Image not found: {image_path}"}
    try:
        image_data = base64.b64encode(p.read_bytes()).decode("utf-8")
    except Exception as e:
        return {"_error": str(e)}

    mime = "image/jpeg"
    if p.suffix.lower() == ".png":  mime = "image/png"
    elif p.suffix.lower() == ".gif": mime = "image/gif"
    elif p.suffix.lower() == ".webp": mime = "image/webp"

    system_prompt = (
        "You are a senior customer relations specialist for a Consumer Electronics company, "
        "reviewing evidence submitted with a customer complaint. "
        "Analyse the image thoroughly and provide structured findings to help resolve the complaint fairly."
    )
    user_prompt = """Analyse this consumer electronics complaint evidence image and provide:

1. STRUCTURED FINDINGS (key-value pairs):
   - For product defects: product_condition, defect_type (screen_crack/battery_issue/physical_damage/other),
     severity (Minor/Moderate/Severe), visible_damage, serial_number_visible
   - For billing/screenshots: platform, amount_shown, date_shown, discrepancy_visible, relevant_text
   - For packaging/delivery: package_condition, damage_extent, contents_affected
   - For invoices/receipts: purchase_date, product_name, invoice_number, amount_paid
   - General: evidence_quality, supports_complaint (Yes/No/Partially), recommended_action

2. DETAILED SUMMARY for the complaint resolution team covering:
   - What the image shows
   - Key findings and evidence (including any serial numbers, purchase dates, model numbers visible)
   - Severity assessment for electronics defect
   - How this supports or relates to the complaint
   - Recommended next steps

Return a JSON object:
{
  "_confidence": 0.0-1.0,
  "detailed_summary": "Comprehensive summary for the resolution team",
  "evidence_type": "value or null",
  "supports_complaint": "Yes/No/Partially",
  "severity": "value or null"
}"""

    model = os.environ.get("OPENAI_MODEL", "gpt-4o")
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text",      "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_data}"}},
                    ],
                },
            ],
            max_tokens=2500,
            temperature=0.1,
        )
        raw = response.choices[0].message.content or "{}"
        raw = raw.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1][4:] if parts[1].startswith("json") else parts[1]
        raw = raw.strip()
        data = json.loads(raw)
        if isinstance(data, dict):
            confidence       = data.pop("_confidence", None)
            detailed_summary = data.pop("detailed_summary", "")
            clean = {k: v for k, v in data.items() if not str(k).startswith("_")}
            if isinstance(confidence, (int, float)):
                clean["_confidence"] = float(confidence)
            if detailed_summary:
                clean["detailed_summary"] = detailed_summary
            return clean
        return {}
    except json.JSONDecodeError as e:
        return {"_parse_error": str(e)}
    except Exception as e:
        return {"_error": str(e)}


def extract_claim_information(
    claim_id: str,
    email_body: str,
    attachments: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Main entry point: extract complaint information from email and attachments.

    Args:
        claim_id:    Ingested complaint ID.
        email_body:  Full email text.
        attachments: List of {"name", "path", "mimeType", "size"}.

    Returns:
        Extraction result with extractedFields, evidence, documents, errors.
    """
    _load_env()
    client = _get_openai_client()

    result: Dict[str, Any] = {"extractedFields": {}, "documents": [], "evidence": [], "errors": []}

    email_fields = extract_from_email(email_body, client)
    if "_error" in email_fields:
        result["errors"].append(f"Email extraction: {email_fields['_error']}")
        email_fields = {}
    elif "_parse_error" in email_fields:
        result["errors"].append(f"Email parse: {email_fields['_parse_error']}")
        email_fields = {}
    result["extractedFields"] = email_fields

    # Electronics-specific field names including new fields
    field_names = {
        "customerName":    "Customer Name",
        "customerEmail":   "Customer Email",
        "customerPhone":   "Customer Phone",
        "complaintRef":    "Complaint Reference",
        "complaintDate":   "Complaint Date",
        "purchaseDate":    "Purchase Date",
        "complaintType":   "Complaint Type",
        "productOrService":"Product / Service",
        "productModel":    "Product Model Number",
        "serialNumber":    "Serial / IMEI Number",
        "description":     "Description",
    }
    field_conf = email_fields.get("_confidence") or {}

    # Process attachments
    for idx, att in enumerate(attachments):
        name = att.get("name", f"attachment_{idx}")
        path = att.get("path", "")
        mime = att.get("mimeType", "")

        doc_entry: Dict[str, Any] = {
            "id":         f"doc_{idx}",
            "name":       name,
            "mimeType":   mime,
            "type":       "Other",
            "content":    "",
            "confidence": 0.7,
            "metadata":   {},
        }

        if _is_image_file(path, mime):
            findings = analyze_image_evidence(path, client)
            doc_entry["type"] = "PhotoEvidence"
            if "_error" in findings or "_parse_error" in findings:
                doc_entry["content"]    = findings.get("_error") or findings.get("_parse_error", "Vision analysis failed")
                doc_entry["confidence"] = 0.5
            else:
                img_conf         = findings.pop("_confidence", None)
                detailed_summary = findings.pop("detailed_summary", "")
                doc_entry["keyFields"]  = {k: v for k, v in findings.items() if not str(k).startswith("_")}
                doc_entry["content"]    = detailed_summary
                doc_entry["confidence"] = float(img_conf) if isinstance(img_conf, (int, float)) else 0.85
        else:
            content = _read_text_file(path)
            if content:
                classification      = extract_from_document(name, content, client)
                doc_entry["type"]       = classification.get("type", "Other")
                doc_entry["content"]    = content
                doc_entry["confidence"] = classification.get("confidence", 0.7)
                doc_entry["keyFields"]  = classification.get("keyFields", {})
            else:
                doc_entry["content"] = f"[Binary/non-text: {name}]"

        result["documents"].append(doc_entry)

    # Build evidence list from extracted fields
    for field, display_name in field_names.items():
        val = email_fields.get(field)
        if val is not None and val != "":
            conf = field_conf.get(field)
            conf = max(0.0, min(1.0, float(conf))) if isinstance(conf, (int, float)) else 0.85
            result["evidence"].append({
                "field":         field,
                "fieldName":     display_name,
                "value":         str(val),
                "confidence":    conf,
                "sourceLocator": "email_content",
                "rationale":     "Extracted from customer email and attachments",
            })

    return result


def main() -> int:
    """CLI entry: run extraction for a complaint and output JSON."""
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python -m backend.extraction <complaint_id>"}), file=sys.stderr)
        return 1

    complaint_id = sys.argv[1]
    if not INGESTED_COMPLAINTS_FILE.exists():
        print(json.dumps({"error": "No ingested complaints found"}), file=sys.stderr)
        return 1

    complaints = json.loads(INGESTED_COMPLAINTS_FILE.read_text(encoding="utf-8"))
    complaint  = next((c for c in complaints if c.get("id") == complaint_id), None)
    if not complaint:
        print(json.dumps({"error": f"Complaint {complaint_id} not found"}), file=sys.stderr)
        return 1

    result = extract_claim_information(
        claim_id=complaint_id,
        email_body=complaint.get("emailBody", ""),
        attachments=complaint.get("attachments", []),
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
