# Database Notes

## Phase 1 Tables

### assignment_phases

Stores the phase catalog used by assignment filters and new assignment defaults.

Columns:

- `id uuid primary key`
- `name text not null`
- `slug text not null unique`
- `description text not null default ''`
- `color text not null default ''`
- `icon text not null default ''`
- `display_order integer not null default 0`
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Important behavior:

- Phase names are loaded from this table instead of hardcoded lists.
- Disabled phases remain in the table for historical compatibility.
- Existing submissions are not converted or renamed.

### system_settings

Stores generic application settings with JSONB values.

Columns:

- `id uuid primary key`
- `key text not null unique`
- `value jsonb not null default 'null'::jsonb`
- `description text not null default ''`
- `updated_at timestamptz not null default now()`

Initial keys:

- `DEFAULT_PHASE`
- `AUTO_APPROVAL_ENABLED`
- `AUTO_APPROVAL_DELAY`
- `STUDENT_QUERY_ENABLED`
- `NOTIFICATIONS_ENABLED`

## Existing Table Changes

### submissions

Added:

- `workflow_status text not null default 'submitted'`
- `auto_approval_due_at timestamptz`
- `approval_method text`
- `approval_at timestamptz`

`workflow_status` exists for future workflow expansion.

`auto_approval_due_at` is set only when auto approval is enabled and an AI draft is ready. Publishing clears this timestamp.

`approval_method` and `approval_at` record whether final feedback was approved manually or by auto approval.

The existing `phase` column is preserved.

## Phase 3 Tables

### assignment_queries

Stores student questions about already published assignment feedback and trainer resolutions.

Columns:

- `id uuid primary key`
- `submission_id bigint not null references submissions(id) on delete cascade`
- `student_id uuid not null references students(id) on delete cascade`
- `query_text text not null`
- `status text not null default 'open'`
- `trainer_response text`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `created_by text not null default 'student'`
- `updated_by text`
- `resolved_at timestamptz`
- `resolved_by text`

Important behavior:

- Status validation is application-level only.
- Student query APIs allow creation only for published submissions owned by the student.
- Trainer resolution APIs enforce existing trainer batch scope.
- Anonymous and browser client table access is denied through RLS; server APIs use the service role.

## Access Pattern

Server-side helpers use the service-role Supabase client from `lib/supabase-admin.js`.

Client flows use REST endpoints:

- `GET /api/assignment-phases`
- `GET /api/admin-assignment-phases`
- `POST /api/admin-assignment-phases`
- `PATCH /api/admin-assignment-phases`
- `GET /api/admin-workflow-settings`
- `PATCH /api/admin-workflow-settings`
- `POST /api/admin-workflow-settings`
- `GET /api/cron/auto-approval`
- `GET /api/student-queries`
- `POST /api/student-queries`
- `GET /api/teacher-queries`
- `PATCH /api/teacher-queries`
- `GET /api/admin-queries`

## Migration Strategy

The Phase 1 migration:

- Creates `assignment_phases`.
- Creates `system_settings`.
- Adds `submissions.workflow_status`.
- Seeds phases from existing `submissions.phase` values.
- Seeds a default phase setting from the first active phase.
- Seeds future feature settings as disabled.

No existing submission data is removed or renamed.

## Phase 2 Migration Strategy

The Phase 2 migration:

- Adds auto approval due timestamps.
- Adds approval audit fields.
- Adds advisory lock helpers for the cron processor.
- Adds a database function used by the shared publishing helper.
- Adds the auto approval due-date index.

No existing feedback data is removed or renamed.

## Phase 3 Migration Strategy

The Phase 3 migration creates `assignment_queries` and indexes for student, submission, status, and open-query lookups.

No existing tables or existing rows are modified.

## Phase 4 Hardening Migration

The Phase 4 hardening migration adds only indexes for existing hot paths:

- trainer/admin submission reads by batch and submission date
- student submission history reads
- pending review queues
- AI draft queue reads
- batch ownership lookups

No tables, columns, constraints, or data are changed.

The Phase 4.2 access hardening migration explicitly revokes public access and grants service-role access for earlier server-owned tables and helper functions, matching the later protected-table pattern.

## Phase 3.1 Tables

### notifications

Stores generic notification records for students, trainers, admins, and future modules.

Columns:

- `id uuid primary key`
- `user_type text not null`
- `user_identifier text not null`
- `notification_type text not null`
- `title text not null`
- `message text not null`
- `reference_type text`
- `reference_id text`
- `icon text`
- `severity text not null default 'info'`
- `action_label text`
- `action_url text`
- `is_read boolean not null default false`
- `created_at timestamptz not null default now()`
- `read_at timestamptz`
- `expires_at timestamptz`
- `pinned boolean not null default false`
- `delivered_at timestamptz not null default now()`

Important behavior:

- Notifications are created server-side only.
- A unique dedupe index prevents duplicate notifications for the same user, type, and reference.
- Recent, unread, and expiry indexes support notification bell loading and cleanup.
- Rich metadata supports severity styling, icons, action labels, and action URLs.
- Expired notifications are pruned by the server-side notification helper. Pinned notifications are kept until they are read.
- Anonymous and browser client table access is denied through RLS; server APIs use the service role.
- The table is added to the Supabase Realtime publication where available. The browser still reloads notification data through `/api/notifications`.

Phase 3.1 also uses `system_settings` for:

- `NOTIFICATION_PREFERENCES`
- `NOTIFICATION_RETENTION_DAYS`
