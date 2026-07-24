# Phase 14: projects, goals, and long-term planning

## Source of truth

Tasks remain the units of work, sessions remain the units used to divide work, and schedule blocks remain the units of planned time. Goals, projects, milestones, and finish-to-start dependencies add optional structure above tasks. Progress and health are derived and are not persisted.

The task schema adds optional `projectId` and `milestoneId` fields. A milestone assignment is valid only when its project matches the task's project. Assigning a task preserves its stable ID, category, priority, sessions, schedule blocks, reminders, and time logs.

## Progress rules

- Task-count progress uses top-level tasks. A task with sessions contributes its completed-session effort once through the parent.
- Effort-weighted progress uses estimates as scope. Tasks without estimates are excluded and produce a visible warning; they are never silently assigned guessed effort.
- Milestone-completion progress excludes skipped and archived milestones.
- Manual progress is clamped and validated between 0 and 100 and is labeled as manual.
- Goals use completed projects, eligible milestones, or manual progress according to their selected mode. Paused projects remain in the project-completion denominator.
- Reaching 100% never changes an entity's status automatically.

## Health and dates

Project health reuses the Phase 8 task-risk assessments and availability capacity, including selected Google Calendar busy time. Completed and paused project states take precedence. A passed project target is overdue; task risk, conflicts, missing estimates, and missing availability produce explainable health reasons. Health calculation never changes a task or schedule.

Project and milestone target dates are planning checkpoints. Task deadlines remain authoritative. Date alignment review reports tasks or milestones outside the project dates and projects beyond a goal target, but saving remains allowed and no dates are rewritten.

## Dependencies

Phase 14 supports finish-to-start dependencies inside one project. Validation rejects self-links, duplicates, cross-project links, and cycles. Topological order uses task ID as its deterministic tie-breaker.

Warning-only mode leaves ordinary scheduling eligible and identifies unmet predecessors. Strict mode keeps successors without a known predecessor completion point unscheduled. A completed predecessor satisfies the dependency; reopening it makes the dependency unmet again. Dependencies never trigger automatic replanning.

## Storage and synchronization

Local storage uses additive keys:

- `planner_goals_v1`
- `planner_structured_projects_v1`
- `planner_milestones_v1`
- `planner_task_dependencies_v1`

The structured-project key is intentionally separate from the legacy checklist-project key. Internal backup format version 11 adds all four collections. Firestore uses user-scoped flat collections named `goals`, `projects`, `milestones`, and `taskDependencies`; stable IDs make writes and reconciliation idempotent.

Derived progress and health are not stored. Current task assignment is used for historical analytics attribution because assignment-history snapshots are not available.

## Current boundaries

The timeline is read-only. There is no editable Gantt view, recursive project nesting, automatic dependency rescheduling, shared project support, or external project-management integration. Offline writes follow the existing local-first cache and synchronize when the app reconnects; concurrent edits use the existing newest-`updatedAt` merge behavior.
