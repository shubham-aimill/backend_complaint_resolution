"""
Ingested Complaints package.

Manages customer complaints ingested from email before AI processing.
Provides CRUD, reference extraction, and deduplication.
"""
from backend.ingested_complaints.service import (
    clear_all_ingested_complaints,
    extract_complaint_reference,
    get_all_ingested_complaints,
    get_complaint_references,
    get_ingested_complaint_by_id,
    get_stale_pending_complaints,
    mark_complaint_auto_closed,
    save_ingested_complaint,
)

__all__ = [
    "clear_all_ingested_complaints",
    "extract_complaint_reference",
    "get_all_ingested_complaints",
    "get_complaint_references",
    "get_ingested_complaint_by_id",
    "get_stale_pending_complaints",
    "mark_complaint_auto_closed",
    "save_ingested_complaint",
]
