# Supabase RLS recommendations (production)

> **Implemented policies:** see [migrations/20250523140000_production_rls_policies.sql](./migrations/20250523140000_production_rls_policies.sql) and [POLICIES.md](./POLICIES.md).

The portal uses the **anon key in the browser** for students/trainers and the **service role** only in API routes for AI. Row Level Security is your primary database firewall.

## Current risk without RLS

If RLS is disabled or permissive, anyone with `NEXT_PUBLIC_SUPABASE_ANON_KEY` can read/write all rows and storage objects allowed by policies.

## Recommended policies (apply in Supabase SQL editor)

### `submissions`

- **Students (anon):** `SELECT` / `INSERT` / `UPDATE` only their own rows (match by session you trust — today the app uses `localStorage`, so true student isolation requires Supabase Auth or signed tokens).
- **Trainers:** full access only via a trusted role or service role (trainer login is env-based today; consider a `trainer` JWT claim later).
- **Hide sensitive columns from anon `SELECT`:** use a view without `password_hash` on `students`, and avoid exposing `ai_evaluation` rubric internals to students if not needed.

### `students`

- **INSERT** for registration; **SELECT/UPDATE** only own row.
- Never allow anon to read `password_hash` of other users.

### `curriculum_chunks`

- **SELECT** allowed for anon (needed if you ever load RAG client-side; today RAG is server-only).
- **INSERT/UPDATE/DELETE** denied for anon — only service role via API (`/api/rag-source`, ingestion).

### Storage `assignments`

- **Upload:** authenticated students only, path prefix or signed upload URLs.
- **Download:** read for owner + trainers; avoid public bucket if possible (use signed URLs).

## AI-specific

- `ai_status`, `ai_feedback`, `ai_evaluation` updates should ideally happen **only via service role** (API routes). Deny anon `UPDATE` on those columns if policies allow column-level rules, or route all AI writes through API only.

## Service role key

- `SUPABASE_SERVICE_KEY` must **never** be exposed to the client or `NEXT_PUBLIC_*` env vars.
- Rotate if leaked.

## Optional hardening

- Enable [Supabase API rate limiting](https://supabase.com/docs/guides/platform/performance#rate-limiting) on the project.
- Use Vercel WAF / Upstash Redis for distributed rate limits on `/api/generate-feedback` (in-memory limits in this app are per-instance only).
