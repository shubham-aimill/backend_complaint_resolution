"""CLI entry for FAQ resolution service."""
import json
import sys
from backend.faq_resolution.service import process_faq_email

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] != "process":
        print(json.dumps({"error": "Usage: process"}), file=sys.stderr)
        sys.exit(1)
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}), file=sys.stderr)
        sys.exit(1)
    result = process_faq_email(
        payload.get("from", ""), payload.get("to", ""),
        payload.get("subject", ""), payload.get("emailBody", ""),
    )
    print(json.dumps(result))
    sys.exit(0 if result.get("answered") or not result.get("is_faq") else 1)
