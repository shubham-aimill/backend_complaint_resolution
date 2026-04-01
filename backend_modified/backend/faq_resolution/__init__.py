"""
FAQ Resolution package.

Detects FAQ queries in customer emails and sends automated answers,
keeping the complaint queue focused on genuine issues.
"""

from backend.faq_resolution.service import (
    process_faq_email,
    get_all_faqs,
    get_all_faq_emails,
    save_faq_email,
    clear_faq_emails,
)

__all__ = [
    "process_faq_email",
    "get_all_faqs",
    "get_all_faq_emails",
    "save_faq_email",
    "clear_faq_emails",
]
