# Phase 1 Foundation

Phase 1 adds the foundation for a future assignment workflow without activating new workflow behavior.

## Scope

Implemented in Phase 1:

- Dynamic assignment phases stored in `assignment_phases`.
- Server-side default phase configuration through `system_settings.DEFAULT_PHASE`.
- Assignment lifecycle status foundation through `submissions.workflow_status`.
- Centralized workflow status constants and validation helpers.
- Minimal admin phase management.

Not implemented in Phase 1:

- Auto approval.
- Student queries.
- Notifications.
- Schedulers or background workers.
- Analytics.
- Assignment events.

Phase 2 adds auto approval on top of this foundation. Phase 1 remains the database and settings base for dynamic phases and workflow status.

## Backward Compatibility

The existing `submissions.phase` field remains in place and continues to store the display phase name for current portal flows.

Existing submissions keep their current phase values. The migration seeds `assignment_phases` from existing submission phase values so filters and assignment creation can move to database-driven phases without requiring immediate data conversion.

New submissions receive the configured default phase server-side through the existing student submission flow. If phase configuration cannot be loaded, the database default on `submissions.phase` preserves the previous behavior.

## Dynamic Phases

`assignment_phases` stores phase metadata:

- `id`
- `name`
- `slug`
- `description`
- `color`
- `icon`
- `display_order`
- `is_active`
- `created_at`
- `updated_at`

Phases are never physically deleted in the admin UI. They are enabled or disabled through `is_active`.

## System Settings

`system_settings` stores generic JSONB-backed settings so future workflow phases can add configuration without schema changes.

Initial settings:

- `DEFAULT_PHASE`
- `AUTO_APPROVAL_ENABLED`
- `AUTO_APPROVAL_DELAY`
- `STUDENT_QUERY_ENABLED`
- `NOTIFICATIONS_ENABLED`

All future-feature switches default to off.

## Workflow Foundation

`submissions.workflow_status` is added as a non-null text column with default `submitted`.

The current portal does not use `workflow_status` to drive behavior in Phase 1. Valid statuses are centralized in `lib/assignment-workflow.js` for future application-level validation.

Current statuses:

- `submitted`
- `processing`
- `ai_generated`
- `waiting_auto_approval`
- `trainer_editing`
- `published`
- `failed`

## Admin Phase Management

The admin settings area includes a small assignment phase management panel for:

- Adding phases.
- Editing phase metadata.
- Enabling or disabling phases.
- Changing display order.
- Selecting the default phase.

This does not redesign the admin experience.
