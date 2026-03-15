"""
Shared Pydantic request/response models.

Import from here in fastapi_server.py and any future routers.
To reuse in another project: copy this file and adjust fields as needed.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ── Complaint Processing ──────────────────────────────────────────────────

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
    warrantyStatus:      Optional[str] = None
    productCategory:     Optional[str] = None
    autoDecision:        Optional[str] = None
    decisionConfidence:  Optional[float] = None
    recommendedNextStep: Optional[str] = None


class UpdateComplaintStatusRequest(BaseModel):
    status:           str = Field(..., description="accepted | rejected | pending")
    rejectionReason:  Optional[str] = None
    rejectionDetails: Optional[str] = None


# ── Mail Chain ────────────────────────────────────────────────────────────

class AddThreadEmailRequest(BaseModel):
    fromAddr:         str = Field("support@electronics.com", alias="from")
    toAddr:           str = Field("", alias="to")
    subject:          str
    emailBody:        str
    direction:        str = "outbound"
    emailType:        Optional[str] = None
    rejectionReason:  Optional[str] = None
    rejectionDetails: Optional[str] = None
    inReplyTo:        Optional[str] = None

    model_config = {"populate_by_name": True}


# ── Appointments ──────────────────────────────────────────────────────────

class BookAppointmentRequest(BaseModel):
    complaintId:  str
    date:         str
    time:         str
    engineerName: str
    location:     str
    notes:        Optional[str] = None


# ── Email ─────────────────────────────────────────────────────────────────

class SendEmailRequest(BaseModel):
    to:      str
    subject: str
    body:    str
    cc:      Optional[List[str]] = None
    bcc:     Optional[List[str]] = None


# ── Sync Inbox ────────────────────────────────────────────────────────────

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
