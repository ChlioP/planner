# Phase 13 AI-assisted planning

The assistant is disabled by default. Enabling it requires a user gesture and exposes
individual data-category controls. Redaction occurs in application code before the
provider interface is called. Task, session, and schedule IDs are replaced with
request-scoped aliases; the trusted alias map never appears in visible assistant
messages. Notes, descriptions, time data, analytics, risk data, and calendar titles
are independently controlled. Calendar descriptions, attendees, meeting links,
tokens, Firebase configuration, and notification permissions are never included.

This repository has no secure AI backend, so production model calls are intentionally
disabled. `PlanningAssistantProvider` defines the server/provider boundary and
`LocalPlanningAssistantProvider` supplies deterministic development and offline-safe
behavior. It relies on existing Phase 6, 7, 8, 10, and 12 services for session
validation, schedule slots, risk, analytics facts, and external busy time. A future
production endpoint must:

1. Authenticate the Firebase user server-side.
2. Accept only `SanitizedAssistantPrompt` with a 2,000-character message limit.
3. Apply per-user rate and request-size limits.
4. Keep the provider key in a server-only environment variable such as
   `AI_PROVIDER_API_KEY`.
5. Return the versioned `AssistantResponse` schema.
6. Log only safe error codes—not prompts, notes, tokens, or calendar content.
7. Time out requests and perform at most one schema-repair retry.

Model text never mutates planner state. Mutations use a closed union of structured
actions, reject extra fields and unknown aliases, display a review panel, compare the
proposal’s planner version, and re-run existing validators. Each selected action is
idempotent and receives an independent result. Schedule actions remain previews and
must continue through the existing scheduling confirmation flow. Google Calendar
publishing remains completely separate.

Local persistence keys are:

- `planner_ai_assistant_settings_v1`
- `planner_ai_conversation_v1`
- `planner_ai_action_audits_v1`
- `planner_ai_assistant_draft_v1`

Conversation persistence is opt-in and capped. Deleting conversation history does
not delete tasks or concise action audits. Firestore uses
`users/{userId}/settings/aiAssistant`, `users/{userId}/assistantMessages/{messageId}`,
and `users/{userId}/assistantActionAudits/{auditId}`. Rules reject secret and hidden
reasoning fields. Recovery backup schema 10 includes settings, opted-in visible
history, and audits, but no provider credentials or hidden prompts.
