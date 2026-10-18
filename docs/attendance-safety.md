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
