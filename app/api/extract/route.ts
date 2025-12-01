import { NextResponse } from 'next/server';
import { extractTextGeneric, chunkText, removeHeadersFootersFromPages } from '../../../lib/extractors';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = form.getAll('file') as File[];
    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'no file uploaded' }, { status: 400 });
    }

    const results: any[] = [];
    for (const f of files) {
      const arrayBuffer = await f.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      const r = await extractTextGeneric(f.name, buf, f.type);
      // run header/footer removal on pages if present
      const pages = (r && r.pages && Array.isArray(r.pages)) ? removeHeadersFootersFromPages(r.pages) : [];
      const textForChunking = pages.length > 0 ? pages.join('\n\n') : (r.text || '');
      const chunks = chunkText(textForChunking);
      results.push({ name: f.name, type: f.type, size: buf.length, extracted: r, pages, chunks });
    }

    // Combine extracted text for convenience
    const combined = results.map(r => (r.extracted && r.extracted.text) ? r.extracted.text : '').join('\n\n');
    const combinedChunks = chunkText(combined);

    // Optionally forward chunks to a local embedding service for indexing (self-hosted Faiss service).
    const embeddingUrl = process.env.EMBEDDING_SERVICE_URL || null;
    let embedResp: any = null;
    try {
      if (embeddingUrl) {
        const payload = { chunks: combinedChunks.map((c: any) => ({ id: c.id, text: c.text })) };
        const r = await fetch(`${embeddingUrl.replace(/\/+$/,'')}/encode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        embedResp = await r.json();
      }
    } catch (e) {
      // ignore embedding failures but include error for debugging
      embedResp = { error: String(e) };
    }

    return NextResponse.json({ ok: true, files: results, combinedText: combined, combinedChunks, embedding: embedResp }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
