"""
Shared configuration for Complaint Management backend services.

Resolves project root and data paths. Used by all microservices.
Supports environment variables for deployment-ready configuration.
"""

import os
from pathlib import Path
from typing import Dict


def _env_path(env_var: str, fallback: Path) -> Path:
    v = os.getenv(env_var)
    return Path(v) if v else fallback


def _get_project_root() -> Path:
    env_root = os.getenv("PROJECT_ROOT")
    if env_root:
        return Path(env_root)
    return Path(__file__).resolve().parent.parent.parent


# ── Core paths ────────────────────────────────────────────────────────────

PROJECT_ROOT: Path = _get_project_root()
DATA_DIR: Path     = _env_path("DATA_DIR", PROJECT_ROOT / "data")
ENV_FILE: Path     = _env_path("ENV_FILE", PROJECT_ROOT / ".env")

# Attachment storage for ingested complaint emails
INGESTED_DIR: Path = _env_path("INGESTED_DIR", DATA_DIR / "ingested-attachments")

# Processed complaint records (JSON + CSV)
PROCESSED_COMPLAINTS_DIR: Path = _env_path(
    "PROCESSED_COMPLAINTS_DIR", DATA_DIR / "processed-complaints"
)

# ── Master dataset files (your 4 core JSON files) ─────────────────────────

CUSTOMERS_FILE:        Path = DATA_DIR / "customers.json"
COMPLAINTS_FILE:       Path = DATA_DIR / "complaints.json"
COMPLAINT_ACTIONS_FILE: Path = DATA_DIR / "complaint_action.json"
PRODUCTS_FILE:         Path = DATA_DIR / "product_service.json"

# ── Ingestion / processing files ──────────────────────────────────────────

# Raw complaints ingested from email (before AI processing)
INGESTED_COMPLAINTS_FILE: Path = DATA_DIR / "ingested-complaints.json"

# Processed complaint index + history CSV
COMPLAINTS_INDEX_FILE:  Path = PROCESSED_COMPLAINTS_DIR / "complaints-index.json"
COMPLAINTS_HISTORY_CSV: Path = PROCESSED_COMPLAINTS_DIR / "complaints-history.csv"

# ── Utility ───────────────────────────────────────────────────────────────

def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    INGESTED_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_COMPLAINTS_DIR.mkdir(parents=True, exist_ok=True)


def get_config_summary() -> Dict[str, str]:
    return {
        "PROJECT_ROOT":             str(PROJECT_ROOT),
        "DATA_DIR":                 str(DATA_DIR),
        "INGESTED_DIR":             str(INGESTED_DIR),
        "PROCESSED_COMPLAINTS_DIR": str(PROCESSED_COMPLAINTS_DIR),
        "ENV_FILE":                 str(ENV_FILE),
        "CUSTOMERS_FILE":           str(CUSTOMERS_FILE),
        "COMPLAINTS_FILE":          str(COMPLAINTS_FILE),
        "COMPLAINT_ACTIONS_FILE":   str(COMPLAINT_ACTIONS_FILE),
        "PRODUCTS_FILE":            str(PRODUCTS_FILE),
        "INGESTED_COMPLAINTS_FILE": str(INGESTED_COMPLAINTS_FILE),
        "COMPLAINTS_INDEX_FILE":    str(COMPLAINTS_INDEX_FILE),
        "COMPLAINTS_HISTORY_CSV":   str(COMPLAINTS_HISTORY_CSV),
    }
