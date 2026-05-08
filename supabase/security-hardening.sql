-- Apply only after the preview deployment has been tested with:
-- SUPABASE_SERVICE_ROLE_KEY and AUTH_SECRET configured in Vercel.
-- This blocks direct browser/anon access; the Next.js API routes continue to work.

alter table if exists public.students enable row level security;
alter table if exists public.submissions enable row level security;
alter table if exists public.batches enable row level security;

alter table if exists public.students force row level security;
alter table if exists public.submissions force row level security;
alter table if exists public.batches force row level security;

revoke all on table public.students from anon, authenticated;
revoke all on table public.submissions from anon, authenticated;
revoke all on table public.batches from anon, authenticated;

-- Make assignment files private. The app now returns 24-hour signed URLs.
update storage.buckets
set public = false
where id = 'assignments';
