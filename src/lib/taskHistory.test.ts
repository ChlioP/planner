import { describe, expect, it } from "vitest";
import { TASK_SCHEMA_VERSION, STABLE_LEGACY_MIGRATION_TIMESTAMP, archiveTask, completeTask, createTask, migrateTask, migrateTasks, permanentlyDeleteTask, restoreTask, updateTask, type TaskRecord } from "./taskHistory";

const NOW = "2026-07-22T12:00:00.000Z";

const task: TaskRecord = {
  schemaVersion: TASK_SCHEMA_VERSION,
  id: "task-1",
  title: "Plan release",
  date: "2026-07-22",
  time: "09:00",
  status: "planned",
  priority: "high",
  category: "Task",
  tags: [],
  isSplittable: false,
  isGeneratedSession: false,
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
  archivedAt: null,
};

describe("task history", () => {
  it("creates a task with a stable ID and lifecycle timestamps", () => {
    const created = createTask({
      id: "created-task",
      title: "Created task",
      date: "2026-07-22",
      time: "10:00",
      status: "planned",
      priority: "low",
      category: "Task",
    }, NOW);
    expect(created).toMatchObject({ id: "created-task", createdAt: NOW, updatedAt: NOW, completedAt: null, archivedAt: null });
  });

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

  it("loads legacy text and local planning dates without changing them", () => {
    const legacy = {
      id: "legacy-text",
      title: "Keep title",
      description: "Keep description",
      note: "Keep note",
      date: "2026-03-08",
      time: "23:30",
      category: "Học ngoại ngữ",
      status: "todo" as const,
      priority: "high",
    };

    expect(migrateTask(legacy)).toMatchObject({
      id: "legacy-text",
      title: "Keep title",
      description: "Keep description",
      note: "Keep note",
      date: "2026-03-08",
      scheduledDate: "2026-03-08",
      time: "23:30",
      category: "Học ngoại ngữ",
    });
  });

  it("adds safe defaults without generating load-time timestamps", () => {
    const migrated = migrateTask({ id: "minimal", title: "Unscheduled" });

    expect(migrated).toMatchObject({
      schemaVersion: 5,
      id: "minimal",
      status: "backlog",
      priority: "medium",
      category: "other",
      tags: [],
      isSplittable: false,
      isGeneratedSession: false,
      date: "",
      time: "",
      createdAt: STABLE_LEGACY_MIGRATION_TIMESTAMP,
      updatedAt: STABLE_LEGACY_MIGRATION_TIMESTAMP,
    });
  });

  it("is idempotent when the same task is migrated twice", () => {
    const unknownLegacyFields = { extraLegacyField: "preserved" };
    const once = migrateTask({
      ...unknownLegacyFields,
      id: 99,
      title: "Repeat migration",
      date: "2026-11-01",
      time: "08:15",
      durationMins: 45,
      status: "inProgress",
      priority: "unexpected",
      category: "Custom legacy category",
    });

    expect(migrateTask(once)).toEqual(once);
    expect(once).toMatchObject({
      id: "legacy-99",
      status: "in-progress",
      priority: "medium",
      estimatedMinutes: 45,
      extraLegacyField: "preserved",
    });
  });

  it("produces the same stable IDs when legacy migration is repeated", () => {
    const legacy = { ...task, id: 42, status: "todo" as const };
    expect(migrateTask(legacy, NOW).id).toBe(migrateTask(legacy, NOW).id);
  });

  it("edits a task without changing its stable ID or creation time", () => {
    const edited = updateTask(task, "title", "Edited title", "2026-07-23T00:00:00.000Z");
    expect(edited).toMatchObject({ id: task.id, title: "Edited title", createdAt: NOW, updatedAt: "2026-07-23T00:00:00.000Z" });
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

  it("keeps legacy archived tasks archived", () => {
    const migrated = migrateTask({
      id: "archived-legacy",
      title: "Archived task",
      date: "2025-08-13",
      time: "09:00",
      status: "archived",
      priority: "low",
      category: "Task",
    }, NOW);

    expect(migrated).toMatchObject({ status: "archived", archivedAt: NOW });
  });

  it("creates new tasks with the expanded model", () => {
    const created = createTask({ title: "Expanded task", date: "2026-07-22", time: "10:00" }, NOW);

    expect(created).toMatchObject({
      schemaVersion: 5,
      status: "planned",
      priority: "medium",
      category: "other",
      tags: [],
      scheduledDate: "2026-07-22",
      isSplittable: false,
      isGeneratedSession: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("preserves expanded fields through local-cache JSON serialization", () => {
    const expanded = createTask({
      id: "round-trip",
      title: "Round trip",
      date: "2026-11-01",
      time: "01:30",
      dueDate: "2026-11-02",
      estimatedMinutes: 120,
      actualMinutes: 35,
      isSplittable: true,
      minimumSessionMinutes: 30,
      maximumSessionMinutes: 60,
      tags: ["school"],
    }, NOW);

    expect(migrateTasks(JSON.parse(JSON.stringify([expanded])))).toEqual([expanded]);
  });

  it("does not shift local date-only values across timezone settings", () => {
    const originalTimezone = process.env.TZ;
    const dates = ["America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Honolulu"].map((timezone) => {
      process.env.TZ = timezone;
      return migrateTask({
        id: `timezone-${timezone}`,
        title: "Local date",
        date: "2026-03-08",
        time: "01:30",
      }).scheduledDate;
    });
    process.env.TZ = originalTimezone;

    expect(dates).toEqual(["2026-03-08", "2026-03-08", "2026-03-08"]);
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

  it("permanently deletes only the selected task from the supplied collection", () => {
    const secondTask = { ...task, id: "task-2" };
    expect(permanentlyDeleteTask([task, secondTask], task.id)).toEqual([secondTask]);
  });
});
