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

import re
import sys
import time
from typing import Any, Dict

from backend.dashboard.service import save_processed_complaint
from backend.decision.service import build_decision_pack
from backend.decision.customer_grounding import find_customer
from backend.extraction.service import extract_claim_information
from backend.ingested_complaints.service import (
    get_ingested_complaint_by_id,
    mark_ingested_complaint_processed,
    add_email_to_thread,
)
from backend.validation.service import run_validation
from backend.auto_response.service import send_auto_response


def process_complaint(ingested_complaint_id: str) -> Dict[str, Any]:
    complaint = get_ingested_complaint_by_id(ingested_complaint_id)
    if not complaint:
        raise ValueError(f"Complaint not found: {ingested_complaint_id}")
    if complaint.get("source") == "outbound":
        raise ValueError(
            f"Complaint {ingested_complaint_id} is an outbound thread email and cannot be processed"
        )

    # ── Guard: skip re-processing already-processed complaints ────────────
    if complaint.get("processingStatus") == "processed":
        from backend.dashboard.service import get_processed_complaint_by_id as _get_existing
        existing = _get_existing(f"CMP-{ingested_complaint_id}")
        if existing:
            return existing

    pipeline_start = time.time()

    # ── Pre-check: Verify customer exists before expensive LLM calls ───────
    complaint_ref_pre = str(complaint.get("complaintRef", "") or "").strip().upper()
    if re.match(r"^CUST[-]?\d+$", complaint_ref_pre) and not find_customer(complaint_ref_pre.replace("-", "")):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        complaint_id = f"CMP-{ingested_complaint_id}"
        complaint_data: Dict[str, Any] = {
            "complaintId":         complaint_id,
            "ingestedComplaintId": ingested_complaint_id,
            "sourceEmailFrom":     complaint.get("from"),
            "warrantyStatus":      "UNKNOWN",
            "productCategory":     None,
            "autoDecision":        "DESK_REJECT",
            "decisionConfidence":  1.0,
            "rejectReason":        "customer_not_found",
            "recommendedNextStep": "Customer not found in CRM. Send desk-reject email.",
            "decisionPack": {
                "id":               f"DP-{int(time.time() * 1000)}",
                "complaintDraft":   {"customerName": "Valued Customer", "productOrService": "your product"},
                "autoDecision":     "DESK_REJECT",
                "decisionConfidence": 1.0,
                "decisionRationale": (
                    f"Customer reference '{complaint_ref_pre}' was not found in the CRM database. "
                    "Complaint cannot be processed without a verified account."
                ),
                "rejectReason": "customer_not_found",
                "recommendedNextStep": "Send DESK_REJECT email. Ask customer to verify account details.",
                "evidence": [], "documents": [], "customerGrounding": [],
                "validationResults": [], "warrantyStatus": "UNKNOWN",
                "resolutionAssessment": {"customerVerified": False, "recommendation": "DESK_REJECT"},
                "createdAt": now,
            },
            "processingMetrics": {"fieldsAutoPopulated": 0, "stepsCompleted": 1, "stepsFailed": 0},
            "createdAt": now,
            "status": "draft",
        }
        # Send DESK_REJECT email
        customer_email = complaint.get("from", "")
        if customer_email and "@" in customer_email:
            auto_email_result = send_auto_response(
                to_addr=customer_email,
                customer_name="Valued Customer",
                complaint_id=complaint_id,
                decision="DESK_REJECT",
                reject_reason="customer_not_found",
                in_reply_to=complaint.get("messageId"),
                references=complaint.get("threadId"),
            )
            if auto_email_result.get("sent"):
                try:
                    add_email_to_thread(
                        complaint_id=ingested_complaint_id,
                        from_addr=auto_email_result.get("sentFrom", "support@aimill-support.com"),
                        to_addr=customer_email,
                        subject=auto_email_result.get("subject", f"Re: {complaint.get('subject', '')}"),
                        email_body=auto_email_result.get("body", ""),
                        direction="outbound",
                        email_type="auto_desk_reject",
                        rejection_reason="customer_not_found",
                        in_reply_to=complaint.get("messageId"),
                    )
                except Exception:
                    pass
        else:
            auto_email_result = {"sent": False, "skipped": True, "reason": "no_customer_email"}
        complaint_data["autoEmailResponse"] = auto_email_result
        complaint_data["processingTime"] = int((time.time() - pipeline_start) * 1000)
        save_processed_complaint(complaint_data)
        mark_ingested_complaint_processed(ingested_complaint_id)
        return complaint_data

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
    auto_decision  = complaint_data.get("autoDecision")
    customer_email = complaint.get("from", "")

    draft         = (complaint_data.get("decisionPack") or {}).get("complaintDraft") or {}
    customer_name = draft.get("customerName", "Valued Customer")
    product_name  = draft.get("productOrService", "your product")
    complaint_id  = complaint_data.get("complaintId", ingested_complaint_id)
    complaint_desc = draft.get("description") or draft.get("complaintType", "")
    subject_text   = complaint.get("subject", "")

    # ---------------------------------------------------------------------
    # NEW AUTOMATIC RAG INJECTION LOGIC (Fetching from your existing DB)
    # ---------------------------------------------------------------------
    rag_troubleshooting_steps = None
    if auto_decision in ["TROUBLESHOOTING_REQUIRED", "INVESTIGATE"]:
        try:
            # Import functions directly from your advanced rag/service.py
            from backend.rag.service import semantic_search, generate_answer, match_product_from_text

            query_text = f"{subject_text} {complaint_desc} {product_name}".strip()
            
            # 1. Use your keyword dictionary to get the exact product ID
            prod_match = match_product_from_text(subject_text, query_text)
            rag_product_id = prod_match.get("product_id")
            rag_product_name = prod_match.get("product_name") or product_name

            # 2. Search your ChromaDB (with your built-in product_id hard filter)
            chunks = semantic_search(
                query=query_text, 
                top_k=4, 
                product_id=rag_product_id
            )

            # 3. Generate the answer using your built-in GPT-4o prompt
            if chunks:
                rag_result = generate_answer(
                    question=complaint_desc,
                    chunks=chunks,
                    product_id=rag_product_id,
                    product_name=rag_product_name
                )
                
                # Extract the formatted answer string
                if rag_result and rag_result.get("answer"):
                    rag_troubleshooting_steps = rag_result.get("answer")
            
            # Change the decision so it triggers the new RAG email template
            auto_decision = "REQUEST_DOCUMENTS"

        except Exception as e:
            print(f"Auto-RAG generation failed during orchestrator pipeline: {e}", file=sys.stderr)
            auto_decision = "REQUEST_DOCUMENTS"
    # ---------------------------------------------------------------------

    doc_result = next(
        (r for r in validation.get("validationResults", []) if r.get("check") == "document_validation"),
        {}
    )
    missing_docs = doc_result.get("missingDocuments", [])

    warranty_result = next(
        (r for r in validation.get("validationResults", []) if r.get("check") == "warranty_validation"),
        {}
    )
    warranty_expiry = warranty_result.get("expiryDate")
    purchase_date   = warranty_result.get("purchaseDate")
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
            in_reply_to=complaint.get("messageId"),
            references=complaint.get("threadId"),
            troubleshooting_steps=rag_troubleshooting_steps, # <-- PASSING YOUR GENERATED DB RAG STEPS
        )
        if auto_email_result.get("sent"):
            try:
                add_email_to_thread(
                    complaint_id=ingested_complaint_id,
                    from_addr=auto_email_result.get("sentFrom", "support@aimill-support.com"),
                    to_addr=customer_email,
                    subject=auto_email_result.get("subject", f"Re: {complaint.get('subject', '')}"),
                    email_body=auto_email_result.get("body", ""),
                    direction="outbound",
                    email_type=f"auto_{auto_decision.lower()}",
                    rejection_reason=reject_reason,
                    in_reply_to=complaint.get("messageId"),
                )
            except Exception:
                pass 
    elif not customer_email:
        auto_email_result = {
            "sent": False,
            "skipped": True,
            "reason": "no_customer_email",
            "decision": auto_decision,
        }

    complaint_data["autoEmailResponse"] = auto_email_result
    if complaint.get("messageId"):
        complaint_data["messageId"] = complaint["messageId"]
    if complaint.get("threadId"):
        complaint_data["threadId"] = complaint["threadId"]

    # ── Step 5: Save to Dashboard ──────────────────────────────────────────
    total_duration = int((time.time() - pipeline_start) * 1000)
    complaint_data["processingTime"] = total_duration
    complaint_data["processingMetrics"] = complaint_data.get("processingMetrics") or {}
    complaint_data["processingMetrics"]["totalProcessingTime"] = total_duration
    complaint_data["processingMetrics"]["averageHandleTime"]   = total_duration / 1000.0
    complaint_data["processingMetrics"]["extractionTime"]      = extraction_duration_ms
    complaint_data["processingMetrics"]["validationTime"]      = validation_duration_ms

    save_processed_complaint(complaint_data)
    mark_ingested_complaint_processed(ingested_complaint_id)
    return complaint_data


def main() -> int:
    if len(sys.argv) < 2:
        print('{"error": "Usage: python -m backend.process_complaint <ingested_complaint_id>"}', file=sys.stderr)
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