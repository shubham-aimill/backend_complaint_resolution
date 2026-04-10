"""
RAG Service — Samsung Complaint Resolution System
==================================================
Semantic search over Samsung product manual knowledge base.

ARCHITECTURE:
  • Ingestion (ONE-TIME): run ingest_pdfs.py
      PDF → text extraction + GPT-4o Vision for image pages
      → chunked + embedded with text-embedding-3-small
      → stored in ChromaDB with product_id metadata

  • Runtime (every FAQ query):
      Customer query → embed with text-embedding-3-small
      → ChromaDB query WITH hard product_id filter (no cross-product bleed)
      → top-K chunks → GPT-4o generates grounded, product-specific answer
"""

import csv
import json
import math
import os
import re
import smtplib
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.common.config import DATA_DIR, ENV_FILE

# ── Paths ──────────────────────────────────────────────────────────────────
KNOWLEDGE_DIR = DATA_DIR / "rag_knowledge"
CHROMA_DIR = DATA_DIR / "chroma_db"
FAQ_CSV_FILE = DATA_DIR / "FAQ.csv"

# ── Config ─────────────────────────────────────────────────────────────────
TOP_K = 5
EMBED_MODEL = "text-embedding-3-small"
ANSWER_MODEL = "gpt-4o"
COLLECTION = "samsung_manuals"

# ── Product ID → display name mapping ──────────────────────────────────────
PRODUCT_ID_TO_NAME: Dict[str, str] = {
    "PROD-SM-S938": "Samsung Galaxy S26 Ultra",
    "PROD-SM-A155": "Samsung Galaxy A15",
    "PROD-QN90D-65": "Samsung Neo QLED 4K QN90D",
    "PROD-S85D-55": "Samsung OLED S85D",
    "PROD-RF350-BD": "Samsung Bespoke AI Double Door 350L",
    "PROD-RF653-SBS": "Samsung Bespoke Convertible 5in1 653L Side-by-Side",
    "PROD-AC-WFAI": "Samsung Bespoke AI WindFree AC",
    "PROD-AC-WF15": "Samsung WindFree 1.5 Ton Inverter AC",
}

# ── Keyword map for product detection from email text ──────────────────────
PRODUCT_KEYWORDS: Dict[str, List[str]] = {
    "PROD-SM-S938": [
        "samsung galaxy s26 ultra", "galaxy s26 ultra", "s26 ultra",
        "galaxy s26", "sm-s938", "s26ultra"
    ],
    "PROD-SM-A155": [
        "samsung galaxy a15", "galaxy a15", "a15",
        "sm-a155", "galaxya15"
    ],
    "PROD-QN90D-65": [
        "samsung neo qled 4k qn90d", "neo qled 4k qn90d", "qn90d",
        "neo qled", "qn90", "neo-qled"
    ],
    "PROD-S85D-55": [
        "samsung oled s85d", "oled s85d", "s85d",
        "oled s85", "samsung oled", "s85"
    ],
    "PROD-RF350-BD": [
        "samsung bespoke ai double door 350l", "double door 350l", "350l",
        "double door", "bespoke 350", "rt39", "rf350"
    ],
    "PROD-RF653-SBS": [
        "samsung bespoke convertible 5in1 653l side-by-side",
        "653l side-by-side", "653l", "side by side", "side-by-side",
        "rs76", "bespoke 653", "rf653", "5in1"
    ],
    "PROD-AC-WFAI": [
        "samsung bespoke ai windfree ac", "bespoke ai windfree ac",
        "windfree bespoke", "bespoke ai", "bespoke windfree",
        "ar18cx", "windfree ai"
    ],
    "PROD-AC-WF15": [
        "samsung windfree 1.5 ton inverter ac", "windfree 1.5 ton inverter ac",
        "windfree 1.5", "windfree ac", "ar18by",
        "wind free", "wf15", "inverter ac"
    ],
}


# ══════════════════════════════════════════════════════════════════════════
# Env / OpenAI
# ══════════════════════════════════════════════════════════════════════════

def _load_env() -> None:
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def _get_openai():
    _load_env()
    from openai import OpenAI
    return OpenAI(api_key=os.environ["OPENAI_API_KEY"])


# ══════════════════════════════════════════════════════════════════════════
# ChromaDB
# ══════════════════════════════════════════════════════════════════════════

def _get_collection():
    try:
        import chromadb
    except ImportError:
        return None
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return client.get_or_create_collection(
        name=COLLECTION,
        metadata={"hnsw:space": "cosine"}
    )


# ══════════════════════════════════════════════════════════════════════════
# Knowledge Base (JSON fallback loader)
# ══════════════════════════════════════════════════════════════════════════

def _load_knowledge_chunks(product_id: Optional[str] = None) -> List[Dict]:
    """Load pre-extracted manual chunks. Optionally filter by product_id."""
    if not KNOWLEDGE_DIR.exists():
        return []

    all_chunks = []
    for f in sorted(KNOWLEDGE_DIR.glob("*.json")):
        if f.name.startswith("_"):
            continue
        try:
            chunks = json.loads(f.read_text(encoding="utf-8"))
            if product_id:
                chunks = [c for c in chunks if c.get("product_id") == product_id]
            all_chunks.extend(chunks)
        except Exception as e:
            print(f"Warning: could not load {f.name}: {e}", file=sys.stderr)
    return all_chunks


# ══════════════════════════════════════════════════════════════════════════
# Product identification from email text
# ══════════════════════════════════════════════════════════════════════════

def _normalize_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s\-]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def match_product_from_text(subject: str, body: str) -> Dict[str, Any]:
    """
    Detect product from subject/body using:
    1. exact product name match
    2. keyword/alias match

    Returns:
    {
        "product_id": ... or None,
        "product_name": ... or None,
        "matched_cue": ... or None,
        "confidence": "high|medium|low",
        "match_type": "exact_name|keyword|none"
    }
    """
    raw_text = f"{subject} {body}"
    text = _normalize_text(raw_text)

    # 1. Exact product name match gets highest priority
    exact_name_candidates = []
    for product_id, product_name in PRODUCT_ID_TO_NAME.items():
        normalized_name = _normalize_text(product_name)
        if normalized_name and normalized_name in text:
            exact_name_candidates.append({
                "product_id": product_id,
                "product_name": product_name,
                "matched_cue": product_name,
                "confidence": "high",
                "match_type": "exact_name",
                "score": len(normalized_name),
            })

    if exact_name_candidates:
        exact_name_candidates.sort(key=lambda x: x["score"], reverse=True)
        best = exact_name_candidates[0].copy()
        best.pop("score", None)
        return best

    # 2. Keyword/alias match
    keyword_candidates = []
    for product_id, keywords in PRODUCT_KEYWORDS.items():
        for kw in keywords:
            normalized_kw = _normalize_text(kw)
            if normalized_kw and normalized_kw in text:
                score = len(normalized_kw)

                # Slightly penalize very short weak cues
                if normalized_kw in {"a15", "s85", "350l", "653l"}:
                    score -= 2

                keyword_candidates.append({
                    "product_id": product_id,
                    "product_name": PRODUCT_ID_TO_NAME.get(product_id, product_id),
                    "matched_cue": kw,
                    "confidence": "medium",
                    "match_type": "keyword",
                    "score": score,
                })

    if keyword_candidates:
        keyword_candidates.sort(key=lambda x: x["score"], reverse=True)
        best = keyword_candidates[0].copy()
        best.pop("score", None)
        return best

    return {
        "product_id": None,
        "product_name": None,
        "matched_cue": None,
        "confidence": "low",
        "match_type": "none",
    }


def match_product_id_from_text(subject: str, body: str) -> Optional[str]:
    """
    Backward-compatible wrapper.
    Returns product_id string or None.
    """
    result = match_product_from_text(subject, body)
    return result.get("product_id")


def get_product_name(product_id: str) -> str:
    """Return human-readable product name for a product_id."""
    return PRODUCT_ID_TO_NAME.get(product_id, product_id)


# ══════════════════════════════════════════════════════════════════════════
# Semantic Search — with hard product_id filter
# ══════════════════════════════════════════════════════════════════════════

def _cosine(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


def semantic_search(
    query: str,
    top_k: int = TOP_K,
    product_id: Optional[str] = None,
) -> List[Dict]:
    """
    Search the manual knowledge base.
    """
    _load_env()
    client = _get_openai()

    q_emb = client.embeddings.create(model=EMBED_MODEL, input=[query]).data[0].embedding

    collection = _get_collection()
    if collection and collection.count() > 0:
        where_filter = None
        if product_id:
            where_filter = {"product_id": {"$eq": product_id}}

        try:
            query_kwargs: Dict[str, Any] = {
                "query_embeddings": [q_emb],
                "n_results": min(top_k, collection.count()),
                "include": ["documents", "metadatas", "distances"],
            }
            if where_filter:
                query_kwargs["where"] = where_filter

            results = collection.query(**query_kwargs)

            chunks = []
            if results and results["ids"] and results["ids"][0]:
                for i in range(len(results["ids"][0])):
                    meta = results["metadatas"][0][i]
                    chunks.append({
                        "text": results["documents"][0][i],
                        "product_id": meta.get("product_id", ""),
                        # FIX: Handle both possible metadata keys to prevent 'undefined'
                        "product_name": meta.get("product_name") or meta.get("product") or "Samsung Product",
                        "category": meta.get("category", ""),
                        "page_num": meta.get("page_num", 0),
                        "page_range": meta.get("page_range", ""),
                        "distance": results["distances"][0][i],
                    })
            return chunks
        except Exception as e:
            print(f"ChromaDB query error: {e}", file=sys.stderr)

    all_chunks = _load_knowledge_chunks(product_id=product_id)
    if not all_chunks:
        return []

    texts = [c["text"] for c in all_chunks]
    texts = texts[:500]
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    chunk_embs = [r.embedding for r in resp.data]

    scored = sorted(
        [(1 - _cosine(q_emb, emb), i) for i, emb in enumerate(chunk_embs)]
    )[:top_k]

    return [{
        "text": all_chunks[i]["text"],
        "product_id": all_chunks[i].get("product_id", ""),
        "product_name": all_chunks[i].get("product_name") or all_chunks[i].get("product") or "Samsung Product",
        "category": all_chunks[i].get("category", ""),
        "page_num": all_chunks[i].get("page_num", 0),
        "page_range": all_chunks[i].get("page_range", ""),
        "distance": dist,
    } for dist, i in scored]


# ══════════════════════════════════════════════════════════════════════════
# Answer Generation — product-scoped system prompt
# ══════════════════════════════════════════════════════════════════════════

def generate_answer(
    question: str,
    chunks: List[Dict],
    product_id: Optional[str] = None,
    product_name: Optional[str] = None,
    category: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generate a grounded answer from manual chunks.
    """
    if not chunks:
        return {"answer": None, "sources": [], "confidence": 0.0}

    _load_env()
    client = _get_openai()

    context_parts = []
    for c in chunks:
        # FIX: Check both product_name and product keys
        pname = c.get("product_name") or c.get("product") or product_name or "Samsung product"
        page_ref = c.get("page_range") or f"{c.get('page_num', '?')}"
        context_parts.append(
            f"[SOURCE: {pname} Manual — Pages {page_ref}]\n{c['text']}"
        )
    context = "\n\n---\n\n".join(context_parts)

    sources = [{
        "product_id": c.get("product_id", ""),
        # FIX: Ensure product_name is correctly set for footer
        "product_name": c.get("product_name") or c.get("product") or product_name or "Samsung Product",
        "page_num": c.get("page_num", 0),
        "page_range": c.get("page_range", ""),
        "category": c.get("category", ""),
        "relevance": round(1 - c.get("distance", 1), 3),
    } for c in chunks]

    pname_str = product_name or PRODUCT_ID_TO_NAME.get(product_id or "", "Samsung product")
    category_str = category or (chunks[0].get("category") if chunks else "product")
    pid_str = product_id or ""

    system_prompt = (
        f"You are a Samsung Senior Technical Support Specialist for the {pname_str}.\n\n"
        f"STRICT RULES:\n"
        f"1. Use ONLY the provided manual excerpts to solve the issue.\n"
        f"2. Provide clear, step-by-step instructions.\n"
        f"3. DO NOT mention page numbers, manual names, or citations (e.g., avoid 'As per page 99').\n"
        f"4. DO NOT say 'based on the manual' or 'according to the context'.\n"
        f"5. Speak directly to the customer as an expert who knows the product by heart.\n"
        f"6. If the manual doesn't have an exact fix for a 'glitch', provide the standard pairing/reset steps found in the text.\n"
        f"7. Be professional, concise, and helpful."
    )

    user_prompt = (
        f"Customer question about their {pname_str}:\n{question}\n\n"
        f"{pname_str} Manual Excerpts:\n\n{context}\n\n"
        f"Provide a clear, step-by-step answer referencing the manual:"
    )

    resp = client.chat.completions.create(
        model=ANSWER_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=1000,
        temperature=0.1,
    )

    return {
        "answer": resp.choices[0].message.content or "",
        "sources": sources,
        "confidence": round(1 - min(c.get("distance", 1) for c in chunks), 3),
        "method": "rag_manual",
        "product_id": product_id,
        "product_name": pname_str,
    }


# ══════════════════════════════════════════════════════════════════════════
# FAQ CSV Fallback
# ══════════════════════════════════════════════════════════════════════════

def _faq_csv_fallback(question: str, product_id: Optional[str] = None) -> Optional[str]:
    if not FAQ_CSV_FILE.exists():
        return None

    _load_env()
    faqs = []
    try:
        with open(FAQ_CSV_FILE, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                q = row.get("Question", "").strip()
                a = row.get("Answer", "").strip()
                if q and a:
                    faqs.append({"question": q, "answer": a})
    except Exception:
        return None

    if not faqs:
        return None

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return faqs[0]["answer"]

    client = _get_openai()
    context = "\n\n".join(
        f"Q{i+1}: {f['question']}\nA{i+1}: {f['answer']}"
        for i, f in enumerate(faqs)
    )
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Samsung FAQ matcher. Reply ONLY with number (A1,A2...) or NONE."},
            {"role": "user", "content": f"Question: {question}\n\nFAQ:\n{context}"},
        ],
        max_tokens=10,
        temperature=0,
    )
    m = re.search(r"A(\d+)", resp.choices[0].message.content or "")
    if m:
        idx = int(m.group(1)) - 1
        if 0 <= idx < len(faqs):
            return faqs[idx]["answer"]
    return None


# ══════════════════════════════════════════════════════════════════════════
# FAQ Detector
# ══════════════════════════════════════════════════════════════════════════

def _is_faq_query(subject: str, body: str) -> bool:
    text = f"{subject} {body}".lower()

    complaint_kw = [
        r"\bformal complaint\b", r"\bescalate\b", r"\brefund\b",
        r"\bnot working\b", r"\bdefective\b", r"\bbroken\b",
        r"\bnot cooling\b", r"\bno picture\b", r"\bno sound\b",
        r"\bwater leak\b", r"\bbilling error\b", r"\bdead\b",
        r"\bunder warranty\b", r"\bwarranty claim\b",
        r"\bdissatisfied\b", r"\bunhappy\b", r"\battached.*invoice\b",
    ]
    for p in complaint_kw:
        if re.search(p, text, re.IGNORECASE):
            return False

    faq_kw = [
        r"\bhow\s+(do|can|should|to|does)\b", r"\bwhat\s+(is|are|does|do)\b",
        r"\bcan\s+I\b", r"\bhow\s+to\b", r"\bsteps\s+to\b",
        r"\bquestion\b", r"\binquiry\b", r"\bwant\s+to\s+know\b",
    ]
    if not any(re.search(p, text, re.IGNORECASE) for p in faq_kw):
        return False

    _load_env()
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return True

    try:
        client = _get_openai()
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Samsung email classifier. Reply ONLY 'FAQ' or 'COMPLAINT'."},
                {"role": "user", "content": f"Subject: {subject}\n\n{body[:1500]}"},
            ],
            max_tokens=5,
            temperature=0,
        )
        return (resp.choices[0].message.content or "").strip().upper().startswith("FAQ")
    except Exception:
        return True


# ══════════════════════════════════════════════════════════════════════════
# Email sender
# ══════════════════════════════════════════════════════════════════════════
def _send_faq_email(
    to_addr: str, subject: str, answer: str, sources: List[Dict]
) -> None:
    _load_env()
    sender = os.environ.get("SENDER_EMAIL", "")
    password = os.environ.get("EMAIL_PASSWORD", "").replace(" ", "")
    
    if not sender or not password:
        raise ValueError("SENDER_EMAIL and EMAIL_PASSWORD missing in .env")

    # CLEAN VERSION: src_text is deleted. Citations are gone.
    body = (
        f"Thank you for contacting Samsung Customer Support.\n\n"
        f"{answer}\n\n"
        f"---\n"
        f"This response was generated from official Samsung product documentation.\n"
        f"If this does not resolve your issue, please reply to this email or call 1-800-SAMSUNG.\n\n"
        f"Samsung Customer Support | samsung.com/in/support"
    )

    msg = MIMEMultipart("alternative")
    msg["From"] = f"Samsung Support <{sender}>"
    msg["To"] = to_addr
    msg["Subject"] = f"Re: {subject}"
    
    msg.attach(MIMEText(body, "plain"))
    msg.attach(MIMEText(body.replace("\n", "<br>"), "html"))

    try:
        server = smtplib.SMTP(
            os.environ.get("SMTP_HOST", "smtp.gmail.com"),
            int(os.environ.get("SMTP_PORT", "587")),
        )
        server.starttls()
        server.login(sender, password)
        server.send_message(msg)
        server.quit()
    except Exception as e:
        print(f"SMTP Error: {e}")

def _verify_customer_product(
    customer_id: Optional[str], product_id: Optional[str]
) -> Dict[str, Any]:
    """
    Verify: customer exists, product registered to customer, within warranty.
    Returns dict with: verified, customer, product, warranty_status, message
    """
    _load_env()
    result: Dict[str, Any] = {
        "verified": False,
        "customer": None,
        "product": None,
        "warranty_status": None,
        "message": None,
    }

    customers_file = DATA_DIR / "customers.json"
    products_file = DATA_DIR / "product_service.json"
    if not customers_file.exists() or not products_file.exists():
        result["message"] = "Could not load customer data"
        return result

    customers = json.loads(customers_file.read_text(encoding="utf-8"))
    products = json.loads(products_file.read_text(encoding="utf-8"))

    if not customer_id:
        result["message"] = "no_customer_id"
        return result

    customer = next(
        (c for c in customers if c["customer_id"].upper() == customer_id.upper()), None
    )
    if not customer:
        result["message"] = "customer_not_found"
        return result
    result["customer"] = customer

    if not product_id:
        result["message"] = "no_product_mentioned"
        result["verified"] = True
        return result

    registered = customer.get("registered_products", [])
    if product_id not in registered:
        result["message"] = "product_not_registered"
        result["verified"] = False
        return result

    product = next((p for p in products if p["product_id"] == product_id), None)
    if not product:
        result["message"] = "product_not_in_catalogue"
        return result
    result["product"] = product

    from datetime import datetime, timedelta
    warranty_months = product.get("warranty_period_months", 12)
    purchase_dates_map = customer.get("product_purchase_dates", {})
    purchase_date_str = purchase_dates_map.get(product_id) or customer.get("customer_since", "")
    try:
        purchase_dt = datetime.strptime(purchase_date_str[:10], "%Y-%m-%d")
        expiry_dt = purchase_dt + timedelta(days=warranty_months * 30.44)
        within = datetime.now() <= expiry_dt
        result["warranty_status"] = "WITHIN_WARRANTY" if within else "OUT_OF_WARRANTY"
        result["warranty_expiry"] = expiry_dt.strftime("%Y-%m-%d")
        result["purchase_date"] = purchase_date_str[:10]
    except Exception:
        result["warranty_status"] = "UNKNOWN"

    result["verified"] = True
    result["message"] = "verified"
    return result


def _send_verification_failed_email(
    to_addr: str, subject: str, reason: str, customer_name: str = ""
) -> None:
    name = customer_name or "Valued Customer"
    messages = {
        "no_customer_id": (
            f"Dear {name},\n\n"
            "Thank you for contacting Samsung Customer Support.\n\n"
            "We were unable to locate your customer account. "
            "Please include your Customer ID (format: CUST10001) in your email "
            "so we can assist you better.\n\n"
            "You can find your Customer ID on your Samsung purchase invoice or "
            "by logging into your Samsung account at account.samsung.com.\n\n"
            "Samsung Customer Support | 1-800-SAMSUNG"
        ),
        "customer_not_found": (
            f"Dear {name},\n\n"
            "Thank you for contacting Samsung Customer Support.\n\n"
            "We could not find your Customer ID in our records. "
            "Please verify your Customer ID and try again, or register at "
            "account.samsung.com.\n\n"
            "Samsung Customer Support | 1-800-SAMSUNG"
        ),
        "product_not_registered": (
            f"Dear {name},\n\n"
            "Thank you for contacting Samsung Customer Support.\n\n"
            "The product mentioned in your email does not appear to be registered "
            "under your account. Please register your product at:\n"
            "samsung.com/in/support → Register Product\n\n"
            "Samsung Customer Support | 1-800-SAMSUNG"
        ),
        "out_of_warranty": (
            f"Dear {name},\n\n"
            "Thank you for contacting Samsung Customer Support.\n\n"
            "Your product's warranty period has expired. We can still help you "
            "with general usage questions, however for repairs or replacements "
            "please visit your nearest Samsung Service Centre.\n\n"
            "Find a service centre: samsung.com/in/support/service-centre\n\n"
            "Samsung Customer Support | 1-800-SAMSUNG"
        ),
    }
    body = messages.get(reason, (
        f"Dear {name},\n\nThank you for contacting Samsung Support. "
        "Please call 1-800-SAMSUNG for further assistance."
    ))
    _send_faq_email(to_addr, subject, body, [])


# ══════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ══════════════════════════════════════════════════════════════════════════

def process_faq_email(
    from_addr: str,
    to_addr: str,
    subject: str,
    email_body: str,
    message_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Main entry point called by email_ingestion/service.py.
    """
    try:
        if not _is_faq_query(subject, email_body):
            return {"is_faq": False, "answered": False, "answer": None, "error": None}

        customer_id = _extract_customer_id(f"{subject} {email_body}")

        product_match = match_product_from_text(subject, email_body)
        product_id = product_match.get("product_id")
        product_name = product_match.get("product_name") or ""

        verification = _verify_customer_product(customer_id, product_id)
        customer = verification.get("customer") or {}
        customer_name = (
            f"{customer.get('first_name', '')} {customer.get('last_name', '')}".strip()
            or "Valued Customer"
        )
        reason = verification.get("message", "")

        if reason in ("no_customer_id", "customer_not_found", "product_not_registered"):
            _send_verification_failed_email(from_addr, subject, reason, customer_name)
            return {
                "is_faq": True,
                "answered": True,
                "answer": f"Verification failed: {reason}",
                "method": "verification_failed",
                "verification": verification,
                "product_match": product_match,
                "error": None,
            }

        if verification.get("warranty_status") == "OUT_OF_WARRANTY":
            _send_verification_failed_email(from_addr, subject, "out_of_warranty", customer_name)
            return {
                "is_faq": True,
                "answered": True,
                "answer": "Out of warranty — customer informed",
                "method": "out_of_warranty",
                "verification": verification,
                "product_match": product_match,
                "error": None,
            }

        product_obj = verification.get("product") or {}
        product_name = product_obj.get("product_name") or product_name
        category = product_obj.get("category", "")
        question = f"{subject}\n\n{email_body[:1200]}"

        try:
            chunks = semantic_search(
                query=question,
                top_k=TOP_K,
                product_id=product_id,
            )
        except Exception as rag_err:
            print(f"RAG search error: {rag_err}", file=sys.stderr)
            chunks = []

        if chunks:
            result = generate_answer(
                question=question,
                chunks=chunks,
                product_id=product_id,
                product_name=product_name,
                category=category,
            )
            if result.get("answer"):
                personalised = (
                    f"Dear {customer_name},\n\n"
                    f"Thank you for contacting Samsung Customer Support.\n\n"
                    f"We have verified your account (Customer ID: {customer_id}) "
                    f"and your {product_name} is registered and within warranty.\n\n"
                    f"{result['answer']}\n\n"
                    f"If you need further assistance, please call 1-800-SAMSUNG.\n\n"
                    f"Samsung Customer Support | samsung.com/in/support"
                )
                _send_faq_email(from_addr, subject, personalised, result["sources"])
                return {
                    "is_faq": True,
                    "answered": True,
                    "answer": personalised,
                    "sources": result["sources"],
                    "confidence": result["confidence"],
                    "method": "rag_manual",
                    "product_id": product_id,
                    "product_name": product_name,
                    "product_match": product_match,
                    "verification": verification,
                    "error": None,
                }

        csv_ans = _faq_csv_fallback(question, product_id=product_id)
        if csv_ans:
            personalised = (
                f"Dear {customer_name},\n\n{csv_ans}\n\n"
                f"Samsung Customer Support | 1-800-SAMSUNG"
            )
            _send_faq_email(from_addr, subject, personalised, [])
            return {
                "is_faq": True,
                "answered": True,
                "answer": personalised,
                "sources": [],
                "method": "faq_csv_fallback",
                "product_id": product_id,
                "product_match": product_match,
                "verification": verification,
                "error": None,
            }

        generic = (
            f"Dear {customer_name},\n\n"
            "Thank you for contacting Samsung Customer Support. "
            "We have received your enquiry and will respond within 2 business days. "
            "For urgent issues please call 1-800-SAMSUNG.\n\n"
            "Samsung Customer Support"
        )
        _send_faq_email(from_addr, subject, generic, [])
        return {
            "is_faq": True,
            "answered": True,
            "answer": generic,
            "sources": [],
            "method": "generic_fallback",
            "product_id": product_id,
            "product_match": product_match,
            "verification": verification,
            "error": None,
        }

    except Exception as e:
        return {"is_faq": True, "answered": False, "answer": None, "error": str(e)}


def get_rag_status() -> Dict[str, Any]:
    """Health check — call from /health endpoint."""
    collection = _get_collection()
    chunks = _load_knowledge_chunks()

    by_product: Dict[str, int] = {}
    if collection:
        try:
            all_meta = collection.get(include=["metadatas"])["metadatas"]
            for m in all_meta:
                pid = m.get("product_id", "unknown")
                by_product[pid] = by_product.get(pid, 0) + 1
        except Exception:
            pass

    return {
        "rag_available": len(chunks) > 0 or (collection is not None and collection.count() > 0),
        "chunks_in_files": len(chunks),
        "chunks_in_chromadb": collection.count() if collection else 0,
        "products_in_chromadb": by_product,
        "products_covered": list({c.get("product_id", "") for c in chunks}),
        "all_products": list(PRODUCT_ID_TO_NAME.keys()),
        "faq_csv_fallback": FAQ_CSV_FILE.exists(),
        "embed_model": EMBED_MODEL,
        "answer_model": ANSWER_MODEL,
        "top_k": TOP_K,
    }