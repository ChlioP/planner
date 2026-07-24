import { describe, expect, it } from "vitest";
import { mergeAvailabilityTemplateData, mergeTaskCopies, mergeTaskSessionData, mergeTimeLogData } from "./firestoreSync";
import { TASK_SCHEMA_VERSION, type TaskRecord } from "./taskHistory";
import { createAvailabilityTemplate, editAvailabilityTemplate } from "./availabilityTemplates";
import { createTaskSession, editTaskSession } from "./taskSessions";
import { completeTimer, createTimerLog, editCompletedTimeLog } from "./timeLogs";

const baseTask: TaskRecord = {
  schemaVersion: TASK_SCHEMA_VERSION,
  id: "stable-task-id",
  title: "Local title",
  date: "2026-07-22",
  time: "09:00",
  status: "planned",
  priority: "medium",
  category: "Task",
  tags: ["sync"],
  dueDate: "2026-07-25",
  estimatedMinutes: 90,
  actualMinutes: 35,
  isSplittable: true,
  minimumSessionMinutes: 30,
  maximumSessionMinutes: 60,
  isGeneratedSession: false,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
  completedAt: null,
  archivedAt: null,
};

describe("Firestore task merging", () => {
  it("deduplicates repeated copies by stable ID and keeps the newest version", () => {
    const remoteTask = {
      ...baseTask,
      title: "Remote title",
      updatedAt: "2026-07-22T00:00:00.000Z",
    };

    const merged = mergeTaskCopies([baseTask], [remoteTask]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("Remote title");
    expect(merged[0]).toMatchObject({
      schemaVersion: 5,
      tags: ["sync"],
      dueDate: "2026-07-25",
      estimatedMinutes: 90,
      actualMinutes: 35,
      isSplittable: true,
      minimumSessionMinutes: 30,
      maximumSessionMinutes: 60,
    });
  });
});

describe("Firestore availability template merging", () => {
  it("preserves template and block fields while keeping the newest stable-ID copy", () => {
    const local = createAvailabilityTemplate({
      id: "template-id",
      name: "Workday",
      blocks: [{ id: "block-id", name: "Work", startTime: "09:00", endTime: "18:00", type: "work" }],
    }, "2026-07-22T00:00:00.000Z");
    const remote = editAvailabilityTemplate(local, { name: "Updated Workday" }, "2026-07-23T00:00:00.000Z");

    expect(mergeAvailabilityTemplateData([local], [remote, remote])).toEqual([remote]);
  });
});

describe("Firestore task session merging", () => {
  it("preserves session fields and stable IDs while keeping the newest copy", () => {
    const local = createTaskSession({ id: "session-id", parentTaskId: "stable-task-id", title: "Research", estimatedMinutes: 60, actualMinutes: 30, status: "planned", order: 0, isGenerated: true }, "2026-07-22T00:00:00.000Z");
    const remote = editTaskSession(local, { title: "Updated research" }, "2026-07-23T00:00:00.000Z");
    expect(mergeTaskSessionData([local], [remote, remote])).toEqual([remote]);
  });
});

describe("Firestore time-log merging", () => {
  it("preserves timer fields and stable IDs while preventing retry duplicates", () => {
    const local = completeTimer(createTimerLog({ id: "log-id", taskId: "stable-task-id", sessionId: "session-id" }, "2026-07-22T00:00:00.000Z"), "2026-07-22T00:30:00.000Z");
    const remote = editCompletedTimeLog(local, { durationMinutes: 35 }, "2026-07-23T00:00:00.000Z");
    expect(mergeTimeLogData([local], [remote, remote])).toEqual([remote]);
  });
});
