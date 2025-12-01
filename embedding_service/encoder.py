from sentence_transformers import SentenceTransformer
import numpy as np
import faiss
import os
import json

class FaissIndexer:
    def __init__(self, model_name: str = 'all-MiniLM-L6-v2', index_path: str = 'faiss_index.bin', meta_path: str = 'faiss_meta.json'):
        self.model = SentenceTransformer(model_name)
        self.index = None
        self.index_path = index_path
        self.meta_path = meta_path
        self.meta = []

    def encode_texts(self, texts):
        # returns numpy array of shape (n, dim)
        embs = self.model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
        # normalize for cosine via inner product
        norms = np.linalg.norm(embs, axis=1, keepdims=True)
        norms[norms == 0] = 1e-9
        embs = embs / norms
        return embs.astype('float32')

    def build_index(self, ids, texts):
        embs = self.encode_texts(texts)
        dim = embs.shape[1]
        index = faiss.IndexFlatIP(dim)
        index.add(embs)
        self.index = index
        self.meta = [{'id': ids[i], 'text': texts[i]} for i in range(len(ids))]
        self.save()

    def save(self):
        if self.index is not None:
            faiss.write_index(self.index, self.index_path)
        with open(self.meta_path, 'w', encoding='utf-8') as f:
            json.dump(self.meta, f, ensure_ascii=False, indent=2)

    def load(self):
        if os.path.exists(self.index_path) and os.path.exists(self.meta_path):
            self.index = faiss.read_index(self.index_path)
            with open(self.meta_path, 'r', encoding='utf-8') as f:
                self.meta = json.load(f)
            return True
        return False

    def query(self, text, k=5):
        if self.index is None:
            raise RuntimeError('Index not loaded')
        qemb = self.encode_texts([text])
        D, I = self.index.search(qemb, k)
        results = []
        for score, idx in zip(D[0], I[0]):
            if idx < 0 or idx >= len(self.meta):
                continue
            m = self.meta[idx]
            results.append({'id': m.get('id'), 'text': m.get('text'), 'score': float(score)})
        return results


if __name__ == '__main__':
    # quick local test
    idx = FaissIndexer()
    docs = ['This is a sentence about AI.', 'This is a note about biology.', 'Another sentence about AI and ML.']
    ids = ['d1','d2','d3']
    idx.build_index(ids, docs)
    print(idx.query('machine learning', k=2))
