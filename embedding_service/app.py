from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from encoder import FaissIndexer
import os

app = FastAPI(title='Embedding & Faiss Service')

# keep a singleton indexer
INDEX_PATH = os.environ.get('FAISS_INDEX_PATH', 'embedding_service/faiss_index.bin')
META_PATH = os.environ.get('FAISS_META_PATH', 'embedding_service/faiss_meta.json')
MODEL_NAME = os.environ.get('EMBED_MODEL', 'all-MiniLM-L6-v2')

indexer = FaissIndexer(model_name=MODEL_NAME, index_path=INDEX_PATH, meta_path=META_PATH)
indexer.load()


class ChunkItem(BaseModel):
    id: str
    text: str


class EncodeRequest(BaseModel):
    chunks: List[ChunkItem]


class QueryRequest(BaseModel):
    query: str
    k: Optional[int] = 5


@app.post('/encode')
async def encode(req: EncodeRequest):
    if not req.chunks:
        raise HTTPException(status_code=400, detail='no chunks')
    ids = [c.id for c in req.chunks]
    texts = [c.text for c in req.chunks]
    indexer.build_index(ids, texts)
    return {'ok': True, 'count': len(ids)}


@app.post('/query')
async def query(req: QueryRequest):
    if indexer.index is None:
        raise HTTPException(status_code=500, detail='index not built')
    res = indexer.query(req.query, k=req.k or 5)
    return {'ok': True, 'results': res}


@app.get('/status')
async def status():
    return {'ok': True, 'index_built': indexer.index is not None, 'count': len(indexer.meta)}
