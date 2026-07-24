import { describe, expect, it } from "vitest";
import { createAvailabilityBlock } from "./availability";
import { createAvailabilityTemplate } from "./availabilityTemplates";
import {
  archiveTaskSession,
  automaticBreakdownEligibility,
  breakdownState,
  completeTaskSession,
  confirmGeneratedSessionPreview,
  createGeneratedSessions,
  createTaskSession,
  editTaskSession,
  manualBreakdownWarnings,
  mergeSessionCopies,
  migrateTaskSessions,
  parentEstimateWarnings,
  reorderTaskSessions,
  restoreTaskSession,
  sessionTotals,
  sessionsForParent,
  splitTaskEffort,
  validateSessionParent,
} from "./taskSessions";
import { archiveTask, createTask, migrateTask, restoreTask } from "./taskHistory";

const NOW = "2026-07-23T12:00:00.000Z";
const parent = createTask({ id: "essay", title: "Write essay", date: "", time: "", estimatedMinutes: 600, isSplittable: true, minimumSessionMinutes: 30, maximumSessionMinutes: 90 }, NOW);

describe("automatic session splitting", () => {
  it("rejects automatic generation for tasks without estimates", () => {
    const task = createTask({ title: "No estimate", date: "", time: "", isSplittable: true }, NOW);
    expect(automaticBreakdownEligibility(task)).toEqual({ eligible: false, message: "Add an estimate before creating work sessions." });
  });

  it("requires explicit manual breakdown for a non-splittable task", () => {
    expect(automaticBreakdownEligibility({ ...parent, isSplittable: false })).toMatchObject({ eligible: false });
    expect(createTaskSession({ parentTaskId: parent.id, title: "Manual", estimatedMinutes: 30, status: "backlog", order: 0, isGenerated: false }, NOW).isGenerated).toBe(false);
  });

  it("splits 600 minutes into ten deterministic 60-minute sessions", () => {
    const result = splitTaskEffort({ remainingTaskMinutes: 600, preferredSessionMinutes: 60, minimumSessionMinutes: 30, maximumSessionMinutes: 90 });
    expect(result.durations).toEqual(Array(10).fill(60));
    expect(result.totalProposedMinutes).toBe(600);
    expect(splitTaskEffort({ remainingTaskMinutes: 600, preferredSessionMinutes: 60, minimumSessionMinutes: 30, maximumSessionMinutes: 90 })).toEqual(result);
  });

  it("redistributes a remainder instead of creating a tiny final session", () => {
    const result = splitTaskEffort({ remainingTaskMinutes: 185, preferredSessionMinutes: 45, minimumSessionMinutes: 30, maximumSessionMinutes: 60 });
    expect(result.durations).toEqual([47, 46, 46, 46]);
    expect(Math.min(...result.durations)).toBeGreaterThanOrEqual(30);
    expect(Math.max(...result.durations)).toBeLessThanOrEqual(60);
    expect(result.durations.reduce((sum, value) => sum + value, 0)).toBe(185);
  });

  it("respects minimum, maximum, and optional session count when possible", () => {
    const result = splitTaskEffort({ remainingTaskMinutes: 240, preferredSessionMinutes: 45, minimumSessionMinutes: 30, maximumSessionMinutes: 60, numberOfSessions: 5 });
    expect(result.durations).toEqual([48, 48, 48, 48, 48]);
  });

  it("excludes completed session effort from new generation", () => {
    const result = splitTaskEffort({ remainingTaskMinutes: 600, existingCompletedSessionMinutes: 60, preferredSessionMinutes: 60, minimumSessionMinutes: 30, maximumSessionMinutes: 90 });
    expect(result.totalProposedMinutes).toBe(540);
    expect(result.durations).toHaveLength(9);
  });

  it("does not persist a preview until confirmation and cancellation changes nothing", () => {
    const stored: ReturnType<typeof createGeneratedSessions> = [];
    const preview = splitTaskEffort({ remainingTaskMinutes: 120, preferredSessionMinutes: 60, minimumSessionMinutes: 30, maximumSessionMinutes: 90 });
    expect(stored).toEqual([]);
    expect(preview.durations).toEqual([60, 60]);
  });

  it("confirmation saves sessions and repeated confirmation skips duplicates", () => {
    const drafts = [{ title: "Essay Session 1", estimatedMinutes: 60 }, { title: "Essay Session 2", estimatedMinutes: 60 }];
    const first = confirmGeneratedSessionPreview([], parent, drafts, NOW);
    const second = confirmGeneratedSessionPreview(first.sessions, parent, drafts, NOW);
    expect(first.created).toHaveLength(2);
    expect(second.created).toHaveLength(0);
    expect(second.sessions).toHaveLength(2);
    expect(second.skippedDuplicates).toBe(2);
  });
});

describe("session lifecycle and parent totals", () => {
  const sessions = () => createGeneratedSessions(parent, [60, 60, 60], ["Research", "Outline", "Draft"], NOW);

  it("edits titles and durations while preserving IDs", () => {
    const session = sessions()[0]!;
    expect(editTaskSession(session, { title: "Sources", estimatedMinutes: 75 }, "2026-07-24T00:00:00.000Z")).toMatchObject({ id: session.id, title: "Sources", estimatedMinutes: 75, createdAt: NOW });
  });

  it("reorders sessions without changing session IDs", () => {
    const original = sessions();
    const ids = original.map((session) => session.id);
    const reordered = reorderTaskSessions(original, parent.id, [ids[2]!, ids[0]!, ids[1]!], NOW);
    expect(sessionsForParent(reordered, parent.id).map((session) => session.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(new Set(reordered.map((session) => session.id))).toEqual(new Set(ids));
  });

  it("warns when manual totals are below or above the estimate", () => {
    expect(manualBreakdownWarnings(600, 0, [{ estimatedMinutes: 300 }])[0]).toContain("300 minutes will remain");
    expect(manualBreakdownWarnings(600, 500, [{ estimatedMinutes: 200 }])[0]).toContain("exceeds");
  });

  it("updates structural progress without automatically completing the parent", () => {
    const original = sessions();
    const completed = [completeTaskSession(original[0]!, NOW), ...original.slice(1)];
    expect(sessionTotals(parent, completed).progressPercent).toBe(10);
    expect(parent.status).toBe("backlog");
    expect(breakdownState(parent, completed)).toBe("Partially broken down");
  });

  it("suggests completion only when all active sessions are complete", () => {
    const completed = sessions().map((session) => completeTaskSession(session, NOW));
    expect(sessionTotals({ estimatedMinutes: 180 }, completed).allActiveSessionsComplete).toBe(true);
    expect(parent.status).not.toBe("completed");
  });

  it("reopening a session reduces progress", () => {
    const completed = sessions().map((session) => completeTaskSession(session, NOW));
    const reopened = [completeTaskSession(completed[0]!, NOW), ...completed.slice(1)];
    expect(sessionTotals({ estimatedMinutes: 180 }, completed).progressPercent).toBe(100);
    expect(sessionTotals({ estimatedMinutes: 180 }, reopened).progressPercent).toBe(67);
  });

  it("deleting a session recalculates assigned and unassigned totals", () => {
    const original = sessions();
    expect(sessionTotals(parent, original).assignedMinutes).toBe(180);
    const afterDelete = original.filter((session) => session.id !== original[0]!.id);
    expect(sessionTotals(parent, afterDelete)).toMatchObject({ assignedMinutes: 120, unassignedMinutes: 480 });
  });

  it("archives and restores sessions and counts previously completed archived work", () => {
    const completed = completeTaskSession(sessions()[0]!, NOW);
    const archived = archiveTaskSession(completed, NOW);
    expect(sessionTotals(parent, [archived]).completedMinutes).toBe(60);
    expect(restoreTaskSession(archived, NOW)).toMatchObject({ status: "completed", completedAt: completed.completedAt, archivedAt: undefined });
  });

  it("parent archive and restore preserve linked sessions and visibility can follow the parent", () => {
    const linked = sessions();
    const archivedParent = archiveTask(parent, NOW);
    expect(linked).toHaveLength(3);
    expect(archivedParent.status).toBe("archived");
    expect(restoreTask(archivedParent, NOW).status).toBe("backlog");
    expect(sessionsForParent(linked, parent.id)).toHaveLength(3);
  });

  it("estimate increases leave unassigned effort and decreases warn without mutating sessions", () => {
    const linked = sessions();
    expect(sessionTotals({ estimatedMinutes: 700 }, linked).unassignedMinutes).toBe(520);
    expect(parentEstimateWarnings(100, linked)[0]).toContain("exceeds");
    expect(linked.reduce((sum, session) => sum + session.estimatedMinutes, 0)).toBe(180);
  });

  it("rejects circular or invalid parent relationships", () => {
    expect(() => validateSessionParent({ id: "same", parentTaskId: "same" }, [parent])).toThrow("own parent");
    expect(() => validateSessionParent({ id: "child", parentTaskId: "missing" }, [parent])).toThrow("valid parent");
  });
});

describe("session persistence and isolation", () => {
  it("preserves sessions through refresh-like local and Firebase serialization", () => {
    const session = createTaskSession({ id: "stable-session", userId: "user", parentTaskId: parent.id, title: "Research", description: "Find sources", estimatedMinutes: 60, actualMinutes: 55, status: "planned", order: 0, isGenerated: true }, NOW);
    const loaded = migrateTaskSessions(JSON.parse(JSON.stringify([session])));
    expect(loaded).toEqual([session]);
    const newer = editTaskSession(session, { title: "Updated" }, "2026-07-24T00:00:00.000Z");
    expect(mergeSessionCopies([session], [newer, newer])).toEqual([newer]);
  });

  it("preserves optional local scheduling strings without generating them", () => {
    const session = createTaskSession({ id: "dated", parentTaskId: parent.id, title: "Manual date", estimatedMinutes: 30, status: "planned", order: 0, isGenerated: false, scheduledDate: "2026-11-01", scheduledStartTime: "01:30", scheduledEndTime: "02:00" }, NOW);
    expect(migrateTaskSessions(JSON.parse(JSON.stringify([session])))[0]).toMatchObject({ scheduledDate: "2026-11-01", scheduledStartTime: "01:30", scheduledEndTime: "02:00" });
    expect(createGeneratedSessions(parent, [60], undefined, NOW)[0]).toMatchObject({ scheduledDate: undefined, scheduledStartTime: undefined });
  });

  it("does not mutate existing availability, templates, or legacy tasks", () => {
    const availability = [createAvailabilityBlock({ id: "availability", name: "Focus", date: "2026-07-23", startTime: "19:00", endTime: "21:00", type: "available", isRecurring: false }, NOW)];
    const templates = [createAvailabilityTemplate({ id: "template", name: "Workday", blocks: [] }, NOW)];
    const legacy = migrateTask({ id: 1, title: "Legacy", date: "2025-01-01", time: "09:00", status: "todo", priority: "medium", category: "Task" });
    const snapshots = [JSON.stringify(availability), JSON.stringify(templates), JSON.stringify(legacy)];
    createGeneratedSessions(parent, [60], undefined, NOW);
    expect([JSON.stringify(availability), JSON.stringify(templates), JSON.stringify(legacy)]).toEqual(snapshots);
  });
});
