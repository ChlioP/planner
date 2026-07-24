# Availability persistence and overrides

Phase 3 adds availability without changing the task repository, task cache key, or task Firestore
path. Blocks use `planner_availability_v1`; overrides use
`planner_availability_overrides_v1`. Authenticated copies are stored under
`users/{userId}/availability/{id}` and `users/{userId}/availabilityOverrides/{id}`. Existing
user-scoped wildcard Firestore rules already cover both collections.

Weekly recurrence is represented by one block for each selected weekday. There is no recurrence
rule parser. A date override is a separate remove or replace record referencing the recurring block.
The recurring source remains unchanged, and removing an override restores the normal week.

Only explicit `available` intervals count toward totals. Available and commitment intervals are
merged independently, then merged commitments are subtracted from merged availability. This avoids
double-counting overlapping availability and double-subtracting overlapping commitments.

Backup format version 3 includes blocks and overrides. Versions 1 and 2 remain importable and are
treated as having empty availability. Invalid availability aborts import with a record-specific
validation message.

The existing full-mirror Firestore synchronization behavior remains a rollback and multi-device
risk. Export a backup before using an older application build against data written by Phase 3.
