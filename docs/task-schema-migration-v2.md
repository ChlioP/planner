# Task schema migration: version 1 to version 2

The planner continues to use the `planner_tasks_v1` localStorage key and the existing
`users/{userId}/tasks/{taskId}` Firestore path. No data is deleted or moved by this migration.

Every task is normalized when it is loaded from localStorage, Firestore, or a JSON backup. The
migration preserves stable IDs, lifecycle state, text, free-form categories, local date/time
strings, and unknown fields. It adds `schemaVersion: 2` and safe defaults for planning fields.
Existing `date`, `time`, `endTime`, `durationMins`, and `note` fields remain available to the
current UI. `scheduledDate` initially mirrors `date`, and `estimatedMinutes` initially mirrors
`durationMins` when that value exists.

Legacy records without lifecycle timestamps receive `1970-01-01T00:00:00.000Z`. A fixed value is
intentional: loading the same record more than once must not continually change it. Newly created
tasks still receive their real creation time.

JSON backup exports now use format version 2. The importer accepts both version 1 and version 2.

## Rollback risk

Older application builds preserve unknown task fields when parsing JSON, but their normal edits and
cloud writes were not designed around version 2. Before rolling back, export a JSON backup. Do not
remove version 2 fields, rename the storage key, or rewrite free-form categories until all local and
Firestore copies have been verified on the newer build. The existing full-mirror Firestore sync is
unchanged and remains the largest risk when different devices run different application versions.
