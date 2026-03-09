"""
FastAPI Server — Consumer Electronics Complaint Resolution System.

Provides REST endpoints for the frontend to ingest, process, retrieve
and dashboard customer complaints. Extended with electronics-specific fields
(warrantyStatus, productCategory, autoDecision, validationResults).
"""

import json
import os
import queue
import sys
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.dashboard.service import (
    get_dashboard_kpis,
    get_processed_complaint_by_id,
    get_processed_complaint_summaries,
    save_processed_complaint,
)
from backend.email_ingestion.service import sync_inbox
from backend.ingested_complaints.service import (
    clear_all_ingested_complaints,
    get_all_ingested_complaints,
    get_complaint_references,
    get_ingested_complaint_by_id,
)
from backend.process_complaint.orchestrator import process_complaint
from backend.common.config import ENV_FILE


def _load_env_at_startup() -> None:
    """Load .env from repo root or backend_modified so OPENAI_API_KEY etc. are set."""
    if ENV_FILE.exists():
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    k = key.strip()
                    v = val.strip().strip("'\"")
                    if k and not os.environ.get(k):
                        os.environ[k] = v


_load_env_at_startup()

app = FastAPI(
    title="Consumer Electronics Complaint Resolution API",
    description=(
        "REST API for consumer electronics complaint ingestion, validation, "
        "AI-powered decision making, and dashboard management."
    ),
    version="2.0.0",
)

cors_origins = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ──────────────────────────────────────────────

class ProcessComplaintRequest(BaseModel):
    ingestedComplaintId: str


class SaveComplaintRequest(BaseModel):
    complaintId:         Optional[str] = None
    ingestedComplaintId: Optional[str] = None
    decisionPack:        Dict[str, Any]
    status:              Optional[str] = None
    createdAt:           Optional[str] = None
    processingTime:      Optional[int] = None
    processingMetrics:   Optional[Dict[str, Any]] = None
    # New electronics fields
    warrantyStatus:      Optional[str] = None
    productCategory:     Optional[str] = None
    autoDecision:        Optional[str] = None
    decisionConfidence:  Optional[float] = None
    recommendedNextStep: Optional[str] = None


class SyncInboxResponse(BaseModel):
    success:            bool
    ingested:           int
    scanned:            int
    skippedNoComplaint: int = 0
    skippedDuplicate:   int = 0
    faqAnswered:        int = 0
    faqError:           int = 0
    errors:             List[str]
    hint:               Optional[str] = None


# ── Endpoints ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check() -> Dict[str, str]:
    return {
        "status":  "healthy",
        "service": "consumer-electronics-complaint-resolution-api",
        "version": "2.0.0",
    }


@app.post("/api/process-complaint")
async def process_complaint_endpoint(request: ProcessComplaintRequest) -> Dict[str, Any]:
    """
    Process an ingested complaint end-to-end:
    AI Extraction → Validation Engine → Decision Engine → Auto Email Response → Save.
    """
    if not request.ingestedComplaintId:
        raise HTTPException(status_code=400, detail="ingestedComplaintId is required")
    try:
        result = process_complaint(request.ingestedComplaintId)
        if result.get("error"):
            raise HTTPException(status_code=404, detail=result["error"])
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")


@app.get("/api/ingested-complaints")
async def list_ingested_complaints(full: bool = False) -> List[Dict[str, Any]]:
    """List ingested complaints. Use ?full=true to return complete records."""
    try:
        return get_all_ingested_complaints() if full else get_complaint_references()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ingested-complaints/{complaint_id}")
async def get_ingested_complaint_endpoint(complaint_id: str) -> Dict[str, Any]:
    """Get a single ingested complaint by ID."""
    result = get_ingested_complaint_by_id(complaint_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Ingested complaint not found")
    return result


@app.post("/api/ingested-complaints/clear")
async def clear_ingested_complaints_endpoint() -> Dict[str, Any]:
    """Delete all ingested complaints and their attachment files."""
    try:
        clear_all_ingested_complaints()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/complaints")
async def list_processed_complaints() -> List[Dict[str, Any]]:
    """List all processed complaint summaries."""
    try:
        return get_processed_complaint_summaries()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/complaints")
async def save_complaint_endpoint(request: SaveComplaintRequest) -> Dict[str, Any]:
    """Save a processed complaint record."""
    if not request.decisionPack:
        raise HTTPException(status_code=400, detail="decisionPack is required")
    try:
        save_processed_complaint(request.model_dump(exclude_none=True))
        return {"success": True, "complaintId": request.complaintId}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/complaints/{complaint_id}")
async def get_complaint_endpoint(complaint_id: str) -> Dict[str, Any]:
    """Get a processed complaint by ID (includes full decisionPack, validationResults, autoDecision)."""
    result = get_processed_complaint_by_id(complaint_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Complaint not found")
    return result


@app.get("/api/dashboard/kpis")
async def get_dashboard_kpis_endpoint() -> Dict[str, Any]:
    """
    Get dashboard KPIs and statistics.

    Includes new electronics-specific KPIs:
    - complaintsByDecision (APPROVE_REPAIR, APPROVE_REPLACEMENT, DESK_REJECT, etc.)
    - warrantyStatusCounts (WITHIN_WARRANTY, OUT_OF_WARRANTY, UNKNOWN)
    - complaintsByCategory (Smartphone, Laptop, etc.)
    """
    try:
        return get_dashboard_kpis()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync-inbox")
async def sync_inbox_endpoint() -> SyncInboxResponse:
    """Sync email inbox and ingest new complaint emails."""
    try:
        result = sync_inbox()
        return SyncInboxResponse(
            success=result.get("success", False),
            ingested=result.get("ingested", 0),
            scanned=result.get("scanned", 0),
            skippedNoComplaint=result.get("skippedNoComplaint", 0),
            skippedDuplicate=result.get("skippedDuplicate", 0),
            faqAnswered=result.get("faqAnswered", 0),
            faqError=result.get("faqError", 0),
            errors=result.get("errors", []),
            hint=result.get("hint"),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _sync_inbox_stream_generator():
    """Yield SSE events: progress (total/done/counts) then done (final result)."""
    q = queue.Queue()

    def on_progress(p: Dict[str, Any]) -> None:
        q.put(("progress", p))

    def run_sync() -> None:
        try:
            result = sync_inbox(progress_callback=on_progress)
            q.put(("done", result))
        except Exception as e:
            q.put(("error", {"errors": [str(e)]}))

    thread = threading.Thread(target=run_sync)
    thread.start()

    while True:
        kind, data = q.get()
        if kind == "progress":
            yield f"event: progress\ndata: {json.dumps(data)}\n\n"
        elif kind == "done":
            yield f"event: done\ndata: {json.dumps(data)}\n\n"
            break
        else:
            yield f"event: error\ndata: {json.dumps(data)}\n\n"
            break


@app.get("/api/sync-inbox/stream")
def sync_inbox_stream_endpoint():
    """Stream sync progress (total/done/counts) then final result as SSE."""
    return StreamingResponse(
        _sync_inbox_stream_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/")
async def root() -> Dict[str, str]:
    return {
        "message": "Consumer Electronics Complaint Resolution API",
        "version": "2.0.0",
        "docs":    "/docs",
        "health":  "/health",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.fastapi_server:app",
        host=os.getenv("API_HOST", "0.0.0.0"),
        port=int(os.getenv("API_PORT", "8020")),
        reload=os.getenv("API_RELOAD", "false").lower() == "true",
    )
