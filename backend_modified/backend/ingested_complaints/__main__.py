"""CLI entry for ingested complaints service."""
import base64
import json
import sys

from backend.ingested_complaints.service import (
    clear_all_ingested_complaints,
    get_all_ingested_complaints,
    get_complaint_references,
    get_ingested_complaint_by_id,
    save_ingested_complaint,
)

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(json.dumps({"error": "Usage: list | list-full | get <id> | clear | save-webhook"}), file=sys.stderr)
        sys.exit(1)

    cmd = args[0].lower()

    if cmd == "save-webhook":
        try:
            payload = json.load(sys.stdin)
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"Invalid JSON: {e}"}), file=sys.stderr)
            sys.exit(1)
        attachment_files = []
        for a in payload.get("attachmentFiles", []):
            name    = a.get("name", "attachment")
            content = a.get("buffer")
            if isinstance(content, str):  content = base64.b64decode(content)
            elif content is None:         content = b""
            attachment_files.append((name, content, a.get("mimeType", "application/octet-stream")))
        result = save_ingested_complaint(
            payload.get("from", ""), payload.get("to", ""),
            payload.get("subject", ""), payload.get("emailBody", ""),
            attachment_files, "sendgrid",
        )
        print(json.dumps({"success": True, "complaintId": result["id"], "complaintRef": result["complaintRef"]}))
        sys.exit(0)

    if cmd == "list":
        print(json.dumps(get_complaint_references())); sys.exit(0)

    if cmd == "list-full":
        print(json.dumps(get_all_ingested_complaints())); sys.exit(0)

    if cmd == "get":
        if len(args) < 2:
            print(json.dumps({"error": "complaint id required"}), file=sys.stderr); sys.exit(1)
        c = get_ingested_complaint_by_id(args[1])
        print(json.dumps(c) if c else "null"); sys.exit(0)

    if cmd == "clear":
        clear_all_ingested_complaints()
        print(json.dumps({"success": True})); sys.exit(0)

    print(json.dumps({"error": f"Unknown command: {cmd}"}), file=sys.stderr)
    sys.exit(1)
