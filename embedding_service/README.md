# Embedding service (self-hosted) using sentence-transformers + Faiss

This small FastAPI service encodes text chunks using `sentence-transformers` and stores them in a Faiss index for semantic retrieval.

Quick start (Windows PowerShell):

```powershell
cd embedding_service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# start the service (default port 8001)
uvicorn app:app --host 0.0.0.0 --port 8001
```

Endpoints:
- `POST /encode`  - body: `{ "chunks": [{ "id": "chunk-id", "text": "..." }, ...] }` -> builds/saves Faiss index
- `POST /query`   - body: `{ "query": "text", "k": 5 }` -> returns top-k chunks with scores
- `GET /status`   - check whether index exists

Notes:
- Uses the `all-MiniLM-L6-v2` model by default (fast and small). You can set `EMBED_MODEL` env var to another sentence-transformers model.
- Faiss index is saved to `faiss_index.bin` and metadata to `faiss_meta.json` in the embedding_service folder by default.
