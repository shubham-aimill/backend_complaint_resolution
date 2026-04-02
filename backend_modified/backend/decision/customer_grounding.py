"""
Customer Grounding Service.

Looks up customer records, complaint history, and product/service details
from the 4 JSON data files to verify the customer and enrich the decision pack.

Data files used (all under data/):
  customers.json        — customer master records
  complaints.json       — complaint history per customer
  complaint_action.json — resolution actions taken on each complaint
  product_service.json  — product and service catalogue
"""

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.common.config import (
    DATA_DIR,
    CUSTOMERS_FILE,
    COMPLAINTS_FILE,
    COMPLAINT_ACTIONS_FILE as ACTIONS_FILE,
    PRODUCTS_FILE,
)

_customers_cache:  Optional[List[Dict[str, Any]]] = None
_complaints_cache: Optional[List[Dict[str, Any]]] = None
_actions_cache:    Optional[List[Dict[str, Any]]] = None
_products_cache:   Optional[List[Dict[str, Any]]] = None


def _load_json(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else [data]
    except Exception:
        return []


def _load_data() -> None:
    global _customers_cache, _complaints_cache, _actions_cache, _products_cache
    if _customers_cache  is None: _customers_cache  = _load_json(CUSTOMERS_FILE)
    if _complaints_cache is None: _complaints_cache = _load_json(COMPLAINTS_FILE)
    if _actions_cache    is None: _actions_cache    = _load_json(ACTIONS_FILE)
    if _products_cache   is None: _products_cache   = _load_json(PRODUCTS_FILE)


def reload_data() -> None:
    """Force reload all caches (call if files change at runtime)."""
    global _customers_cache, _complaints_cache, _actions_cache, _products_cache
    _customers_cache = _complaints_cache = _actions_cache = _products_cache = None
    _load_data()


# ── Data lookup helpers ────────────────────────────────────────────────────

def find_customer(customer_id: str) -> Optional[Dict[str, Any]]:
    """Look up a customer record by customer_id (e.g. CUST10001)."""
    _load_data()
    cid = customer_id.strip().upper()
    return next((c for c in _customers_cache if c.get("customer_id", "").upper() == cid), None)


def _normalize_email(raw: Optional[str]) -> str:
    if not raw:
        return ""
    s = str(raw).strip().lower()
    m = re.search(r"<([^>]+@[^>]+)>", s)
    if m:
        return m.group(1).strip()
    return s


def _normalize_name(raw: Optional[str]) -> str:
    if not raw:
        return ""
    return " ".join(str(raw).strip().lower().split())


def find_customer_by_email(email: str) -> Optional[Dict[str, Any]]:
    _load_data()
    target = _normalize_email(email)
    if not target:
        return None
    return next((c for c in _customers_cache if _normalize_email(c.get("email_id")) == target), None)


def find_customer_by_name(full_name: str) -> Optional[Dict[str, Any]]:
    _load_data()
    target = _normalize_name(full_name)
    if not target:
        return None
    return next(
        (
            c for c in _customers_cache
            if _normalize_name(f"{c.get('first_name', '')} {c.get('last_name', '')}") == target
        ),
        None,
    )


def get_customer_complaints(customer_id: str) -> List[Dict[str, Any]]:
    """Return all complaint records for a customer."""
    _load_data()
    cid = customer_id.strip().upper()
    return [c for c in _complaints_cache if c.get("customer_id", "").upper() == cid]


def get_complaint_actions(complaint_id: str) -> List[Dict[str, Any]]:
    """Return all actions taken on a specific complaint."""
    _load_data()
    return [a for a in _actions_cache if a.get("complaint_id") == complaint_id]


def get_product(product_id: str) -> Optional[Dict[str, Any]]:
    """Look up a product/service record by product_id."""
    _load_data()
    return next((p for p in _products_cache if p.get("product_id") == product_id), None)


def _tokenize_cg(s: str) -> set:
    """Tokenise for product-name matching (length > 1, alphanumeric only)."""
    return {t for t in re.sub(r"[^a-z0-9\s]", " ", s.lower()).split() if len(t) > 1}


def _find_product_id_by_name(product_name: str) -> Optional[str]:
    """
    Return the product_id from the catalogue that best matches *product_name*
    using scored token-overlap (F1).  Returns None when no entry meets the
    minimum confidence threshold, preventing spurious matches on generic terms
    like a brand name alone.
    """
    _load_data()
    if not product_name or not _products_cache:
        return None

    search_raw    = product_name.strip().lower()
    search_tokens = _tokenize_cg(search_raw)
    MIN_SCORE     = 0.45

    best_id:    Optional[str]   = None
    best_score: float           = -1.0

    for p in _products_cache:
        name  = (p.get("product_name")  or "").strip()
        model = (p.get("model_number")  or "").strip()
        name_lower  = name.lower()
        model_lower = model.lower()

        # Exact match — return immediately
        if search_raw == name_lower or (model_lower and search_raw == model_lower):
            return p.get("product_id")

        # Model substring
        model_score = 0.0
        if model_lower and (model_lower in search_raw or search_raw in model_lower):
            model_score = 0.9 + len(model_lower) / (len(search_raw) + len(model_lower) + 1)

        # Token-overlap F1
        name_tokens = _tokenize_cg(name_lower)
        token_score = 0.0
        if name_tokens and search_tokens:
            overlap   = len(search_tokens & name_tokens)
            precision = overlap / len(search_tokens)
            recall    = overlap / len(name_tokens)
            if precision + recall > 0:
                token_score = 2 * precision * recall / (precision + recall)
            if overlap <= 1 and len(name_tokens) > 2:
                token_score *= 0.25

        score = max(model_score, token_score)
        if score > best_score:
            best_score = score
            best_id    = p.get("product_id")

    return best_id if best_score >= MIN_SCORE else None


# ── Confidence scoring ─────────────────────────────────────────────────────

def _confidence_score(customer_found: bool, has_history: bool, product_found: bool) -> float:
    return max(0.0, min(1.0,
        (0.30 if customer_found  else 0.0)
      + (0.25 if has_history     else 0.0)
      + (0.25 if product_found   else 0.0)
      + 0.20   # documentation baseline
    ))


def _recommendation(score: float, is_escalated: bool, priority: str) -> Dict[str, str]:
    if is_escalated or priority in ("CRITICAL", "URGENT"):
        return {
            "recommendation": "ESCALATE",
            "action": "Complaint is escalated or critical priority — assign to senior agent immediately",
        }
    if score >= 0.85:
        return {
            "recommendation": "AUTO_APPROVE",
            "action": "Customer and product verified — proceed with resolution per SLA",
        }
    if score >= 0.65:
        return {
            "recommendation": "MANUAL_REVIEW",
            "action": "Review complaint details and customer record before resolving",
        }
    return {
        "recommendation": "INVESTIGATE",
        "action": "Insufficient data — gather more information before resolving",
    }


# ── Main grounding entry point ─────────────────────────────────────────────

def get_customer_grounding(extracted_fields: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Ground the complaint by looking up customer, complaint history,
    and product details from the local JSON data files.

    Input:  extractedFields dict from the extraction service
            (must contain complaintRef = customer_id like CUST10001)
    Output: list of grounding records for the decision pack
    """
    _load_data()

    customer_ref = str(extracted_fields.get("complaintRef", "") or "").strip().upper()
    customer_email = str(extracted_fields.get("customerEmail", "") or "").strip()
    customer_name_field = str(extracted_fields.get("customerName", "") or "").strip()

    if not customer_ref and not customer_email and not customer_name_field:
        return []

    # ── Step 1: Customer lookup ───────────────────────────────────────────
    customer = find_customer(customer_ref) if customer_ref else None
    if not customer and customer_email:
        customer = find_customer_by_email(customer_email)
    if not customer and customer_name_field:
        customer = find_customer_by_name(customer_name_field)

    resolved_ref = customer_ref or (str(customer.get("customer_id", "")).strip().upper() if customer else "")
    if not customer:
        return [{
            "recordId":          "CUSTOMER-NOT-FOUND",
            "title":             "Customer Not Found",
            "snippet":           "No customer record found for the provided customer details.",
            "content":           (
                "Customer could not be matched using complaintRef, customerEmail, or customerName. "
                "Please verify the customer details."
            ),
            "section":           "Customer Verification",
            "score":             0.0,
            "confidence_score":  0.0,
            "recommendation":    "INVESTIGATE",
            "action":            "Verify the customer reference number provided in the complaint.",
            "sourceDocument":    "customers.json (Consumer Electronics CRM)",
            "customer_verified": False,
        }]

    customer_name   = f"{customer.get('first_name', '')} {customer.get('last_name', '')}".strip()
    customer_status = customer.get("customer_status", "UNKNOWN")

    # ── Step 2: Complaint history ─────────────────────────────────────────
    all_past_complaints = get_customer_complaints(resolved_ref)

    # Narrow history to the product mentioned in the current complaint so that
    # complaint records from *other* products the customer owns don't pollute
    # the "Matched Resolution Rules" panel.
    current_product_name = str(extracted_fields.get("productOrService") or "").strip()
    current_product_id   = _find_product_id_by_name(current_product_name) if current_product_name else None

    if current_product_id:
        relevant = [c for c in all_past_complaints if c.get("product_id") == current_product_id]
        # Fall back to full history if the specific product has no prior complaints
        past_complaints = relevant if relevant else all_past_complaints
    else:
        past_complaints = all_past_complaints

    if not past_complaints:
        score = _confidence_score(True, False, False)
        rec   = _recommendation(score, False, "NORMAL")
        return [{
            "recordId":          f"NEW-{resolved_ref}",
            "title":             f"New Complaint — {customer_name}",
            "snippet":           f"Customer {resolved_ref} verified. No prior complaint history.",
            "content":           (
                f"Customer: {customer_name} | Status: {customer_status} | "
                f"Loyalty: {customer.get('loyalty_tier', 'N/A')} | "
                f"Customer since: {customer.get('customer_since', 'N/A')} | "
                f"Total complaints on record: 0"
            ),
            "section":           "Customer Profile",
            "score":             score,
            "confidence_score":  score,
            "recommendation":    rec["recommendation"],
            "action":            rec["action"],
            "sourceDocument":    "customers.json (Consumer Electronics CRM)",
            "customer_verified": True,
            "customer_name":     customer_name,
            "customer_status":   customer_status,
            "loyalty_tier":      customer.get("loyalty_tier"),
            "open_complaints":   customer.get("open_complaints", 0),
            "total_complaints":  customer.get("total_complaints", 0),
        }]

    # ── Step 3: Build one grounding record per complaint ──────────────────
    results = []
    for complaint in past_complaints:
        complaint_id = complaint.get("complaint_id", "")
        product_id   = complaint.get("product_id", "")
        product      = get_product(product_id) if product_id else None
        actions      = get_complaint_actions(complaint_id)
        latest_action = actions[-1] if actions else {}

        score = _confidence_score(True, True, bool(product))
        rec   = _recommendation(
            score,
            complaint.get("is_escalated", False),
            complaint.get("priority_level", "NORMAL"),
        )

        refund_total = float(complaint.get("refund_total") or 0)
        comp_total   = float(complaint.get("compensation_total") or 0)

        content = (
            f"Customer: {customer_name} ({resolved_ref}) | "
            f"Account status: {customer_status} | "
            f"Loyalty tier: {customer.get('loyalty_tier', 'N/A')} | "
            f"Complaint ID: {complaint_id} | "
            f"Type: {complaint.get('complaint_type', 'N/A')} | "
            f"Category: {complaint.get('complaint_category', 'N/A')} | "
            f"Sub-category: {complaint.get('complaint_subcategory', 'N/A')} | "
            f"Current status: {complaint.get('current_status', 'N/A')} | "
            f"Priority: {complaint.get('priority_level', 'N/A')} | "
            f"Severity: {complaint.get('severity_level', 'N/A')} | "
            f"Escalated: {'Yes' if complaint.get('is_escalated') else 'No'} | "
            f"SLA: {complaint.get('sla_hours', 'N/A')}h | "
            f"Refund issued: ${refund_total:.2f} | "
            f"Compensation: ${comp_total:.2f}"
        )
        if product:
            content += (
                f" | Product: {product.get('product_name')} ({product.get('brand_name', '')}) | "
                f"Warranty: {product.get('warranty_period_months', 'N/A')} months | "
                f"Price: ${product.get('price', 0):.2f}"
            )
        if latest_action:
            content += f" | Latest action: {latest_action.get('action_description', 'N/A')}"

        results.append({
            "recordId":          complaint_id or f"CMP-{resolved_ref}",
            "title":             f"{complaint.get('complaint_type', 'Complaint')} — {product.get('product_name', 'N/A') if product else 'N/A'}",
            "snippet":           f"{complaint.get('complaint_type', 'Complaint')} — {complaint.get('complaint_subcategory', complaint.get('description', '')[:80])}",
            "content":           content,
            "section":           complaint.get("complaint_category", "Complaint History"),
            "score":             score,
            "confidence_score":  score,
            "recommendation":    rec["recommendation"],
            "action":            rec["action"],
            "sourceDocument":    "complaints.json + product_service.json (Consumer Electronics)",
            "customer_verified": True,
            # Customer
            "customer_name":     customer_name,
            "customer_status":   customer_status,
            "loyalty_tier":      customer.get("loyalty_tier"),
            "open_complaints":   customer.get("open_complaints", 0),
            "total_complaints":  customer.get("total_complaints", 0),
            # Complaint
            "complaint_id":      complaint_id,
            "complaint_type":    complaint.get("complaint_type"),
            "complaint_category": complaint.get("complaint_category"),
            "current_status":    complaint.get("current_status"),
            "priority_level":    complaint.get("priority_level"),
            "severity_level":    complaint.get("severity_level"),
            "is_escalated":      complaint.get("is_escalated", False),
            "assigned_team":     complaint.get("assigned_team"),
            "sla_hours":         complaint.get("sla_hours"),
            "refund_total":      refund_total,
            "compensation_total": comp_total,
            # Product
            "product_id":        product_id,
            "product_name":      product.get("product_name") if product else None,
            "product_category":  product.get("product_category") if product else None,
            "warranty_months":   product.get("warranty_period_months") if product else None,
            # Actions
            "actions_count":     len(actions),
            "latest_action":     latest_action.get("action_description"),
        })

    results.sort(key=lambda x: x["confidence_score"], reverse=True)
    return results[:5]


def get_full_customer_info(customer_ref: str) -> Dict[str, Any]:
    """Return complete customer + complaints + products for a reference."""
    _load_data()
    customer   = find_customer(customer_ref)
    complaints = get_customer_complaints(customer_ref)
    products: Dict[str, Any] = {}
    for c in complaints:
        pid = c.get("product_id")
        if pid and pid not in products:
            p = get_product(pid)
            if p:
                products[pid] = p
    return {
        "customer":   customer,
        "complaints": complaints,
        "products":   list(products.values()),
        "ref":        customer_ref,
    }
