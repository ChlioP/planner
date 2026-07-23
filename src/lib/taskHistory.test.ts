import { describe, expect, it } from "vitest";
import { archiveTask, completeTask, migrateTask, migrateTasks, restoreTask, type TaskRecord } from "./taskHistory";

const NOW = "2026-07-22T12:00:00.000Z";

const task: TaskRecord = {
  id: "task-1",
  title: "Plan release",
  date: "2026-07-22",
  time: "09:00",
  status: "planned",
  priority: "high",
  category: "Task",
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
  archivedAt: null,
};

describe("task history", () => {
  it("migrates legacy statuses and adds history fields without dropping existing fields", () => {
    const migrated = migrateTasks([{ ...task, status: "inProgress", note: "keep me", createdAt: undefined }], NOW);

    expect(migrated[0]).toMatchObject({
      id: "task-1",
      status: "in-progress",
      note: "keep me",
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
      archivedAt: null,
    });
  });

  it("loads a legacy completed task and records its completion", () => {
    const migrated = migrateTask({
      id: 2,
      title: "Legacy task",
      date: "2025-08-13",
      time: "09:00",
      status: "completed",
      priority: "medium",
      category: "Task",
    }, NOW);

    expect(migrated.id).toBe("legacy-2");
    expect(migrated.status).toBe("completed");
    expect(migrated.completedAt).toBe(NOW);
  });

  it("completes without removing the task and can reopen it", () => {
    const completed = completeTask(task, NOW);
    expect(completed).toMatchObject({ id: task.id, status: "completed", completedAt: NOW });
    expect(completeTask(completed, "2026-07-23T12:00:00.000Z")).toMatchObject({
      id: task.id,
      status: "planned",
      completedAt: null,
    });
  });

  it("archives without removing the task", () => {
    expect(archiveTask(task, NOW)).toMatchObject({ id: task.id, status: "archived", archivedAt: NOW });
  });

  it("restores an archived task", () => {
    const archived = archiveTask(task, NOW);
    expect(restoreTask(archived, "2026-07-23T12:00:00.000Z")).toMatchObject({
      id: task.id,
      status: "planned",
      archivedAt: null,
    });
  });

  it("restores the status a task had before archival", () => {
    const completed = completeTask(task, NOW);
    const restored = restoreTask(archiveTask(completed, "2026-07-23T12:00:00.000Z"));

    expect(restored.status).toBe("completed");
    expect(restored.completedAt).toBe(NOW);
  });
});
