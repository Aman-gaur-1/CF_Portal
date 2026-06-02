# Supabase RLS policies — explained

Apply: `migrations/20250523140000_production_rls_policies.sql` in the Supabase SQL Editor (after earlier migrations).

## How this fits your architecture

| Client | Key | RLS |
|--------|-----|-----|
| Browser (student + trainer) | `anon` | Policies below |
| API routes (`/api/*`) | `service_role` | Bypasses RLS |

Trainer login and student sessions still use **localStorage**, not Supabase Auth. Policies therefore **cannot** prove identity per row for students; they harden what is possible without rewriting the app.

Apply `migrations/20260602120000_student_auth_phase1_containment.sql` after the
base RLS migration. Student login and registration then run through server API
routes. The browser can read only safe student profile columns and cannot insert
student accounts directly.

---

## `submissions`

### Trigger: `guard_submission_ai_fields`

| Operation | `service_role` | `anon` (browser) |
|-----------|----------------|------------------|
| INSERT | Full AI fields | Only `ai_status = 'pending'`; AI text/json cleared |
| UPDATE | Full AI fields | `feedback`, points, phase, etc. allowed; **AI columns frozen** |

**Why:** Prevents tampering with `ai_feedback` / `ai_evaluation` from DevTools. Only the evaluation API may write drafts.

### Policies

| Policy | Operation | Purpose |
|--------|-----------|---------|
| `submissions_anon_select` | SELECT | Trainers list all; students filter by `student_id` in app |
| `submissions_anon_insert` | INSERT | Student submit; requires `student_id` + `topic` |
| `submissions_anon_update` | UPDATE | Trainer feedback, approve flow, points/phase |
| `submissions_anon_delete` | DELETE | Trainer delete submission |

---

## `students`

| Policy | Operation | Purpose |
|--------|-----------|---------|
| `students_anon_select` | SELECT | Safe profile fields only: `id`, `name`, `batch`, `created_at` |
| `students_anon_insert` | INSERT | Removed by Phase 1 containment; registration uses `/api/student-register` |
| `students_anon_update` | UPDATE | Trainer edit student |
| `students_anon_delete` | DELETE | Trainer delete student |

`password_hash` is no longer readable with the anon key. Login verification uses
`/api/student-login` with the server-side service-role client.

---

## `curriculum_chunks`

| Policy | Operation | Purpose |
|--------|-----------|---------|
| `curriculum_chunks_deny_anon` | ALL | **Deny** every anon access |

**Why:** Curriculum is loaded only in server routes (`retrieve.js`, GitBook ingest, `/api/rag-source`). Trainers edit reference text via API (service role), not direct table access.

---

## Storage: `assignments` bucket

Apply `migrations/20260602170000_assignment_storage_phase1_hardening.sql` after
the base RLS migration. The bucket remains public in Phase 1. New browser uploads
must use an opaque `submission_<uuid>.<ext>` object name prepared by
`/api/student-upload`, and the bucket enforces the 10 MB size limit and allowed
MIME types.

| Policy | Operation | Purpose |
|--------|-----------|---------|
| `assignments_anon_select` | SELECT | Download/open files |
| `assignments_anon_insert` | INSERT | Student upload; no path separators in name |
| `assignments_anon_delete` | DELETE | Trainer cleanup on submission delete |
| `assignments_anon_update` | UPDATE | **Denied** (app does not use update) |

**Limitation:** Anyone with the anon key can upload/delete **any** object in this bucket. Per-student paths need Auth or signed URLs later.

---

## Tables not in this migration

`batches`, `trainers` — still without RLS. Add similar anon policies if you enable RLS on them.

---

## Verify after apply

1. Student: register, login, submit file, see feedback tab.
2. Trainer: list submissions, generate AI draft, save/approve feedback, delete submission.
3. `POST /api/rag-source` and `POST /api/curriculum/ingest-gitbook` still work (service role).
4. Direct anon query to `curriculum_chunks` in SQL editor as anon should return **0 rows / permission denied**.
