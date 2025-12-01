# 📚 QuizGenPro — AI-Powered Quiz Generator

### Generate quizzes from PDFs, DOCX, TXT & Text using RAG + Embeddings + Semantic Scoring

QuizGenPro is an intelligent quiz generation platform that converts study material into high-quality quizzes using **document parsing**, **semantic similarity**, **embeddings**, and **RAG-style retrieval**.
The system works with and without a backend, thanks to robust client-side fallback logic.

Built using **Next.js (App Router)**, **TypeScript**, **TailwindCSS**, **pdf.js**, **mammoth**, **recharts**, and **lucide-react**.

---

## 🚀 Live Demo



---

## 🖼️ Screenshot



---

# ✨ Features

### 📥 1. Smart Document Upload System

✔ Drag & drop OR file picker
✔ Supports **PDF**, **DOCX**, **TXT**, multi-file uploads
✔ Client-side parsing using:

* `pdfjs-dist` for PDFs
* `mammoth` for DOCX
  ✔ Automatic fallback text extraction
  ✔ Optional backend extraction via `/api/extract`

---

### 🧠 2. AI / RAG-Based Quiz Generation

Two generation modes supported:

#### **A) Backend Mode (if `/api/generate-question` exists)**

* Uses embeddings + chunk retrieval
* Generates distractors based on semantic similarity
* Returns high-quality structured questions

#### **B) Client-Side Fallback Mode**

* Extracts sentences from documents
* Generates:

  * Single-choice
  * Multiple-choice
  * Written answers
  * Match-the-pair
* Ensures quizzes even with **no backend**

---

### 📝 3. Customizable Quiz Settings

* Number of questions
* Difficulty: **easy, medium, hard, mixed**
* Question types: **single**, **multiple**, **written**, **match**
* Passing score configuration
* Time limit (minutes → seconds)
* Distractor similarity range (min/max)

---

### 🧪 4. Full Quiz Player

✔ Keyboard shortcuts (← → Enter)
✔ Per-question timing
✔ Progress bar
✔ Semantic scoring for written answers
✔ Supports 4 question types
✔ Clean UI with TailwindCSS & lucide-react icons

---

### 🧮 5. Semantic Scoring Engine

Written answers use:

* Token normalization
* Stopword removal
* Jaccard similarity
* Cosine similarity
* Bigram matching

Score awarded = `similarity * points`
Correct if similarity ≥ **0.6**

---

### 📊 6. Analytics Dashboard

✔ Attempt history saved in **localStorage**
✔ Topic-wise performance breakdown
✔ Pie chart using `recharts`
✔ Detailed attempt modal
✔ Accuracy grouping (Correct / Partial / Wrong)
✔ Time-per-question averages

---

### 🗂 7. Persistent User Settings

Stored automatically in localStorage:

* question_count
* difficulty
* types
* passing_score
* time_limit
* distractor_sim range

---

# 🛠️ Tech Stack

| Layer     | Technology                                  |
| --------- | ------------------------------------------- |
| Framework | Next.js 14 – App Router                     |
| UI        | React, TailwindCSS, lucide-react            |
| Parsing   | pdfjs-dist, mammoth                         |
| Charts    | recharts                                    |
| Storage   | localStorage                                |
| AI        | Optional backend (OpenAI/Gemini/Custom LLM) |
| Language  | TypeScript                                  |

---

# 📁 Project Structure

```
quiz-gen-pro/
│
├── app/                    # Main Next.js UI + logic
├── embedding_service/      # Backend embedding logic (optional)
├── lib/                    # Utilities
├── public/                 # Static assets
├── types/                  # Global TypeScript types
│
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── package.json
└── README.md
```

---

# 🔧 Local Setup

```bash
git clone https://github.com/saket-pathak/QuizGenPro
cd QuizGenPro

npm install
npm run dev
```

Visit:
👉 [http://localhost:3000](http://localhost:3000)

---

# 🔐 Environment Variables

Create a `.env.local` file:

```
OPENAI_API_KEY=your-key
EMBEDDING_MODEL=text-embedding-3-small
LLM_API_URL=optional
LLM_API_KEY=optional
VECTOR_DB_URL=optional
VECTOR_DB_API_KEY=optional
```

*Env variables are optional — the app works without a backend.*

---

# 🔌 API Endpoints Used by UI (Optional Backend)

### **POST /api/extract**

Used to parse files & index embeddings.

### **POST /api/generate-question**

Used for AI-powered RAG question generation.

If unavailable → **client fallback generator** activates automatically.

---

# 🧠 Core Logic Highlights

### ✔ `generateMockQuiz()`

Creates quizzes from extracted text when no backend is available.

### ✔ `extractPdfText()`

Dynamic import of pdf.js → parses all PDF pages.

### ✔ `extractDocxText()`

Dynamic import of mammoth → pulls raw text.

### ✔ `semanticMatchScore()`

Combines multiple similarity functions for written-answer scoring.

### ✔ QuizPlayer

* Keyboard navigation
* Timer
* Tracking time per question
* Detailed submission object

### ✔ AnalyticsDashboard

* Displays topic-wise accuracy
* Uses recharts PieChart
* Supports "Recent" and "All Attempts" filters

---

# 🧩 How to Use (End-to-End)

1. Upload files (PDF/DOCX/TXT)
2. App extracts or fetches text
3. Configure quiz settings
4. Either:

   * Preview questions
   * Generate full quiz
5. Take the quiz
6. View scoring + detailed analysis
7. Check analytics tab for insights
8. Continue learning!

---

# 🛣️ Roadmap

* [ ] Full backend embeddings + vector DB support
* [ ] PDF Quiz Export
* [ ] User authentication
* [ ] Cloud save for quizzes & attempts
* [ ] Leaderboard & competitive quiz mode
* [ ] Support YouTube/video transcript extraction
* [ ] Custom LLM prompt builder
* [ ] Mobile app (React Native)

---

# 🤝 Contributing

PRs are welcome!

```bash
git checkout -b feature/your-feature
git commit -m "Add your feature"
git push origin feature/your-feature
```

Open a pull request 🚀

---

# 📄 License

MIT License.
Free to use, modify, and distribute.

---

# 🌟 Support

If you like this project:

👉 **Star the repository** ⭐
👉 **Share it**
👉 **Fork and build on top of it**

---


