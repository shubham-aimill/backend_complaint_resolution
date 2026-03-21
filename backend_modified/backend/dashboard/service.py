"""
Dashboard Service — Consumer Electronics Complaint Resolution System.

Manages processed complaints history: save, list, retrieve by ID,
export CSV, and compute KPI statistics for the dashboard.

Extended KPIs:
  - complaintsByDecision   — breakdown by auto-decision code
  - warrantyStatusCounts   — WITHIN_WARRANTY / OUT_OF_WARRANTY / UNKNOWN
  - complaintsByCategory   — Smartphone, Laptop, Tablet, etc.
  - autoEmailsSent         — how many automated emails were sent
"""

import json
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.common.config import (
    COMPLAINTS_HISTORY_CSV,
    COMPLAINTS_INDEX_FILE,
    PROCESSED_COMPLAINTS_DIR,
    ensure_data_dir,
)


def _get_index() -> List[Dict[str, Any]]:
    ensure_data_dir()
    if not COMPLAINTS_INDEX_FILE.exists():
        return []
    try:
        return json.loads(COMPLAINTS_INDEX_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _save_index(index: List[Dict[str, Any]]) -> None:
    ensure_data_dir()
    COMPLAINTS_INDEX_FILE.write_text(json.dumps(index, indent=2), encoding="utf-8")


def _escape_csv(val: Any) -> str:
    if val is None:
        return ""
    s = str(val)
    if "," in s or '"' in s or "\n" in s:
        return f'"{s.replace(chr(34), chr(34)+chr(34))}"'
    return s


def _append_to_csv(complaint: Dict[str, Any]) -> None:
    ensure_data_dir()
    draft = (complaint.get("decisionPack") or {}).get("complaintDraft") or {}
    # Extended CSV headers including new electronics fields
    headers = [
        "complaintId", "ingestedComplaintId", "customerRef", "customerName",
        "complaintType", "description", "status", "createdAt",
        "warrantyStatus", "productCategory", "autoDecision", "decisionConfidence",
    ]
    row = [
        complaint.get("complaintId", ""),
        complaint.get("ingestedComplaintId", ""),
        draft.get("complaintRef", ""),
        draft.get("customerName", ""),
        draft.get("complaintType", ""),
        draft.get("description", ""),
        complaint.get("status", ""),
        complaint.get("createdAt", ""),
        complaint.get("warrantyStatus", ""),
        complaint.get("productCategory", ""),
        complaint.get("autoDecision", ""),
        str(complaint.get("decisionConfidence", "")),
    ]
    write_header = not COMPLAINTS_HISTORY_CSV.exists()
    line = (",".join(_escape_csv(h) for h in headers) + "\n" if write_header else "")
    line += ",".join(_escape_csv(v) for v in row) + "\n"
    with open(COMPLAINTS_HISTORY_CSV, "a", encoding="utf-8") as f:
        f.write(line)


def save_processed_complaint(complaint: Dict[str, Any]) -> None:
    ensure_data_dir()
    complaint_id = complaint.get("complaintId") or f"CMP-{int(time.time() * 1000)}"
    safe_id      = re.sub(r"[/\\:]", "_", complaint_id)
    file_path    = PROCESSED_COMPLAINTS_DIR / f"{safe_id}.json"
    to_save      = {**complaint, "complaintId": complaint_id}
    file_path.write_text(json.dumps(to_save, indent=2), encoding="utf-8")

    draft = (complaint.get("decisionPack") or {}).get("complaintDraft") or {}
    index = _get_index()
    existing = next((i for i, e in enumerate(index) if e.get("complaintId") == complaint_id), -1)

    if existing < 0:
        _append_to_csv(to_save)

    # Store relative path so the index works across machines and OS moves
    rel_path = file_path.name  # just the filename, e.g. "CMP-ING-xxx.json"

    entry = {
        "complaintId":         complaint_id,
        "ingestedComplaintId": complaint.get("ingestedComplaintId"),
        "customerRef":         draft.get("complaintRef", ""),
        "customerName":        draft.get("customerName", ""),
        "complaintType":       draft.get("complaintType", ""),
        "createdAt":           complaint.get("createdAt", ""),
        "filePath":            rel_path,
        # New index fields for fast dashboard queries
        "warrantyStatus":      complaint.get("warrantyStatus", "UNKNOWN"),
        "productCategory":     complaint.get("productCategory", ""),
        "autoDecision":        complaint.get("autoDecision", ""),
        "decisionConfidence":  complaint.get("decisionConfidence", 0.0),
    }
    if existing >= 0:
        index[existing] = entry
    else:
        index.insert(0, entry)
    _save_index(index)


def get_processed_complaint_summaries() -> List[Dict[str, Any]]:
    return [
        {
            "complaintId":         e.get("complaintId"),
            "ingestedComplaintId": e.get("ingestedComplaintId"),
            "customerRef":         e.get("customerRef", ""),
            "customerName":        e.get("customerName", ""),
            "complaintType":       e.get("complaintType", ""),
            "createdAt":           e.get("createdAt", ""),
            "warrantyStatus":      e.get("warrantyStatus", "UNKNOWN"),
            "productCategory":     e.get("productCategory", ""),
            "autoDecision":        e.get("autoDecision", ""),
            "decisionConfidence":  e.get("decisionConfidence", 0.0),
        }
        for e in _get_index()
    ]


def _resolve_file_path(raw: str) -> Path:
    """Resolve stored filePath (relative or absolute) to an absolute Path."""
    p = Path(raw)
    if p.is_absolute():
        # Legacy absolute path — try as-is, then fall back to just the filename
        if p.exists():
            return p
        return PROCESSED_COMPLAINTS_DIR / p.name
    return PROCESSED_COMPLAINTS_DIR / p


def get_processed_complaint_by_id(complaint_id: str) -> Optional[Dict[str, Any]]:
    entry = next((e for e in _get_index() if e.get("complaintId") == complaint_id), None)
    if not entry:
        return None
    file_path = _resolve_file_path(entry["filePath"])
    if not file_path.exists():
        return None
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def get_csv_content() -> str:
    return COMPLAINTS_HISTORY_CSV.read_text(encoding="utf-8") if COMPLAINTS_HISTORY_CSV.exists() else ""


def get_dashboard_kpis() -> Dict[str, Any]:
    """
    Compute dashboard KPIs.

    Standard KPIs (preserved):
      totalComplaints, complaintsThisWeek, complaintsThisMonth,
      complaintsByType, avgResolutionConfidence, complaintsByDate, recentComplaints

    New electronics-specific KPIs:
      complaintsByDecision   — count per auto-decision code
      warrantyStatusCounts   — WITHIN_WARRANTY / OUT_OF_WARRANTY / UNKNOWN counts
      complaintsByCategory   — count per product category
      autoEmailsSent         — total automated emails successfully sent
      autoEmailsAttempted    — total auto-response attempts
    """
    index = _get_index()
    if not index:
        return {
            "totalComplaints":       0,
            "complaintsThisWeek":    0,
            "complaintsThisMonth":   0,
            "complaintsByType":      {},
            "avgResolutionConfidence": 0,
            "complaintsByDate":      [],
            "recentComplaints":      [],
            # New KPIs
            "complaintsByDecision":  {},
            "warrantyStatusCounts":  {},
            "complaintsByCategory":  {},
            "autoEmailsSent":        0,
            "autoEmailsAttempted":   0,
        }

    now       = datetime.utcnow()
    week_ago  = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    total = week = month = 0
    type_counts:     Dict[str, int] = defaultdict(int)
    decision_counts: Dict[str, int] = defaultdict(int)
    warranty_counts: Dict[str, int] = defaultdict(int)
    category_counts: Dict[str, int] = defaultdict(int)
    conf_sum = conf_count = 0
    date_counts: Dict[str, int] = defaultdict(int)
    recent: List[Dict[str, Any]] = []
    emails_sent = emails_attempted = 0

    for entry in index:
        fp = entry.get("filePath")
        if not fp:
            continue
        file_path = _resolve_file_path(fp)
        if not file_path.exists():
            continue
        try:
            complaint = json.loads(file_path.read_text())
        except Exception:
            continue

        total += 1
        created = complaint.get("createdAt", "")
        if created:
            try:
                dt = datetime.fromisoformat(created.replace("Z", "+00:00")).replace(tzinfo=None)
                dk = dt.strftime("%Y-%m-%d")
                date_counts[dk] += 1
                if dk >= week_ago.strftime("%Y-%m-%d"):  week += 1
                if dk >= month_ago.strftime("%Y-%m-%d"): month += 1
            except Exception:
                pass

        dp    = complaint.get("decisionPack") or {}
        draft = dp.get("complaintDraft") or {}
        ctype = draft.get("complaintType", "Other")
        type_counts[ctype] += 1

        # New electronics fields
        auto_decision  = complaint.get("autoDecision") or dp.get("autoDecision") or "UNKNOWN"
        warranty_status = complaint.get("warrantyStatus") or dp.get("warrantyStatus") or "UNKNOWN"
        product_category = complaint.get("productCategory") or dp.get("productCategory") or "Unknown"

        decision_counts[auto_decision] += 1
        warranty_counts[warranty_status] += 1
        if product_category and product_category != "Unknown":
            category_counts[product_category] += 1

        # Auto email stats
        auto_email = complaint.get("autoEmailResponse") or {}
        if auto_email and not auto_email.get("skipped"):
            emails_attempted += 1
            if auto_email.get("sent"):
                emails_sent += 1

        for e in dp.get("evidence") or []:
            conf = e.get("confidence")
            if conf is not None:
                conf_sum   += float(conf)
                conf_count += 1

        if len(recent) < 5:
            recent.append({
                "complaintId":    complaint.get("complaintId"),
                "customerRef":    draft.get("complaintRef", ""),
                "customerName":   draft.get("customerName", ""),
                "complaintType":  ctype,
                "createdAt":      created,
                "autoDecision":   auto_decision,
                "warrantyStatus": warranty_status,
                "productCategory": product_category,
            })

    sorted_dates = sorted(date_counts.keys())[-14:]
    return {
        # Standard KPIs (backward-compatible)
        "totalComplaints":         total,
        "complaintsThisWeek":      week,
        "complaintsThisMonth":     month,
        "complaintsByType":        dict(type_counts),
        "avgResolutionConfidence": round((conf_sum / conf_count * 100) if conf_count else 0, 1),
        "complaintsByDate":        [{"date": d, "count": date_counts[d]} for d in sorted_dates],
        "recentComplaints":        recent,
        # New electronics-specific KPIs
        "complaintsByDecision":    dict(decision_counts),
        "warrantyStatusCounts":    dict(warranty_counts),
        "complaintsByCategory":    dict(category_counts),
        "autoEmailsSent":          emails_sent,
        "autoEmailsAttempted":     emails_attempted,
    }
