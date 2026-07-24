# Phase 7 scheduling

`ScheduleBlock` is the source of truth for scheduled task and session time. The
older task/session scheduled fields remain readable for compatibility but Phase 7
does not write them.

Scheduling runs are explicit. The pure scheduler creates in-memory proposed
blocks; only selected blocks are persisted after confirmation. Confirmed, manual,
and locked blocks consume availability and are preserved. Completed, missed, and
cancelled blocks remain as history but do not cover future remaining effort.

Data is cached under the new `planner_schedule_blocks_v1` key and synchronized at
`users/{userId}/scheduleBlocks/{scheduleBlockId}`. Backup schema version 6 adds
`scheduleBlocks`; versions 1–5 import with an empty schedule-block collection.
Existing keys and records are not renamed or cleared.

Firestore's existing authenticated user wildcard rule already covers the new
collection, so no rule change is required. Permanent parent deletion should remove
linked schedule blocks; session deletion cancels active linked blocks while
preserving completed history. The current Phase 7 UI exposes cancellation and
history preservation; broader archive-flow consolidation remains future work.

Rollback risk: an older build ignores the new cache and backup field, so schedules
will not appear there. It does not damage tasks, sessions, availability, or
templates. Do not delete the schedule-block collection when rolling back.
