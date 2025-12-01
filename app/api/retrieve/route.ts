import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { query, k } = body || {};
    if (!query) return NextResponse.json({ error: 'missing query' }, { status: 400 });

    const embeddingUrl = process.env.EMBEDDING_SERVICE_URL || null;
    if (!embeddingUrl) return NextResponse.json({ error: 'embedding service not configured' }, { status: 500 });

    const r = await fetch(`${embeddingUrl.replace(/\/+$/,'')}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, k: k || 5 }),
    });
    const jr = await r.json();
    return NextResponse.json({ ok: true, results: jr.results || jr }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
