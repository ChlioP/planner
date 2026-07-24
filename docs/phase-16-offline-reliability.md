# Phase 16: offline reliability

## Persistence audit

Before Phase 16, planner state was hydrated from feature-specific `localStorage` keys and synchronized by periodic Firestore collection rewrites. This made refresh recovery possible, but `localStorage` was the only local fallback, writes had no durable operation envelope, collection synchronization inferred deletion from local absence, and conflict selection relied mainly on `updatedAt`. There was no transactional queue, entity version, tombstone, quarantine, migration checkpoint, or multi-tab lease.

Phase 16 keeps the existing keys as a non-destructive rollout fallback and adds a user-partitioned IndexedDB database named `bunbun-planner-offline`. Legacy keys are not renamed or cleared.

## Local model

The local database has `entities`, `operations`, `syncState`, `conflicts`, `tombstones`, `migrations`, `leases`, `diagnostics`, and `snapshots` stores. Entity records use a compound string key derived only from user ID, trusted entity type, and stable entity ID. Indexed indexes cover user, entity type, sync state, update time, operation state, retry time, conflicts, and diagnostics.

Every observed source entity is imported once at version 1. Subsequent changes write the optimistic entity, prior snapshot, and replayable operation in one transaction. Deletion writes an operation and 90-day tombstone in the same transaction. The existing localStorage persistence remains during the migration retention period.

Settings that are stored as singleton records continue through their existing repositories in this rollout; the normalized adapter currently covers task, session, availability, schedule, time, reminder, calendar-link, assistant-history, project, goal, dependency, recurrence, and routine-template records.

## Versioning and remote writes

Entities start at integer version 1 and increment for each durable mutation. Operations retain the base and result version. Firestore collection writes now run in bounded groups of 100 version-aware transactions, attach `schemaVersion`, `entityVersion`, and `lastOperationId`, and recognize a repeated operation as success. A remote collection is no longer destructively pruned merely because a local client omitted a document.

Remote transaction metadata is an incremental compatibility adapter. The Firestore rules protect new reliability collections and ownership, while version comparison and complex domain constraints remain enforced in trusted repository code because rules cannot efficiently validate every multi-document invariant.

## Reconciliation and conflict policy

Remote records are validated and compared by explicit versions. A pending local edit is never replaced by its acknowledged base. Non-overlapping changes may merge from a retained base snapshot. Same-field edits create a durable conflict.

Atomic groups include:

- task project and milestone assignment
- task due date and due time
- task lifecycle state and lifecycle timestamps
- recurrence linkage fields
- schedule interval fields
- schedule lock and lifecycle fields
- project, goal, and milestone lifecycle fields
- recurrence rule, start, end, and timezone

Arrays are not generically merged. Time logs are treated as immutable. Unsupported newer schemas are not overwritten. Delete-versus-edit, recurrence-definition, reorder, invalid-domain, permission, and schema conflicts remain reviewable. Resolution produces a later ordinary mutation; raw planner JSON is not the primary review surface.

## Queue, retries, and crash recovery

Operations have stable IDs and idempotency keys. Processing records older than one minute return to pending at startup. Transient network, timeout, contention, authentication-refresh, unavailable, and rate-limit errors use persisted exponential backoff with jitter, capped at five minutes. Permanent schema and permission errors remain visible and do not retry endlessly.

Only explicitly safe updates coalesce. Time logs, calendar sync records, recurrence exceptions, and AI audits never use generic last-write coalescing. The coordinator processes at most 100 operations per pass and acknowledges an entity only if the response still matches that entity’s latest operation and version.

## Multiple tabs and devices

`BroadcastChannel` carries non-sensitive sync notifications where supported. A transactional 15-second local lease, renewed every five seconds by an active coordinator, selects one preferred tab. Correctness does not rely on perfect election: operation idempotency protects overlapping workers and an expired lease can be taken over after a tab crash.

Device, client, and tab identifiers are random local IDs. They contain no account data or fingerprint. They are used only for operation attribution, leases, and friendly conflict explanations.

## Migration, corruption, and quota

Migrations are ordered, idempotent, and checkpointed. Legacy imports run in batches of 250, preserve IDs and unknown record fields, and do not delete legacy storage. Canonical SHA-256 checksums detect accidental local inconsistency; checksums are not encryption. Invalid or mismatched records are quarantined with content-free diagnostic codes instead of being deleted silently.

Cleanup removes disposable diagnostics and acknowledged operations first. Acknowledged operation retention is 30 days; tombstone retention is at least 90 days. Pending, failed, retrying, or conflicted operations and unresolved conflicts are never compacted.

If IndexedDB is unavailable, blocked, aborted, or over quota, the planner continues through its established localStorage behavior and shows that changes may not survive browser closure. The database is never reset automatically.

## Privacy and service separation

Diagnostics retain codes, counts, timings, entity types, and operation types. Keys containing title, description, notes, calendar, prompt, message, or content are removed. Tokens, provider credentials, calendar titles, AI messages, and planner free text are not included.

Planner/Firestore synchronization, Google Calendar publishing, and AI provider requests remain separate state machines. A Firestore acknowledgment does not mean a Google event was published. Approved AI changes become ordinary planner mutations; AI failures do not block planner sync. Deterministic recurrence keys and exceptions remain the source of duplicate protection for generated occurrences.

## Background and history limitations

Browser background execution is not guaranteed. Closing the browser can pause synchronization; durable changes resume when the planner is next opened under the same account. Service workers are not required for correctness.

The current rollout dual-writes normalized IndexedDB after established repository state changes and uses the existing Firestore synchronizers as the remote transport. It does not yet provide a server-maintained device registry, guaranteed remote atomicity for operations above Firestore transaction limits, or automatic remote tombstone compaction. Historical collections continue to use existing eager Firestore reads; bounded on-demand listeners are a remaining optimization.
