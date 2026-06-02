# ConsoleFlare Assignment Portal (Next.js)

Fast, beautiful replacement for the Streamlit portal.

## Stack
- **Next.js 14** (React) – frontend
- **Supabase** – same database, same storage (no migration needed)
- **Vercel** – free hosting, zero cold starts 

## Setup

### 1. Clone and install
```bash
git clone <your-repo>
cd consoleflare-portal
npm install
```

### 2. Environment variables
Copy `.env.local.example` to `.env.local` and fill in values:
```env
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_KEY=your-service-role-key
QWEN_API_KEY=your-nvidia-api-key
AI_MODEL=qwen3-coder-480b-a35b-instruct
AI_BASE_URL=https://integrate.api.nvidia.com/v1
TEACHER_CREDENTIALS={"aman":"yourpassword","trainer2":"pass456"}
TEACHER_SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_CREDENTIALS={"admin":"your-admin-password"}
ADMIN_SESSION_SECRET=replace-with-a-different-long-random-secret
INGEST_SECRET=replace-with-a-long-random-ingest-secret
```
Production deployments require dedicated `TEACHER_SESSION_SECRET`, `ADMIN_SESSION_SECRET`, and `INGEST_SECRET` values.

> Same Supabase URL and key from your Streamlit `secrets.toml`.
> Run the SQL migration in `supabase/migrations/` before using AI evaluation (see `supabase/README.md`).

### 3. Run locally
```bash
npm run dev
```
Open `http://localhost:3000` (student), `http://localhost:3000/teacher` (trainer), and `http://localhost:3000/admin` (admin).

## Deploy to Vercel (Free)

1. Push project to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import repo
3. Add the environment variables in Vercel dashboard
4. Deploy → done!

## Routes
- `/` – Student portal (register/login/submit/feedback)
- `/teacher` – Trainer panel (submissions/students/batches)
- `/admin` – Admin control center (teachers/batches/students/AI operations)

## API (AI evaluation)
- `POST /api/evaluate` – canonical evaluation pipeline (`{ "submissionId": "..." }`)
- `POST /api/generate-feedback` – legacy alias (same behavior)
- `GET/PUT /api/rag-source` – trainer reference document (stored in `curriculum_chunks`)
- `POST /api/curriculum/ingest-gitbook` – sync Python docs from ConsoleFlare GitBook into `curriculum_chunks`

## Database
Existing tables (`students`, `submissions`, `batches`) and storage bucket (`assignments`) are unchanged.
Phase 0+1 adds `curriculum_chunks` and optional AI columns on `submissions` — apply `supabase/migrations/20250523120000_ai_evaluation_phase0_1.sql`.

## Supabase Storage CORS (if needed)
In Supabase dashboard → Storage → Settings → add your Vercel URL to allowed origins.
