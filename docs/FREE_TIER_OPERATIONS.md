# Free-tier operations guardrails

This release keeps the portal within the Vercel Hobby operating envelope without changing attendance, coursework, scoring, role security, or AI business rules.

## Runtime placement

- Vercel functions are configured for `bom1` (Mumbai).
- Supabase production is `ap-south-1` (Mumbai).
- The placement is intentional: application functions should run close to the database. Verify the deployed function region after every production deployment.

## Request cadence

- Student coursework loads on tab open, visibility/online resume, notifications/coursework refresh events, and submission mutations. It has no idle timer.
- Student query refresh has a five-minute visible-tab fallback and is also refreshed on tab open, resume, and refresh events.
- Teacher review lists and query counts have a five-minute visible-tab fallback. Manual refresh and mutations remain the primary path.
- Teacher review activity heartbeats run only while a review is open, active, online, and visible. A stale or out-of-scope lease is rejected by the server and is not treated as an application error.
- Notification Realtime is the primary signal. Healthy channels use a 15-minute visible-tab recovery timer; disconnected channels use five minutes. Hidden tabs schedule no timer.
- Active AI jobs use status-gated backoff polling, abort previous requests, stop on terminal state, and do not poll hidden tabs.

## Database and payload guardrails

- Admin Coursework uses the bounded `submissions(count)` relationship query. The measured production baseline before this release was 1,031 calls, 748,048.83 ms total, and 725.56 ms average.
- The only new database index is `submissions_coursework_item_id_idx`, justified by that measured relationship lookup. It was applied and checked in staging first; production application requires a fresh restorable backup and a controlled migration.
- Do not add indexes for every foreign key based only on advisor output. Review each query shape and plan first.
- API responses use explicit field lists on hot paths and `Cache-Control: no-store` for authenticated/private data. Public caching must not be introduced for student, teacher, admin, attendance, submission, or notification responses.
- Vercel request cancellation is enabled only for the read-only Student Coursework and Student Health routes, and their Supabase reads receive `request.signal`. It is intentionally not enabled on writes, password changes, attendance mutations, coursework creation, or AI mutations.
- System settings retain their bounded in-process cache and invalidation behavior.

## OCR and AI extraction

PDF OCR remains a bounded fallback only. Cached `submission_text` is consumed before storage download or OCR, and the parser caps embedded-image attempts and image bytes. Do not disable or rewrite OCR based on aggregate diagnostics alone; investigate repeated extraction instead.

## Scheduled work

The only scheduled jobs are:

- `/api/cron/auto-approval` at 03:00 UTC
- `/api/cron/notifications` at 03:15 UTC

Do not add high-frequency cron jobs for UI refresh.

## Verification procedure

Run `npm run audit:free-tier` for local static guardrails. It never sends production traffic. Run `npm run test:free-tier-performance` and the normal regression suites before a release. Use staging for E2E and a minimal production smoke only after deployment; do not repeatedly create synthetic production activity.

Record before/after request cadence from browser/network evidence and database query plans. Vercel Hobby does not expose a reliable per-request Fluid CPU reduction number, so report CPU savings only when directly measured; otherwise report the concrete cadence, payload, plan, and region changes.

## Separate security-advisor track

Supabase security-advisor findings are reported separately from this performance release. This release does not alter legacy RLS, `SECURITY DEFINER`, or search-path behavior without a dedicated security review and regression plan.
