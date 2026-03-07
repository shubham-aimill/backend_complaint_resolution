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
    if not customer_ref:
        return []

    # ── Step 1: Customer lookup ───────────────────────────────────────────
    customer = find_customer(customer_ref)
    if not customer:
        return [{
            "recordId":          "CUSTOMER-NOT-FOUND",
            "title":             "Customer Not Found",
            "snippet":           f"No customer record found for ID: {customer_ref}",
            "content":           f"Customer ID '{customer_ref}' was not found. Please verify the reference number.",
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
    past_complaints = get_customer_complaints(customer_ref)

    if not past_complaints:
        score = _confidence_score(True, False, False)
        rec   = _recommendation(score, False, "NORMAL")
        return [{
            "recordId":          f"NEW-{customer_ref}",
            "title":             f"New Complaint — {customer_name}",
            "snippet":           f"Customer {customer_ref} verified. No prior complaint history.",
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
            f"Customer: {customer_name} ({customer_ref}) | "
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
            "recordId":          complaint_id or f"CMP-{customer_ref}",
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
    return results[:10]


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
