const pdfParse: any = require('pdf-parse');
import mammoth from 'mammoth';

export async function extractPdfFromBuffer(buffer: ArrayBuffer | Buffer) {
  try {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const data = await pdfParse(buf as Buffer);
    // pdf-parse returns `text` which concatenates pages; we can split by form feed if present
    const pages = (data.text || '').split('\f').filter(Boolean).map((p: string) => p.trim());
    return { text: data.text || '', pages, numPages: data.numpages || pages.length };
  } catch (e) {
    return { text: '', pages: [], numPages: 0, error: String(e) };
  }
}

export async function extractDocxFromBuffer(buffer: ArrayBuffer | Buffer) {
  try {
    const arrayBuffer = Buffer.isBuffer(buffer) ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer;
    const res = await mammoth.extractRawText({ arrayBuffer });
    const text = res && (res as any).value ? String((res as any).value) : '';
    // naive split by newlines into pages/chunks
    const pages = text.split('\n\n').filter(Boolean).map(p => p.trim());
    return { text, pages, numPages: pages.length };
  } catch (e) {
    return { text: '', pages: [], numPages: 0, error: String(e) };
  }
}

export async function extractTextGeneric(name: string, buffer: ArrayBuffer | Buffer, mime?: string) {
  const lower = (name || '').toLowerCase();
  if (mime && mime.includes('pdf') || lower.endsWith('.pdf')) {
    return await extractPdfFromBuffer(buffer);
  }
  if (mime && (mime.includes('word') || mime.includes('officedocument')) || lower.endsWith('.docx')) {
    return await extractDocxFromBuffer(buffer);
  }
  // treat as plain text
  try {
    const txt = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
    const pages = txt.split('\n\n').filter(Boolean).map(p => p.trim());
    return { text: txt, pages, numPages: pages.length };
  } catch (e) {
    return { text: '', pages: [], numPages: 0, error: String(e) };
  }
}

// Simple chunking: split into chunks of ~3000 chars with 500 char overlap
// Normalize text: fix line breaks, remove hyphenation, collapse whitespace
export function normalizeTextForExtraction(text: string) {
  if (!text) return '';
  let t = String(text || '');
  // unify line endings
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // remove common hyphenation at line breaks (e.g., hy-\nation -> hyation)
  t = t.replace(/-\n\s*/g, '');
  // convert remaining line breaks to spaces (preserve paragraphs)
  t = t.replace(/\n{2,}/g, '\n\n').replace(/\n/g, ' ');
  // collapse multiple spaces
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// Remove repeated headers/footers heuristically by checking first/last lines across pages
export function removeHeadersFootersFromPages(pages: string[]) {
  if (!pages || pages.length <= 1) return pages;
  const firstLines = pages.map(p => (p || '').split('\n').map(l => l.trim()).filter(Boolean)[0] || '');
  const lastLines = pages.map(p => (p || '').split('\n').map(l => l.trim()).filter(Boolean).slice(-1)[0] || '');
  const freq: Record<string, number> = {};
  [...firstLines, ...lastLines].forEach(l => { if (l) freq[l] = (freq[l] || 0) + 1; });
  const repeats = new Set(Object.entries(freq).filter(([, c]) => c > 1).map(([k]) => k));
  return pages.map(p => {
    if (!p) return p;
    const lines = p.split('\n').map(l => l.trim());
    const filtered = lines.filter(l => !repeats.has(l));
    return filtered.join('\n');
  });
}

// Sentence splitter (naive): split on punctuation followed by space
export function splitIntoSentences(text: string) {
  if (!text) return [];
  // Match sentences including trailing punctuation
  const re = /[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g;
  const matches = text.match(re) || [];
  return matches.map(s => s.trim()).filter(Boolean);
}

// Semantic chunking: group sentences into chunks up to ~chunkChars with overlap
export function chunkIntoSemanticChunks(text: string, chunkChars = 3000, overlapChars = 500) {
  const normalized = normalizeTextForExtraction(text || '');
  if (!normalized) return [];
  const sentences = splitIntoSentences(normalized);
  const chunks: { id: string; text: string; startSentence: number; endSentence: number; startChar: number; endChar: number }[] = [];
  let idx = 0;
  let charPos = 0;
  while (idx < sentences.length) {
    let len = 0;
    let startIdx = idx;
    const startChar = charPos;
    const parts: string[] = [];
    while (idx < sentences.length && (len < chunkChars || parts.length === 0)) {
      const s = sentences[idx];
      parts.push(s);
      len += s.length + 1;
      idx++;
    }
    const chunkText = parts.join(' ');
    const endChar = startChar + chunkText.length;
    chunks.push({ id: `${startChar}-${endChar}`, text: chunkText, startSentence: startIdx, endSentence: idx - 1, startChar, endChar });
    // backtrack overlap
    if (idx < sentences.length) {
      // move idx back to include overlapChars worth of characters
      let back = 0;
      let j = idx - 1;
      while (j > startIdx && back < overlapChars) {
        back += sentences[j].length + 1;
        j--;
      }
      const newIdx = Math.max(startIdx, j + 1);
      // recalc charPos for newIdx
      charPos = chunks[chunks.length - 1].startChar + Math.max(0, chunkText.length - overlapChars);
      idx = newIdx;
    } else {
      idx = sentences.length;
      charPos = endChar;
    }
  }
  return chunks;
}

export { chunkIntoSemanticChunks as chunkText };

export default {
  extractPdfFromBuffer,
  extractDocxFromBuffer,
  extractTextGeneric,
  chunkText: chunkIntoSemanticChunks,
};
