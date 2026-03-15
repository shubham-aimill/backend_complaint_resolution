"""
BaseJsonService — reusable JSON file-backed CRUD service.

To reuse in another project:
    from backend.common.base_service import BaseJsonService

    class MyService(BaseJsonService):
        def __init__(self):
            super().__init__(DATA_DIR / "my_records.json")

Provides: load, save, get_by_id, get_all, insert, update, delete.
"""

import json
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


class BaseJsonService:
    """
    Generic JSON-file-backed service.

    Subclass and pass a file path to get full CRUD for free.
    All records are expected to have an 'id' field.
    """

    def __init__(self, file_path: Path, id_prefix: str = "REC") -> None:
        self._file = file_path
        self._prefix = id_prefix

    # ── Internal I/O ──────────────────────────────────────────────────────

    def _load(self) -> List[Dict[str, Any]]:
        self._file.parent.mkdir(parents=True, exist_ok=True)
        if not self._file.exists():
            return []
        try:
            return json.loads(self._file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []

    def _save(self, records: List[Dict[str, Any]]) -> None:
        self._file.parent.mkdir(parents=True, exist_ok=True)
        self._file.write_text(json.dumps(records, indent=2), encoding="utf-8")

    # ── ID generation ─────────────────────────────────────────────────────

    def generate_id(self) -> str:
        return f"{self._prefix}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:7]}"

    # ── Public CRUD ───────────────────────────────────────────────────────

    def get_all(
        self,
        filter_fn: Optional[Callable[[Dict[str, Any]], bool]] = None,
    ) -> List[Dict[str, Any]]:
        records = self._load()
        if filter_fn:
            return [r for r in records if filter_fn(r)]
        return records

    def get_by_id(self, record_id: str) -> Optional[Dict[str, Any]]:
        return next((r for r in self._load() if r.get("id") == record_id), None)

    def insert(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a record at the front of the list (newest first)."""
        if "id" not in record:
            record["id"] = self.generate_id()
        records = self._load()
        records.insert(0, record)
        self._save(records)
        return record

    def update(self, record_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Merge updates into an existing record. Returns updated record or None."""
        records = self._load()
        for i, r in enumerate(records):
            if r.get("id") == record_id:
                records[i] = {**r, **updates}
                self._save(records)
                return records[i]
        return None

    def delete(self, record_id: str) -> bool:
        records = self._load()
        new_records = [r for r in records if r.get("id") != record_id]
        if len(new_records) == len(records):
            return False
        self._save(new_records)
        return True

    def clear(self) -> None:
        self._save([])

    def count(self) -> int:
        return len(self._load())
