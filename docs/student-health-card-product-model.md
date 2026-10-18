# Student Health Card product model

This document describes the local refactor prepared for review. It is not a
production rollout instruction. The migration is intentionally unapplied and
no production data is rewritten.

## Product rules

- Assignment = 5 points; Project = 10 points; approved attendance = 1 point.
- A Health Card total is coursework points plus attendance points.
- Leaderboard rank uses coursework points only, with deterministic tie breaks.
- Legacy `100` and `200` submission types are normalized at read time.
- Legacy `20` and `50` rows do not earn Assignment/Project Health Card points.
- Multiple valid attendance sessions on one date collapse to one daily point.
- A date is tracked only when a non-legacy attendance session exists for the
  batch. Working-calendar entries do not fabricate tracked attendance dates.

## Catalog versus activation

`coursework_items` remains the canonical catalog. The new
`batch_coursework_assignments` table records when an item becomes expected for
a batch and who activated it. Catalog creation therefore does not create
student pending work. A student submission must carry the active
`coursework_item_id`; the API derives its title, type, and phase from the
canonical item instead of matching free text.

## Roster safety

The admin roster flow accepts XLSX/XLS/CSV, previews New/Existing/Possible
duplicate/Invalid rows, and imports only safe New rows. New accounts get a
readable login ID and a bcrypt temporary-password hash with
`must_change_password=true`. Plaintext temporary passwords are returned only
in the immediate import/reset response and are not stored in the roster audit
row. The reset endpoint generates a new temporary password rather than
attempting to retrieve an old one.

## Attendance safety

Student self-mark remains session-scoped. `legacy_backfill` sessions are never
eligible for self-marking, and missing-session approval remains blocked by the
attendance safety hotfix. Attendance issue requests retain the
`student_attendance_query` source and never create a session from a batch/date.

## Review gate

Before any future staging/production rollout, apply the new migration only in
an isolated staging database, run the health-card, attendance, auth,
evaluator, and refactor regression suites, inspect the generated credentials
handling, and verify the production read-only attendance blocker remains
unchanged. Do not run `supabase db push` as part of this local review.
