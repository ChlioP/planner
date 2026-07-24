# Phase 9 time tracking

`TimeLog` is the timer source of truth. A running log stores accumulated seconds
from earlier segments plus `lastResumedAt`. The live display adds the timestamp
difference; it never persists a per-second counter. Pausing folds the current
segment into `accumulatedSeconds`, and resuming records a new timestamp.

Completed logs use nearest-whole-minute aggregation with a one-minute minimum for
any non-zero log. Exact seconds remain stored. Running, paused, and discarded
logs do not contribute to actual time.

Existing `task.actualMinutes` and `session.actualMinutes` remain unchanged as
legacy manual actual time. Total actual time is legacy actual plus completed
logs. A session log contributes once to its session and once to its parent
aggregate; it is not also counted as a separate parent log. No synthetic
migration logs are created, avoiding repeat-migration duplication.

Time logs use local cache key `planner_time_logs_v1`, Firestore collection
`users/{userId}/timeLogs`, and backup schema version 7. Older backups import with
an empty time-log collection. Stable-ID newest-copy merging makes retry writes
idempotent.

Multiple running records from different devices are preserved and reported as a
conflict. The UI never combines elapsed time silently. Paused timers may coexist
with one running timer so the user can explicitly pause existing work before
starting another.

Schedule-linked logs retain `scheduleBlockId`. Saving never changes the schedule
block or completes work unless the user separately confirms those actions.
Tracked partial effort updates displayed remaining estimates and deadline risk,
while structural scheduling continues to use incomplete session estimates.
