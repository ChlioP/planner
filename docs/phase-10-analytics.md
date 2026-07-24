# Phase 10 productivity analytics

Analytics summaries are derived locally and are never written to localStorage,
Firestore, or an external analytics service.

## Range inclusion

- completed time logs use the local date of `startedAt`
- legacy actual minutes use the task completion date, then its scheduled date
- schedule metrics use the schedule block’s local `date`
- task and session completion counts use the local completion timestamp
- estimate comparisons include work completed inside the selected range but use
  its complete lifetime estimate and tracked actual total

Ranges are inclusive local `YYYY-MM-DD` boundaries.

## Counting rules

Only completed, non-discarded time logs count. Session time inherits the parent
task category and is counted once. Legacy actual minutes remain separate from
logs and are included once; Phase 9 created no migration logs.

Planned time includes completed, missed, and confirmed blocks. Proposed and
cancelled blocks are excluded from planned completion. The primary schedule
completion rate is duration-weighted:

`completed past scheduled minutes / eligible past scheduled minutes`

Eligible past minutes include completed, missed, and past incomplete confirmed
blocks. Future and cancelled time is excluded.

Estimate accuracy compares top-level tasks only when they have no sessions. When
sessions exist, completed sessions are compared individually and the parent is
excluded. The page shows median actual-to-estimate ratio, median absolute
variance, and mean absolute-percentage accuracy. Broad estimate insights require
three comparable items.

## Insights and performance

Insights use named deterministic thresholds in `analytics.ts`; at most five are
shown. They cover estimate pattern, category focus, schedule follow-through,
workload concentration, deadline completion, or insufficient data.

The dashboard selector is memoized by its authoritative collections and selected
range. Running timer ticks do not change those collections and therefore do not
recalculate analytics. Detailed records are limited to 100 displayed rows.

CSV contains only the selected, currently filtered records with user-facing
fields. It excludes user IDs, Firebase IDs, and internal record IDs.
