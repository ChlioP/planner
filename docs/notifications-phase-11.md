# Phase 11 notification persistence

Phase 11 adds three backward-compatible records without changing existing storage keys:

- `planner_notifications_v1`
- `planner_reminders_v1`
- `planner_notification_settings_v1`

Authenticated copies use `users/{userId}/notifications/{notificationId}`,
`users/{userId}/reminders/{reminderId}`, and
`users/{userId}/settings/notifications`. The existing user-scoped wildcard Firestore
rule covers these paths, so no rule change was required. Recovery backups are schema
version 8; versions 1–7 still import with empty notification/reminder collections and
quiet defaults.

Notification IDs are derived from deterministic deduplication keys. Manual reminders
use stable UUIDs. Evaluation runs when the app opens, when authoritative planner data
changes, and at most once per local minute while open. It never runs from the timer’s
one-second display tick.

Browser permission is requested only from the notification settings button. Browser
delivery works while the planner is open; there is no backend push service and no
claim of delivery after the browser closes. In-app history remains authoritative.
Multiple devices share records and read/dismiss state, but browser presentation may
occur once per enabled device because there is no server delivery coordinator.

Quiet hours use local `HH:mm` comparisons and support ranges crossing midnight.
In-app records remain available while browser delivery is deferred. Repeated local
times during daylight-saving changes are deduplicated by event key. A daily reminder
whose wall-clock time does not exist is resolved by the JavaScript runtime to the next
valid local time.

Retention is 30 days for read/dismissed notifications and 14 days for cancelled or
expired notifications. Active unread and scheduled records are retained. Cleanup is
local and synchronized on subsequent normal writes; no background cleanup job is
introduced.
