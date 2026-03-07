"""CLI entry for complaint processing orchestrator."""
import sys
from backend.process_complaint.orchestrator import main

if __name__ == "__main__":
    sys.exit(main())
