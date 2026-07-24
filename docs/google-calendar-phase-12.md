# Phase 12 Google Calendar integration

Google Calendar connection is read-only first. The read-only button requests only
`calendar.readonly`; the publishing button separately requests `calendar.events`.
Firebase authentication does not imply Calendar API authorization. OAuth access
tokens live only in component memory and are not placed in local storage, Firestore,
backups, logs, or UI messages. With no secure token backend, refresh tokens and
closed-browser/background synchronization are intentionally unsupported.

The event cache covers 30 days before today through 90 days after today. It is local
only because event titles can be sensitive. Safe connection metadata, sync settings,
and planner-to-Google link records synchronize under:

- `users/{userId}/calendarConnections/google`
- `users/{userId}/calendarSyncSettings/google`
- `users/{userId}/calendarSyncRecords/{recordId}`

Firestore rules reject token/client-secret fields and validate Google provider link
records. Recovery backup schema 9 includes safe calendar metadata/settings/links,
but not OAuth tokens or cached external events.

Selected opaque events form an additional derived busy layer. Cancelled events,
unselected calendars, transparent events, and all-day events do not block time by
default. Tentative events do. Overlaps are merged. All-day end dates are exclusive.
Events linked to an already-published planner block are not subtracted twice.

Confirmed planner schedule blocks remain authoritative. Publishing is manual,
previewed by confirmation, and idempotent through a stable sync record plus a Google
private extended property. Proposed, completed, cancelled, and missed blocks are not
published. Planner-side/provider-side changes mark the link pending, conflicted, or
detached; neither side is silently overwritten or deleted.

Sync occurs after an explicit connection and manual refresh. Concurrent refreshes
are collapsed. Provider pagination is supported. Cached data remains visible offline
with stale messaging, but provider writes are disabled and never reported as
successful. Each device may refresh independently; shared sync records prevent a
second publish after Firestore synchronization, but this client-only design cannot
promise instantaneous cross-device coordination.
