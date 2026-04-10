"""
build_embeddings.py
===================
Synchronized version for Consumer Electronics RAG.
Run this to embed pre-existing JSON chunks from data/rag_knowledge/ into ChromaDB.
"""

import argparse, json, os, sys, time, re
from pathlib import Path

# Path discovery
PROJECT_ROOT  = Path(__file__).resolve().parent
if (PROJECT_ROOT / "data").exists():
    DATA_DIR = PROJECT_ROOT / "data"
else:
    DATA_DIR = PROJECT_ROOT.parent / "data"

KNOWLEDGE_DIR = DATA_DIR / "rag_knowledge"
CHROMA_DIR    = DATA_DIR / "chroma_db"
# The aggregate file created by ingest_pdfs.py
CHUNKS_FILE   = KNOWLEDGE_DIR / "_all_chunks.json"

COLLECTION    = "samsung_manuals"
EMBED_MODEL   = "text-embedding-3-small"
ANSWER_MODEL  = "gpt-4o"

def load_env():
    env_file = PROJECT_ROOT / ".env"
    if not env_file.exists():
        env_file = PROJECT_ROOT.parent / ".env"
    
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))

def get_collection():
    import chromadb
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return client.get_or_create_collection(
        name=COLLECTION,
        metadata={"hnsw:space": "cosine"}
    )

def status():
    print("\n" + "="*60)
    print("   RAG Embedding Status")
    print("="*60)
    try:
        col = get_collection()
        chunks = json.loads(CHUNKS_FILE.read_text(encoding="utf-8")) if CHUNKS_FILE.exists() else []
        
        print(f"   Aggregated File (_all_chunks.json): {'✓ FOUND' if CHUNKS_FILE.exists() else '✗ MISSING'}")
        print(f"   Chunks in JSON files     : {len(chunks)}")
        print(f"   Chunks in ChromaDB       : {col.count()}")
        
        if col.count() > 0:
            # Map by product_id to match ingest_pdfs logic
            products = list({c.get('product_name', 'Unknown') for c in chunks})
            print(f"   Products Indexed         : {len(products)}")
            for p in sorted(products):
                print(f"     • {p}")
        print(f"   Status                   : {'✓ READY' if col.count() > 0 else '✗ NEEDS BUILD'}")
    except Exception as e:
        print(f"   Error checking status: {e}")
    print("="*60 + "\n")

def build(reset=False):
    load_env()
    api_key = os.environ.get("OPENAI_API_KEY","")
    if not api_key:
        print("ERROR: OPENAI_API_KEY not found in .env"); sys.exit(1)
    
    if not CHUNKS_FILE.exists():
        print(f"ERROR: {CHUNKS_FILE} not found. Run ingest_pdfs.py first."); sys.exit(1)

    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    col = get_collection()
    chunks = json.loads(CHUNKS_FILE.read_text(encoding="utf-8"))

    print(f"\n{'='*60}")
    print("   Building Samsung RAG Embedding Index")
    print(f"{'='*60}")

    if reset and col.count() > 0:
        print("   Wiping existing collection...", end=" ", flush=True)
        existing = col.get()
        col.delete(ids=existing["ids"])
        print("done")

    # Prevent double indexing
    if not reset and col.count() >= len(chunks) and col.count() > 0:
        print(f"   Index already has {col.count()} chunks. Skipping.")
        print("   Use --reset to force a rebuild.\n")
        return

    texts     = [c["text"] for c in chunks]
    ids       = [c["id"] for c in chunks]
    
    # CRITICAL: Metadata keys must match ingest_pdfs.py exactly
    metadatas = [{
        "product_id": c.get("product_id", "UNKNOWN"),
        "product_name": c.get("product_name", "Unknown"),
        "category": c.get("category", "Unknown"),
        "page_num": c.get("page_num", 0),
        "page_range": c.get("page_range", ""),
        "source_pdf": c.get("source_pdf", "")
    } for c in chunks]

    print(f"   Embedding {len(chunks)} chunks in batches...")
    all_embeddings = []
    BATCH_SIZE = 50
    
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i:i+BATCH_SIZE]
        print(f"   Batch {i//BATCH_SIZE + 1}/{(len(texts)+BATCH_SIZE-1)//BATCH_SIZE}...", end=" ", flush=True)
        resp = client.embeddings.create(model=EMBED_MODEL, input=batch)
        all_embeddings.extend([r.embedding for r in resp.data])
        print("done")

    print("   Storing in ChromaDB...", end=" ", flush=True)
    col.add(ids=ids, documents=texts, embeddings=all_embeddings, metadatas=metadatas)
    print("done")

    print(f"\n   ✓ SUCCESS: {col.count()} chunks are now searchable.")
    print(f"   Restart your FastAPI server to apply changes.")
    print("="*60 + "\n")

def test_query(query):
    load_env()
    from openai import OpenAI
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    col = get_collection()

    print(f"\n   TEST QUERY: {query}")
    print("   " + "-"*55)

    # 1. Embed query
    q_emb = client.embeddings.create(model=EMBED_MODEL, input=[query]).data[0].embedding

    # 2. Search
    results = col.query(
        query_embeddings=[q_emb],
        n_results=3,
        include=["documents", "metadatas", "distances"]
    )

    # 3. Display
    if not results or not results["ids"][0]:
        print("   No matches found.")
        return

    for i in range(len(results["ids"][0])):
        m = results["metadatas"][0][i]
        d = results["distances"][0][i]
        print(f"   [{i+1}] {m.get('product_name')} (ID: {m.get('product_id')})")
        print(f"       Relevance: {round(1-d, 3)} | Page: {m.get('page_num')}")
        print(f"       Snippet: {results['documents'][0][i][:100]}...")
    print()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="Wipe and rebuild")
    parser.add_argument("--status", action="store_true", help="Check index")
    parser.add_argument("--test", type=str, help="Test a search query")
    args = parser.parse_args()

    if args.status:
        status()
    elif args.test:
        test_query(args.test)
    else:
        build(reset=args.reset)