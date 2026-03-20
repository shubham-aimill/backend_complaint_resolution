"""
build_embeddings.py
===================
Run this ONCE to embed all Samsung manual chunks into ChromaDB.

After this:
  - 48 chunks permanently stored in data/chroma_db/
  - Every FAQ = only 1 embedding call (the question only)
  - Chunks NEVER re-embedded again

Usage:
    python build_embeddings.py            # build
    python build_embeddings.py --reset    # wipe and rebuild
    python build_embeddings.py --status   # check status
    python build_embeddings.py --test "how to fix wifi on S26 Ultra"
"""

import argparse, json, os, sys, time
from pathlib import Path

PROJECT_ROOT  = Path(__file__).parent
DATA_DIR      = PROJECT_ROOT / "data"
KNOWLEDGE_DIR = DATA_DIR / "rag_knowledge"
CHROMA_DIR    = DATA_DIR / "chroma_db"
CHUNKS_FILE   = KNOWLEDGE_DIR / "_all_chunks.json"
COLLECTION    = "samsung_manuals"
EMBED_MODEL   = "text-embedding-3-small"
ANSWER_MODEL  = "gpt-4o"


def load_env():
    env_file = PROJECT_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def get_collection():
    import chromadb
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return client.get_or_create_collection(
        name=COLLECTION,
        metadata={"hnsw:space": "cosine"}
    )


def status():
    print("\n" + "="*55)
    print("  ChromaDB Embedding Status")
    print("="*55)
    try:
        import chromadb
        col    = get_collection()
        chunks = json.loads(CHUNKS_FILE.read_text()) if CHUNKS_FILE.exists() else []
        print(f"  Chunks in files    : {len(chunks)}")
        print(f"  Chunks in ChromaDB : {col.count()}")
        print(f"  Status             : {'✓ READY' if col.count() > 0 else '✗ NOT BUILT'}")
        if col.count() > 0:
            products = list({c['product'] for c in chunks})
            print(f"  Products indexed   : {len(products)}")
            for p in sorted(products):
                print(f"    • {p}")
    except ImportError:
        print("  chromadb not installed — run: pip install chromadb")
    print()


def build(reset=False):
    load_env()
    api_key = os.environ.get("OPENAI_API_KEY","")
    if not api_key or "your-" in api_key:
        print("ERROR: set OPENAI_API_KEY in .env"); sys.exit(1)
    if not CHUNKS_FILE.exists():
        print(f"ERROR: {CHUNKS_FILE} not found"); sys.exit(1)

    try:
        import chromadb
    except ImportError:
        print("ERROR: run: pip install chromadb"); sys.exit(1)

    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    col    = get_collection()
    chunks = json.loads(CHUNKS_FILE.read_text())

    print(f"\n{'='*55}")
    print("  Building Samsung RAG Embedding Index")
    print(f"{'='*55}")
    print(f"  Chunks to embed : {len(chunks)}")
    print(f"  Model           : {EMBED_MODEL}")
    print(f"  Est. cost       : ~${len(chunks)*100*0.00002/1000:.5f}")
    print(f"  Storage         : {CHROMA_DIR}\n")

    if reset and col.count() > 0:
        existing = col.get()
        col.delete(ids=existing["ids"])
        print(f"  Cleared {len(existing['ids'])} old entries")

    if not reset and col.count() >= len(chunks):
        print(f"  Already indexed {col.count()} chunks — nothing to do")
        print("  Use --reset to rebuild\n"); return

    texts     = [c["text"]     for c in chunks]
    ids       = [c["id"]       for c in chunks]
    metadatas = [{"product": c["product"], "category": c["category"],
                  "page_num": c["page_num"]} for c in chunks]

    print(f"  Embedding {len(chunks)} chunks...")
    t0 = time.time()
    all_embeddings = []
    BATCH = 50
    for i in range(0, len(texts), BATCH):
        batch = texts[i:i+BATCH]
        print(f"  Batch {i//BATCH+1}/{(len(texts)+BATCH-1)//BATCH} ({len(batch)} chunks)...", end=" ", flush=True)
        resp = client.embeddings.create(model=EMBED_MODEL, input=batch)
        all_embeddings.extend([r.embedding for r in resp.data])
        print("done")

    print("\n  Storing in ChromaDB...", end=" ", flush=True)
    col.add(ids=ids, documents=texts, embeddings=all_embeddings, metadatas=metadatas)
    print("done")

    print(f"\n{'='*55}")
    print(f"  ✓ DONE in {time.time()-t0:.1f}s")
    print(f"  Chunks stored : {col.count()}")
    print(f"  Vector dims   : {len(all_embeddings[0])}")
    print(f"\n  RAG is LIVE — restart your server")
    print(f"{'='*55}\n")


def test_query(query):
    load_env()
    api_key = os.environ.get("OPENAI_API_KEY","")
    if not api_key or "your-" in api_key:
        print("ERROR: set OPENAI_API_KEY in .env"); sys.exit(1)
    try:
        import chromadb
    except ImportError:
        print("ERROR: run: pip install chromadb"); sys.exit(1)

    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    col    = get_collection()

    if col.count() == 0:
        print("ERROR: index not built — run: python build_embeddings.py"); sys.exit(1)

    print(f"\nQuery: {query}")
    print("-"*55)

    # Embed query
    q_emb = client.embeddings.create(model=EMBED_MODEL, input=[query]).data[0].embedding

    # Search
    results = col.query(
        query_embeddings=[q_emb],
        n_results=3,
        include=["documents","metadatas","distances"]
    )

    print("Top 3 matching chunks:")
    context_parts = []
    for i, doc_id in enumerate(results["ids"][0]):
        meta     = results["metadatas"][0][i]
        dist     = results["distances"][0][i]
        relevance = round(1 - dist, 3)
        text_preview = results["documents"][0][i][:150].replace("\n"," ")
        print(f"\n  [{i+1}] {meta['product']} — Page {meta['page_num']} (relevance: {relevance})")
        print(f"       {text_preview}...")
        context_parts.append(
            f"[{meta['product']} Manual — Page {meta['page_num']}]\n{results['documents'][0][i]}"
        )

    # Generate answer
    print("\n" + "-"*55)
    print("Generating answer from manual content...\n")
    context = "\n\n---\n\n".join(context_parts)
    resp = client.chat.completions.create(
        model=ANSWER_MODEL,
        messages=[
            {"role":"system","content":"You are a Samsung support specialist. Answer using ONLY the manual excerpts provided. Be step-by-step and reference the product name."},
            {"role":"user","content":f"Question: {query}\n\nManual content:\n{context}\n\nAnswer:"}
        ],
        max_tokens=500, temperature=0.2,
    )
    print("Answer:")
    print(resp.choices[0].message.content)
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset",  action="store_true", help="Wipe and rebuild index")
    parser.add_argument("--status", action="store_true", help="Show current status")
    parser.add_argument("--test",   type=str,            help="Test a query")
    args = parser.parse_args()

    if args.status:
        status()
    elif args.test:
        test_query(args.test)
    else:
        build(reset=args.reset)
