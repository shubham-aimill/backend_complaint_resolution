"""
Extraction package.

Extracts structured complaint fields from email text and attachments.
"""
from backend.extraction.service import extract_claim_information

__all__ = ["extract_claim_information"]
