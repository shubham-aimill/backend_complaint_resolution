"""CLI entry for email_ingestion microservice."""
import json
import sys
from backend.email_ingestion.service import sync_inbox

if __name__ == "__main__":
    r = sync_inbox()
    print(json.dumps(r, indent=2))
    sys.exit(0 if r.get("success") else 1)
