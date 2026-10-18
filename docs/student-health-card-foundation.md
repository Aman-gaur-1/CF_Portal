# Student Health Card foundation

## Validation state

- Staging validation completed successfully against the disposable Supabase project.
- Production has not been migrated or changed. Production schema and migration-ledger review remain a release-gate activity.

## Phase A: repository findings

- The app is a Next.js 14 client portal with route handlers under `app/api`.
- Server routes use `getSupabaseAdmin()` and signed local session tokens. Student identity is reloaded from `students`; teacher batch ownership is resolved fresh through `getTeacherScope()`.
- Existing assignment feedback, review, AI evaluation, auto-approval, notification, query, and admin activity flows use the existing `submissions` fields and are intentionally not rewritten.
- Coursework display scoring is shared through `lib/coursework-scoring.js`: assignments are 5 points and projects are 10 points. Lifetime feedback points use canonical, deduplicated submission facts; Health Card points remain a separate epoch-scoped calculation.
- The repository does not contain a canonical coursework catalog, attendance table, working-day calendar, or effective-dated point-rule table. Existing `submissions` rows use a bigint id and `student_id` is treated as uuid by existing migrations.

## Phase B decisions implemented locally

1. `point_rules` uses half-open effective date ranges. Historical assignment/project rules end at 2026-10-01; Health Card assignment/project/attendance rules begin on that date. A GiST exclusion constraint prevents overlapping active rules.
2. `coursework_items` is a batch-scoped catalog. It is soft-deactivated with `active=false`; submissions retain their optional foreign key and are never speculatively backfilled.
3. `student_attendance` is the source of truth. The API derives the authenticated student, current batch, and Asia/Kolkata date; the database unique constraint handles concurrent duplicates. Only `approved` attendance on a calendar working day earns points.
4. `batch_calendar_days` supplies the denominator. A student’s eligible start date is taken from the new membership history when available, otherwise the pre-migration `students.created_at` fallback is used. A trigger records future registrations and batch changes without rewriting existing student rows.
5. Health Card activity is limited to submissions on/after 2026-10-01 and the student’s current batch snapshot. Linked coursework is awarded once per student/item. Transitional unlinked submissions are awarded at most once per student/type/normalized topic; an exact unique active catalog-title match is used for completion. This avoids repeated-submission farming without guessing historical mappings. A deactivated catalog item is removed from future expected totals but remains awardable for an already-linked valid submission, preserving its earned activity meaning.
6. `RANK()` is computed in PostgreSQL using total points, assignment completion percentage, attendance percentage, final contributing activity time, and student id. Rank is never stored.
7. AI scores and AI pending states remain outside Health Card points. The new UI does not convert an AI score into points.

## API surface

- `GET /api/student-health` — authenticated student-only aggregated snapshot.
- `POST /api/student-attendance` — body ignored; authenticated student/date/batch/status are server-derived. Duplicate same-day requests return 409.
- `GET/PATCH /api/teacher-attendance` — teacher-scoped attendance queue and approve/reject workflow. Scope is checked against the stored attendance batch using fresh ownership data.
- `GET /api/admin-health` — admin-only read-only foundation/configuration view.

## Migration safety and rollback

The Health Card foundation is additive. It adds tables, indexes, RLS, grants, one nullable submission foreign-key column, a membership trigger, seed point rules, and server-only functions. It does not update existing submissions or attendance because no attendance table existed. Staging has been validated; production has not been migrated.

Before production rollout, reconcile the production migration ledger with the actual schema and inspect the SQL in staging first. A rollback should be a separately reviewed migration that first removes API/UI usage, then drops the Health Card functions/trigger and new tables only after confirming no retained Health Card data is needed. Do not use an ad-hoc `DROP` or execute rollback against production.

## Deferred Phase 2 work

- Admin CRUD for coursework items and batch calendar days.
- A reviewed staging backfill/initialization process for existing student memberships and calendars.
- SQL/RPC integration tests against a disposable Supabase/Postgres database.
- Optional Health Card notifications and richer teacher/admin drill-down views.

