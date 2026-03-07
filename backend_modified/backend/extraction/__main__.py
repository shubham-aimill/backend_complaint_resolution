"""CLI entry for extraction microservice."""
import sys
from backend.extraction.service import main

if __name__ == "__main__":
    sys.exit(main())
