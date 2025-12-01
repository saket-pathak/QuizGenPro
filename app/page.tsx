"use client";
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
// ... rest of imports
import {
  Upload, FileText, Play, CheckCircle, BarChart2,
  ChevronRight, ChevronLeft, Clock,
  Loader2, BookOpen
} from 'lucide-react';
import {
  ResponsiveContainer, Tooltip as RechartsTooltip, PieChart, Pie, Cell, Legend
} from 'recharts';

// --- TYPES ---
type Question = {
  question_id: string;
  type: "single" | "multiple" | "written" | "match";
  prompt: string;
  choices: { choice_id: string; text: string }[];
  match_pairs: { left: string; right: string }[];
  correct_choice_ids: string[];
  correct_written_answers: string[];
  points: number;
  difficulty: "easy" | "medium" | "hard";
  explanation: string;
  topics: string[];
};

type Quiz = {
  quiz_id: string;
  document_id: string;
  title: string;
  description: string;
  question_count: number;
  total_points: number;
  questions: Question[];
  metadata: { generated_by: string; generated_at: string };
};

type AttemptResult = {
  attempt_id: string;
  quiz_id: string;
  user_id?: string; // <-- ADDED so `user_id` in result objects is allowed
  score: number;
  total_points: number;
  per_question: any[];
  passed?: boolean;
  meta?: { passing_score: number; time_limit_seconds: number | null };
  insights: {
    topics_covered: { topic: string; correct_count: number; total: number }[];
    time_per_question_avg_seconds: number;
  };
  finished_at: string;
};

// --- MOCK DATA GENERATORS (SIMULATING AI & DB) ---
const generateMockQuiz = (docMetadata: any, settings: any = { question_count: 5, difficulty: 'mixed', types: ['single','multiple','written','match'] }): Quiz => {
  // If uploaded metadata contains text or files, prefer generating questions from that.
  const desired = settings.question_count || 5;
  const preferredTypes = settings.types || ['single','multiple','written','match'];

  const questions: Question[] = [];

  // Helper: simple unique id
  const uid = () => (crypto as any).randomUUID();

  // If there's extracted text, split into sentences and use them as prompts
  const text = (docMetadata && docMetadata.text_extracted) ? String(docMetadata.text_extracted) : '';
  if (text && text.trim().length > 20) {
    const sentences = text.split(/(?<=[\.\?\!])\s+/).filter((s: string) => s.trim().length > 20);
    for (let i = 0; i < desired && i < Math.max(1, sentences.length); i++) {
      const base = sentences[i % sentences.length].replace(/\s+/g, ' ').trim();
      // create a simple single-choice question referencing the sentence
      if (preferredTypes.includes('single')) {
        questions.push({
          question_id: uid(),
          type: 'single',
          prompt: `According to the document: ${base}`,
          choices: [
            { choice_id: uid(), text: base.slice(0, 60) },
            { choice_id: uid(), text: 'An unrelated statement' },
            { choice_id: uid(), text: 'Another distractor' }
          ],
          match_pairs: [],
          correct_choice_ids: [],
          correct_written_answers: [],
          points: 1,
          difficulty: 'medium',
          explanation: base,
          topics: [(docMetadata.files && docMetadata.files[0] && docMetadata.files[0].name) || 'Uploaded Document']
        });
      }
    }
  }

  // If there are uploaded files but no extracted text, generate file-based prompts
  if (questions.length < desired && docMetadata && Array.isArray(docMetadata.files) && docMetadata.files.length > 0) {
    const files = docMetadata.files;
    for (let i = 0; i < desired && i < files.length; i++) {
      const f = files[i % files.length];
      const title = f.name || `File ${i + 1}`;
      if (preferredTypes.includes('written') && questions.length < desired) {
        questions.push({
          question_id: uid(),
          type: 'written',
          prompt: `Summarize the main point from ${title} in one sentence.`,
          choices: [],
          match_pairs: [],
          correct_choice_ids: [],
          correct_written_answers: [],
          points: 2,
          difficulty: 'medium',
          explanation: `Expected a short summary of ${title}`,
          topics: [title]
        });
      }
      if (preferredTypes.includes('match') && questions.length < desired) {
        questions.push({
          question_id: uid(),
          type: 'match',
          prompt: `Match the items mentioned in ${title}.`,
          choices: [],
          match_pairs: [
            { left: 'Item A', right: 'Answer 1' },
            { left: 'Item B', right: 'Answer 2' }
          ],
          correct_choice_ids: [],
          correct_written_answers: [],
          points: 2,
          difficulty: 'hard',
          explanation: `Matches derived from ${title}`,
          topics: [title]
        });
      }
    }
  }

  // Fallback: if we still have too few questions, fill with small generated items
  const fallbackPool: Question[] = [
    {
      question_id: uid(), type: 'single', prompt: 'Which option is most relevant?',
      choices: [{ choice_id: uid(), text: 'Option A' }, { choice_id: uid(), text: 'Option B' }], match_pairs: [], correct_choice_ids: [], correct_written_answers: [], points: 1, difficulty: 'easy', explanation: '', topics: ['General']
    },
    {
      question_id: uid(), type: 'written', prompt: 'In one sentence, explain a key concept from the material.',
      choices: [], match_pairs: [], correct_choice_ids: [], correct_written_answers: [], points: 2, difficulty: 'medium', explanation: '', topics: ['General']
    }
  ];

  let idx = 0;
  while (questions.length < desired) {
    const f = fallbackPool[idx % fallbackPool.length];
    if ((settings.types || ['single','multiple','written','match']).includes(f.type)) {
      questions.push({ ...f, question_id: uid() });
    }
    idx++;
  }

  const finalQuestions = questions.slice(0, desired);
  const total_points = finalQuestions.reduce((acc, q) => acc + (q.points || 0), 0);

  return {
    quiz_id: uid(),
    document_id: docMetadata.document_id,
    title: `Quiz: ${docMetadata.filename || (docMetadata.files ? `${docMetadata.files.length} files` : 'Uploaded')}`,
    description: 'Generated assessment based on uploaded documentation.',
    question_count: desired,
    total_points,
    questions: finalQuestions,
    metadata: { generated_by: 'AI_Model_v1', generated_at: new Date().toISOString() }
  };
};

// --- COMPONENTS ---

// 1. Upload Page
// Helper: extract text from a PDF File using pdf.js (dynamic import). Returns '' on failure.
async function extractPdfText(file: File): Promise<string> {
  try {
    const pdfjs: any = await import('pdfjs-dist/build/pdf');
    // Use CDN worker as fallback so consumers don't need to configure worker build right away
    if (pdfjs && pdfjs.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.9.179/pdf.worker.min.js';
    }
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      // eslint-disable-next-line no-await-in-loop
      const page = await pdf.getPage(p);
      // eslint-disable-next-line no-await-in-loop
      const content = await page.getTextContent();
      const pageText = content.items.map((i: any) => (i.str || '')).join(' ');
      text += pageText + '\n\n';
    }
    return text;
  } catch (err) {
    // extraction failed — return empty string so fallback metadata will be used
    return '';
  }
}

// Helper: extract text from a DOCX file using `mammoth` (dynamic import). Returns '' on failure.
async function extractDocxText(file: File): Promise<string> {
  try {
    const mammoth: any = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result && result.value ? String(result.value) : '';
  } catch (e) {
    return '';
  }
}

// Simple semantic similarity helpers (lightweight): normalize, jaccard and cosine on token sets
function normalizeText(s: string) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const fa: any = {};
  const fb: any = {};
  a.forEach((w: string) => fa[w] = (fa[w] || 0) + 1);
  b.forEach((w: string) => fb[w] = (fb[w] || 0) + 1);
  const all = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  let dot = 0; let na = 0; let nb = 0;
  all.forEach((w: any) => {
    const va = fa[w] || 0; const vb = fb[w] || 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  });
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function semanticSimilarity(a: string, b: string) {
  const ta = tokens(a || '');
  const tb = tokens(b || '');
  if (ta.length === 0 || tb.length === 0) return 0;
  const j = jaccard(ta, tb);
  const c = cosineSim(ta, tb);
  return Math.max(j, c);
}

// Decide match/score: returns score between 0..1
function semanticMatchScore(response: string, expectedArr: string[]) {
  if (!response || !response.trim()) return 0;
  if (!expectedArr || expectedArr.length === 0) return 0;
  // token-based similarity
  const tokenScores = expectedArr.map(e => semanticSimilarity(response, e));

  // bigram overlap as additional signal
  const bigrams = (s: string) => {
    const t = normalizeText(s || '');
    const parts = t.split(' ').filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i < parts.length - 1; i++) out.push(parts[i] + ' ' + parts[i + 1]);
    return out;
  };
  const bigramJaccard = (a: string[], b: string[]) => {
    const A = new Set(a); const B = new Set(b);
    const inter = [...A].filter(x => B.has(x)).length; const uni = new Set([...A, ...B]).size;
    return uni === 0 ? 0 : inter / uni;
  };

  const bigramScores = expectedArr.map(e => bigramJaccard(bigrams(response), bigrams(e)));

  const combined = expectedArr.map((_, i) => Math.max(tokenScores[i] || 0, bigramScores[i] || 0));
  return Math.max(...combined);
}

// 1. Upload Page
const DocumentUploadPage = ({ onUploadSuccess }: { onUploadSuccess: (meta: any) => void }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [useFileCount, setUseFileCount] = useState<number>(1);
  const [useFileCountManual, setUseFileCountManual] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const onFilesSelected = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).slice(0, 20); // sane cap
    setSelectedFiles(prev => {
      const combined = [...prev];
      arr.forEach(f => {
        if (!combined.find(x => x.name === f.name && x.size === f.size)) combined.push(f);
      });
      const final = combined.slice(0, 50);
      // if the user hasn't manually changed the counter, default it to the full selection
      if (!useFileCountManual) {
        setUseFileCount(final.length || 1);
      } else {
        // otherwise clamp existing manual value to the available files
        setUseFileCount(prev => Math.max(1, Math.min(prev, final.length || 1)));
      }
      return final;
    });
  };

  // Ensure `useFileCount` stays within bounds when `selectedFiles` changes from elsewhere
  useEffect(() => {
    if (selectedFiles.length === 0) {
      setUseFileCount(1);
      return;
    }
    setUseFileCount(prev => {
      if (prev < 1) return 1;
      if (prev > selectedFiles.length) return selectedFiles.length;
      // if the user DID NOT manually set the counter and more files appeared, prefer using all by default
      if (!useFileCountManual && prev <= 1 && selectedFiles.length > 1) return selectedFiles.length;
      return prev;
    });
  }, [selectedFiles, useFileCountManual]);

  const handleProcess = () => {
    setUploading(true);
    setTimeout(() => {
      // Build a combined mock metadata object from selected files
      const filesToUse = selectedFiles.slice(0, useFileCount || 1);
      const totalPages = filesToUse.reduce((s, f) => s + (Math.min(30, Math.max(1, Math.round((f.size || 0) / 10240)))) , 0);
      const totalSize = filesToUse.reduce((s, f) => s + (f.size || 0), 0);

      (async () => {
        // Extract text from PDFs and read TXT files; fallback to filename for others
        const parts: string[] = [];
        for (const f of filesToUse) {
          try {
            if (f.type && f.type.includes('pdf')) {
              const pdfText = await extractPdfText(f);
              if (pdfText && pdfText.trim().length > 20) {
                parts.push(pdfText.slice(0, 5000)); // limit size
                continue;
              }
            }
            if (f.type && (f.type.includes('text') || f.name.toLowerCase().endsWith('.txt'))) {
              const txt = await f.text();
              if (txt && txt.trim().length > 0) {
                parts.push(txt.slice(0, 5000));
                continue;
              }
            }
            // fallback: include filename as a hint
            parts.push(`File: ${f.name}`);
          } catch (e) {
            parts.push(`File: ${f.name}`);
          }
        }

        const extractedTextCombined = parts.join('\n\n');

        const baseMetadata = {
          document_id: (crypto as any).randomUUID(),
          filename: filesToUse.length === 1 ? filesToUse[0].name : `${filesToUse.length} files uploaded`,
          content_type: filesToUse.length === 1 ? filesToUse[0].type || 'application/octet-stream' : 'multipart/mixed',
          page_count: totalPages,
          size_bytes: totalSize,
          uploaded_by: 'user_123',
          uploaded_at: new Date().toISOString(),
          text_extracted: extractedTextCombined || filesToUse.map((f, i) => `Extracted text from ${f.name || 'file' + i}`).join('\n\n'),
          files: filesToUse.map((f) => ({ name: f.name, size: f.size, type: f.type }))
        };

        // Try to POST files to server-side extract endpoint so server can index with embedding service
        try {
          const fd = new FormData();
          for (const f of filesToUse) fd.append('file', f);
          const res = await fetch('/api/extract', { method: 'POST', body: fd });
          if (res.ok) {
            const data = await res.json();
            const merged = { ...baseMetadata, extractResponse: data, chunks: data?.combinedChunks || data?.files?.flatMap((x: any) => x.chunks || []) || null };
            setUploading(false);
            onUploadSuccess(merged);
            return;
          }
          // non-ok response falls through to fallback
        } catch (e) {
          // ignore network errors and continue with fallback
        }

        // fallback to using local extracted metadata when server extract/indexing unavailable
        setUploading(false);
        onUploadSuccess(baseMetadata);
      })();
    }, 1200);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-4 sm:p-6 bg-slate-50">
      <div
        className={`relative w-full max-w-full sm:max-w-2xl p-6 sm:p-8 border-4 border-dashed rounded-xl transition-colors ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white'}`}
        onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); onFilesSelected(e.dataTransfer.files); }}
      >
        <div className="flex flex-col space-y-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-full">
              <Upload className="w-8 h-8 text-blue-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-800">Upload Course Material</h2>
              <p className="text-slate-500">Drag & drop PDF, DOCX, or TXT (Max 30 pages per file). You can select multiple files.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input ref={fileInputRef} type="file" multiple onChange={(e) => { onFilesSelected(e.target.files); (e.target as HTMLInputElement).value = ''; }} className="hidden" />
            <button type="button" onClick={() => { fileInputRef.current?.click(); }} className="px-3 py-2 bg-white border rounded hover:bg-slate-50">Choose Files</button>
            <span className="text-sm text-slate-600">Or drag files into the box above.</span>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs text-slate-500">Use up to</span>
              <input type="number" min={1} max={Math.max(1, selectedFiles.length)} value={useFileCount} onChange={(e) => { setUseFileCount(Math.max(1, Math.min(Number(e.target.value || 1), Math.max(1, selectedFiles.length)))); setUseFileCountManual(true); }} className="w-20 px-2 py-1 border rounded" />
              <span className="text-xs text-slate-500">files for quiz generation</span>
            </label>
          </div>

          {selectedFiles.length > 0 && (
            <div className="border rounded p-3 bg-slate-50">
              <h4 className="text-sm font-semibold mb-2">Selected Files ({selectedFiles.length})</h4>
              <ul className="text-sm space-y-1">
                {selectedFiles.map((f, idx) => (
                  <li key={idx} className="flex items-center justify-between">
                    <span className="truncate max-w-[70%]">{f.name}</span>
                    <span className="text-xs text-slate-500">{Math.round((f.size || 0) / 1024)} KB</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-end">
            <button
              onClick={handleProcess}
              disabled={uploading || selectedFiles.length === 0}
              className="px-6 py-2 mt-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? 'Processing...' : 'Process Files & Generate Quiz'}
            </button>
          </div>

          {uploading && (
            <div className="absolute inset-0 bg-white/70 flex flex-col items-center justify-center gap-3">
              <div className="h-4 bg-slate-200 rounded w-3/4 animate-pulse" />
              <div className="h-4 bg-slate-200 rounded w-1/2 animate-pulse" />
              <div className="h-8 w-40 bg-blue-600 rounded animate-pulse" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 2. Quiz Player
const QuizPlayer = ({ quiz, settings, onFinish }: { quiz: Quiz, settings: any, onFinish: (submission: any) => void }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<any>({});
  const answersRef = useRef<any>({});
  // DON'T initialize start times on server — do it on client only
  const [startTime, setStartTime] = useState<number | null>(null);
  const [questionStart, setQuestionStart] = useState<number | null>(null);

  useEffect(() => {
    const now = Date.now();
    setStartTime(now);
    setQuestionStart(now);
  }, []);

  // enforce time limit if provided in settings
  const submittedRef = useRef(false);
  useEffect(() => {
    if (!settings || !settings.time_limit_seconds) return;
    if (!startTime) return;
    const limitMs = settings.time_limit_seconds * 1000;
    const check = () => {
      if (submittedRef.current) return;
      const now = Date.now();
      if ((now - (startTime || 0)) >= limitMs) {
        submittedRef.current = true;
        // build submission from answersRef
        const finalAnswers = { ...(answersRef.current || {}) };
        const submission = {
          user_id: "current_user",
          quiz_id: quiz.quiz_id,
          started_at: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
          finished_at: new Date().toISOString(),
          answers: Object.entries(finalAnswers).map(([qid, ans]: [string, any]) => ({
            question_id: qid,
            selected_choice_ids: ans.selected_choice_ids || [],
            written_answer: ans.written_answer || "",
            match_pairs: ans.match_pairs || [],
            time_spent_seconds: ans.time_spent_seconds || 0
          }))
        };
        onFinish(submission);
      }
    };
    const id = setInterval(check, 500);
    return () => clearInterval(id);
  }, [settings, startTime, quiz.quiz_id, onFinish]);

  

  const currentQ = quiz.questions[currentIndex];

  const handleNext = () => {
    const now = Date.now();
    const qStart = questionStart ?? now;
    const timeSpent = (now - qStart) / 1000;
    // Build a deterministic finalAnswers object from the answersRef so it includes the latest selection
    const finalAnswers = { ...(answersRef.current || {}) };
    finalAnswers[currentQ.question_id] = {
      ...(finalAnswers[currentQ.question_id] || {}),
      time_spent_seconds: ((finalAnswers[currentQ.question_id] && finalAnswers[currentQ.question_id].time_spent_seconds) || 0) + timeSpent,
    };

    if (currentIndex < quiz.questions.length - 1) {
      // update state for next question
      setAnswers(finalAnswers);
      setCurrentIndex(prev => prev + 1);
      setQuestionStart(Date.now());
    } else {
      // build submission (no strict submission type here) using finalAnswers
      const submission = {
        user_id: "current_user",
        quiz_id: quiz.quiz_id,
        started_at: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
        finished_at: new Date().toISOString(),
        answers: Object.entries(finalAnswers).map(([qid, ans]: [string, any]) => ({
          question_id: qid,
          selected_choice_ids: ans.selected_choice_ids || [],
          written_answer: ans.written_answer || "",
          match_pairs: ans.match_pairs || [],
          time_spent_seconds: ans.time_spent_seconds || 0
        }))
      };
      // ensure state and ref updated with finalAnswers for continuity
      answersRef.current = finalAnswers;
      setAnswers(finalAnswers);
      onFinish(submission);
    }
  };

  // Keyboard shortcuts: left/right to navigate questions, Enter to advance/submit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') {
        setCurrentIndex(c => Math.max(0, c - 1));
      } else if (e.key === 'ArrowRight') {
        if (currentIndex < quiz.questions.length - 1) {
          setCurrentIndex(c => Math.min(quiz.questions.length - 1, c + 1));
          setQuestionStart(Date.now());
        } else {
          handleNext();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentIndex, quiz.questions.length, handleNext]);

  const updateAnswer = (data: any) => {
    const current = answersRef.current || {};
    const next = { ...current, [currentQ.question_id]: { ...(current[currentQ.question_id] || {}), ...data } };
    answersRef.current = next;
    setAnswers(next);
  };

  const renderQuestionInput = () => {
    const ans = answers[currentQ.question_id] || {};

    switch (currentQ.type) {
      case 'single':
        return (
          <div className="space-y-3">
            {currentQ.choices.map((c: any) => (
              <button
                key={c.choice_id}
                onClick={() => updateAnswer({ selected_choice_ids: [c.choice_id] })}
                className={`w-full p-4 text-left border rounded-lg flex items-center justify-between ${
                  ans.selected_choice_ids?.includes(c.choice_id)
                    ? 'border-blue-500 bg-blue-50 text-blue-800'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span>{c.text}</span>
                {ans.selected_choice_ids?.includes(c.choice_id) && <CheckCircle className="w-5 h-5" />}
              </button>
            ))}
          </div>
        );

      case 'multiple':
        return (
          <div className="space-y-3">
            {currentQ.choices.map((c: any) => {
              const selected = ans.selected_choice_ids || [];
              const isSelected = selected.includes(c.choice_id);
              return (
                <button
                  key={c.choice_id}
                  onClick={() => {
                    const newSel = isSelected
                      ? selected.filter((id: string) => id !== c.choice_id)
                      : [...selected, c.choice_id];
                    updateAnswer({ selected_choice_ids: newSel });
                  }}
                  className={`w-full p-4 text-left border rounded-lg flex items-center justify-between ${
                    isSelected ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span>{c.text}</span>
                  <div className={`w-5 h-5 border rounded ${isSelected ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`} />
                </button>
              );
            })}
          </div>
        );

      case 'written':
        return (
          <textarea
            className="w-full p-4 border rounded-lg border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            rows={4}
            placeholder="Type your answer here..."
            value={ans.written_answer || ""}
            onChange={(e) => updateAnswer({ written_answer: e.target.value })}
          />
        );

      case 'match':
        const currentPairs = ans.match_pairs || [];
        const lefts = currentQ.match_pairs.map((p: any) => p.left);
        const rights = currentQ.match_pairs.map((p: any) => p.right).sort();

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <h4 className="font-semibold text-slate-500 text-sm mb-2">Items</h4>
              {lefts.map((l: string, idx: number) => (
                <div key={idx} className="p-3 bg-white border border-slate-200 rounded flex items-center">
                  <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center mr-3 text-xs font-bold">{idx + 1}</div>
                  {l}
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-slate-500 text-sm mb-2">Match With</h4>
              {lefts.map((l: string, idx: number) => (
                <div key={idx} className="flex items-center space-x-2 h-[50px]">
                  <select
                    className="w-full h-full border border-slate-300 rounded px-2"
                    value={(currentPairs.find((p: any) => p.left === l)?.right) ?? ''}
                    onChange={(e) => {
                      const newPairs = [...currentPairs.filter((p: any) => p.left !== l), { left: l, right: e.target.value }];
                      updateAnswer({ match_pairs: newPairs });
                    }}
                  >
                    <option value="">Select match...</option>
                    {rights.map((r: string) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        );

      default: return null;
    }
  };

  // safe elapsed display
  const elapsedSeconds = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

  return (
    <div className="max-w-full sm:max-w-3xl mx-auto mt-4 sm:mt-8 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden px-4 sm:px-0">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
        <div>
          <h3 className="font-semibold text-slate-700">Question {currentIndex + 1} of {quiz.questions.length}</h3>
          <div className="flex items-center text-xs text-slate-500 mt-1 space-x-3">
            <span className={`px-2 py-0.5 rounded-full ${currentQ.difficulty === 'hard' ? 'bg-red-100 text-red-700' : currentQ.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'} capitalize`}>
              {currentQ.difficulty} ({currentQ.points} pts)
            </span>
            <span className="flex items-center"><Clock className="w-3 h-3 mr-1" /> {elapsedSeconds}s elapsed</span>
          </div>
        </div>
        <div className="w-32 bg-slate-200 h-2 rounded-full overflow-hidden">
          <div className="bg-blue-600 h-full transition-all duration-300" style={{ width: `${((currentIndex + 1) / quiz.questions.length) * 100}%` }} />
        </div>
      </div>

      <div className="p-8">
        <h2 className="text-xl font-medium text-slate-900 mb-6">{currentQ.prompt}</h2>
        {renderQuestionInput()}
      </div>

      <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between">
        <button
          onClick={() => setCurrentIndex(c => Math.max(0, c - 1))}
          disabled={currentIndex === 0}
          className="flex items-center text-slate-600 hover:text-slate-900 disabled:opacity-30"
        >
          <ChevronLeft className="w-5 h-5 mr-1" /> Previous
        </button>
        <button
          onClick={handleNext}
          className="flex items-center px-6 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800"
        >
          {currentIndex === quiz.questions.length - 1 ? "Submit Quiz" : "Next Question"}
          {currentIndex !== quiz.questions.length - 1 && <ChevronRight className="w-5 h-5 ml-1" />}
        </button>
      </div>
    </div>
  );
};

// 3. Analytics & History
const AnalyticsDashboard = ({ history }: { history: AttemptResult[] }) => {

  const [scope, setScope] = useState<'recent' | 'all'>('recent');

  const topicData = useMemo(() => {
    const topicsMap: any = {};
    const source = scope === 'recent' ? (history.length ? [history[history.length - 1]] : []) : history;
    source.forEach(attempt => {
      // some older attempts may not have insights; skip safely
      (attempt.insights?.topics_covered || []).forEach((t: any) => {
        if (!topicsMap[t.topic]) topicsMap[t.topic] = { name: t.topic, correct: 0, incorrect: 0 };
        topicsMap[t.topic].correct += t.correct_count;
        topicsMap[t.topic].incorrect += (t.total - t.correct_count);
      });
    });
    return Object.values(topicsMap).filter((t: any) => ((t.correct || 0) + (t.incorrect || 0)) > 0);
  }, [history, scope]);

  const [selectedAttempt, setSelectedAttempt] = useState<AttemptResult | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedAttempt) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedAttempt(null);
    };
    window.addEventListener('keydown', onKey);

    // focus the modal container for a11y
    setTimeout(() => {
      modalRef.current?.focus();
    }, 50);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [selectedAttempt]);

  const pieData: { name: string; value: number; correct?: number; total?: number }[] = useMemo(() => {
    return topicData.map((t: any) => {
      const total = (t.correct || 0) + (t.incorrect || 0);
      return { name: t.name, value: total, correct: t.correct || 0, total };
    }).filter(d => (d.total || 0) > 0);
  }, [topicData]);

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-slate-500 text-sm font-semibold uppercase">Total Attempts</h3>
          <p className="text-3xl font-bold text-slate-900 mt-2">{history.length}</p>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-slate-500 text-sm font-semibold uppercase">Avg Score</h3>
          <p className="text-3xl font-bold text-blue-600 mt-2">
            {history.length > 0 ? Math.round(history.reduce((a, b) => a + (b.score / b.total_points * 100), 0) / history.length) : 0}%
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-slate-500 text-sm font-semibold uppercase">Time Spent (Avg)</h3>
          <p className="text-3xl font-bold text-slate-900 mt-2">
            {history.length > 0 ? Math.round(history.reduce((a, b) => a + b.insights.time_per_question_avg_seconds, 0) / history.length) : 0}s <span className="text-sm font-normal text-slate-400">/ question</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-64 sm:h-80">
          <h3 className="text-slate-800 font-bold mb-4">Knowledge Gaps (Topic Accuracy)</h3>
          {topicData.length > 0 ? (
            <>
                <div className="relative w-full h-full">
                  <svg width="0" height="0">
                    <defs>
                      <linearGradient id="grad1" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.6" />
                        <stop offset="100%" stopColor="#000000" stopOpacity="0.05" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <RechartsTooltip formatter={(value: any, name: string, props: any) => {
                        const pd = props && props.payload;
                        if (pd && pd.total) return [`${pd.correct}/${pd.total}`, `${pd.name}`];
                        return [value, name];
                      }} />

                      {/* Outer rim for 3D effect */}
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        outerRadius={86}
                        fill="#e6e6e6"
                        cornerRadius={6}
                        paddingAngle={2}
                      />

                      {/* Main pie */}
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={36}
                        outerRadius={78}
                        paddingAngle={2}
                        label={({ name, percent, payload }: any) => `${name} (${payload && payload.total ? Math.round((payload.correct / payload.total) * 100) : Math.round((percent ?? 0) * 100)}%)`}
                      >
                        {pieData.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={['#60A5FA', '#F87171', '#34D399', '#F59E0B', '#A78BFA'][index % 5]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              <div className="mt-4 flex flex-wrap gap-3 items-center">
                <div className="flex items-center gap-3">
                  <label className="text-sm text-slate-500">Scope:</label>
                  <select value={scope} onChange={(e) => setScope(e.target.value as any)} className="px-2 py-1 border rounded">
                    <option value="recent">Most Recent Attempt</option>
                    <option value="all">All Attempts</option>
                  </select>
                </div>
                <div className="flex-1" />
                <div className="flex flex-wrap gap-3 items-center">
                  {topicData.map((t: any, index: number) => (
                    <div key={`legend-${index}`} className="flex items-center gap-2 text-sm text-slate-700">
                      <span style={{ width: 14, height: 14, background: ['#60A5FA', '#F87171', '#34D399', '#F59E0B', '#A78BFA'][index % 5], display: 'inline-block', borderRadius: 3 }} />
                      <span className="whitespace-nowrap">{t.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <div>No topic data for the selected scope.</div>
              {scope === 'all' ? <div className="text-xs text-slate-400 mt-2">Try 'Most Recent Attempt' or generate more quizzes so data can be aggregated.</div> : null}
            </div>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm overflow-auto max-h-80">
          <h3 className="text-slate-800 font-bold mb-4">Recent History</h3>
            <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h: any) => (
                <tr key={h.attempt_id} onClick={() => setSelectedAttempt(h)} role="button" className="border-b border-slate-100 cursor-pointer hover:bg-slate-50" tabIndex={0}>
                  <td className="px-4 py-3">{new Date(h.finished_at).toLocaleString()}</td>
                  <td className="px-4 py-3 font-semibold">{h.score} / {h.total_points}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const passed = typeof h.passed === 'boolean' ? h.passed : (h.score / h.total_points > 0.7);
                      return (
                        <span className={`px-2 py-1 rounded-full text-xs ${passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {passed ? 'Pass' : 'Fail'}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            {selectedAttempt && (
              <div className="fixed inset-0 z-50 flex items-center justify-center">
                <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedAttempt(null)} />
                <div role="dialog" aria-modal="true" ref={modalRef} tabIndex={-1} className="relative bg-white w-full max-w-2xl p-6 rounded-lg shadow-lg">
                  <div className="flex items-start justify-between">
                    <h4 className="text-lg font-bold">Attempt Details</h4>
                    <button onClick={() => setSelectedAttempt(null)} className="text-slate-500 hover:text-slate-700">Close</button>
                  </div>
                  <div className="mt-4">
                    <p className="text-sm text-slate-600">Date: {new Date(selectedAttempt.finished_at).toLocaleString()}</p>
                    <p className="text-sm text-slate-600">Score: {selectedAttempt.score} / {selectedAttempt.total_points}</p>
                    <div className="mt-4 overflow-auto max-h-72">
                                <table className="w-full text-sm">
                                  <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                                    <tr>
                                      <th className="px-3 py-2">Status</th>
                                      <th className="px-3 py-2">#</th>
                                      <th className="px-3 py-2">Prompt</th>
                                      <th className="px-3 py-2">Your Answer</th>
                                      <th className="px-3 py-2">Correct Answer</th>
                                      <th className="px-3 py-2">Time (s)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedAttempt.per_question.map((q: any, i: number) => {
                                      // helper renderers
                                      const renderYourAnswer = () => {
                                        if ((q.user_selected_choice_ids || []).length > 0) {
                                          return q.choices.filter((c: any) => (q.user_selected_choice_ids || []).includes(c.choice_id)).map((c: any) => c.text).join(', ');
                                        }
                                        if (q.user_written_answer) return q.user_written_answer;
                                        if ((q.user_match_pairs || []).length > 0) return (q.user_match_pairs || []).map((p: any) => `${p.left} → ${p.right}`).join('; ');
                                        return '-';
                                      };

                                      const renderCorrectAnswer = () => {
                                        if ((q.correct_choice_ids || []).length > 0) {
                                          return (q.choices || []).filter((c: any) => (q.correct_choice_ids || []).includes(c.choice_id)).map((c: any) => c.text).join(', ');
                                        }
                                        if ((q.correct_written_answers || []).length > 0) return (q.correct_written_answers || []).join('; ');
                                        if ((q.match_pairs || []).length > 0) return (q.match_pairs || []).map((p: any) => `${p.left} → ${p.right}`).join('; ');
                                        return '-';
                                      };

                                      const status = q.correct ? 'correct' : ((q.points_awarded || 0) > 0 ? 'partial' : 'incorrect');
                                      const statusBadge = status === 'correct' ? (<span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">Correct</span>) : status === 'partial' ? (<span className="px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">Partial</span>) : (<span className="px-2 py-1 rounded-full text-xs bg-red-100 text-red-700">Incorrect</span>);

                                      const answerCellClass = status === 'correct' ? 'text-green-700' : status === 'partial' ? 'text-yellow-800' : 'text-red-700';

                                      return (
                                        <tr key={q.question_id} className="border-b last:border-b-0 align-top">
                                          <td className="px-3 py-2 align-top w-24">{statusBadge}</td>
                                          <td className="px-3 py-2 align-top w-8">{i + 1}</td>
                                          <td className="px-3 py-2 align-top max-w-[45%] wrap-break-word">{q.prompt}</td>
                                          <td className={`px-3 py-2 align-top max-w-[20%] wrap-break-word ${answerCellClass}`}>
                                            <div className="whitespace-pre-wrap">{renderYourAnswer()}</div>
                                          </td>
                                          <td className="px-3 py-2 align-top max-w-[20%] wrap-break-word">
                                            <div className="whitespace-pre-wrap">{renderCorrectAnswer()}</div>
                                          </td>
                                          <td className="px-3 py-2 align-top">{(q.time_spent_seconds ?? 0).toFixed ? (q.time_spent_seconds ?? 0).toFixed(3) : (q.time_spent_seconds ?? 0)}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---

export default function Home() {
  // Client mount guard to avoid hydration mismatch for any time-dependent UI
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // --- EXISTING CODE CONTINUES BELOW ---
  const [view, setView] = useState('upload');
  const [documentMeta, setDocumentMeta] = useState<any>(null);
  const [quiz, setQuiz] = useState<any>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewQuestions, setPreviewQuestions] = useState<Question[] | null>(null);
  const [attemptResult, setAttemptResult] = useState<AttemptResult | null>(null);
  const [history, setHistory] = useState<AttemptResult[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // load persisted history from localStorage (client-only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('quizgen_history');
      if (raw) {
        setHistory(JSON.parse(raw));
      }
    } catch (e) {
      // ignore parse errors
    }
  }, []);

  // Accessibility: trap focus + handle Escape when mobile drawer open
  useEffect(() => {
    if (!mobileNavOpen) {
      document.body.style.overflow = '';
      return;
    }
    // prevent background scroll
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);

    // focus first actionable element in drawer
    setTimeout(() => {
      if (closeButtonRef.current) closeButtonRef.current.focus();
    }, 50);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [mobileNavOpen]);

  // persist history whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('quizgen_history', JSON.stringify(history));
    } catch (e) {
      // ignore storage errors
    }
  }, [history]);

  // user settings (persisted)
  const [settings, setSettings] = useState<{ question_count: number; difficulty: string; types: string[]; passing_score: number | null; time_limit_seconds: number | null; distractor_min_sim?: number; distractor_max_sim?: number }>(() => {
    try {
      const raw = localStorage.getItem('quizgen_settings');
      if (raw) return JSON.parse(raw);
    } catch (e) { }
    return { question_count: 5, difficulty: 'mixed', types: ['single', 'multiple', 'written', 'match'], passing_score: 70, time_limit_seconds: null, distractor_min_sim: 0.12, distractor_max_sim: 0.75 };
  });

  useEffect(() => {
    try {
      localStorage.setItem('quizgen_settings', JSON.stringify(settings));
    } catch (e) { }
  }, [settings]);

  // Local controlled input for Passing Score to allow empty input and remove leading zeros cleanly
  const [passingScoreInput, setPassingScoreInput] = useState<string>(() => String(settings.passing_score ?? ''));
  useEffect(() => {
    setPassingScoreInput(settings.passing_score != null ? String(settings.passing_score) : '');
  }, [settings.passing_score]);

  const handleGenerate = () => {
    setView('generating');
    setTimeout(() => {
      const newQuiz = generateMockQuiz(documentMeta || { document_id: 'doc_0', filename: 'Unknown' }, settings);
      setQuiz(newQuiz);
      setView('quiz');
    }, 1000);
  };

  // Preview generated questions by calling server-side generator when available.
  const handlePreviewGenerate = async () => {
    setPreviewError(null);
    setPreviewQuestions(null);
    setPreviewLoading(true);
    setPreviewOpen(true);

    try {
      const payload: any = { question_count: settings.question_count || 5, types: settings.types || [], difficulty: settings.difficulty || 'mixed' };
      if (typeof settings.distractor_min_sim === 'number') payload.min_sim = settings.distractor_min_sim;
      if (typeof settings.distractor_max_sim === 'number') payload.max_sim = settings.distractor_max_sim;
      if (documentMeta?.chunks) payload.chunks = documentMeta.chunks;
      else if (documentMeta?.text_extracted) payload.text = documentMeta.text_extracted;

      const res = await fetch('/api/generate-question', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });

      if (!res.ok) {
        // fallback to client-side generator
        const fallback = generateMockQuiz(documentMeta || { document_id: 'doc_0', filename: 'Unknown' }, settings);
        setPreviewQuestions(fallback.questions);
        setPreviewLoading(false);
        return;
      }

      const data = await res.json();
      // The API may return either { quiz } or { questions }
      if (data.quiz && Array.isArray(data.quiz.questions)) {
        setPreviewQuestions(data.quiz.questions as Question[]);
      } else if (data.questions && Array.isArray(data.questions)) {
        setPreviewQuestions(data.questions as Question[]);
      } else {
        // fallback: use client mock
        const fallback = generateMockQuiz(documentMeta || { document_id: 'doc_0', filename: 'Unknown' }, settings);
        setPreviewQuestions(fallback.questions);
      }
    } catch (e: any) {
      setPreviewError(String(e?.message || e));
      // fallback to client mock so user can still see something
      try {
        const fallback = generateMockQuiz(documentMeta || { document_id: 'doc_0', filename: 'Unknown' }, settings);
        setPreviewQuestions(fallback.questions);
      } catch (_err) {
        // ignore
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const acceptPreviewAsQuiz = () => {
    if (!previewQuestions) return;
    const uid = () => (crypto as any).randomUUID();
    const total_points = previewQuestions.reduce((acc, q) => acc + (q.points || 0), 0);
    const built: Quiz = {
      quiz_id: uid(),
      document_id: documentMeta?.document_id || 'doc_0',
      title: `Quiz: ${documentMeta?.filename || 'Uploaded'}`,
      description: 'Generated from document preview',
      question_count: previewQuestions.length,
      total_points,
      questions: previewQuestions,
      metadata: { generated_by: 'server_generator', generated_at: new Date().toISOString() }
    };
    setQuiz(built);
    setPreviewOpen(false);
    setPreviewQuestions(null);
    setView('quiz');
  };

  const handleQuizFinish = (submission: any) => {
    let score = 0;
    const perQuestion: any[] = [];
    const topicStats: any = {};

    if (!quiz) return;

    submission.answers.forEach((ans: any) => {
      const question = quiz.questions.find((q: any) => q.question_id === ans.question_id);
      if (!question) return;
      let isCorrect = false;

      if (question.type === 'single') {
        isCorrect = ((ans.selected_choice_ids || [])[0]) === question.correct_choice_ids[0];
      } else if (question.type === 'multiple') {
        const s = (ans.selected_choice_ids || []).slice().sort();
        const c = (question.correct_choice_ids || []).slice().sort();
        isCorrect = JSON.stringify(s) === JSON.stringify(c);
      } else if (question.type === 'match') {
        const allMatched = question.match_pairs.every((pair: any) => {
          const userPair = (ans.match_pairs || []).find((p: any) => p.left === pair.left);
          return userPair && userPair.right === pair.right;
        });
        isCorrect = allMatched;
      } else if (question.type === 'written') {
        // semantic matching against expected written answers (score 0..1)
        const resp = ans.written_answer || "";
        const expected = question.correct_written_answers && question.correct_written_answers.length ? question.correct_written_answers : [question.prompt];
        const sim = semanticMatchScore(resp, expected);
        if (sim >= 0.6) {
          isCorrect = true;
        } else {
          isCorrect = false;
        }
        // award partial points based on similarity
        const partialPoints = Math.round((sim || 0) * question.points);
        // ensure at least 0
        const awarded = Math.max(0, partialPoints);
        // set points awarded later in perQuestion entry
        // temporarily store awarded into ans._awarded to pass into perQuestion building
        ans._awarded_points = awarded;
      }

      if (isCorrect) {
        score += question.points;
      } else if (ans._awarded_points) {
        score += ans._awarded_points;
      }

      perQuestion.push({
        question_id: question.question_id,
        prompt: question.prompt,
        correct: isCorrect,
        points_awarded: (isCorrect ? question.points : (ans._awarded_points || 0)),
        correct_choice_ids: question.correct_choice_ids,
        choices: question.choices || [],
        correct_written_answers: question.correct_written_answers || [],
        match_pairs: question.match_pairs || [],
        user_selected_choice_ids: ans.selected_choice_ids || [],
        user_written_answer: ans.written_answer || "",
        user_match_pairs: ans.match_pairs || [],
        time_spent_seconds: ans.time_spent_seconds || 0,
        explanation: question.explanation
      });

      question.topics.forEach((t: string) => {
        if (!topicStats[t]) topicStats[t] = { correct: 0, total: 0 };
        topicStats[t].total++;
        if (isCorrect) topicStats[t].correct++;
      });
    });

    const avgTime = submission.answers.length > 0
      ? submission.answers.reduce((acc: number, curr: any) => acc + (curr.time_spent_seconds || 0), 0) / submission.answers.length
      : 0;

    const result: AttemptResult = {
      attempt_id: (crypto as any).randomUUID(),
      quiz_id: quiz.quiz_id,
      user_id: submission.user_id, // now allowed by type
      score,
      total_points: quiz.total_points,
      per_question: perQuestion,
        passed: ((settings && settings.passing_score) ? (Math.round((score / quiz.total_points) * 100) >= settings.passing_score) : (score / quiz.total_points) > 0.7),
        meta: { passing_score: settings?.passing_score ?? 70, time_limit_seconds: settings?.time_limit_seconds ?? null },
      insights: {
        topics_covered: Object.entries(topicStats).map(([k, v]: [string, any]) => ({
          topic: k, correct_count: v.correct, total: v.total
        })),
        time_per_question_avg_seconds: avgTime
      },
      finished_at: new Date().toISOString()
    };

    setAttemptResult(result);
    setHistory(prev => [...prev, result]);
    setView('result');
  };

  // --- ADD THIS CHECK TO AVOID HYDRATION MISMATCH ---
  if (!isMounted) {
    return null; // or a client-only loading placeholder
  }
  // ---------------------------------------------------

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-900">
      {/* Mobile header (visible on small screens) */}
      <div className="md:hidden w-full bg-white border-b">
        <div className="flex items-center justify-between p-3">
            <div className="flex items-center gap-3">
            <button onClick={() => setMobileNavOpen(true)} aria-label="Open menu" aria-expanded={mobileNavOpen} className="p-2 rounded-md hover:bg-slate-100">
              <svg className="w-6 h-6 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-500" /> QuizGen Pro
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold">JD</div>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-slate-900 text-slate-300 flex flex-col" role="dialog" aria-modal="true" ref={drawerRef} tabIndex={-1}>
            <div className="p-6 border-b border-slate-800">
              <div className="flex items-center justify-between">
                <h2 className="text-white text-lg font-bold flex items-center gap-2"><BookOpen className="w-5 h-5 text-blue-500" /> QuizGen Pro</h2>
                <button ref={closeButtonRef} onClick={() => setMobileNavOpen(false)} aria-label="Close menu" className="p-2 rounded-md hover:bg-slate-800">
                  <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <nav className="flex-1 px-4 py-6 space-y-2">
              <button onClick={() => { setView('upload'); setMobileNavOpen(false); }} className={`flex items-center w-full px-4 py-3 rounded-lg ${view === 'upload' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'}`}>
                <Upload className="w-5 h-5 mr-3" /> New Upload
              </button>
              <button onClick={() => { setView('analytics'); setMobileNavOpen(false); }} className={`flex items-center w-full px-4 py-3 rounded-lg ${view === 'analytics' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'}`}>
                <BarChart2 className="w-5 h-5 mr-3" /> Analytics
              </button>
            </nav>
            <div className="p-4 border-t border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold">JD</div>
                <div className="text-sm">
                  <p className="text-white">John Doe</p>
                  <p className="text-slate-500">Student</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="w-64 bg-slate-900 text-slate-300 flex-col hidden md:flex">
        <div className="p-6">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-blue-500" />
            QuizGen Pro
          </h1>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          <button onClick={() => setView('upload')} className={`flex items-center w-full px-4 py-3 rounded-lg ${view === 'upload' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'}`}>
            <Upload className="w-5 h-5 mr-3" /> New Upload
          </button>
          <button onClick={() => setView('analytics')} className={`flex items-center w-full px-4 py-3 rounded-lg ${view === 'analytics' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'}`}>
            <BarChart2 className="w-5 h-5 mr-3" /> Analytics
          </button>
        </nav>
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold">JD</div>
            <div className="text-sm">
              <p className="text-white">John Doe</p>
              <p className="text-slate-500">Student</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {view === 'upload' && (
          <DocumentUploadPage onUploadSuccess={(meta) => { setDocumentMeta(meta); setView('confirm'); }} />
        )}

        {view === 'confirm' && documentMeta && (
          <div className="max-w-full sm:max-w-2xl mx-auto mt-8 sm:mt-20 p-4 sm:p-8 bg-white rounded-xl shadow-sm">
            <div className="flex items-center gap-4 mb-6">
              <FileText className="w-12 h-12 text-blue-600" />
              <div>
                <h2 className="text-2xl font-bold text-slate-900">{documentMeta.filename}</h2>
                <p className="text-slate-500">{documentMeta.page_count} Pages • {(documentMeta.size_bytes / 1024).toFixed(1)} KB</p>
                {/* Indexing status (if server-side extract returned embedding info) */}
                {documentMeta?.extractResponse && (
                  <div className="mt-2 text-sm">
                    {documentMeta.extractResponse.embedding ? (
                      <div className="inline-flex items-center gap-2 px-2 py-1 rounded text-xs bg-green-100 text-green-800">Indexed: {String(documentMeta.extractResponse.embedding?.ok ?? 'true')}</div>
                    ) : documentMeta.extractResponse.error ? (
                      <div className="inline-flex items-center gap-2 px-2 py-1 rounded text-xs bg-red-100 text-red-800">Indexing Error</div>
                    ) : (
                      <div className="inline-flex items-center gap-2 px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-800">Indexing: Unknown</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded border border-slate-200">
                <h4 className="font-semibold text-slate-700 mb-2">Configuration</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm text-slate-600">
                  <label className="flex flex-col">
                    <span className="text-xs text-slate-500 mb-1">Questions</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={settings.question_count ?? 5}
                      onChange={(e) => setSettings(s => ({ ...s, question_count: Math.max(1, Math.min(50, Number(e.target.value || 1))) }))}
                      className="px-3 py-2 border rounded-md w-full"
                    />
                  </label>

                  <label className="flex flex-col">
                    <span className="text-xs text-slate-500 mb-1">Distractor Min Sim (0-1)</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={typeof settings.distractor_min_sim === 'number' ? settings.distractor_min_sim : 0.12}
                      onChange={(e) => setSettings(s => ({ ...s, distractor_min_sim: Math.max(0, Math.min(1, Number(e.target.value || 0))) }))}
                      className="px-3 py-2 border rounded-md w-full"
                    />
                  </label>

                  <label className="flex flex-col">
                    <span className="text-xs text-slate-500 mb-1">Distractor Max Sim (0-1)</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={typeof settings.distractor_max_sim === 'number' ? settings.distractor_max_sim : 0.75}
                      onChange={(e) => setSettings(s => ({ ...s, distractor_max_sim: Math.max(0, Math.min(1, Number(e.target.value || 0))) }))}
                      className="px-3 py-2 border rounded-md w-full"
                    />
                  </label>

                  <label className="flex flex-col">
                    <span className="text-xs text-slate-500 mb-1">Difficulty</span>
                    <select value={settings.difficulty ?? 'mixed'} onChange={(e) => setSettings(s => ({ ...s, difficulty: e.target.value }))} className="px-3 py-2 border rounded-md w-full">
                      <option value="mixed">Mixed</option>
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </label>

                  <div>
                    <span className="text-xs text-slate-500 mb-1 block">Types</span>
                    <div className="flex flex-wrap gap-2">
                      {['single', 'multiple', 'written', 'match'].map((t) => (
                        <label key={t} className={`inline-flex items-center px-2 py-1 rounded-md border ${(settings.types || []).includes(t) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200'}`}>
                          <input type="checkbox" checked={(settings.types || []).includes(t)} onChange={() => {
                            setSettings(s => ({
                              ...s,
                              types: (s.types || []).includes(t) ? (s.types || []).filter((x: string) => x !== t) : [...(s.types || []), t]
                            }));
                          }} className="mr-2" />
                          <span className="text-sm capitalize">{t}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-slate-50 rounded border border-slate-200 mt-4">
                <h4 className="font-semibold text-slate-700 mb-2">Passing & Time Limit</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm text-slate-600 items-end">
                  <label className="flex flex-col">
                    <span className="text-xs text-slate-500 mb-1">Passing Score (%)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      max={100}
                      value={passingScoreInput}
                      onChange={(e) => {
                        // allow only digits and empty; strip leading zeros when more digits follow
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        const cleaned = raw.replace(/^0+(?=\d)/, '');
                        // clamp to 3 digits to avoid huge numbers
                        const clamped = cleaned.slice(0, 3);
                        setPassingScoreInput(clamped);
                        if (clamped === '') {
                          // don't force a numeric 0 here; keep nullable so user can leave empty
                          setSettings(s => ({ ...s, passing_score: null }));
                        } else {
                          const n = Math.max(0, Math.min(100, Number(clamped)));
                          setSettings(s => ({ ...s, passing_score: n }));
                          // reflect any clamp back to the input
                          if (String(n) !== clamped) setPassingScoreInput(String(n));
                        }
                      }}
                      onBlur={() => {
                        // if left empty, keep it empty; otherwise ensure value within 0..100
                        if (passingScoreInput === '') return;
                        const n = Math.max(0, Math.min(100, Number(passingScoreInput || 0)));
                        if (String(n) !== passingScoreInput) {
                          setPassingScoreInput(String(n));
                          setSettings(s => ({ ...s, passing_score: n }));
                        }
                      }}
                      className="px-3 py-2 border rounded-md w-full"
                    />
                  </label>

                  <div className="flex items-center gap-3">
                    <input id="timeToggle" type="checkbox" checked={Boolean(settings.time_limit_seconds)} onChange={(e) => setSettings(s => ({ ...s, time_limit_seconds: e.target.checked ? (s.time_limit_seconds || 300) : null }))} />
                    <label htmlFor="timeToggle" className="text-sm text-slate-600">Enable time limit</label>
                  </div>

                  <label className="flex flex-col">
                    <span className="text-xs text-slate-500 mb-1">Time Limit (minutes)</span>
                    <input type="number" min={1} max={240} value={settings.time_limit_seconds ? Math.ceil(settings.time_limit_seconds / 60) : ''} onChange={(e) => {
                      const v = Number(e.target.value || 0);
                      setSettings(s => ({ ...s, time_limit_seconds: v > 0 ? v * 60 : null }));
                    }} className="px-3 py-2 border rounded-md w-full" disabled={!settings.time_limit_seconds} />
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handlePreviewGenerate}
                  className="w-full py-3 bg-white border border-slate-200 rounded-lg font-semibold hover:bg-slate-50 flex items-center justify-center gap-2"
                >
                  <Loader2 className="w-4 h-4 text-slate-700" /> Preview Generated Questions
                </button>
                <button
                  onClick={handleGenerate}
                  className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 flex items-center justify-center gap-2"
                >
                  <Play className="w-5 h-5" /> Generate Quiz with AI
                </button>
              </div>
            </div>
          </div>
        )}

        {view === 'generating' && (
          <div className="flex flex-col items-center justify-center h-full">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
            <h2 className="text-xl font-semibold text-slate-800">Analyzing Document Structure...</h2>
            <p className="text-slate-500 mt-2">Generating questions, pairs, and distractors.</p>
            <div className="mt-6 w-full max-w-md">
              <div className="h-3 bg-slate-200 rounded mb-2 animate-pulse" />
              <div className="h-3 bg-slate-200 rounded mb-2 animate-pulse" />
              <div className="h-3 bg-slate-200 rounded mb-2 animate-pulse" />
            </div>
          </div>
        )}

        {view === 'quiz' && quiz && (
          <QuizPlayer quiz={quiz} settings={settings} onFinish={handleQuizFinish} />
        )}

        {view === 'result' && attemptResult && (
          <div className="max-w-full sm:max-w-4xl mx-auto p-4 sm:p-8">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-8 bg-slate-900 text-white text-center">
                <p className="text-slate-400 uppercase tracking-wider text-sm font-bold">Quiz Complete</p>
                <h1 className="text-5xl font-bold mt-4 mb-2">{Math.round((attemptResult.score / attemptResult.total_points) * 100)}%</h1>
                <p className="text-slate-300">You scored {attemptResult.score} out of {attemptResult.total_points} points</p>
              </div>

              <div className="p-8">
                <h3 className="text-lg font-bold text-slate-800 mb-4">Detailed Review</h3>
                <div className="space-y-6">
                  {attemptResult.per_question.map((q: any, i: number) => {
                    const originalQ = quiz.questions.find((qu: any) => qu.question_id === q.question_id);
                    if (!originalQ) return null;
                    return (
                      <div key={q.question_id} className={`p-4 border rounded-lg ${q.correct ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-bold text-slate-700">Q{i + 1}: {originalQ.prompt}</span>
                          <span className={`px-2 py-1 rounded text-xs font-bold ${q.correct ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                            {q.correct ? `+${q.points_awarded}` : '0'} Pts
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 mt-2"><span className="font-semibold">Explanation:</span> {q.explanation}</p>
                        <div className="mt-3 text-sm text-slate-700">
                          <div><span className="font-semibold">Your Answer:</span> {(() => {
                            if ((q.user_selected_choice_ids || []).length > 0) return (q.choices || []).filter((c: any) => (q.user_selected_choice_ids || []).includes(c.choice_id)).map((c: any) => c.text).join(', ');
                            if (q.user_written_answer) return q.user_written_answer;
                            if ((q.user_match_pairs || []).length > 0) return (q.user_match_pairs || []).map((p: any) => `${p.left} → ${p.right}`).join('; ');
                            return '-';
                          })()}</div>
                          <div className="mt-1"><span className="font-semibold">Correct Answer:</span> {(() => {
                            if ((q.correct_choice_ids || []).length > 0) return (q.choices || []).filter((c: any) => (q.correct_choice_ids || []).includes(c.choice_id)).map((c: any) => c.text).join(', ');
                            if ((q.correct_written_answers || []).length > 0) return (q.correct_written_answers || []).join('; ');
                            if ((q.match_pairs || []).length > 0) return (q.match_pairs || []).map((p: any) => `${p.left} → ${p.right}`).join('; ');
                            return '-';
                          })()}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-8 flex justify-end gap-4">
                  <button onClick={() => setView('analytics')} className="px-6 py-2 border border-slate-300 rounded-lg hover:bg-slate-50">View Analytics</button>
                  <button onClick={() => setView('upload')} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Start New Quiz</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'analytics' && (
          <AnalyticsDashboard history={history} />
        )}

        {previewOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => { setPreviewOpen(false); setPreviewQuestions(null); }} />
            <div role="dialog" aria-modal="true" className="relative bg-white w-full max-w-3xl p-6 rounded-lg shadow-lg">
              <div className="flex items-start justify-between">
                <h4 className="text-lg font-bold">Preview Generated Questions</h4>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setPreviewOpen(false); setPreviewQuestions(null); }} className="text-slate-500 hover:text-slate-700">Close</button>
                </div>
              </div>

              <div className="mt-4 max-h-[60vh] overflow-auto">
                {previewLoading && (
                  <div className="flex flex-col items-center justify-center p-6">
                    <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-3" />
                    <p className="text-slate-600">Generating preview…</p>
                  </div>
                )}

                {!previewLoading && previewError && (
                  <div className="p-4 text-sm text-red-600">Error: {previewError}</div>
                )}

                {!previewLoading && previewQuestions && (
                  <div className="space-y-4">
                    {previewQuestions.map((q, i) => (
                      <div key={q.question_id} className="p-3 border rounded">
                        <div className="font-semibold">Q{i + 1}: {q.prompt}</div>
                        {q.choices && q.choices.length > 0 && (
                          <ul className="mt-2 list-disc list-inside text-sm text-slate-700">
                            {q.choices.map(c => (<li key={c.choice_id}>{c.text}</li>))}
                          </ul>
                        )}
                        {q.type === 'written' && (<div className="mt-2 text-xs text-slate-500">(Written answer)</div>)}
                        {q.type === 'match' && q.match_pairs && (
                          <div className="mt-2 text-sm">
                            {q.match_pairs.map((p, idx) => (<div key={idx}>{p.left} → {p.right}</div>))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => handlePreviewGenerate()} className="px-4 py-2 border rounded-md">Regenerate</button>
                <button onClick={() => { acceptPreviewAsQuiz(); }} disabled={!previewQuestions} className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50">Accept Quiz</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
