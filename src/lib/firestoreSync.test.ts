import { describe, expect, it } from "vitest";
import { mergeTaskCopies } from "./firestoreSync";
import type { TaskRecord } from "./taskHistory";

const baseTask: TaskRecord = {
  id: "stable-task-id",
  title: "Local title",
  date: "2026-07-22",
  time: "09:00",
  status: "planned",
  priority: "medium",
  category: "Task",
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
  });
});
