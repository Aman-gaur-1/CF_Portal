# Supabase migrations

## Apply production RLS (recommended before go-live)

Run [migrations/20250523140000_production_rls_policies.sql](./migrations/20250523140000_production_rls_policies.sql).

See [POLICIES.md](./POLICIES.md) for a plain-language explanation of each policy.

## Apply student authentication Phase 1 containment

Run [migrations/20260602120000_student_auth_phase1_containment.sql](./migrations/20260602120000_student_auth_phase1_containment.sql).

This removes browser access to `students.password_hash` and disables direct anon
student registration. Student login and registration now use server API routes.

## Apply assignment storage Phase 1 hardening

Run [migrations/20260602170000_assignment_storage_phase1_hardening.sql](./migrations/20260602170000_assignment_storage_phase1_hardening.sql).

This keeps the `assignments` bucket public while adding the 10 MB bucket limit,
allowed MIME types, opaque filenames for new uploads, and an
`original_file_name` submission field for display.

Admin-only orphan maintenance API:

```bash
# Dry-run report
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/admin-storage-orphans

# Explicit cleanup
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":false,"confirmCleanup":true}' \
  http://localhost:3000/api/admin-storage-orphans
```

## Apply Phase 0 + 1 (AI evaluation)

Run the SQL in [migrations/20250523120000_ai_evaluation_phase0_1.sql](./migrations/20250523120000_ai_evaluation_phase0_1.sql) using either:

1. **Supabase Dashboard** → SQL Editor → paste and run the file, or  
2. **Supabase CLI** (if linked): `supabase db push`

This creates:

- `curriculum_chunks` — phase/topic RAG source  
- New `submissions` columns: `ai_status`, `ai_evaluation`, `submission_text`, `ai_error`, `ai_model`, `ai_rag_version`

Existing rows are unchanged; `ai_feedback` / `feedback` behavior stays the same.

## Apply soft review activity

Run [migrations/20260601190000_submission_soft_review_lock.sql](./migrations/20260601190000_submission_soft_review_lock.sql).

This adds two nullable advisory activity columns to `submissions`. Review markers expire in application logic and never block trainer actions.

## Apply activity log

Run [migrations/20260601210000_activity_log.sql](./migrations/20260601210000_activity_log.sql).

This adds a short-lived append-only operational history used by the admin Recent Activity panel.

## Required env (server)

```env
SUPABASE_SERVICE_KEY=your-service-role-key
QWEN_API_KEY=your-nvidia-api-key
AI_MODEL=qwen3-coder-480b-a35b-instruct
AI_BASE_URL=https://integrate.api.nvidia.com/v1
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` remain used by the browser client.

## GitBook ingestion (Phase 0+)

1. Run [migrations/20250523130000_curriculum_chunks_source_url.sql](./migrations/20250523130000_curriculum_chunks_source_url.sql) (adds `source_url` + unique index).

2. Trigger ingestion (server):

```bash
curl -X POST http://localhost:3000/api/curriculum/ingest-gitbook
```

Or CLI (from project root, with env loaded):

```bash
node scripts/ingest-gitbook.mjs
```

Optional env:

```env
GITBOOK_PYTHON_INDEX_URL=https://pda-assignments.consoleflare.com/python-for-data-analytics/1.python/1.python-documents.md
INGEST_SECRET=your-cron-secret
```

Chunks are stored with `phase`, `topic`, `source_url`, and `updated_by = gitbook-ingest`. Trainer manual chunks (`topic` null, `updated_by = trainer`) are not removed.
