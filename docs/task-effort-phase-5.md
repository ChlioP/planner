# Task effort estimation

Phase 5 uses the task fields introduced by schema version 2:

- `estimatedMinutes`
- `actualMinutes`
- `isSplittable`
- `minimumSessionMinutes`
- `maximumSessionMinutes`

No separate effort records, storage keys, Firestore collections, sessions, or scheduling records are
created. The existing `planner_tasks_v1` local cache, `users/{userId}/tasks/{taskId}` Firestore
documents, and backup task array already preserve these fields.

Estimates and manual actual time are whole numeric minutes. The UI converts hours and minutes to
this value without deriving scheduled start/end times. Estimates above 40 hours require review, and
the supported hard limit is 10 weeks. A missing estimate remains valid for legacy and backlog tasks.

Splittable tasks require positive minimum and maximum session durations. Maximum must be at least
the minimum, and minimum cannot exceed the total estimate. Phase 5 stores these preferences but
does not generate sessions.

Remaining effort is `max(estimatedMinutes - actualMinutes, 0)`. Completed tasks display zero
remaining without rewriting their stored estimate or actual time. Estimate-state labels are
descriptive and do not evaluate performance.

The Planning view derives totals directly from the shared task array. It does not calculate
schedule feasibility. Availability, overrides, and templates are not read or changed by effort
updates.
