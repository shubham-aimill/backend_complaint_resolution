"""
Appointments service — engineer visit booking for complaint resolution.

Appointments are stored as a flat JSON list in data/appointments.json.
Each record includes the complaint reference, engineer details, date/time,
location, status, and audit timestamps.
"""

import json
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.common.config import APPOINTMENTS_FILE, DATA_DIR


def _load() -> List[Dict[str, Any]]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not APPOINTMENTS_FILE.exists():
        return []
    try:
        return json.loads(APPOINTMENTS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _save(records: List[Dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    APPOINTMENTS_FILE.write_text(
        json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def book_appointment(
    complaint_id: str,
    date: str,
    time_slot: str,
    engineer_name: str,
    location: str,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a new engineer visit appointment and persist it."""
    records = _load()
    appointment_id = f"APT-{int(time.time() * 1000)}"
    record: Dict[str, Any] = {
        "appointmentId": appointment_id,
        "complaintId": complaint_id,
        "date": date,
        "time": time_slot,
        "engineerName": engineer_name,
        "location": location,
        "notes": notes or "",
        "status": "confirmed",
        "createdAt": datetime.utcnow().isoformat() + "Z",
    }
    records.insert(0, record)
    _save(records)
    return record


def get_appointments(complaint_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return all appointments, optionally filtered by complaint ID."""
    records = _load()
    if complaint_id:
        return [r for r in records if r.get("complaintId") == complaint_id]
    return records


def get_appointment_by_id(appointment_id: str) -> Optional[Dict[str, Any]]:
    """Return a single appointment by ID, or None if not found."""
    return next(
        (r for r in _load() if r.get("appointmentId") == appointment_id), None
    )
