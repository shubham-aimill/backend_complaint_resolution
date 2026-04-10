"""
ingest_pdfs.py
==============
ONE-TIME script to ingest Samsung product PDF manuals into ChromaDB.
"""
import argparse
import base64
import io
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# ── Paths ──────────────────────────────────────────────────────────────────
THIS_FILE = Path(__file__).resolve()
PROJECT_ROOT = THIS_FILE.parent

if (PROJECT_ROOT / "data").exists():
    DATA_DIR = PROJECT_ROOT / "data"
elif (PROJECT_ROOT.parent / "data").exists():
    DATA_DIR = PROJECT_ROOT.parent / "data"
else:
    DATA_DIR = PROJECT_ROOT / "data"

PDF_DIR = DATA_DIR / "pdfs"
KNOWLEDGE_DIR = DATA_DIR / "rag_knowledge"
CHROMA_DIR = DATA_DIR / "chroma_db"

if (PROJECT_ROOT / ".env").exists():
    ENV_FILE = PROJECT_ROOT / ".env"
else:
    ENV_FILE = PROJECT_ROOT.parent / ".env"


# ── ChromaDB collection name ───────────────────────────────────────────────
COLLECTION = "samsung_manuals"
EMBED_MODEL = "text-embedding-3-small"
VISION_MODEL = "gpt-4o"


# ── Product Map (REFRIGERATOR 350L REMOVED) ────────────────────────────────
PDF_PRODUCT_MAP: Dict[str, Dict[str, str]] = {
    "Samsung_Galaxy_A15": {
        "product_id": "PROD-SM-A155",
        "product_name": "Samsung Galaxy A15",
        "category": "Smartphone",
    },
    "Samsung_Galaxy_S26_Ultra": {
        "product_id": "PROD-SM-S938",
        "product_name": "Samsung Galaxy S26 Ultra",
        "category": "Smartphone",
    },
    "Samsung_Neo_QLED_QN90D": {
        "product_id": "PROD-QN90D-65",
        "product_name": "Samsung Neo QLED 4K QN90D",
        "category": "Television",
    },
    "Samsung_OLED_S85D": {
        "product_id": "PROD-S85D-55",
        "product_name": "Samsung OLED S85D",
        "category": "Television",
    },
    "Samsung_WindFree_Bespoke_AC": {
        "product_id": "PROD-AC-WFAI",
        "product_name": "Samsung Bespoke AI WindFree AC",
        "category": "Air Conditioner",
    },
    "Samsung_WindFree_AC": {
        "product_id": "PROD-AC-WF15",
        "product_name": "Samsung WindFree 1.5 Ton Inverter AC",
        "category": "Air Conditioner",
    },
    "Samsung_Side_by_Side_653L": {
        "product_id": "PROD-RF653-SBS",
        "product_name": "Samsung Bespoke Convertible 5in1 653L Side-by-Side",
        "category": "Refrigerator",
    },
}


# ── Reverse lookups for repair / normalization ─────────────────────────────
PRODUCT_BY_ID: Dict[str, Dict[str, str]] = {
    meta["product_id"]: meta for meta in PDF_PRODUCT_MAP.values()
}
PRODUCT_BY_PDF: Dict[str, Dict[str, str]] = {
    f"{pdf_stem}.pdf": meta for pdf_stem, meta in PDF_PRODUCT_MAP.items()
}


# ── Chunking config ────────────────────────────────────────────────────────
MIN_TEXT_CHARS = 150
CHUNK_OVERLAP = 1
PAGES_PER_CHUNK = 2
EMBED_BATCH_SIZE = 50


# ══════════════════════════════════════════════════════════════════════════
# Env loader
# ══════════════════════════════════════════════════════════════════════════

def _load_env() -> None:
    candidates = [
        ENV_FILE,
        PROJECT_ROOT.parent / ".env",
        PROJECT_ROOT.parent.parent / ".env",
    ]
    for env_path in candidates:
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip("'\""))
            break


def _get_openai_client():
    _load_env()
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or "your-" in api_key:
        print("ERROR: OPENAI_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)
    from openai import OpenAI
    return OpenAI(api_key=api_key)


# ══════════════════════════════════════════════════════════════════════════
# ChromaDB
# ══════════════════════════════════════════════════════════════════════════

def _get_collection():
    try:
        import chromadb
    except ImportError:
        print("ERROR: chromadb not installed. Run: pip install chromadb", file=sys.stderr)
        sys.exit(1)

    CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return client.get_or_create_collection(
        name=COLLECTION,
        metadata={"hnsw:space": "cosine"}
    )


# ══════════════════════════════════════════════════════════════════════════
# PDF Text Extraction
# ══════════════════════════════════════════════════════════════════════════

def _extract_pages(pdf_path: Path) -> List[Dict[str, Any]]:
    try:
        from pypdf import PdfReader
    except ImportError:
        print("ERROR: pypdf not installed. Run: pip install pypdf", file=sys.stderr)
        sys.exit(1)

    reader = PdfReader(str(pdf_path))
    pages: List[Dict[str, Any]] = []

    for i, page in enumerate(reader.pages):
        text = (page.extract_text() or "").strip()
        has_images = len(text) < MIN_TEXT_CHARS
        pages.append({
            "page_num": i + 1,
            "text": text,
            "has_images": has_images,
            "pdf_path": str(pdf_path),
        })

    return pages


# ══════════════════════════════════════════════════════════════════════════
# Vision fallback for image-heavy pages
# ══════════════════════════════════════════════════════════════════════════

def _page_to_image_b64(pdf_path: Path, page_num: int) -> Optional[str]:
    try:
        from pypdf import PdfReader
        from PIL import Image
    except ImportError:
        return None

    try:
        from pdf2image import convert_from_path
        images = convert_from_path(
            str(pdf_path),
            first_page=page_num,
            last_page=page_num,
            dpi=150
        )
        if images:
            buf = io.BytesIO()
            images[0].save(buf, format="JPEG", quality=85)
            return base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception:
        pass

    try:
        reader = PdfReader(str(pdf_path))
        page = reader.pages[page_num - 1]
        if "/Resources" in page and "/XObject" in page["/Resources"]:
            xobj = page["/Resources"]["/XObject"].get_object()
            for _, ref in xobj.items():
                obj = ref.get_object()
                if obj.get("/Subtype") == "/Image":
                    data = obj.get_data()
                    width = obj.get("/Width", 800)
                    height = obj.get("/Height", 600)
                    try:
                        img = Image.frombytes("RGB", (width, height), data)
                        buf = io.BytesIO()
                        img.save(buf, format="JPEG", quality=85)
                        return base64.b64encode(buf.getvalue()).decode("utf-8")
                    except Exception:
                        continue
    except Exception:
        pass

    return None


def _describe_image_page(
    client,
    pdf_path: Path,
    page_num: int,
    product_name: str,
    category: str,
) -> str:
    img_b64 = _page_to_image_b64(pdf_path, page_num)
    if not img_b64:
        return f"[Page {page_num} — image content could not be extracted]"

    try:
        resp = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"This is page {page_num} from the {product_name} ({category}) user manual. "
                            "Describe all content on this page in detail: diagrams, buttons, indicators, "
                            "error codes, troubleshooting steps, installation diagrams, and component labels. "
                            "Format as structured text useful for customer support."
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{img_b64}",
                            "detail": "high"
                        },
                    },
                ],
            }],
            max_tokens=800,
        )
        return resp.choices[0].message.content or f"[Page {page_num} — no description generated]"
    except Exception as e:
        return f"[Page {page_num} — Vision API error: {e}]"


# ══════════════════════════════════════════════════════════════════════════
# Chunk normalization / repair
# ══════════════════════════════════════════════════════════════════════════

def _infer_product_meta_from_chunk(chunk: Dict[str, Any]) -> Dict[str, str]:
    product_id = str(chunk.get("product_id", "") or "").strip()
    source_pdf = str(chunk.get("source_pdf", "") or "").strip()

    if product_id and product_id in PRODUCT_BY_ID:
        return PRODUCT_BY_ID[product_id]

    if source_pdf and source_pdf in PRODUCT_BY_PDF:
        return PRODUCT_BY_PDF[source_pdf]

    return {
        "product_id": product_id or "UNKNOWN",
        "product_name": str(chunk.get("product_name", "") or "Unknown"),
        "category": str(chunk.get("category", "") or "Unknown"),
    }


def _normalize_chunk(chunk: Dict[str, Any], fallback_id: int = 0) -> Dict[str, Any]:
    meta = _infer_product_meta_from_chunk(chunk)
    normalized = dict(chunk)

    normalized["product_id"] = str(normalized.get("product_id") or meta["product_id"] or "UNKNOWN")
    normalized["product_name"] = str(normalized.get("product_name") or meta["product_name"] or "Unknown")
    normalized["category"] = str(normalized.get("category") or meta["category"] or "Unknown")

    page_num = normalized.get("page_num")
    try:
        page_num = int(page_num)
    except Exception:
        page_num = 0
    normalized["page_num"] = page_num

    if not normalized.get("page_range"):
        normalized["page_range"] = f"{page_num}-{page_num}" if page_num else "0-0"

    normalized["text"] = str(normalized.get("text") or "")
    normalized["source_pdf"] = str(normalized.get("source_pdf") or "")

    if not normalized.get("id"):
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", normalized["product_name"])
        if page_num:
            normalized["id"] = f"{safe_name}_p{page_num:04d}"
        else:
            normalized["id"] = f"{safe_name}_chunk_{fallback_id:04d}"

    return normalized


def _validate_chunks(chunks: List[Dict[str, Any]], context: str = "") -> None:
    required_keys = ["id", "product_id", "product_name", "category", "page_num", "text", "source_pdf"]
    for i, chunk in enumerate(chunks):
        missing = [k for k in required_keys if k not in chunk]
        if missing:
            raise ValueError(f"Chunk #{i} in {context or 'unknown'} missing keys {missing}: {chunk}")


# ══════════════════════════════════════════════════════════════════════════
# Chunking
# ══════════════════════════════════════════════════════════════════════════

def _make_chunks(
    pages: List[Dict[str, Any]],
    product_meta: Dict[str, str],
    client,
    pdf_path: Path,
    vision_pages_used: List[int],
) -> List[Dict[str, Any]]:
    product_id = product_meta["product_id"]
    product_name = product_meta["product_name"]
    category = product_meta["category"]
    safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", product_name)

    resolved = []
    for pg in pages:
        if pg["has_images"] and len(pg["text"]) < MIN_TEXT_CHARS:
            print(f"      → Page {pg['page_num']}: image-heavy, calling Vision...", end=" ", flush=True)
            text = _describe_image_page(client, pdf_path, pg["page_num"], product_name, category)
            vision_pages_used.append(pg["page_num"])
            print("done")
        else:
            text = pg["text"]

        resolved.append({"page_num": pg["page_num"], "text": text})

    chunks: List[Dict[str, Any]] = []
    step = max(1, PAGES_PER_CHUNK - CHUNK_OVERLAP)
    i = 0
    while i < len(resolved):
        window = resolved[i:i + PAGES_PER_CHUNK]
        page_nums = [p["page_num"] for p in window]
        combined = "\n\n".join([f"--- Page {p['page_num']} ---\n{p['text']}" for p in window if str(p['text']).strip()])

        if combined.strip():
            chunk_id = f"{safe_name}_p{page_nums[0]:04d}"
            if len(page_nums) > 1:
                chunk_id += f"_p{page_nums[-1]:04d}"

            chunk = {
                "id": chunk_id,
                "product_id": product_id,
                "product_name": product_name,
                "category": category,
                "page_num": page_nums[0],
                "page_range": f"{page_nums[0]}-{page_nums[-1]}",
                "text": combined,
                "source_pdf": pdf_path.name,
            }
            chunks.append(_normalize_chunk(chunk, fallback_id=len(chunks)))
        i += step

    return chunks


# ══════════════════════════════════════════════════════════════════════════
# Embedding
# ══════════════════════════════════════════════════════════════════════════

def _embed_chunks(client, chunks: List[Dict[str, Any]]) -> List[List[float]]:
    all_embeddings: List[List[float]] = []
    texts = [c["text"] for c in chunks]
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i:i + EMBED_BATCH_SIZE]
        print(f"      Embedding batch {i // EMBED_BATCH_SIZE + 1}...", end=" ", flush=True)
        resp = client.embeddings.create(model=EMBED_MODEL, input=batch)
        all_embeddings.extend([r.embedding for r in resp.data])
        print("done")
        time.sleep(0.2)
    return all_embeddings


# ══════════════════════════════════════════════════════════════════════════
# Save & Rebuild master JSON
# ══════════════════════════════════════════════════════════════════════════

def _save_knowledge_json(chunks: List[Dict[str, Any]], product_name: str) -> Path:
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^a-zA-Z0-9]", "_", product_name)
    out = KNOWLEDGE_DIR / f"{safe}.json"
    out.write_text(json.dumps(chunks, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


def _rebuild_all_chunks_json() -> None:
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    all_chunks = []
    for f in sorted(KNOWLEDGE_DIR.glob("*.json")):
        if f.name.startswith("_"): continue
        try:
            raw = json.loads(f.read_text(encoding="utf-8"))
            all_chunks.extend([_normalize_chunk(c, i) for i, c in enumerate(raw)])
        except Exception:
            continue

    (KNOWLEDGE_DIR / "_all_chunks.json").write_text(json.dumps(all_chunks, indent=2, ensure_ascii=False), encoding="utf-8")
    index = [{"id": c.get("id"), "product_name": c.get("product_name"), "page_num": c.get("page_num")} for c in all_chunks]
    (KNOWLEDGE_DIR / "_index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n   Rebuilt _all_chunks.json with {len(all_chunks)} chunks.")


# ══════════════════════════════════════════════════════════════════════════
# Ingestion Logic
# ══════════════════════════════════════════════════════════════════════════

def _ingest_product(pdf_path: Path, product_meta: Dict[str, str], client, collection, reset: bool) -> int:
    product_id = product_meta["product_id"]
    product_name = product_meta["product_name"]

    print(f"\n   Product : {product_name} | PDF: {pdf_path.name}")
    try:
        existing = collection.get(where={"product_id": {"$eq": product_id}})
        if existing.get("ids"): collection.delete(ids=existing["ids"])
    except Exception: pass

    pages = _extract_pages(pdf_path)
    vision_used = []
    chunks = _make_chunks(pages, product_meta, client, pdf_path, vision_used)
    if not chunks: return 0

    embeddings = _embed_chunks(client, chunks)
    ids = [c["id"] for c in chunks]
    metadatas = [{k: c[k] for k in ["product_id", "product_name", "category", "page_num", "page_range", "source_pdf"]} for c in chunks]
    collection.add(ids=ids, documents=[c["text"] for c in chunks], embeddings=embeddings, metadatas=metadatas)

    _save_knowledge_json(chunks, product_name)
    return len(chunks)


# ══════════════════════════════════════════════════════════════════════════
# CLI commands
# ══════════════════════════════════════════════════════════════════════════

def cmd_status() -> None:
    print("\n   RAG Knowledge Status")
    try:
        col = _get_collection()
        print(f"   ChromaDB: {col.count()} chunks indexed.")
    except Exception as e: print(f"   Error: {e}")


def cmd_build(reset: bool = False, product_filter: Optional[str] = None) -> None:
    _load_env()
    client = _get_openai_client()
    collection = _get_collection()

    if reset and not product_filter:
        try:
            ex = collection.get()
            if ex.get("ids"): collection.delete(ids=ex["ids"])
        except Exception: pass

    total_chunks = 0
    processed = 0
    for pdf_stem, meta in PDF_PRODUCT_MAP.items():
        if product_filter and product_filter not in (pdf_stem, meta["product_id"], meta["product_name"]): continue
        pdf_path = PDF_DIR / f"{pdf_stem}.pdf"
        if not pdf_path.exists(): continue

        try:
            n = _ingest_product(pdf_path, meta, client, collection, reset)
            total_chunks += n
            processed += 1
        except Exception as e:
            print(f"   ❌ Error ingesting {pdf_stem}.pdf: {e}")
            continue

    _rebuild_all_chunks_json()
    print(f"\n   ✓ Done: {processed} products, {total_chunks} master chunks.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--product", type=str)
    args = parser.parse_args()

    if args.status: cmd_status()
    else: cmd_build(reset=args.reset, product_filter=args.product)