import { NextResponse } from 'next/server';
import { splitIntoSentences } from '../../../lib/extractors';

export const runtime = 'nodejs';

// Simple token-based semantic similarity (server-side lightweight fallback)
export function normalizeText(s: string) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(s: string) {
  const stop = new Set(['the','is','in','and','of','a','to','for','with','on','by','an','be','that','this','it','as','are']);
  return normalizeText(s).split(' ').filter(Boolean).filter((t) => !stop.has(t));
}
function jaccard(a: string[], b: string[]) {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter(x => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni === 0 ? 0 : inter / uni;
}
function cosineSim(a: string[], b: string[]) {
  const fa: any = {}; const fb: any = {};
  a.forEach((w: string) => fa[w] = (fa[w] || 0) + 1);
  b.forEach((w: string) => fb[w] = (fb[w] || 0) + 1);
  const all = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  let dot = 0; let na = 0; let nb = 0;
  all.forEach((w: any) => { const va = fa[w] || 0; const vb = fb[w] || 0; dot += va * vb; na += va * va; nb += vb * vb; });
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
export function semanticSimilarity(a: string, b: string) {
  const ta = tokens(a || ''); const tb = tokens(b || ''); if (ta.length === 0 || tb.length === 0) return 0;
  const j = jaccard(ta, tb); const c = cosineSim(ta, tb); return Math.max(j, c);
}

function makeId(prefix = 'c') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function extractCandidatePhrases(text: string, answer: string) {
  const out: string[] = [];
  if (!text) return out;
  // quoted phrases
  const quotes = Array.from(text.matchAll(/"([^"]{3,})"|'([^']{3,})'/g)).map(m => m[1] || m[2]).filter(Boolean);
  out.push(...quotes);

  // capitalized sequences (proper nouns)
  const pn = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g) || [];
  out.push(...pn.map(s => s.trim()));

  // comma-separated noun-ish chunks
  text.split(/[\.;\n]/).forEach(line => {
    line.split(',').forEach(part => {
      const t = part.trim();
      if (t.length > 3 && t.split(' ').length < 7 && !t.toLowerCase().includes(answer.toLowerCase())) out.push(t);
    });
  });

  // fallback: extract long words/phrases
  const words = text.split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean);
  for (let i = 0; i < Math.max(0, Math.min(8, words.length - 1)); i++) {
    const p = words.slice(i, i + 2).join(' ');
    if (p.length > 3 && !p.toLowerCase().includes(answer.toLowerCase())) out.push(p);
  }

  // dedupe and return
  return Array.from(new Set(out)).filter(Boolean).slice(0, 50);
}
function pickAnswerPhrase(sentence: string) {
  // try quoted phrase
  const quoteMatch = sentence.match(/"([^\"]{3,})"|'([^']{3,})'/);
  if (quoteMatch) return quoteMatch[1] || quoteMatch[2];

  // proper noun sequences (Capitalized words)
  const pn = sentence.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g);
  if (pn && pn.length) {
    // pick the longest
    return pn.reduce((a, b) => (a.length > b.length ? a : b));
  }

  // fallback: longest word >4 chars
  const words = sentence.split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9]/g, ''));
  const candidates = words.filter(w => w.length > 4);
  if (candidates.length) {
    return candidates.reduce((a, b) => (a.length > b.length ? a : b));
  }

  // last resort: first 3-char word
  return words.find(w => w.length >= 3) || '';
}

function blankOut(sentence: string, phrase: string) {
  if (!phrase) return sentence;
  const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return sentence.replace(re, '______');
}

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export { tokens, jaccard, cosineSim, makeId, pickAnswerPhrase, blankOut, shuffle };

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { query, chunks, k = 5, question_count = 3, min_sim, max_sim } = body || {};

    let texts: string[] = [];

    if (Array.isArray(chunks) && chunks.length > 0) {
      texts = chunks.map((c: any) => String(c.text || '')).filter(Boolean);
    } else {
      // try embedding service
      const embeddingUrl = process.env.EMBEDDING_SERVICE_URL || null;
      if (!embeddingUrl) return NextResponse.json({ error: 'no chunks provided and EMBEDDING_SERVICE_URL not configured' }, { status: 400 });
      const r = await fetch(`${embeddingUrl.replace(/\/+$/,'')}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query || '', k }),
      });
      const jr = await r.json();
      texts = (jr && jr.results) ? (jr.results.map((x: any) => String(x.text || ''))) : [];
    }

    // build sentence pool
    const sentences: string[] = [];
    texts.forEach(t => {
      const s = splitIntoSentences(String(t || ''));
      s.forEach((ss: string) => { if (ss && ss.length > 20) sentences.push(ss); });
    });

    if (sentences.length === 0) return NextResponse.json({ error: 'no usable sentences extracted' }, { status: 400 });

    // build candidate answer phrases pool
    const phrasePool = new Set<string>();
    sentences.forEach(s => {
      const p = pickAnswerPhrase(s);
      if (p && p.length > 1) phrasePool.add(p);
    });
    const phrases = Array.from(phrasePool).filter(Boolean);

    const questions: any[] = [];
    let attempts = 0;
    while (questions.length < question_count && attempts < question_count * 6) {
      attempts++;
      const sent = sentences[Math.floor(Math.random() * sentences.length)];
      const answer = pickAnswerPhrase(sent);
      if (!answer || answer.length < 2) continue;
      // build distractors: prefer semantically-similar candidates from embedding service if available
      let distractors: string[] = [];
      const embeddingUrl = process.env.EMBEDDING_SERVICE_URL || null;
      // allow the client to override distractor similarity thresholds for preview/tuning
      const MIN_SIM = Number(typeof min_sim !== 'undefined' ? min_sim : (process.env.DISTRACTOR_MIN_SIM || 0.12));
      const MAX_SIM = Number(typeof max_sim !== 'undefined' ? max_sim : (process.env.DISTRACTOR_MAX_SIM || 0.75));

      // helper to filter by token-based similarity thresholds
      const pickFiltered = (cands: string[]) => {
        const scored = cands.map(p => ({ p, s: semanticSimilarity(answer, p) }));
        // prefer candidates within [MIN_SIM, MAX_SIM]
        const inRange = scored.filter(x => x.s >= MIN_SIM && x.s <= MAX_SIM).sort((a, b) => b.s - a.s).map(x => x.p);
        if (inRange.length >= 3) return inRange.slice(0, 3);
        // if not enough, include slightly lower ones
        const relaxed = scored.filter(x => x.s >= (MIN_SIM * 0.6)).sort((a, b) => b.s - a.s).map(x => x.p);
        const uniq = Array.from(new Set([...inRange, ...relaxed]));
        return uniq.slice(0, 3);
      };

      if (embeddingUrl) {
        try {
          const qr = await fetch(`${embeddingUrl.replace(/\/+$/,'')}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: answer, k: 12 }),
          });
          const qj = await qr.json();
          const candTexts: string[] = (qj && qj.results) ? qj.results.map((r: any) => String(r.text || '')) : [];
          // extract candidate phrases from those chunks
          const candPhrases: string[] = [];
          candTexts.forEach(ct => {
            splitIntoSentences(ct).forEach(ss => {
              const ph = pickAnswerPhrase(ss);
              if (ph && ph.toLowerCase() !== answer.toLowerCase()) candPhrases.push(ph);
            });
          });
          // dedupe and length filter
          const uniq = Array.from(new Set(candPhrases)).filter(p => Math.abs(p.length - answer.length) < Math.max(12, answer.length + 6));
          shuffle(uniq);
          distractors = pickFiltered(uniq);
        } catch (e) {
          distractors = [];
        }
      }
      // fallback to sampling document phrases
      if (distractors.length < 3) {
        const others = phrases.filter(p => p.toLowerCase() !== answer.toLowerCase() && Math.abs(p.length - answer.length) < Math.max(6, answer.length));
        shuffle(others);
        distractors = distractors.concat(pickFiltered(others));
      }
      // final fallback filler
      while (distractors.length < 3) distractors.push('An unrelated statement');
      const rawChoices = shuffle([answer, ...distractors]);
      const choices = rawChoices.map(c => ({ choice_id: makeId('ch'), text: c }));
      const correct_choice_ids = choices.filter(c => String(c.text) === String(answer)).map(c => c.choice_id);
      questions.push({
        question_id: `q_${Date.now()}_${questions.length}`,
        type: 'single',
        prompt: blankOut(sent, answer),
        choices,
        correct_choice_ids,
        correct_written_answers: [],
        explanation: sent,
        points: 1,
        difficulty: 'medium',
        topics: [query || 'Document']
      });
    }

    return NextResponse.json({ ok: true, questions, sentences_sample: sentences.slice(0,5) }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
