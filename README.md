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
TEACHER_CREDENTIALS={"aman":"yourpassword","trainer2":"pass456"}
```
> Same Supabase URL and key from your Streamlit `secrets.toml`.

### 3. Run locally
```bash
npm run dev
```
Open `http://localhost:3000` (student) and `http://localhost:3000/teacher` (trainer).

## Deploy to Vercel (Free)

1. Push project to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import repo
3. Add the 3 environment variables in Vercel dashboard
4. Deploy → done!

## Routes
- `/` – Student portal (register/login/submit/feedback)
- `/teacher` – Trainer panel (submissions/students/batches)

## No Supabase changes needed
All existing tables (`students`, `submissions`, `batches`) and storage bucket (`assignments`) work as-is.

## Supabase Storage CORS (if needed)
In Supabase dashboard → Storage → Settings → add your Vercel URL to allowed origins.
