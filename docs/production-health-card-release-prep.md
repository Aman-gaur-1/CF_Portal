# Student Health Card production release prep

This release-prep package is intentionally separate from the historical
migrations. It does not apply production changes by itself.

## Current production findings

- `coursework_items.deactivated_at` and its trigger semantics already exist;
  do not replay the archive migration.
- The product-model migration is still required.
- All 796 current students are eligible for a login ID backfill. Existing
  password hashes are preserved; no plaintext passwords are produced.
- The deterministic dry-run found 97 duplicate login bases and 117 rows that
  require collision suffixes. IDs are allocated globally by stable student UUID
  order, so duplicate names across batches cannot collide.
- All 345 active coursework items map exactly to an existing batch. There are
  no ambiguous, unknown-batch, or deactivated active items in the current
  production snapshot.
- The activation simulation produces 345 activation rows, 394,927 assignment
  student-item expectations, 453 canonical submitted awards, and 394,474
  pending assignment pairs. There are currently no project catalog items.

## Prepared files

- `supabase/manual/production_health_card_release_dry_run.sql` — read-only
  preflight and count simulation.
- `supabase/manual/production_health_card_compatibility.sql` — guarded,
  idempotent security, login ID, and deterministic activation phase. It has no
  transaction boundary so the runner can rehearse it with rollback.
- `supabase/manual/production_health_card_release_rehearsal.sql` — staging-only
  fixture rehearsal; it always rolls back.
- `scripts/production-health-card-release.ps1` — target-verified runner. It
  defaults to `DryRun`; production `Apply` requires the explicit environment
  guard and a verified backup path.

## Ordered production execution

1. Verify the production connection identity and fresh custom-format backup.
2. Apply `20261018230000_student_health_card_product_model.sql` only.
3. Run the compatibility phase in one transaction: remove public student
   access, restrict archive helper execution, backfill stable login IDs while
   preserving hashes, and insert only exact batch-mapped activations.
4. Verify schema, RLS, grants, login ID uniqueness, activation counts, Health
   Card RPC definitions, and unchanged historical attendance/submission counts.
5. Generate/download credentials through the normal roster workflow where a
   temporary password is genuinely required; never export hashes.
6. Run the production smoke-test matrix before any application deployment.

The archive-semantics migration is `SKIP — already equivalent`, subject only
to the narrow ACL correction included in the compatibility phase.
