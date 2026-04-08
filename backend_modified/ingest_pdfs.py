"""
ingest_pdfs.py
==============
ONE-TIME script to ingest Samsung product PDF manuals into ChromaDB.

What it does:
  1. Reads each PDF from data/pdfs/
  2. Extracts text per page using pypdf
  3. For image-heavy pages (text < 150 chars) → calls GPT-4o Vision to describe them
  4. Chunks intelligently (page-level, ~500 tokens each)
  5. Tags every chunk with: product_id, product_name, category, page_num, source_pdf
  6. Embeds all chunks with text-embedding-3-small (OpenAI)
  7. Stores into ChromaDB with product_id as metadata for hard filtering at query time
  8. Saves rebuilt JSON files to data/rag_knowledge/<ProductName>.json
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

# Supports both:
# 1) backend_modified/ingest_pdfs.py
# 2) backend/rag/ingest_pdfs.py
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


# ── Product Map ─────────────────────────────────────────────────────────────
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
    "Samsung_Double_Door_350L": {
    "product_id": "PROD-RF350-BD",
    "product_name": "Samsung Bespoke AI Double Door 350L",
    "category": "Refrigerator",
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

    normalized["product_id"] = str(
        normalized.get("product_id") or meta["product_id"] or "UNKNOWN"
    )
    normalized["product_name"] = str(
        normalized.get("product_name") or meta["product_name"] or "Unknown"
    )
    normalized["category"] = str(
        normalized.get("category") or meta["category"] or "Unknown"
    )

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
            raise ValueError(
                f"Chunk #{i} in {context or 'unknown context'} missing keys {missing}: {chunk}"
            )


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
            print(
                f"      → Page {pg['page_num']}: image-heavy, calling GPT-4o Vision...",
                end=" ",
                flush=True,
            )
            text = _describe_image_page(client, pdf_path, pg["page_num"], product_name, category)
            vision_pages_used.append(pg["page_num"])
            print("done")
        else:
            text = pg["text"]

        resolved.append({
            "page_num": pg["page_num"],
            "text": text,
        })

    chunks: List[Dict[str, Any]] = []
    step = max(1, PAGES_PER_CHUNK - CHUNK_OVERLAP)
    i = 0

    while i < len(resolved):
        window = resolved[i:i + PAGES_PER_CHUNK]
        page_nums = [p["page_num"] for p in window]

        combined = "\n\n".join(
            f"--- Page {p['page_num']} ---\n{p['text']}"
            for p in window
            if str(p["text"]).strip()
        )

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

    _validate_chunks(chunks, context=f"_make_chunks({product_name})")
    return chunks


# ══════════════════════════════════════════════════════════════════════════
# Embedding
# ══════════════════════════════════════════════════════════════════════════

def _embed_chunks(client, chunks: List[Dict[str, Any]]) -> List[List[float]]:
    all_embeddings: List[List[float]] = []
    texts = [c["text"] for c in chunks]
    total = len(texts)

    for i in range(0, total, EMBED_BATCH_SIZE):
        batch = texts[i:i + EMBED_BATCH_SIZE]
        batch_num = i // EMBED_BATCH_SIZE + 1
        total_batches = (total + EMBED_BATCH_SIZE - 1) // EMBED_BATCH_SIZE

        print(
            f"      Embedding batch {batch_num}/{total_batches} ({len(batch)} chunks)...",
            end=" ",
            flush=True
        )
        resp = client.embeddings.create(model=EMBED_MODEL, input=batch)
        all_embeddings.extend([r.embedding for r in resp.data])
        print("done")
        time.sleep(0.2)

    return all_embeddings


# ══════════════════════════════════════════════════════════════════════════
# Save to JSON knowledge base
# ══════════════════════════════════════════════════════════════════════════

def _save_knowledge_json(chunks: List[Dict[str, Any]], product_name: str) -> Path:
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^a-zA-Z0-9]", "_", product_name)
    out = KNOWLEDGE_DIR / f"{safe}.json"

    saveable = [_normalize_chunk(c, idx) for idx, c in enumerate(chunks)]
    _validate_chunks(saveable, context=f"_save_knowledge_json({product_name})")

    out.write_text(
        json.dumps(saveable, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )
    return out


def _rebuild_all_chunks_json() -> None:
    """
    Rebuild _all_chunks.json and _index.json from individual product JSONs.
    Also repairs old malformed chunks that may be missing product_name/category.
    """
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)

    all_chunks: List[Dict[str, Any]] = []
    skipped_files: List[str] = []
    repaired_count = 0

    for f in sorted(KNOWLEDGE_DIR.glob("*.json")):
        if f.name.startswith("_"):
            continue

        try:
            raw = json.loads(f.read_text(encoding="utf-8"))
            if not isinstance(raw, list):
                print(f"  WARNING: skipping {f.name} because it is not a JSON list")
                skipped_files.append(f.name)
                continue

            normalized_chunks: List[Dict[str, Any]] = []
            file_had_repairs = False

            for idx, chunk in enumerate(raw):
                if not isinstance(chunk, dict):
                    continue

                before = dict(chunk)
                fixed = _normalize_chunk(chunk, fallback_id=idx)
                normalized_chunks.append(fixed)

                if before != fixed:
                    file_had_repairs = True
                    repaired_count += 1

            # Save repaired per-product file back
            if file_had_repairs:
                f.write_text(
                    json.dumps(normalized_chunks, indent=2, ensure_ascii=False),
                    encoding="utf-8"
                )
                print(f"  Repaired malformed chunks in {f.name}")

            all_chunks.extend(normalized_chunks)

        except Exception as e:
            print(f"  WARNING: failed to read {f.name}: {e}")
            skipped_files.append(f.name)

    all_chunks = [_normalize_chunk(c, idx) for idx, c in enumerate(all_chunks)]
    _validate_chunks(all_chunks, context="_rebuild_all_chunks_json(all_chunks)")

    (KNOWLEDGE_DIR / "_all_chunks.json").write_text(
        json.dumps(all_chunks, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    index = [
        {
            "id": c.get("id"),
            "product_name": c.get("product_name", "Unknown"),
            "product_id": c.get("product_id", "UNKNOWN"),
            "category": c.get("category", "Unknown"),
            "page_num": c.get("page_num", 0),
            "page_range": c.get("page_range", "0-0"),
            "source_pdf": c.get("source_pdf", ""),
        }
        for c in all_chunks
    ]

    (KNOWLEDGE_DIR / "_index.json").write_text(
        json.dumps(index, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    # Optional text-only dump if you need it
    text_chunks = [
        {
            "id": c.get("id"),
            "product_name": c.get("product_name", "Unknown"),
            "product_id": c.get("product_id", "UNKNOWN"),
            "page_num": c.get("page_num", 0),
            "text": c.get("text", ""),
        }
        for c in all_chunks
    ]

    (KNOWLEDGE_DIR / "_all_text_chunks.json").write_text(
        json.dumps(text_chunks, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    print(f"\n  Rebuilt _all_chunks.json ({len(all_chunks)} total chunks)")
    print("  Rebuilt _index.json")
    print("  Rebuilt _all_text_chunks.json")
    if repaired_count:
        print(f"  Auto-repaired {repaired_count} malformed chunk records")
    if skipped_files:
        print(f"  Skipped files: {', '.join(skipped_files)}")


# ══════════════════════════════════════════════════════════════════════════
# Ingest one product
# ══════════════════════════════════════════════════════════════════════════

def _ingest_product(pdf_path: Path, product_meta: Dict[str, str], client, collection, reset: bool) -> int:
    product_id = product_meta["product_id"]
    product_name = product_meta["product_name"]

    print(f"\n  {'─' * 60}")
    print(f"  Product  : {product_name}")
    print(f"  ID       : {product_id}")
    print(f"  PDF      : {pdf_path.name}")
    print(f"  {'─' * 60}")

    try:
        existing = collection.get(where={"product_id": {"$eq": product_id}})
        if existing.get("ids"):
            collection.delete(ids=existing["ids"])
            print(f"  Cleared {len(existing['ids'])} old chunks for {product_id}")
    except Exception:
        pass

    print("  Extracting pages from PDF...", end=" ", flush=True)
    pages = _extract_pages(pdf_path)
    text_pages = sum(1 for p in pages if not p["has_images"])
    image_pages = sum(1 for p in pages if p["has_images"])
    print(f"done — {len(pages)} pages ({text_pages} text, {image_pages} image-heavy)")

    vision_used: List[int] = []
    print(f"  Chunking (window={PAGES_PER_CHUNK} pages, overlap={CHUNK_OVERLAP})...")
    chunks = _make_chunks(pages, product_meta, client, pdf_path, vision_used)
    print(
        f"  Created {len(chunks)} chunks" +
        (f" (Vision used on {len(vision_used)} pages)" if vision_used else "")
    )

    if not chunks:
        print(f"  WARNING: no chunks produced for {product_name}")
        return 0

    print(f"  Embedding chunks with {EMBED_MODEL}...")
    embeddings = _embed_chunks(client, chunks)

    print("  Storing in ChromaDB...", end=" ", flush=True)
    ids = [c["id"] for c in chunks]
    texts = [c["text"] for c in chunks]
    metadatas = [{
        "product_id": c["product_id"],
        "product_name": c["product_name"],
        "category": c["category"],
        "page_num": c["page_num"],
        "page_range": c["page_range"],
        "source_pdf": c["source_pdf"],
    } for c in chunks]

    collection.add(ids=ids, documents=texts, embeddings=embeddings, metadatas=metadatas)
    print("done")

    json_path = _save_knowledge_json(chunks, product_name)
    try:
        rel_path = json_path.relative_to(PROJECT_ROOT)
    except Exception:
        rel_path = json_path
    print(f"  Saved JSON → {rel_path}")

    return len(chunks)


# ══════════════════════════════════════════════════════════════════════════
# CLI commands
# ══════════════════════════════════════════════════════════════════════════

def cmd_status() -> None:
    print(f"\n{'=' * 62}")
    print("  RAG Knowledge Base Status")
    print(f"{'=' * 62}")

    print("\n  JSON Knowledge Files:")
    if KNOWLEDGE_DIR.exists():
        for f in sorted(KNOWLEDGE_DIR.glob("*.json")):
            if not f.name.startswith("_"):
                try:
                    d = json.loads(f.read_text(encoding="utf-8"))
                    if not isinstance(d, list):
                        print(f"    {f.name:<50} INVALID FORMAT")
                        continue
                    products = {c.get('product_name', '?') for c in d if isinstance(c, dict)}
                    ids = {c.get('product_id', '?') for c in d if isinstance(c, dict)}
                    pid = list(ids)[0] if ids else "?"
                    pname = list(products)[0] if products else "?"
                    print(f"    {f.name:<50} {len(d):>4} chunks | {pid} | {pname}")
                except Exception as e:
                    print(f"    {f.name}: ERROR {e}")
    else:
        print("    (none — run ingest first)")

    print("\n  ChromaDB Index:")
    try:
        col = _get_collection()
        all_meta = col.get(include=["metadatas"]).get("metadatas", [])
        by_product: Dict[str, int] = {}
        for m in all_meta:
            key = f"{m.get('product_id', '?')} | {m.get('product_name', '?')}"
            by_product[key] = by_product.get(key, 0) + 1

        for k, cnt in sorted(by_product.items()):
            print(f"    {k:<60} {cnt:>4} chunks")
        print(f"\n    TOTAL: {col.count()} chunks indexed")
    except Exception as e:
        print(f"    Error: {e}")

    print("\n  PDFs in data/pdfs/:")
    if PDF_DIR.exists():
        for f in sorted(PDF_DIR.glob("*.pdf")):
            mapped = f.stem in PDF_PRODUCT_MAP
            print(
                f"    {'✓' if mapped else '?'} {f.name}" +
                ("" if mapped else " ← NOT in PDF_PRODUCT_MAP")
            )
    else:
        print(f"    (folder not found: {PDF_DIR})")
    print()


def cmd_build(reset: bool = False, product_filter: Optional[str] = None) -> None:
    _load_env()
    client = _get_openai_client()
    collection = _get_collection()

    if reset and not product_filter:
        print("\n  Wiping entire ChromaDB collection...", end=" ", flush=True)
        try:
            existing = collection.get()
            if existing.get("ids"):
                collection.delete(ids=existing["ids"])
        except Exception:
            pass
        print("done")

        # Also clean aggregate JSON files
        for f in [
            KNOWLEDGE_DIR / "_all_chunks.json",
            KNOWLEDGE_DIR / "_all_text_chunks.json",
            KNOWLEDGE_DIR / "_index.json",
        ]:
            try:
                if f.exists():
                    f.unlink()
            except Exception:
                pass

    print(f"\n{'=' * 62}")
    print("  Samsung RAG PDF Ingestion")
    print(f"{'=' * 62}")
    print(f"  PDF folder  : {PDF_DIR}")
    print(f"  Knowledge   : {KNOWLEDGE_DIR}")
    print(f"  Embed model : {EMBED_MODEL}")
    print(f"  Vision model: {VISION_MODEL} (image pages only)")
    print(f"  ChromaDB    : {CHROMA_DIR}")

    if not PDF_DIR.exists():
        print(f"\n  ERROR: PDF folder not found: {PDF_DIR}")
        print("  Create it and drop your Samsung PDFs there.")
        sys.exit(1)

    total_chunks = 0
    processed = 0

    for pdf_stem, product_meta in PDF_PRODUCT_MAP.items():
        if product_filter and product_filter not in (
            pdf_stem,
            product_meta["product_id"],
            product_meta["product_name"],
        ):
            continue

        pdf_path = PDF_DIR / f"{pdf_stem}.pdf"
        if not pdf_path.exists():
            print(f"\n  SKIPPING {pdf_stem}.pdf — file not found in {PDF_DIR}")
            continue

        n = _ingest_product(pdf_path, product_meta, client, collection, reset)
        total_chunks += n
        processed += 1

    _rebuild_all_chunks_json()

    print(f"\n{'=' * 62}")
    print(f"  ✓ DONE — {processed} products ingested, {total_chunks} total chunks")
    print(f"  ChromaDB now has {collection.count()} chunks total")
    print("  Restart your FastAPI server to use the new index.")
    print(f"{'=' * 62}\n")


def cmd_test(query: str) -> None:
    _load_env()
    client = _get_openai_client()
    col = _get_collection()

    if col.count() == 0:
        print("ERROR: ChromaDB is empty. Run: python ingest_pdfs.py")
        sys.exit(1)

    print(f"\nQuery: {query}")
    print("─" * 60)

    q_emb = client.embeddings.create(model=EMBED_MODEL, input=[query]).data[0].embedding

    # Unfiltered search
    results = col.query(
        query_embeddings=[q_emb],
        n_results=5,
        include=["documents", "metadatas", "distances"]
    )

    print("Top 5 results (no product filter):")
    if results and results.get("ids") and results["ids"][0]:
        for i in range(len(results["ids"][0])):
            meta = results["metadatas"][0][i]
            dist = results["distances"][0][i]
            print(f"\n  [{i + 1}] {meta.get('product_id', '?')} | {meta.get('product_name', '?')}")
            print(f"       Page {meta.get('page_num', '?')} | relevance: {round(1 - dist, 3)}")
            print(f"       {results['documents'][0][i][:200].replace(chr(10), ' ')}...")
    else:
        print("  No results found.")

    print("\n" + "─" * 60)

    # Detect product dynamically from the query
    try:
        from backend.rag.service import match_product_from_text
        product_match = match_product_from_text("", query)
    except Exception as e:
        print(f"Could not import product matcher: {e}")
        product_match = {
            "product_id": None,
            "product_name": None,
            "matched_cue": None,
            "confidence": "low",
            "match_type": "none",
        }

    product_id = product_match.get("product_id")
    product_name = product_match.get("product_name")
    matched_cue = product_match.get("matched_cue")
    confidence = product_match.get("confidence")
    match_type = product_match.get("match_type")

    print("Detected product from query:")
    print(f"  product_id  : {product_id}")
    print(f"  product_name: {product_name}")
    print(f"  matched_cue : {matched_cue}")
    print(f"  confidence  : {confidence}")
    print(f"  match_type  : {match_type}")

    if product_id:
        print(f"\nTesting with hard product filter ({product_name}):")
        try:
            r2 = col.query(
                query_embeddings=[q_emb],
                n_results=3,
                include=["documents", "metadatas", "distances"],
                where={"product_id": {"$eq": product_id}}
            )

            if r2 and r2.get("ids") and r2["ids"][0]:
                for i in range(len(r2["ids"][0])):
                    meta = r2["metadatas"][0][i]
                    dist = r2["distances"][0][i]
                    print(
                        f"\n  [{i + 1}] {meta.get('product_name', '?')} "
                        f"| Page {meta.get('page_num', '?')} "
                        f"| relevance: {round(1 - dist, 3)}"
                    )
                    print(f"       {r2['documents'][0][i][:200].replace(chr(10), ' ')}...")
            else:
                print("  No filtered results found for detected product.")
        except Exception as e:
            print(f"  Filter test error: {e}")
    else:
        print("No product detected from query, so no hard filter was applied.")

    print()
# ══════════════════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Ingest Samsung product PDFs into ChromaDB RAG index"
    )
    parser.add_argument("--status", action="store_true", help="Show current index status")
    parser.add_argument("--reset", action="store_true", help="Wipe and fully rebuild index")
    parser.add_argument("--product", type=str, help="Re-ingest one product (by product_id, name, or PDF stem)")
    parser.add_argument("--test", type=str, help="Test a search query")
    args = parser.parse_args()

    if args.status:
        cmd_status()
    elif args.test:
        cmd_test(args.test)
    else:
        cmd_build(reset=args.reset, product_filter=args.product)