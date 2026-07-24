# Large-task work sessions

Phase 6 stores work sessions separately from parent tasks while keeping each existing task as the
main task. The local cache key is `planner_task_sessions_v1`; authenticated records use
`users/{userId}/taskSessions/{sessionId}`. Existing user-scoped Firestore rules already cover the
collection. Internal backup format version 5 includes sessions and continues accepting versions
1–4.

Automatic splitting is deterministic. It chooses a feasible session count near the preferred
duration, bounded by the minimum and maximum count implied by the session limits, then distributes
the total evenly. Earlier sessions receive one extra minute where needed. This produces
`47, 46, 46, 46` for 185 minutes instead of a five-minute final session. Existing assigned and
completed session effort is not generated again.

Structural parent progress uses the estimated duration of completed sessions:

`min(completed session minutes / parent estimated minutes, 1)`.

The parent is never completed automatically. The interface asks after every active session becomes
complete. Reopening, archiving, restoring, or deleting a session immediately changes derived
totals. A completed session archived later still contributes to structural progress.

Session actual time is aggregated and displayed separately from legacy parent `actualMinutes`.
Those values are never added together, avoiding double-counting until a later time-tracking phase
defines a stronger source-of-truth rule.

Archiving a parent does not mutate its sessions; active views hide them because the parent is
hidden, and restoring the parent reveals them again. Permanent parent deletion explicitly warns
that linked sessions will be deleted and removes them from the same root state update flow.

Session records have optional scheduled fields for forward compatibility, but Phase 6 never fills
them automatically and performs no availability matching or scheduling.
