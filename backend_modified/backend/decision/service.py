"""
Decision Service — Consumer Electronics Complaint Resolution System.

Builds the complete decision pack for a complaint:
  1. Customer grounding — looks up customer, complaint history, product from JSON files
  2. Complaint draft    — structures extracted fields for the frontend
  3. Validation results — warranty, document & product checks (from validation.service)
  4. Resolution assessment — structured decision code + confidence
  5. Evidence & document summaries

Decision codes (new structured set):
  APPROVE_REPAIR        — complaint valid; product approved for repair
  APPROVE_REPLACEMENT   — complaint valid; product approved for replacement
  REQUEST_DOCUMENTS     — required documents missing
  DESK_REJECT           — out of warranty or ineligible
  INVESTIGATE           — insufficient data; manual review needed
  TROUBLESHOOTING_REQUIRED — software/settings issue; send manual steps
"""

import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.decision.customer_grounding import (
    find_customer,
    get_customer_complaints,
    get_customer_grounding,
    get_full_customer_info,
)
from backend.decision.resolution_rules import CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, get_resolution_rules

def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

def _mask_email(email: Optional[str]) -> str:
    if not email:
        return "Not found"
    parts = email.split("@")
    return f"{parts[0][:2]}***@{parts[1]}" if len(parts) == 2 else "Not found"

def _mask_phone(phone: Optional[str]) -> str:
    if not phone:
        return "Not found"
    return re.sub(r"\d(?=\d{4})", "*", phone)

def _derive_auto_decision(
    validation: Dict[str, Any],
    grounding_recommendation: str,
    customer_verified: bool,
    extracted_fields: Dict[str, Any],
) -> Dict[str, Any]:
    validation_auto = validation.get("autoDecision")

    # 1. HARD STOP: DESK REJECTS
    if validation_auto == "DESK_REJECT":
        mapping_result = next((r for r in validation.get("validationResults", []) if r.get("check") == "customer_product_mapping"), {})
        eligibility_result = next((r for r in validation.get("validationResults", []) if r.get("check") == "eligibility_validation"), {})
        reject_reason = mapping_result.get("rejectReason") or eligibility_result.get("rejectReason")

        if reject_reason == "customer_not_found":
            return {
                "autoDecision":        "DESK_REJECT",
                "decisionConfidence":  1.0,
                "decisionRationale":   "Customer record was not found in the CRM database.",
                "recommendedNextStep": "Send DESK_REJECT email (customer not found).",
                "rejectReason": "customer_not_found",
            }
        if reject_reason == "product_not_registered":
            return {
                "autoDecision":        "DESK_REJECT",
                "decisionConfidence":  0.97,
                "decisionRationale":   "Product is not registered under that customer.",
                "recommendedNextStep": "Send DESK_REJECT email (product not registered).",
                "rejectReason": "product_not_registered",
            }
        if reject_reason == "physical_damage":
            return {
                "autoDecision":        "DESK_REJECT",
                "decisionConfidence":  0.90,
                "decisionRationale":   "Physical or accidental damage is not covered.",
                "recommendedNextStep": "Send DESK_REJECT email (physical damage).",
                "rejectReason": "physical_damage",
            }
        if reject_reason == "unauthorized_repair":
            return {
                "autoDecision":        "DESK_REJECT",
                "decisionConfidence":  0.92,
                "decisionRationale":   "Product was repaired by an unauthorised third party.",
                "recommendedNextStep": "Send DESK_REJECT email (unauthorised repair).",
                "rejectReason": "unauthorized_repair",
            }
        if reject_reason == "unsupported_product":
            return {
                "autoDecision":        "DESK_REJECT",
                "decisionConfidence":  0.95,
                "decisionRationale":   "Product type is not in supported categories.",
                "recommendedNextStep": "Send DESK_REJECT email (unsupported product).",
                "rejectReason": "unsupported_product",
            }
        return {
            "autoDecision":        "DESK_REJECT",
            "decisionConfidence":  0.95,
            "decisionRationale":   "Product is outside its warranty period.",
            "recommendedNextStep": "Send DESK_REJECT email.",
            "rejectReason": "out_of_warranty",
        }

    # 2. MISSING DOCUMENTS OVERRIDE
    if validation_auto == "REQUEST_DOCUMENTS":
        complaint_type = str(extracted_fields.get("complaintType", "")).lower()
        description    = str(extracted_fields.get("description", "")).lower()
        combined       = f"{complaint_type} {description}"
        
        troubleshooting_signals = [
            r"\bsettings\b", r"\bsoftware\b", r"\bconnection\b", r"\bbluetooth\b",
            r"\bwifi\b", r"\bpowershare\b", r"\bhow to\b", r"\bsetup\b", r"\bturn on\b",
            r"\bdisconnects\b", r"\bglitch\b", r"\bs-pen\b", r"\bair actions\b", r"\bpair\b"
        ]
        needs_troubleshooting = any(re.search(p, combined, re.IGNORECASE) for p in troubleshooting_signals)

        # If it's a software issue, ignore the missing invoice and help the customer immediately
        if needs_troubleshooting:
            return {
                "autoDecision":        "TROUBLESHOOTING_REQUIRED",
                "decisionConfidence":  0.90,
                "decisionRationale":   "Issue is related to software/settings. Bypassing document checks to send immediate help.",
                "recommendedNextStep": "Trigger RAG manual lookup. Send automated troubleshooting guide.",
            }

        # Otherwise, ask for the documents
        return {
            "autoDecision":        "REQUEST_DOCUMENTS",
            "decisionConfidence":  0.90,
            "decisionRationale":   "Required documents (e.g. purchase invoice) are missing.",
            "recommendedNextStep": "Send REQUEST_DOCUMENTS email to customer.",
        }

    # 3. STANDARD ROUTING
    complaint_type = str(extracted_fields.get("complaintType", "")).lower()
    description    = str(extracted_fields.get("description", "")).lower()
    combined       = f"{complaint_type} {description}"

    replacement_signals = [
        r"\breplace\b", r"\breplacement\b", r"\bdoa\b", r"\bnot turning on\b", 
        r"\bcompletely broken\b", r"\bscreen crack\b", r"\bwater damage\b"
    ]
    
    troubleshooting_signals = [
        r"\bsettings\b", r"\bsoftware\b", r"\bconnection\b", r"\bbluetooth\b",
        r"\bwifi\b", r"\bpowershare\b", r"\bhow to\b", r"\bsetup\b", r"\bturn on\b",
        r"\bdisconnects\b", r"\bglitch\b", r"\bs-pen\b", r"\bair actions\b", r"\bpair\b"
    ]
    
    repair_signals = [r"\brepair\b", r"\bfix\b", r"\bfreezing\b", r"\blag\b", r"\bcharging\b", r"\bbroken\b"]

    wants_replacement     = any(re.search(p, combined, re.IGNORECASE) for p in replacement_signals)
    needs_troubleshooting = any(re.search(p, combined, re.IGNORECASE) for p in troubleshooting_signals)
    wants_repair          = any(re.search(p, combined, re.IGNORECASE) for p in repair_signals)

    if grounding_recommendation == "CUSTOMER_NOT_FOUND":
        return {
            "autoDecision":        "DESK_REJECT",
            "decisionConfidence":  1.0,
            "decisionRationale":   "Customer record not found in the CRM database.",
            "recommendedNextStep": "Send DESK_REJECT email (customer not found).",
            "rejectReason": "customer_not_found",
        }

    if grounding_recommendation in ("ESCALATE",):
        return {
            "autoDecision":        "INVESTIGATE",
            "decisionConfidence":  0.75,
            "decisionRationale":   "Complaint escalated or critical priority.",
            "recommendedNextStep": "Assign to senior agent.",
        }

    if grounding_recommendation in ("AUTO_APPROVE",) and customer_verified:
        if wants_replacement:
            return {
                "autoDecision":        "APPROVE_REPLACEMENT",
                "decisionConfidence":  0.88,
                "decisionRationale":   "Customer and product verified. Replacement indicators present.",
                "recommendedNextStep": "Send APPROVE_REPLACEMENT email.",
            }
            
        if needs_troubleshooting:
            return {
                "autoDecision":        "TROUBLESHOOTING_REQUIRED",
                "decisionConfidence":  0.90,
                "decisionRationale":   "Customer and product verified. Issue related to software or settings.",
                "recommendedNextStep": "Trigger RAG manual lookup. Send automated troubleshooting guide.",
            }
            
        return {
            "autoDecision":        "APPROVE_REPAIR",
            "decisionConfidence":  0.85,
            "decisionRationale":   "Customer and product verified. Repair approved within warranty.",
            "recommendedNextStep": "Send APPROVE_REPAIR email.",
        }

    return {
        "autoDecision":        "INVESTIGATE",
        "decisionConfidence":  0.60,
        "decisionRationale":   "Insufficient verified data. Manual review required.",
        "recommendedNextStep": "Assign to complaints team for review.",
    }


def _build_complaint_draft(fields: Dict[str, Any], ingested: Dict[str, Any], extraction: Dict[str, Any], customer_verified: bool) -> Dict[str, Any]:
    now = _iso_now()
    evidence = extraction.get("evidence", [])
    docs = extraction.get("documents", [])
    avg_conf = sum(e.get("confidence", 0) for e in evidence) / len(evidence) if evidence else 0.0

    attachments = [
        {
            "id": f"doc_{i}",
            "name": att.get("name", ""),
            "type": (docs[i] if i < len(docs) else {}).get("type", "Other"),
            "mimeType": att.get("mimeType", "application/octet-stream"),
            "confidence": (docs[i] if i < len(docs) else {}).get("confidence", 0.7),
        }
        for i, att in enumerate(ingested.get("attachments", []))
    ]

    return {
        "id": f"DRAFT-{int(time.time() * 1000)}",
        "complaintRef": str(fields.get("complaintRef") or "Not found"),
        "customerName": str(fields.get("customerName") or "Not found"),
        "customerEmail": _mask_email(str(fields.get("customerEmail") or "").strip() or None),
        "customerPhone": _mask_phone(str(fields.get("customerPhone") or "").strip() or None),
        "complaintDate": str(fields.get("complaintDate") or now.split("T")[0]),
        "complaintType": str(fields.get("complaintType") or "Other"),
        "productOrService": str(fields.get("productOrService") or "Not specified"),
        "description": str(fields.get("description") or "Complaint submitted via email"),
        "desiredResolution": str(fields.get("desiredResolution")or "Not specified"),
        "estimatedAmount": float(fields.get("estimatedAmount") or 0),
        "attachments": attachments,
        "customerVerified": customer_verified,
        "createdAt": now,
        "source": "information_extraction",
        "confidence": avg_conf,
    }


def _build_customer_info(customer_ref: str) -> Optional[Dict[str, Any]]:
    customer = find_customer(customer_ref)
    complaints = get_customer_complaints(customer_ref)
    if not customer:
        return None

    latest = sorted(complaints, key=lambda c: c.get("created_date", ""), reverse=True)
    latest = latest[0] if latest else {}

    return {
        "customer_id": customer.get("customer_id"),
        "first_name": customer.get("first_name"),
        "last_name": customer.get("last_name"),
        "full_name": f"{customer.get('first_name','')} {customer.get('last_name','')}".strip(),
        "email_id": customer.get("email_id"),
        "phone_number": customer.get("phone_number"),
        "address_line1": customer.get("address_line1"),
        "address_line2": customer.get("address_line2"),
        "city": customer.get("city"),
        "state": customer.get("state"),
        "postal_code": customer.get("postal_code"),
        "country": customer.get("country", ""),
        "customer_since": customer.get("customer_since"),
        "customer_status": customer.get("customer_status"),
        "loyalty_tier": customer.get("loyalty_tier"),
        "total_complaints": customer.get("total_complaints"),
        "open_complaints": customer.get("open_complaints"),
        "preferred_contact":customer.get("preferred_contact_method"),
        "complaint_ref": customer_ref,
        "complaint_id": latest.get("complaint_id"),
        "product_id": latest.get("product_id"),
        "complaint_type": latest.get("complaint_type"),
        "current_status": latest.get("current_status"),
        "priority_level": latest.get("priority_level"),
        "severity_level": latest.get("severity_level"),
        "is_escalated": latest.get("is_escalated", False),
        "assigned_team": latest.get("assigned_team"),
        "sla_hours": latest.get("sla_hours"),
    }


def build_decision_pack(
    ingested_claim_id: str,
    ingested_email: Dict[str, Any],
    extraction: Dict[str, Any],
    extraction_duration_ms: int = 0,
    validation: Optional[Dict[str, Any]] = None,
    validation_duration_ms: int = 0,
) -> Dict[str, Any]:
    now = _iso_now()
    complaint_id = f"CMP-{ingested_claim_id}"
    fields = extraction.get("extractedFields") or {}

    grounding_start = time.time()
    grounding = get_customer_grounding(fields)
    if not grounding:
        grounding = get_resolution_rules(fields)
    grounding_ms = int((time.time() - grounding_start) * 1000)

    not_found_ids = {"CUSTOMER-NOT-FOUND", "ACCOUNT-NOT-FOUND"}
    top = grounding[0] if grounding else {}
    customer_verified = bool(
        top and top.get("recordId") not in not_found_ids and top.get("confidence_score", 0) >= 0.5
        and fields.get("complaintRef") and top.get("customer_verified", False)
    )

    customer_info = None
    customer_ref = str(fields.get("complaintRef", "") or "").strip().upper()
    if customer_ref:
        try:
            customer_info = _build_customer_info(customer_ref)
        except Exception as exc:
            import sys as _sys
            print(f"Warning: customer info lookup failed: {exc}", file=_sys.stderr)

    complaint_draft = _build_complaint_draft(fields, ingested_email, extraction, customer_verified)

    ev = extraction.get("evidence", [])
    docs = extraction.get("documents", [])
    high = sum(1 for e in ev if e.get("confidence", 0) >= CONFIDENCE_HIGH)
    low = sum(1 for e in ev if e.get("confidence", 0) < CONFIDENCE_MEDIUM)
    avg = sum(e.get("confidence", 0) for e in ev) / len(ev) if ev else 0.0

    top_score = top.get("confidence_score", top.get("score", 0))
    top_rec = top.get("recommendation", "INVESTIGATE")
    if top.get("recordId") in not_found_ids:
        top_rec = "CUSTOMER_NOT_FOUND"

    validation = validation or {}
    decision_block = _derive_auto_decision(validation, top_rec, customer_verified, fields)

    warranty_result = next((r for r in validation.get("validationResults", []) if r.get("check") == "warranty_validation"), {})
    doc_result = next((r for r in validation.get("validationResults", []) if r.get("check") == "document_validation"), {})

    audit = [
        {"step": "Information Extraction", "timestamp": now, "duration": extraction_duration_ms, "agent": "ExtractionService", "status": "completed", "details": {"documentsProcessed": len(docs), "errors": extraction.get("errors", [])}},
        {"step": "Validation Engine", "timestamp": now, "duration": validation_duration_ms, "agent": "ValidationService", "status": "completed", "details": {"warrantyStatus": validation.get("warrantyStatus"), "allChecksPassed": validation.get("allChecksPassed"), "autoDecision": validation.get("autoDecision")}},
        {"step": "Customer & Product Grounding", "timestamp": now, "duration": grounding_ms, "agent": "CustomerGroundingService", "status": "completed", "details": {"recordsFound": len(grounding), "customerVerified": customer_verified}},
        {"step": "Decision Engine", "timestamp": now, "duration": 0, "agent": "DecisionService", "status": "completed", "details": {"autoDecision": decision_block["autoDecision"], "decisionConfidence": decision_block["decisionConfidence"]}},
    ]

    return {
        "complaintId": complaint_id,
        "ingestedComplaintId": ingested_claim_id,
        "sourceEmailFrom": ingested_email.get("from"),
        "warrantyStatus": validation.get("warrantyStatus", "UNKNOWN"),
        "productCategory": validation.get("productCategory"),
        "autoDecision": decision_block["autoDecision"],
        "decisionConfidence": decision_block["decisionConfidence"],
        "recommendedNextStep": decision_block["recommendedNextStep"],
        "rejectReason": decision_block.get("rejectReason"),
        "decisionPack": {
            "id": f"DP-{int(time.time() * 1000)}",
            "complaintDraft": complaint_draft,
            "evidence": ev,
            "documents": [{**d, "metadata": d.get("metadata") or {}} for d in docs],
            "customerGrounding": grounding,
            "customerInfo": customer_info,
            "validationResults": validation.get("validationResults", []),
            "warrantyStatus": validation.get("warrantyStatus", "UNKNOWN"),
            "productCategory": validation.get("productCategory"),
            "matchedProduct": validation.get("matchedProduct"),
            "autoDecision": decision_block["autoDecision"],
            "decisionConfidence": decision_block["decisionConfidence"],
            "decisionRationale": decision_block["decisionRationale"],
            "recommendedNextStep": decision_block["recommendedNextStep"],
            "rejectReason": decision_block.get("rejectReason"),
            "audit": audit,
            "evidenceSummary": {"totalFields": len(ev), "highConfidenceFields": high, "lowConfidenceFields": low, "avgConfidence": avg},
            "documentAnalysis": {"totalDocuments": len(docs), "documentTypes": [d.get("type", "Other") for d in docs], "avgDocumentConfidence": (sum(d.get("confidence", 0) for d in docs) / len(docs) if docs else 0), "missingDocuments": doc_result.get("missingDocuments", []), "presentDocuments": doc_result.get("presentDocuments", [])},
            "resolutionAssessment": {"recordsFound": len(grounding), "customerVerified": customer_verified, "topMatchScore": top_score, "recommendation": top_rec, "autoDecision": decision_block["autoDecision"], "decisionConfidence": decision_block["decisionConfidence"], "recommendedActions": [decision_block["recommendedNextStep"]]},
            "processingSummary": {"stepsCompleted": len(audit), "stepsWithErrors": len(extraction.get("errors", []))},
            "createdAt": now,
        },
        "processingMetrics": {"fieldsAutoPopulated": len(ev), "stepsCompleted": len(audit), "stepsFailed": len(extraction.get("errors", []))},
        "createdAt": now,
        "status": "draft",
    }