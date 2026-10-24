# Attendance safety policy

Pending attendance requires an authoritative class session before approval.
Admin and teacher review APIs reject approval of any pending row whose
`session_id` is null, while rejection remains available. Approved historical
rows are not rewritten by this guard.

Sessionless legacy rows are shown as `Legacy attendance request` and
`Session required`. A reviewer may reject them, leave them pending, or link
them to an existing authoritative session matching the row's batch and date.
The link action never creates a session from date/batch values and does not
approve the row; approval is a separate action after linking.

Current insertion policy:

- student self-mark: explicit eligible non-legacy session required;
- attendance issue request: `source = student_attendance_query`, pending until reviewed;
- Teams upload: explicit upload session;
- resolved unmatched attendance: existing authoritative session required;
- admin/teacher review: status changes only, with approval guarded by session presence.

Rows with no authoritative session remain pending or are rejected according to
the review decision. They must not be converted into fabricated historical
sessions.

## Database defense in depth

`supabase/manual/attendance_session_safety_guard.sql` adds a controlled
`student_attendance` trigger for future writes. It preserves existing legacy
rows, blocks new sessionless normal attendance, requires batch/date agreement
with the referenced session, rejects self-marking against `legacy_backfill`
sessions, and prevents approval without a session. A pending
`student_attendance_query` may remain sessionless until it is reviewed; it is
still non-approvable. Rejection and session linking remain available.

The companion `supabase/manual/attendance_session_safety_rehearsal.sql` first
demonstrates the old omitted-session write in a staging transaction, then
rehearses the trigger, valid attendance, issue-request rejection, duplicate
protection, and multiple sessions on one day. The entire rehearsal rolls back.

The safe production order is:

1. Deploy the session-safe attendance runtime fix and observe that no new
   `source = legacy`, `status = pending`, `session_id IS NULL` rows appear.
2. Apply the attendance database guard in a separately verified transaction.
3. Only then apply the Health Card product-model migration and its compatibility
   backfill/security transaction.
4. Deploy the remaining Health Card application release and rerun the release
   gate.
