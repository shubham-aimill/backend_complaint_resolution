"""CLI entry for dashboard service."""
import json
import sys

from backend.dashboard.service import (
    get_csv_content,
    get_dashboard_kpis,
    get_processed_complaint_by_id,
    get_processed_complaint_summaries,
    save_processed_complaint,
)

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(json.dumps({"error": "Usage: list | get <id> | save | csv | stats"}), file=sys.stderr)
        sys.exit(1)

    cmd = args[0].lower()

    if cmd == "list":
        print(json.dumps(get_processed_complaint_summaries())); sys.exit(0)

    if cmd == "get":
        if len(args) < 2:
            print(json.dumps({"error": "complaintId required"}), file=sys.stderr); sys.exit(1)
        c = get_processed_complaint_by_id(args[1])
        print(json.dumps(c) if c else "null"); sys.exit(0)

    if cmd == "save":
        try:
            payload = json.load(sys.stdin)
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"Invalid JSON: {e}"}), file=sys.stderr); sys.exit(1)
        if not payload.get("decisionPack"):
            print(json.dumps({"error": "Invalid complaint data"}), file=sys.stderr); sys.exit(1)
        save_processed_complaint(payload)
        print(json.dumps({"success": True, "complaintId": payload.get("complaintId")})); sys.exit(0)

    if cmd == "csv":
        print(get_csv_content(), end=""); sys.exit(0)

    if cmd == "stats":
        print(json.dumps(get_dashboard_kpis())); sys.exit(0)

    print(json.dumps({"error": f"Unknown command: {cmd}"}), file=sys.stderr)
    sys.exit(1)
