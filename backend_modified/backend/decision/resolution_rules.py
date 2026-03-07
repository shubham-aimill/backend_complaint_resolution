"""
Resolution Rules Module — Consumer Electronics Complaint Resolution System.

Standard resolution guidelines for electronics complaint categories.
Used as a fallback when no matching customer record is found in the database.
"""

import re
from typing import Any, Dict, List

RESOLUTION_RULES: List[Dict[str, Any]] = [
    {
        "ruleId":   "RES-EL-001",
        "title":    "Hardware Defect Resolution",
        "section":  "Hardware & Physical Damage",
        "content":  (
            "Customers reporting hardware defects (cracked screens, physical damage, dead pixels, "
            "speaker or microphone failure) are entitled to a repair or replacement within the warranty "
            "period. Proof of purchase and product serial number are required. If the defect is "
            "manufacturing-related and within 12 months of purchase, a free-of-charge repair or "
            "replacement will be arranged within 5 business days. Physical damage caused by misuse "
            "is not covered under the standard warranty."
        ),
        "complaintTypes": ["hardware", "defect", "broken", "cracked", "screen", "physical", "damage"],
    },
    {
        "ruleId":   "RES-EL-002",
        "title":    "Software / Firmware Issue Resolution",
        "section":  "Software & Firmware",
        "content":  (
            "Software or firmware issues including crashes, freezing, boot loops, failed updates, "
            "and app compatibility problems will be addressed within 3 business days. The customer "
            "will first be guided through standard troubleshooting steps (factory reset, firmware "
            "re-flash). If the issue persists, a free repair or software restoration will be "
            "offered within the warranty period. Critical software defects affecting all users "
            "are addressed via over-the-air (OTA) updates."
        ),
        "complaintTypes": ["software", "firmware", "crash", "freeze", "update", "boot", "app", "bug"],
    },
    {
        "ruleId":   "RES-EL-003",
        "title":    "Battery and Charging Issue Resolution",
        "section":  "Battery & Power",
        "content":  (
            "Battery issues such as rapid discharge, failure to charge, swollen battery, or overheating "
            "are treated as safety-priority defects. Swollen or damaged batteries are eligible for "
            "immediate replacement regardless of warranty period due to safety concerns. Standard "
            "battery degradation (below 80% capacity after 12 months normal use) is covered under "
            "warranty. Customers should stop using a device with a visibly swollen battery immediately."
        ),
        "complaintTypes": ["battery", "charging", "charge", "power", "drain", "swollen", "overheating"],
    },
    {
        "ruleId":   "RES-EL-004",
        "title":    "Connectivity Issue Resolution",
        "section":  "Connectivity",
        "content":  (
            "Complaints regarding Bluetooth, WiFi, NFC, or cellular connectivity failures will be "
            "investigated within 2 business days. Standard troubleshooting (reset network settings, "
            "firmware update) is provided first. If the hardware radio component is confirmed faulty "
            "within the warranty period, a free repair or replacement will be arranged within 5 "
            "business days. Intermittent connectivity issues may require device logs."
        ),
        "complaintTypes": ["bluetooth", "wifi", "connectivity", "network", "connection", "nfc", "cellular"],
    },
    {
        "ruleId":   "RES-EL-005",
        "title":    "Dead on Arrival (DOA) Resolution",
        "section":  "Dead on Arrival",
        "content":  (
            "Products that are non-functional upon first use (Dead on Arrival) qualify for an "
            "immediate replacement or full refund within 30 days of purchase. No troubleshooting "
            "is required for confirmed DOA cases. A replacement unit will be dispatched within "
            "3 business days upon verification. Customers should retain original packaging for "
            "the return of the defective unit."
        ),
        "complaintTypes": ["doa", "dead on arrival", "not working", "never worked", "out of box"],
    },
    {
        "ruleId":   "RES-EL-006",
        "title":    "Delivery and Packaging Damage Resolution",
        "section":  "Delivery & Fulfilment",
        "content":  (
            "Products damaged in transit or delivered with damaged packaging will be replaced within "
            "5 business days. Customers must report delivery damage within 48 hours of receipt and "
            "provide photographic evidence of the damaged packaging and product. A free returns "
            "label will be provided. If the product is out of stock, a full refund will be offered."
        ),
        "complaintTypes": ["delivery", "shipping", "damaged", "transit", "packaging", "missing", "wrong item"],
    },
    {
        "ruleId":   "RES-EL-007",
        "title":    "Billing and Overcharge Resolution",
        "section":  "Billing & Payments",
        "content":  (
            "Billing errors, duplicate charges, and overcharges will be investigated within 3 "
            "business days. If an error is confirmed, a full refund of the overcharged amount "
            "will be processed within 5-10 business days to the original payment method. "
            "Customers should provide their order confirmation and bank statement showing the charge."
        ),
        "complaintTypes": ["billing", "overcharge", "charge", "payment", "invoice", "price", "refund"],
    },
    {
        "ruleId":   "RES-EL-008",
        "title":    "Out-of-Warranty Service",
        "section":  "Out-of-Warranty",
        "content":  (
            "Products outside the manufacturer warranty period are not eligible for free repair or "
            "replacement. However, customers may opt for a paid repair service at our authorised "
            "service centres. A repair quote will be provided within 2 business days. Alternatively, "
            "customers with an active extended warranty or valid consumer statutory rights may still "
            "be eligible for remediation — please provide relevant documentation."
        ),
        "complaintTypes": ["warranty", "expired", "out of warranty", "paid repair"],
    },
    {
        "ruleId":   "RES-EL-009",
        "title":    "General Electronics Complaint Handling",
        "section":  "General Resolution",
        "content":  (
            "All customer complaints are acknowledged within 1 business day. A full investigation "
            "is completed within 10 business days. The customer will receive a written outcome. "
            "If unsatisfied, they may escalate to a senior manager or request an independent review. "
            "For complaints involving safety hazards (fire, explosion, electric shock), emergency "
            "escalation is triggered within 2 hours."
        ),
        "complaintTypes": ["general", "other", "complaint", "dissatisfied", "unhappy", "performance"],
    },
]

CONFIDENCE_HIGH   = 0.8
CONFIDENCE_MEDIUM = 0.6


def _infer_types(complaint_type: str, description: str = "") -> List[str]:
    combined = f"{complaint_type} {description}".lower()
    types: set = set()
    if re.search(r"\b(hardware|defect|broken|crack|screen|physical|damage|faulty)\b", combined):
        types.update(["hardware", "defect", "broken", "cracked"])
    if re.search(r"\b(software|firmware|crash|freeze|update|boot|bug|app)\b", combined):
        types.update(["software", "firmware", "crash", "freeze"])
    if re.search(r"\b(battery|charg|power|drain|swollen|overheat)\b", combined):
        types.update(["battery", "charging", "power"])
    if re.search(r"\b(bluetooth|wifi|wi-fi|network|connect|nfc|cellular)\b", combined):
        types.update(["bluetooth", "wifi", "connectivity"])
    if re.search(r"\b(doa|dead.on.arrival|never.worked|out.of.box|not.turning.on)\b", combined):
        types.update(["doa", "dead on arrival", "not working"])
    if re.search(r"\b(deliver|shipping|transit|packag|missing|wrong.item)\b", combined):
        types.update(["delivery", "shipping", "damaged", "packaging"])
    if re.search(r"\b(billing|charge|payment|invoice|overcharg|refund|price)\b", combined):
        types.update(["billing", "overcharge", "payment"])
    if re.search(r"\b(warranty|expired|out.of.warranty)\b", combined):
        types.update(["warranty", "expired"])
    return list(types) if types else ["general", "other", "complaint"]


def get_resolution_rules(extracted_fields: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Return matching resolution rules for the complaint type.
    Used as a fallback when no customer record is found in the database.
    """
    complaint_type = str(extracted_fields.get("complaintType", "Other"))
    description    = str(extracted_fields.get("description", ""))
    inferred_types = _infer_types(complaint_type, description)

    results = []
    for rule in RESOLUTION_RULES:
        rule_types = [t.lower() for t in rule.get("complaintTypes", [])]
        score = 0.9 if any(any(rt in it or it in rt for rt in rule_types) for it in inferred_types) else 0.5
        if score >= CONFIDENCE_MEDIUM:
            content = rule.get("content", "")
            results.append({
                "recordId":        rule["ruleId"],
                "title":           rule["title"],
                "snippet":         content[:140] + ("..." if len(content) > 140 else ""),
                "content":         content,
                "section":         rule.get("section"),
                "score":           score,
                "confidence_score": score,
                "recommendation":  "INVESTIGATE",
                "action":          "Apply resolution rule and route to appropriate team.",
                "sourceDocument":  "Resolution Rules — Consumer Electronics",
            })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:3]
