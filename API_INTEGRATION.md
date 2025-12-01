API Integration Notes

This project currently uses a local `generateMockQuiz` function to simulate AI-backed quiz generation. To replace this with a backend API (serverless or REST), follow this outline:

1) Endpoint
   - POST /api/generate-quiz
   - Body: {
       document_id: string,        // id of uploaded document
       settings: {                 // user settings
         question_count: number,
         difficulty: 'mixed'|'easy'|'medium'|'hard',
         types: string[]
       },
       text_snapshot?: string      // optional extracted text to help generation
     }
   - Response: 200 {
       quiz: Quiz // same shape as generateMockQuiz returns
     }

2) Server responsibilities
   - Validate incoming payload and settings
   - Fetch document / extracted text (from DB or object storage)
   - Call AI model (OpenAI, Anthropic, local LLM) to create questions
   - Post-process: ensure IDs, scoring, and sanitization
   - Persist generated quiz to a DB or return directly

3) Security & Cost
   - Authenticate requests (JWT or session cookie)
   - Rate-limit generation endpoints
   - Validate document content to avoid prompt-injection
   - Cache or store generated quizzes to avoid repeated model calls

4) Example Next.js API route (sketch)
   - pages/api/generate-quiz.ts
   - Use server-side environment variables (OPENAI_KEY)
   - Return the generated quiz JSON matching client types

5) Client changes
   - Replace call to `generateMockQuiz(...)` with fetch('/api/generate-quiz', { method: 'POST', body: JSON.stringify({ document_id, settings }) })
   - Show progress UI while awaiting response
   - Handle errors and show retry/cancel

If you want, I can scaffold a Next.js API route (`/pages/api/generate-quiz.ts` or `app/api/generate-quiz/route.ts`) with a mocked handler that demonstrates the request/response shape and safe validation. Let me know which you prefer.