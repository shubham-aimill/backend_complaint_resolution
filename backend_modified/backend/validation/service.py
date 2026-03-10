"""
Validation Engine — Consumer Electronics Complaint Resolution System.

Performs three automatic validation checks after AI extraction and before
the decision engine runs:

  1. Warranty Validation  — is the product still within its warranty period?
  2. Document Validation  — are the required documents present?
  3. Product Validation   — is the product model / category recognised?

Each check returns a structured result dict that is collected into a
``validationResults`` block attached to the decision pack.

Auto-decision codes produced:
  DESK_REJECT        — product is out of warranty, physically/accidentally damaged,
                       repaired by an unauthorised third party, or unsupported product
  REQUEST_DOCUMENTS  — required documents are missing
  VALID              — all checks pass; proceed to the decision engine
"""

import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.common.config import DATA_DIR

# ── Constants ──────────────────────────────────────────────────────────────

SUPPORTED_CATEGORIES = {
    "smartphone", "earbuds", "smart watch", "smartwatch",
    "laptop", "tablet", "camera",
}

# Documents we look for to validate the complaint.
# Each entry: (label, patterns_in_doc_type_or_filename)
REQUIRED_DOCUMENT_LABELS = ["purchase_invoice"]

# Confidence threshold for a document to count as "present"
DOC_CONFIDENCE_THRESHOLD = 0.50


# ── Internal helpers ───────────────────────────────────────────────────────

def _load_products() -> List[Dict[str, Any]]:
    """Load product catalogue from product_service.json."""
    products_file = DATA_DIR / "product_service.json"
    if not products_file.exists():
        return []
    try:
        return json.loads(products_file.read_text(encoding="utf-8"))
    except Exception:
        return []


def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
    """Try multiple date formats and return a datetime or None."""
    if not date_str:
        return None
    # Normalise separators
    date_str = str(date_str).strip().replace("/", "-")
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%m-%d-%Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    return None


def _extract_purchase_date(
    extracted_fields: Dict[str, Any],
    documents: List[Dict[str, Any]],
) -> Tuple[Optional[datetime], str]:
    """
    Attempt to find a purchase date from:
      1. extractedFields (complaintDate is sometimes the purchase date if no other)
      2. keyFields inside document entries (purchaseDate, invoiceDate, etc.)

    Returns (datetime_or_None, source_description).
    """
    # 1. Look in document keyFields for invoice/purchase date
    date_keys = ("purchaseDate", "purchase_date", "invoiceDate", "invoice_date",
                 "date", "receiptDate", "receipt_date")
    for doc in documents:
        key_fields = doc.get("keyFields") or {}
        for key in date_keys:
            raw = key_fields.get(key)
            if raw:
                dt = _parse_date(str(raw))
                if dt:
                    return dt, f"document:{doc.get('name', 'attachment')}"

    # 2. Fall back to complaintDate extracted from email
    raw = extracted_fields.get("complaintDate") or extracted_fields.get("purchaseDate")
    if raw:
        dt = _parse_date(str(raw))
        if dt:
            return dt, "email_body"

    return None, "not_found"


def _find_product(
    product_or_service: Optional[str],
    products: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """
    Try to match the extracted product/service name against the product catalogue.
    Uses case-insensitive substring matching on product_name and model_number.
    """
    if not product_or_service:
        return None
    search = product_or_service.strip().lower()
    for p in products:
        if (
            search in (p.get("product_name") or "").lower()
            or search in (p.get("model_number") or "").lower()
            or (p.get("product_name") or "").lower() in search
            or (p.get("model_number") or "").lower() in search
        ):
            return p
    return None


def _has_invoice_document(documents: List[Dict[str, Any]]) -> bool:
    """
    Return True if at least one document looks like a purchase invoice/receipt.
    Checks document type classification and filename keywords.
    """
    invoice_types = {"invoice", "receipt"}
    invoice_name_patterns = [
        r"invoice", r"receipt", r"bill", r"purchase", r"order", r"payment",
    ]
    for doc in documents:
        doc_type = (doc.get("type") or "").lower()
        if any(t in doc_type for t in invoice_types):
            if doc.get("confidence", 0) >= DOC_CONFIDENCE_THRESHOLD:
                return True
        filename = (doc.get("name") or "").lower()
        if any(re.search(p, filename) for p in invoice_name_patterns):
            return True
        # Check keyFields for invoice number — strong signal
        key_fields = doc.get("keyFields") or {}
        if key_fields.get("invoiceNumber") or key_fields.get("receiptNumber"):
            return True
    return False


def _has_serial_number(
    extracted_fields: Dict[str, Any],
    documents: List[Dict[str, Any]],
) -> Optional[str]:
    """
    Look for a serial number in extractedFields or document keyFields.
    Returns the serial number string or None.
    """
    # Common serial patterns: SN, S/N, Serial No
    sn_pattern = re.compile(r"(?:s(?:erial)?[\s\-/]?n(?:o|umber)?[\s\-:]+)([A-Z0-9]{6,})", re.IGNORECASE)
    text = str(extracted_fields.get("description") or "") + " " + str(extracted_fields.get("productOrService") or "")
    m = sn_pattern.search(text)
    if m:
        return m.group(1)

    for doc in documents:
        kf = doc.get("keyFields") or {}
        sn = kf.get("serialNumber") or kf.get("serial_number") or kf.get("imei")
        if sn:
            return str(sn)

    return None


# ── Validation checks ──────────────────────────────────────────────────────

def validate_warranty(
    extracted_fields: Dict[str, Any],
    documents: List[Dict[str, Any]],
    matched_product: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Check whether the product is within its warranty period.

    Decision output:
      - status: "WITHIN_WARRANTY" | "OUT_OF_WARRANTY" | "UNKNOWN"
      - passed: bool
      - autoDecision: "DESK_REJECT" | None
    """
    warranty_months = (matched_product or {}).get("warranty_period_months", 12)
    purchase_date, date_source = _extract_purchase_date(extracted_fields, documents)

    if purchase_date is None:
        # Cannot determine — give benefit of the doubt but flag
        return {
            "check": "warranty_validation",
            "passed": True,            # do not auto-reject if date unknown
            "status": "UNKNOWN",
            "warrantyMonths": warranty_months,
            "purchaseDate": None,
            "purchaseDateSource": date_source,
            "expiryDate": None,
            "autoDecision": None,
            "notes": (
                "Purchase date could not be determined from the email or attachments. "
                "Manual verification required."
            ),
        }

    expiry_date = purchase_date + timedelta(days=warranty_months * 30.44)
    now = datetime.utcnow()
    within = now <= expiry_date

    return {
        "check": "warranty_validation",
        "passed": within,
        "status": "WITHIN_WARRANTY" if within else "OUT_OF_WARRANTY",
        "warrantyMonths": warranty_months,
        "purchaseDate": purchase_date.strftime("%Y-%m-%d"),
        "purchaseDateSource": date_source,
        "expiryDate": expiry_date.strftime("%Y-%m-%d"),
        "autoDecision": None if within else "DESK_REJECT",
        "notes": (
            f"Product purchased on {purchase_date.strftime('%Y-%m-%d')}. "
            f"Warranty of {warranty_months} months expires on {expiry_date.strftime('%Y-%m-%d')}. "
            + ("Product is within warranty period." if within else "Product is OUT of warranty — DESK REJECT.")
        ),
    }


def validate_documents(
    extracted_fields: Dict[str, Any],
    documents: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Verify that minimum required documents are present.

    Required: purchase invoice (or receipt).
    Optional but noted: serial number, product model.

    Decision output:
      - passed: bool
      - missingDocuments: list of missing items
      - autoDecision: "REQUEST_DOCUMENTS" | None
    """
    missing: List[str] = []
    present: List[str] = []

    # --- Check 1: Purchase invoice ---
    has_invoice = _has_invoice_document(documents)
    if has_invoice:
        present.append("purchase_invoice")
    else:
        missing.append("purchase_invoice")

    # --- Check 2: Product model (soft check — from email fields) ---
    product_model = extracted_fields.get("productOrService")
    if product_model:
        present.append("product_model")
    else:
        missing.append("product_model")

    # --- Check 3: Serial number (optional, informational) ---
    serial = _has_serial_number(extracted_fields, documents)
    serial_present = serial is not None
    if serial_present:
        present.append("serial_number")

    # Only hard-fail on missing invoice; model/serial are soft checks
    hard_fail = "purchase_invoice" in missing
    auto_decision = "REQUEST_DOCUMENTS" if hard_fail else None

    return {
        "check": "document_validation",
        "passed": not hard_fail,
        "presentDocuments": present,
        "missingDocuments": missing,
        "serialNumber": serial,
        "autoDecision": auto_decision,
        "notes": (
            f"Documents present: {', '.join(present) or 'none'}. "
            f"Missing: {', '.join(missing) or 'none'}."
            + (" Purchase invoice is REQUIRED — requesting documents." if hard_fail else "")
        ),
    }


def validate_product(
    extracted_fields: Dict[str, Any],
    documents: List[Dict[str, Any]],
    products: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Validate the product against the product catalogue.

    Checks:
      - Is the product category one of our supported electronics categories?
      - Is the specific model found in product_service.json?

    Decision output:
      - passed: bool
      - productCategory: str or None
      - matchedProductId: str or None
      - autoDecision: None (product validation alone does not auto-reject)
    """
    product_or_service = (extracted_fields.get("productOrService") or "").strip()
    matched = _find_product(product_or_service, products)

    if matched:
        category = (matched.get("product_category") or "").lower()
        category_supported = category in SUPPORTED_CATEGORIES
        return {
            "check": "product_validation",
            "passed": True,
            "productCategory": matched.get("product_category"),
            "matchedProductId": matched.get("product_id"),
            "matchedProductName": matched.get("product_name"),
            "brandName": matched.get("brand_name"),
            "modelNumber": matched.get("model_number"),
            "warrantyMonths": matched.get("warranty_period_months"),
            "price": matched.get("price"),
            "categorySupported": category_supported,
            "authorizedSellers": matched.get("authorized_sellers", []),
            "autoDecision": None,
            "notes": (
                f"Product matched: {matched.get('product_name')} "
                f"(Model: {matched.get('model_number')}, "
                f"Category: {matched.get('product_category')}). "
                + ("Category is supported." if category_supported
                   else "WARNING: Category not in supported electronics list.")
            ),
        }

    # Product not found in catalogue — check if category is at least mentioned
    text = product_or_service.lower()
    category_found = next(
        (c for c in SUPPORTED_CATEGORIES if c in text), None
    )

    return {
        "check": "product_validation",
        "passed": bool(category_found),      # soft pass if category recognisable
        "productCategory": category_found.title() if category_found else None,
        "matchedProductId": None,
        "matchedProductName": None,
        "brandName": None,
        "modelNumber": None,
        "warrantyMonths": None,
        "price": None,
        "categorySupported": bool(category_found),
        "authorizedSellers": [],
        "autoDecision": None,                # not blocking — may just be a new model
        "notes": (
            f"Product '{product_or_service}' not found in product catalogue. "
            + (f"Category '{category_found}' is recognised as supported."
               if category_found else "Category not recognised — manual review advised.")
        ),
    }


# ── Eligibility checks (non-warranty desk-reject scenarios) ───────────────

def validate_eligibility(
    extracted_fields: Dict[str, Any],
    documents: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Check complaint eligibility beyond warranty period.

    Triggers DESK_REJECT for:
      1. Physical / accidental damage caused by user misuse
      2. Unauthorised / third-party repair (voids warranty)
      3. Product not in our supported electronics categories

    Returns a validation result with an optional ``rejectReason`` field.
    """
    description = (extracted_fields.get("description") or "").lower()
    product     = (extracted_fields.get("productOrService") or "").lower()
    combined    = f"{description} {product}"

    # ─ Check 1: Physical / accidental damage ──────────────────────────────
    accidental_patterns = [
        r"\bdropped\b", r"\bfall\b", r"\bfell\b",
        r"\bwater.?damage[d]?\b", r"\bwater.?damaged\b",
        r"\bspill(?:ed)?\b", r"\bsplash(?:ed)?\b",
        r"\baccidental(?:ly)?\b",
        r"\bphysically damaged\b",
        r"\bbent\b",
        r"\bsmashed screen\b", r"\bscreen smashed\b",
        r"\bcracked.*(?:drop|fall|impact|hit)\b",
        r"\b(?:drop|fall|impact|hit).*crack\b",
        r"\bdamage.*(?:drop|fall|hit|impact)\b",
        r"\b(?:drop|fall|hit|impact).*damage\b",
    ]
    if any(re.search(p, combined, re.IGNORECASE) for p in accidental_patterns):
        return {
            "check": "eligibility_validation",
            "passed": False,
            "rejectReason": "physical_damage",
            "autoDecision": "DESK_REJECT",
            "notes": (
                "Complaint indicates physical or accidental damage caused by the user. "
                "Physical damage due to misuse is not covered under the standard warranty."
            ),
        }

    # ─ Check 2: Unauthorised / third-party repair ──────────────────────────
    tamper_patterns = [
        r"\bthird.party repair\b", r"\blocal repair\b",
        r"\bunauthori[sz]ed repair\b",
        r"\brepaired by\b", r"\btook it to a(?:nother)? shop\b",
        r"\bwarranty.*void\b", r"\bvoid.*warranty\b",
        r"\bwarranty seal.*broken\b", r"\btamper(?:ed)?\b",
        r"\bself.?repair\b", r"\bopened the device\b",
        r"\bmodified the\b",
        r"\bnon.authoris(?:ed|ed) technician\b",
        r"\brepaired.*outside\b",
    ]
    if any(re.search(p, combined, re.IGNORECASE) for p in tamper_patterns):
        return {
            "check": "eligibility_validation",
            "passed": False,
            "rejectReason": "unauthorized_repair",
            "autoDecision": "DESK_REJECT",
            "notes": (
                "Complaint indicates the product was repaired or modified by an "
                "unauthorised third party, which voids the manufacturer warranty."
            ),
        }

    # ─ Check 3: Unsupported / non-electronics product ─────────────────────
    non_electronics_patterns = [
        r"\bfurniture\b", r"\bclothing\b", r"\bfood\b", r"\bdrink\b",
        r"\bvehicle\b", r"\bhome appliance\b",
        r"\bwashing machine\b", r"\brefrigerator\b", r"\bmicrowave\b",
        r"\bvacuum cleaner\b", r"\bblender\b", r"\bdishwasher\b",
        r"\boven\b", r"\bcooker\b",
    ]
    if any(re.search(p, combined, re.IGNORECASE) for p in non_electronics_patterns):
        return {
            "check": "eligibility_validation",
            "passed": False,
            "rejectReason": "unsupported_product",
            "autoDecision": "DESK_REJECT",
            "notes": (
                f"Product '{extracted_fields.get('productOrService', '')}' is not in our "
                "supported consumer electronics categories. Cannot process this complaint."
            ),
        }

    return {
        "check": "eligibility_validation",
        "passed": True,
        "rejectReason": None,
        "autoDecision": None,
        "notes": "No eligibility issues detected.",
    }


# ── Main entry point ───────────────────────────────────────────────────────

def run_validation(
    extracted_fields: Dict[str, Any],
    documents: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Run all three validation checks and return a consolidated result block.

    Args:
        extracted_fields: LLM-extracted fields from the complaint email.
        documents:        Processed attachment documents.

    Returns:
        {
            "autoDecision":      str | None,   # highest-priority decision code
            "allChecksPassed":   bool,
            "warrantyStatus":    str,          # "WITHIN_WARRANTY" | "OUT_OF_WARRANTY" | "UNKNOWN"
            "productCategory":   str | None,
            "validationResults": [...]         # one dict per check
        }
    """
    products = _load_products()

    # Product validation first so we can pass matched product to warranty check
    product_result = validate_product(extracted_fields, documents, products)
    matched_product: Optional[Dict[str, Any]] = None
    if product_result.get("matchedProductId"):
        matched_product = next(
            (p for p in products if p.get("product_id") == product_result["matchedProductId"]),
            None,
        )

    eligibility_result = validate_eligibility(extracted_fields, documents)
    warranty_result    = validate_warranty(extracted_fields, documents, matched_product)
    document_result    = validate_documents(extracted_fields, documents)

    results = [eligibility_result, warranty_result, document_result, product_result]

    # Priority order for auto-decision: DESK_REJECT > REQUEST_DOCUMENTS > None
    # Eligibility check takes precedence over warranty (covers additional reject scenarios)
    auto_decision: Optional[str] = None
    for r in results:
        ad = r.get("autoDecision")
        if ad == "DESK_REJECT":
            auto_decision = "DESK_REJECT"
            break
        if ad == "REQUEST_DOCUMENTS":
            auto_decision = "REQUEST_DOCUMENTS"

    all_passed = all(r.get("passed", False) for r in results)

    return {
        "autoDecision":    auto_decision,
        "allChecksPassed": all_passed,
        "warrantyStatus":  warranty_result["status"],
        "productCategory": product_result.get("productCategory"),
        "matchedProduct": {
            "productId":   product_result.get("matchedProductId"),
            "productName": product_result.get("matchedProductName"),
            "brandName":   product_result.get("brandName"),
            "modelNumber": product_result.get("modelNumber"),
            "price":       product_result.get("price"),
        } if product_result.get("matchedProductId") else None,
        "validationResults": results,
    }
