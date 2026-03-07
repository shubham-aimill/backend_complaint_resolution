"""
Process Complaint package.

Orchestrates the end-to-end complaint processing pipeline.
"""
from backend.process_complaint.orchestrator import process_complaint

__all__ = ["process_complaint"]
