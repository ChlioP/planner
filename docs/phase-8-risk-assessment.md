# Phase 8 deadline risk assessment

Risk assessments are derived selectors. They are not stored in localStorage or
Firestore and do not create history records. Reopening the app recalculates them
from the current local date, estimates, sessions, availability, overrides,
schedule blocks, and conflicts.

## Score

The optional score is clamped to 0–100:

- capacity ratio: 0, 10, 25, 35, or 40 points
- unscheduled ratio: 0, 5, 12, 20, or 25 points
- deadline proximity: 0, 3, 6, 10, or 15 points
- conflict impact: up to 10 points
- missed-work impact: up to 10 points

Scores 0–24 are On track, 25–49 are Tight, and 50–100 are At
risk. The UI does not present a separate “critical” status; scores of 80–100
remain At risk with critical reasons. Overdue and missing-data states override
the numeric classification. Priority is excluded from the feasibility score and
is used only when the user explicitly sorts by priority.

Feasibility rules can also raise a task to At risk regardless of its numeric
score: insufficient total capacity, a required fixed session that cannot fit,
or conflicts affecting all required coverage. Very small buffer or unscheduled
work within three days can raise an otherwise feasible task to Tight.

## Capacity and coverage

Capacity counts only explicit effective availability from now through the local
deadline date. Commitments, other tasks’ confirmed work, locked proposals, and
the daily planning cap reduce usable capacity. The task’s own valid work remains
available as planned coverage. Cancelled, missed, conflicted, past, and
post-deadline blocks are not reliable future coverage.

Parent risk uses incomplete session estimates when sessions exist, avoiding
double-counting the parent estimate. Fixed sessions are compared with the
largest continuous usable interval.

Task due times are not currently part of the task schema, so deadlines use the
end of the local due date. Risk recommendations are advisory buttons that return
the user to existing planning controls; no recommendation changes data.
