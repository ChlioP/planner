# Phase 15: recurring tasks and routines

## Data ownership

A recurrence definition describes a bounded rule and template. An occurrence records one eligible local date or flexible weekly slot. A generated task remains the authoritative unit of work and links back to exactly one occurrence. Sessions, schedule blocks, timers, risk, analytics, reminders, projects, and milestones continue to use their existing repositories.

The implementation calls this persisted series record `RecurrenceDefinition` for backward compatibility with the first Phase 15 iteration. It is the recurrence-series source of truth described by the product model.

Definitions and occurrences never replace one-time tasks. Existing tasks have no recurrence fields after migration.

## Generation

Generation is a pure local-date calculation followed by an idempotent materialization step. Keys include the definition ID, rule version, and local date; times-per-week keys additionally use the local Monday week start and slot index. Titles are never used for deduplication.

Defaults generate 30 days ahead, retain at least five future occurrences, and cap one run at 100 new records. A hard implementation limit of 500 prevents unbounded generation. App-open generation runs once after local hydration. There is no claim of background delivery while the planner is closed.

The automatic catch-up range is 14 days. Dates older than that are not materialized automatically and therefore are outside consistency denominators until the user records or recovers them.

## Supported rules

- Daily intervals
- Weekly intervals with selected weekdays
- Monthly day-of-month with skip or last-day behavior
- Monthly weekday positions
- Yearly dates with explicit leap-day behavior
- Flexible times-per-week slots with no more than one generated slot per eligible day

Yearly and flexible times-per-week rules are retained for backward compatibility with already-created Phase 15 data. The normal series editor exposes daily, selected-weekday, and flexible weekly patterns; arbitrary cron remains unsupported.

All calculations use local `YYYY-MM-DD` values and do not parse date-only values through UTC. Recurrence timezones are validated IANA identifiers.

## Completion and consistency

Completing a generated task marks its occurrence completed. Reopening the task returns the occurrence to generated. Running or paused timer time never completes an occurrence. Skipped records remain distinct and visible.

Consistency reports completed, skipped, open, and eligible occurrences for the selected period. It uses neutral language and does not calculate streaks, points, rewards, or grades. Older dates that were never generated are not silently treated as missed.

## Editing and lifecycle

Pausing, completing, or archiving a definition stops future generation but preserves generated tasks and occurrence history. Existing generated occurrences retain the template values copied at their generation time. A rule version in new keys prevents edited rules from reusing unrelated keys.

Skipping is explicit. Carry-forward never creates work silently. Generated tasks can be scheduled manually or through the existing Phase 7 preview; no second scheduler exists.

Editing one occurrence marks its task metadata `modified`. Entire-series default edits update only untouched future generated tasks after an affected-count confirmation. “This and future” creates a new stable series, ends the original before the boundary, preserves task IDs, and writes moved-to-series exceptions. Completed and skipped work is retained.

Deleted, suppressed, moved, and detached logical dates have stable exception records. Their occurrence keys participate in generation deduplication, so deleted work is not recreated. Detaching retains the task as a one-time task.

Reusable routine templates are inert records. They store task defaults, an optional supported recurrence rule, and optional session blueprints, but do not generate tasks until explicitly used.

## Persistence

Additive local keys:

- `planner_recurrence_definitions_v1`
- `planner_recurrence_occurrences_v1`
- `planner_recurrence_exceptions_v1`
- `planner_routine_templates_v1`

Firestore collections:

- `users/{userId}/recurrenceDefinitions`
- `users/{userId}/recurrenceOccurrences`
- `users/{userId}/recurrenceExceptions`
- `users/{userId}/routineTemplates`

Internal recovery backup version 13 contains all recurrence collections. Derived consistency and health summaries are not persisted.

## Current limits

Routine time windows do not cross midnight. Generation while the app is closed is unavailable without existing secure backend infrastructure. Google recurring events, recurring projects/goals, social habits, rewards, native widgets, and automatic missed-routine replanning are outside Phase 15.
