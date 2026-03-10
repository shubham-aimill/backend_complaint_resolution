"""
Complaint Processing Orchestrator — Consumer Electronics Complaint Resolution System.

Extended pipeline:
  1. Load ingested complaint from storage
  2. Extract structured fields from email + attachments (OpenAI)
  3. Validation Engine — warranty / document / product checks
  4. Decision Engine — build full decision pack with structured auto-decision
  5. Auto Email Response — send appropriate email based on decision
  6. Save processed complaint to dashboard storage
"""

import sys
import time
from typing import Any, Dict

from backend.dashboard.service import save_processed_complaint
from backend.decision.service import build_decision_pack
from backend.extraction.service import extract_claim_information
from backend.ingested_complaints.service import get_ingested_complaint_by_id
from backend.validation.service import run_validation
from backend.auto_response.service import send_auto_response


def process_complaint(ingested_complaint_id: str) -> Dict[str, Any]:
    """
    Process an ingested complaint end-to-end through the full electronics pipeline.

    Pipeline:
      Email Ingestion → AI Extraction → Validation Engine →
      Decision Engine → Auto Email Response → Dashboard Save

    Args:
        ingested_complaint_id: ID of the ingested complaint email.

    Returns:
        Complete complaint data dict for the frontend.

    Raises:
        ValueError: If complaint not found.
    """
    complaint = get_ingested_complaint_by_id(ingested_complaint_id)
    if not complaint:
        raise ValueError(f"Complaint not found: {ingested_complaint_id}")

    pipeline_start = time.time()

    # ── Step 1: AI Extraction ──────────────────────────────────────────────
    extraction_start = time.time()
    extraction = extract_claim_information(
        claim_id=ingested_complaint_id,
        email_body=complaint.get("emailBody", ""),
        attachments=complaint.get("attachments", []),
    )
    extraction_duration_ms = int((time.time() - extraction_start) * 1000)

    # ── Step 2: Validation Engine ──────────────────────────────────────────
    validation_start = time.time()
    fields    = extraction.get("extractedFields") or {}
    documents = extraction.get("documents") or []

    validation = run_validation(
        extracted_fields=fields,
        documents=documents,
    )
    validation_duration_ms = int((time.time() - validation_start) * 1000)

    # ── Step 3: Decision Engine ────────────────────────────────────────────
    complaint_data = build_decision_pack(
        ingested_claim_id=ingested_complaint_id,
        ingested_email=complaint,
        extraction=extraction,
        extraction_duration_ms=extraction_duration_ms,
        validation=validation,
        validation_duration_ms=validation_duration_ms,
    )

    # ── Step 4: Auto Email Response ────────────────────────────────────────
    # Attempt to send an automated email based on the decision.
    # Failures are logged but do NOT abort the pipeline.
    auto_decision  = complaint_data.get("autoDecision")
    customer_email = complaint.get("from", "")  # sender's email address

    # Extract additional context for the email
    draft         = (complaint_data.get("decisionPack") or {}).get("complaintDraft") or {}
    customer_name = draft.get("customerName", "Valued Customer")
    product_name  = draft.get("productOrService", "your product")
    complaint_id  = complaint_data.get("complaintId", ingested_complaint_id)

    # Gather missing docs list for REQUEST_DOCUMENTS decision
    doc_result = next(
        (r for r in validation.get("validationResults", []) if r.get("check") == "document_validation"),
        {}
    )
    missing_docs = doc_result.get("missingDocuments", [])

    # Gather warranty dates for DESK_REJECT decision
    warranty_result = next(
        (r for r in validation.get("validationResults", []) if r.get("check") == "warranty_validation"),
        {}
    )
    warranty_expiry = warranty_result.get("expiryDate")
    purchase_date   = warranty_result.get("purchaseDate")

    # Gather reject reason for DESK_REJECT (physical damage, unauthorized repair, etc.)
    reject_reason = complaint_data.get("rejectReason")

    auto_email_result: Dict[str, Any] = {"sent": False, "skipped": True, "reason": "no_decision"}

    if auto_decision and customer_email:
        auto_email_result = send_auto_response(
            to_addr=customer_email,
            customer_name=customer_name,
            complaint_id=complaint_id,
            decision=auto_decision,
            product_name=product_name,
            missing_docs=missing_docs,
            warranty_expiry=warranty_expiry,
            purchase_date=purchase_date,
            reject_reason=reject_reason,
        )
    elif not customer_email:
        auto_email_result = {
            "sent": False,
            "skipped": True,
            "reason": "no_customer_email",
            "decision": auto_decision,
        }

    # Attach auto-response result to the complaint record
    complaint_data["autoEmailResponse"] = auto_email_result

    # ── Step 5: Save to Dashboard ──────────────────────────────────────────
    total_duration = int((time.time() - pipeline_start) * 1000)
    complaint_data["processingTime"] = total_duration
    complaint_data["processingMetrics"] = complaint_data.get("processingMetrics") or {}
    complaint_data["processingMetrics"]["totalProcessingTime"] = total_duration
    complaint_data["processingMetrics"]["averageHandleTime"]   = total_duration / 1000.0
    complaint_data["processingMetrics"]["extractionTime"]      = extraction_duration_ms
    complaint_data["processingMetrics"]["validationTime"]      = validation_duration_ms

    save_processed_complaint(complaint_data)
    return complaint_data


def main() -> int:
    """CLI entry: process a complaint and output JSON."""
    if len(sys.argv) < 2:
        print(
            '{"error": "Usage: python -m backend.process_complaint <ingested_complaint_id>"}',
            file=sys.stderr,
        )
        return 1

    ingested_id = sys.argv[1]
    try:
        result = process_complaint(ingested_id)
        print(__import__("json").dumps(result, indent=2))
        return 0
    except ValueError as e:
        print(__import__("json").dumps({"error": str(e)}), file=sys.stderr)
        return 1
    except Exception as e:
        print(__import__("json").dumps({"error": f"Processing failed: {e}"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
