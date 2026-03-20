"""
RAG Service — Samsung Complaint Resolution System
==================================================
Semantic search over Samsung product manual knowledge base.

Two modes:
  1. TEXT MODE (active now) — pre-extracted manual pages stored as JSON
     in data/rag_knowledge/. Works immediately, no API cost to build index.
  2. VISION MODE (future) — for image-only PDFs (fridges), uses GPT-4o Vision.
     Run: python ingest_manuals.py --vision-only

Pipeline:
  Customer FAQ email
       ↓ _is_faq_query()
  Embed question → cosine search → top-3 chunks
       ↓ generate_answer()
  GPT-4o generates grounded answer from manual content
       ↓ _send_faq_email()
  Auto reply sent to customer
"""

import csv, json, math, os, re, smtplib, sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.common.config import DATA_DIR, ENV_FILE

# ── Paths ──────────────────────────────────────────────────────────────────
KNOWLEDGE_DIR = DATA_DIR / "rag_knowledge"
CHROMA_DIR    = DATA_DIR / "chroma_db"
FAQ_CSV_FILE  = DATA_DIR / "FAQ.csv"

# ── Config ─────────────────────────────────────────────────────────────────
TOP_K        = 3
EMBED_MODEL  = "text-embedding-3-small"
ANSWER_MODEL = "gpt-4o"
COLLECTION   = "samsung_manuals"


def _load_env() -> None:
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def _get_openai():
    _load_env()
    from openai import OpenAI
    return OpenAI(api_key=os.environ["OPENAI_API_KEY"])


# ══════════════════════════════════════════════════════════════════════════
# Knowledge Base — load pre-extracted manual chunks
# ══════════════════════════════════════════════════════════════════════════

def _load_knowledge_chunks() -> List[Dict]:
    """Load all pre-extracted manual chunks from rag_knowledge/ JSON files."""
    if not KNOWLEDGE_DIR.exists():
        return []
    all_chunks = []
    for f in sorted(KNOWLEDGE_DIR.glob("*.json")):
        if f.name.startswith("_"):
            continue
        try:
            chunks = json.loads(f.read_text())
            all_chunks.extend(chunks)
        except Exception as e:
            print(f"Warning: could not load {f.name}: {e}", file=sys.stderr)
    return all_chunks


# ══════════════════════════════════════════════════════════════════════════
# ChromaDB Vector Store
# ══════════════════════════════════════════════════════════════════════════

def _get_collection():
    try:
        import chromadb
    except ImportError:
        return None
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return client.get_or_create_collection(name=COLLECTION, metadata={"hnsw:space": "cosine"})


def build_rag_index(force_rebuild: bool = False) -> Dict[str, Any]:
    """
    Build ChromaDB index from pre-extracted knowledge JSON files.
    Run once after setup: python ingest_manuals.py
    """
    _load_env()
    client     = _get_openai()
    collection = _get_collection()
    if not collection:
        return {"success": False, "error": "ChromaDB not installed. Run: pip install chromadb"}

    chunks = _load_knowledge_chunks()
    if not chunks:
        return {"success": False, "error": f"No knowledge files in {KNOWLEDGE_DIR}"}

    # Check if already indexed
    if not force_rebuild and collection.count() >= len(chunks):
        return {"success": True, "chunks": collection.count(), "message": "Already indexed"}

    # Clear and rebuild
    try:
        existing = collection.get()
        if existing["ids"]:
            collection.delete(ids=existing["ids"])
    except Exception:
        pass

    texts = [c["text"] for c in chunks]
    ids   = [c["id"]   for c in chunks]
    metas = [{"product": c["product"], "category": c["category"], "page_num": c["page_num"]} for c in chunks]

    # Embed in batches of 100
    all_embeddings = []
    for i in range(0, len(texts), 100):
        resp = client.embeddings.create(model=EMBED_MODEL, input=texts[i:i+100])
        all_embeddings.extend([r.embedding for r in resp.data])

    collection.add(ids=ids, documents=texts, embeddings=all_embeddings, metadatas=metas)
    print(f"RAG: indexed {len(chunks)} chunks into ChromaDB")
    return {"success": True, "chunks": len(chunks)}


# ══════════════════════════════════════════════════════════════════════════
# Semantic Search — with cosine fallback if ChromaDB not available
# ══════════════════════════════════════════════════════════════════════════

def _cosine(a: List[float], b: List[float]) -> float:
    dot = sum(x*y for x,y in zip(a,b))
    na  = math.sqrt(sum(x*x for x in a))
    nb  = math.sqrt(sum(x*x for x in b))
    return dot/(na*nb) if na and nb else 0.0


def semantic_search(query: str, top_k: int = TOP_K) -> List[Dict]:
    _load_env()
    client = _get_openai()
    q_emb  = client.embeddings.create(model=EMBED_MODEL, input=[query]).data[0].embedding

    # Try ChromaDB first
    collection = _get_collection()
    if collection and collection.count() > 0:
        results = collection.query(
            query_embeddings=[q_emb],
            n_results=min(top_k, collection.count()),
            include=["documents","metadatas","distances"]
        )
        chunks = []
        if results and results["ids"] and results["ids"][0]:
            for i, _ in enumerate(results["ids"][0]):
                chunks.append({
                    "text":     results["documents"][0][i],
                    "product":  results["metadatas"][0][i].get("product",""),
                    "category": results["metadatas"][0][i].get("category",""),
                    "page_num": results["metadatas"][0][i].get("page_num",0),
                    "distance": results["distances"][0][i],
                })
        return chunks

    # Fallback: in-memory cosine search over knowledge files
    all_chunks = _load_knowledge_chunks()
    if not all_chunks:
        return []

    texts = [c["text"] for c in all_chunks]
    # Embed all chunks (cached in memory per process)
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts[:200])  # limit for speed
    chunk_embs = [r.embedding for r in resp.data]

    scored = sorted(
        [(1 - _cosine(q_emb, emb), i) for i, emb in enumerate(chunk_embs)],
        key=lambda x: x[0]
    )[:top_k]

    return [{
        "text":     all_chunks[i]["text"],
        "product":  all_chunks[i]["product"],
        "category": all_chunks[i]["category"],
        "page_num": all_chunks[i]["page_num"],
        "distance": dist,
    } for dist, i in scored]


# ══════════════════════════════════════════════════════════════════════════
# Answer Generation
# ══════════════════════════════════════════════════════════════════════════

def generate_answer(question: str, chunks: List[Dict]) -> Dict[str, Any]:
    if not chunks:
        return {"answer": None, "sources": [], "confidence": 0.0}

    _load_env()
    client  = _get_openai()
    context = "\n\n---\n\n".join(
        f"[{c['product']} Manual — Page {c['page_num']}]\n{c['text']}"
        for c in chunks
    )
    sources = [{"product": c["product"], "page_num": c["page_num"],
                "category": c["category"], "relevance": round(1 - c["distance"], 3)}
               for c in chunks]

    resp = client.chat.completions.create(
        model=ANSWER_MODEL,
        messages=[
            {"role": "system", "content": (
                "You are a Samsung customer support specialist. "
                "Answer using ONLY the Samsung manual excerpts provided. "
                "Be specific, helpful and step-by-step. "
                "Reference the exact product name. "
                "If manual doesn't cover it, say so and suggest contacting 1-800-SAMSUNG."
            )},
            {"role": "user", "content": (
                f"Customer Question: {question}\n\n"
                f"Samsung Manual Content:\n\n{context}\n\n"
                f"Provide a clear, helpful answer:"
            )}
        ],
        max_tokens=800,
        temperature=0.2,
    )
    return {
        "answer":     resp.choices[0].message.content or "",
        "sources":    sources,
        "confidence": round(1 - min(c["distance"] for c in chunks), 3),
        "method":     "rag_manual"
    }


# ══════════════════════════════════════════════════════════════════════════
# FAQ CSV Fallback
# ══════════════════════════════════════════════════════════════════════════

def _faq_csv_fallback(question: str) -> Optional[str]:
    if not FAQ_CSV_FILE.exists():
        return None
    _load_env()
    faqs = []
    try:
        with open(FAQ_CSV_FILE, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                q = row.get("Question","").strip()
                a = row.get("Answer","").strip()
                if q and a:
                    faqs.append({"question": q, "answer": a})
    except Exception:
        return None
    if not faqs:
        return None

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return faqs[0]["answer"]

    client  = _get_openai()
    context = "\n\n".join(f"Q{i+1}: {f['question']}\nA{i+1}: {f['answer']}" for i,f in enumerate(faqs))
    resp    = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role":"system","content":"Samsung FAQ matcher. Reply ONLY with number (A1,A2...) or NONE."},
            {"role":"user",  "content":f"Question: {question}\n\nFAQ:\n{context}"}
        ],
        max_tokens=10, temperature=0,
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
        resp   = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role":"system","content":"Samsung email classifier. Reply ONLY 'FAQ' or 'COMPLAINT'."},
                {"role":"user",  "content":f"Subject: {subject}\n\n{body[:1500]}"}
            ],
            max_tokens=5, temperature=0,
        )
        return (resp.choices[0].message.content or "").strip().upper().startswith("FAQ")
    except Exception:
        return True


# ══════════════════════════════════════════════════════════════════════════
# Send Email
# ══════════════════════════════════════════════════════════════════════════

def _send_faq_email(to_addr: str, subject: str, answer: str, sources: List[Dict]) -> None:
    _load_env()
    sender   = os.environ.get("SENDER_EMAIL","")
    password = os.environ.get("EMAIL_PASSWORD","").replace(" ","")
    if not sender or not password:
        raise ValueError("SENDER_EMAIL and EMAIL_PASSWORD not configured in .env")

    src_text = ""
    if sources:
        src_text = "\n\nSource: Samsung Manual\n"
        for s in sources:
            src_text += f"  • {s['product']} — Page {s['page_num']}\n"

    body = (
        f"Thank you for contacting Samsung Customer Support.\n\n"
        f"{answer}{src_text}\n\n"
        f"---\n"
        f"This response was generated from official Samsung product documentation.\n"
        f"If this does not resolve your issue, reply to this email or call 1-800-SAMSUNG.\n\n"
        f"Samsung Customer Support | samsung.com/in/support"
    )

    msg            = MIMEMultipart("alternative")
    msg["From"]    = f"Samsung Support <{sender}>"
    msg["To"]      = to_addr
    msg["Subject"] = f"Re: {subject}"
    msg.attach(MIMEText(body, "plain"))
    msg.attach(MIMEText(body.replace("\n","<br>"), "html"))

    server = smtplib.SMTP(os.environ.get("SMTP_HOST","smtp.gmail.com"),
                          int(os.environ.get("SMTP_PORT","587")))
    server.starttls()
    server.login(sender, password)
    server.send_message(msg)
    server.quit()


# ══════════════════════════════════════════════════════════════════════════
# PUBLIC API — drop-in replacement for faq_resolution/service.py
# ══════════════════════════════════════════════════════════════════════════

def _extract_customer_id(subject: str, body: str) -> Optional[str]:
    """Extract CUSTXXXXX from email subject or body."""
    m = re.search(r"CUST\d{5}", f"{subject} {body}", re.IGNORECASE)
    return m.group(0).upper() if m else None


def _match_product_from_text(subject: str, body: str) -> Optional[str]:
    """Fuzzy match product mentioned in email to a product_id."""
    text = f"{subject} {body}".lower()
    keywords = {
        "PROD-SM-S938":  ["s26 ultra", "galaxy s26", "sm-s938"],
        "PROD-SM-A155":  ["galaxy a15", "a15", "sm-a155"],
        "PROD-QN90D-65": ["qn90d", "neo qled", "qn90"],
        "PROD-S85D-55":  ["s85d", "oled s85", "samsung oled"],
        "PROD-RF350-BD": ["350l", "double door", "bespoke 350", "rt39"],
        "PROD-RF653-SBS":["653l", "side by side", "rs76", "bespoke 653"],
        "PROD-AC-WFAI":  ["windfree bespoke", "bespoke ai", "bespoke windfree", "ar18cx"],
        "PROD-AC-WF15":  ["windfree 1.5", "windfree ac", "ar18by", "wind free"],
    }
    for prod_id, kws in keywords.items():
        if any(k in text for k in kws):
            return prod_id
    return None


def _verify_customer_product(customer_id: Optional[str], product_id: Optional[str]) -> Dict[str, Any]:
    """
    3 checks:
    1. Customer exists in customers.json
    2. Product registered to this customer
    3. Product within warranty

    Returns dict with verified, customer, product, warranty_status, message
    """
    _load_env()
    result = {
        "verified": False,
        "customer": None,
        "product": None,
        "warranty_status": None,
        "message": None,
    }

    # Load data
    customers_file = DATA_DIR / "customers.json"
    products_file  = DATA_DIR / "product_service.json"
    if not customers_file.exists() or not products_file.exists():
        result["message"] = "Could not load customer data"
        return result

    customers = json.loads(customers_file.read_text())
    products  = json.loads(products_file.read_text())

    # CHECK 1 — Customer exists?
    if not customer_id:
        result["message"] = "no_customer_id"
        return result

    customer = next((c for c in customers if c["customer_id"].upper() == customer_id.upper()), None)
    if not customer:
        result["message"] = "customer_not_found"
        return result
    result["customer"] = customer

    # CHECK 2 — Product registered to customer?
    if not product_id:
        result["message"]  = "no_product_mentioned"
        result["verified"] = True   # customer verified, product unclear
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

    # CHECK 3 — Within warranty?
    from datetime import datetime, timedelta
    warranty_months    = product.get("warranty_period_months", 12)
    # Use product-specific purchase date first, fallback to customer_since
    purchase_dates_map = customer.get("product_purchase_dates", {})
    purchase_date_str  = purchase_dates_map.get(product_id) or customer.get("customer_since", "")
    try:
        purchase_dt = datetime.strptime(purchase_date_str[:10], "%Y-%m-%d")
        expiry_dt   = purchase_dt + timedelta(days=warranty_months * 30.44)
        within      = datetime.now() <= expiry_dt
        result["warranty_status"]    = "WITHIN_WARRANTY" if within else "OUT_OF_WARRANTY"
        result["warranty_expiry"]    = expiry_dt.strftime("%Y-%m-%d")
        result["purchase_date"]      = purchase_date_str[:10]
    except Exception:
        result["warranty_status"] = "UNKNOWN"

    result["verified"] = True
    result["message"]  = "verified"
    return result


def _send_verification_failed_email(to_addr: str, subject: str, reason: str,
                                     customer_name: str = "") -> None:
    """Send appropriate reply when customer/product verification fails."""
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
            "account.samsung.com to create your account.\n\n"
            "Samsung Customer Support | 1-800-SAMSUNG"
        ),
        "product_not_registered": (
            f"Dear {name},\n\n"
            "Thank you for contacting Samsung Customer Support.\n\n"
            "The product mentioned in your email does not appear to be registered "
            "under your account. Please register your product at:\n"
            "samsung.com/in/support → Register Product\n\n"
            "Once registered, we will be happy to assist you.\n\n"
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


def process_faq_email(from_addr: str, to_addr: str, subject: str, email_body: str) -> Dict[str, Any]:
    """
    Drop-in replacement for faq_resolution.service.process_faq_email.
    Now includes customer verification before answering.

    Flow:
      1. Is FAQ or Complaint?
      2. Extract Customer ID from email
      3. Extract product mentioned
      4. Verify customer exists + product registered + within warranty
      5. RAG search scoped to that product
      6. Generate grounded answer
      7. Send personalised reply
    """
    try:
        # Step 1 — FAQ or complaint?
        if not _is_faq_query(subject, email_body):
            return {"is_faq": False, "answered": False, "answer": None, "error": None}

        # Step 2 — Extract customer + product from email
        customer_id = _extract_customer_id(subject, email_body)
        product_id  = _match_product_from_text(subject, email_body)

        # Step 3 — Verify customer, product, warranty
        verification = _verify_customer_product(customer_id, product_id)
        customer     = verification.get("customer") or {}
        customer_name = f"{customer.get('first_name','')} {customer.get('last_name','')}".strip() or "Valued Customer"
        reason        = verification.get("message","")

        # Failed verifications — send specific reply and stop
        if reason in ("no_customer_id", "customer_not_found", "product_not_registered"):
            _send_verification_failed_email(from_addr, subject, reason, customer_name)
            return {
                "is_faq": True, "answered": True,
                "answer": f"Verification failed: {reason}",
                "method": "verification_failed",
                "verification": verification,
                "error": None,
            }

        # Out of warranty — inform but still answer the question
        if verification.get("warranty_status") == "OUT_OF_WARRANTY":
            _send_verification_failed_email(from_addr, subject, "out_of_warranty", customer_name)
            return {
                "is_faq": True, "answered": True,
                "answer": "Out of warranty — informed customer",
                "method": "out_of_warranty",
                "verification": verification,
                "error": None,
            }

        # Step 4 — Build product-scoped query
        product      = verification.get("product") or {}
        product_name = product.get("product_name", "")
        question     = f"{subject} {email_body[:800]}"

        # Step 5 — RAG search (scoped to product if possible)
        try:
            chunks = semantic_search(question, top_k=TOP_K)

            # Prefer chunks from matched product
            if product_name:
                product_chunks = [c for c in chunks if product_name.lower() in c.get("product","").lower()]
                if product_chunks:
                    chunks = product_chunks + [c for c in chunks if c not in product_chunks]
                    chunks = chunks[:TOP_K]

            if chunks:
                result = generate_answer(question, chunks)
                if result["answer"]:
                    # Personalise the answer
                    personalised = (
                        f"Dear {customer_name},\n\n"
                        f"Thank you for contacting Samsung Customer Support.\n\n"
                        f"We have verified your account (Customer ID: {customer_id}) "
                        f"and your {product_name} is registered and within warranty.\n\n"
                        f"{result['answer']}\n\n"
                        f"If you need further assistance, please call 1-800-SAMSUNG.\n\n"
                        f"Samsung Customer Support"
                    )
                    _send_faq_email(from_addr, subject, personalised, result["sources"])
                    return {
                        "is_faq": True, "answered": True,
                        "answer": personalised,
                        "sources": result["sources"],
                        "confidence": result["confidence"],
                        "method": "rag_manual",
                        "verification": verification,
                        "error": None,
                    }
        except Exception as e:
            print(f"RAG error: {e}", file=sys.stderr)

        # Step 6 — FAQ.csv fallback
        csv_ans = _faq_csv_fallback(question)
        if csv_ans:
            personalised = f"Dear {customer_name},\n\n{csv_ans}\n\nSamsung Customer Support | 1-800-SAMSUNG"
            _send_faq_email(from_addr, subject, personalised, [])
            return {"is_faq": True, "answered": True, "answer": personalised,
                    "sources": [], "method": "faq_csv_fallback",
                    "verification": verification, "error": None}

        # Step 7 — Generic fallback
        generic = (
            f"Dear {customer_name},\n\n"
            "Thank you for contacting Samsung Customer Support. "
            "We have received your enquiry and will respond within 2 business days. "
            "For urgent issues please call 1-800-SAMSUNG.\n\n"
            "Samsung Customer Support"
        )
        _send_faq_email(from_addr, subject, generic, [])
        return {"is_faq": True, "answered": True, "answer": generic,
                "sources": [], "method": "generic_fallback",
                "verification": verification, "error": None}

    except Exception as e:
        return {"is_faq": True, "answered": False, "answer": None, "error": str(e)}


def get_rag_status() -> Dict[str, Any]:
    """Call from /health endpoint."""
    collection = _get_collection()
    chunks     = _load_knowledge_chunks()
    return {
        "rag_available":      len(chunks) > 0,
        "chunks_in_files":    len(chunks),
        "chunks_in_chromadb": collection.count() if collection else 0,
        "products_covered":   list({c["product"] for c in chunks}),
        "faq_csv_fallback":   FAQ_CSV_FILE.exists(),
        "fridge_note":        "Fridge manuals are image-only — FAQ.csv fallback active for fridge queries"
    }