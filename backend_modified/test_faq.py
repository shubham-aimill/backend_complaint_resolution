"""
Test script to populate FAQ emails for testing.
Run: python test_faq.py
"""
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from backend.faq_resolution.service import save_faq_email, get_all_faqs

# Get a sample FAQ to match
faqs = get_all_faqs()
if not faqs:
    print("No FAQs found in FAQ.csv")
    sys.exit(1)

# Create test FAQ emails
test_emails = [
    {
        "from": "customer1@example.com",
        "to": "support@electronics.com",
        "subject": "How do I reset my Samsung Galaxy S26 Ultra?",
        "body": "Hi, I need help resetting my phone to factory settings. Can you guide me?",
        "matched_faq": faqs[0] if len(faqs) > 0 else None,
    },
    {
        "from": "customer2@example.com",
        "to": "support@electronics.com",
        "subject": "WiFi keeps disconnecting on my Galaxy A15",
        "body": "My WiFi connection drops every few minutes. How can I fix this?",
        "matched_faq": faqs[1] if len(faqs) > 1 else None,
    },
    {
        "from": "customer3@example.com",
        "to": "support@electronics.com",
        "subject": "TV has no picture but sound works",
        "body": "My Neo QLED TV screen is black but I can hear the audio. What should I do?",
        "matched_faq": faqs[2] if len(faqs) > 2 else None,
    },
    {
        "from": "customer4@example.com",
        "to": "support@electronics.com",
        "subject": "What is your warranty policy?",
        "body": "I want to know about the warranty coverage for home appliances.",
        "matched_faq": faqs[8] if len(faqs) > 8 else None,
    },
    {
        "from": "customer5@example.com",
        "to": "support@electronics.com",
        "subject": "How to register my product for warranty?",
        "body": "I just bought a Samsung refrigerator. How do I register it?",
        "matched_faq": faqs[9] if len(faqs) > 9 else None,
    },
]

print("Creating test FAQ emails...")
for email in test_emails:
    result = save_faq_email(
        from_addr=email["from"],
        to_addr=email["to"],
        subject=email["subject"],
        email_body=email["body"],
        matched_faq=email["matched_faq"],
    )
    print(f"✓ Created: {result['id']} - {email['subject']}")

print(f"\n✓ Successfully created {len(test_emails)} test FAQ emails")
print("Now open the FAQ page in the frontend to view them!")
