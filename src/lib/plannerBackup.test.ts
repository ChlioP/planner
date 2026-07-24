import { describe, expect, it } from "vitest";
import { createPlannerBackup, mergeBackupTasks, parsePlannerBackup } from "./plannerBackup";
import { STABLE_LEGACY_MIGRATION_TIMESTAMP, createTask } from "./taskHistory";
import { createAvailabilityBlock } from "./availability";
import { createAvailabilityTemplate } from "./availabilityTemplates";
import { createTaskSession } from "./taskSessions";
import { migrateScheduleBlock } from "./scheduleBlocks";
import { completeTimer, createTimerLog } from "./timeLogs";

const NOW = "2026-07-22T12:00:00.000Z";
const preferences = { musicQuery: "lofi", checklistByDate: {}, projects: [], checklistNote: "Remember" };
const task = createTask({
  id: "backup-task",
  title: "Back me up",
  date: "2026-07-22",
  time: "09:00",
  status: "planned",
  priority: "medium",
  category: "Task",
}, NOW);

describe("planner backup", () => {
  it("round-trips a versioned JSON backup", () => {
    const backup = createPlannerBackup([task], preferences, NOW);
    expect(backup.version).toBe(13);
    expect(parsePlannerBackup(JSON.stringify(backup), NOW)).toEqual(backup);
  });

  it("includes notification records, reminders, and settings while older backups remain valid", () => {
    const backup = createPlannerBackup([task], preferences, NOW);
    expect(backup.notifications).toEqual([]);
    expect(backup.reminders).toEqual([]);
    expect(backup.notificationSettings.browserEnabled).toBe(false);
    const legacy = parsePlannerBackup(JSON.stringify({ ...backup, version: 7, notifications: undefined, reminders: undefined, notificationSettings: undefined }), NOW);
    expect(legacy.notifications).toEqual([]);
    expect(legacy.reminders).toEqual([]);
    expect(legacy.notificationSettings.inAppEnabled).toBe(true);
  });

  it("includes safe calendar metadata and sync records without provider tokens or cached event titles", () => {
    const backup = createPlannerBackup([task], preferences, NOW);
    expect(backup.calendarConnection.status).toBe("disconnected");
    expect(backup.calendarSettings.publishPlannerBlocks).toBe(false);
    expect(backup.calendarSyncRecords).toEqual([]);
    expect(JSON.stringify(backup)).not.toContain("accessToken");
    expect("externalEvents" in backup).toBe(false);
  });

  it("includes opt-in AI settings and safe audit data without hidden prompts", () => {
    const backup = createPlannerBackup([task], preferences, NOW);
    expect(backup.aiSettings.isEnabled).toBe(false);
    expect(backup.assistantMessages).toEqual([]);
    expect(backup.assistantActionAudits).toEqual([]);
    expect(JSON.stringify(backup)).not.toContain("chainOfThought");
  });

  it("imports existing version 1 exports and migrates their tasks", () => {
    const legacyBackup = {
      format: "bunbun-planner-backup",
      version: 1,
      exportedAt: NOW,
      tasks: [{
        id: 7,
        title: "Version one task",
        date: "2026-07-22",
        time: "09:00",
        status: "completed",
        priority: "high",
        category: "Legacy category",
      }],
      preferences,
    };

    const imported = parsePlannerBackup(JSON.stringify(legacyBackup), NOW);
    expect(imported.version).toBe(1);
    expect(imported.availability).toEqual([]);
    expect(imported.availabilityTemplates).toEqual([]);
    expect(imported.taskSessions).toEqual([]);
    expect(imported.tasks[0]).toMatchObject({
      schemaVersion: 5,
      id: "legacy-7",
      status: "completed",
      completedAt: STABLE_LEGACY_MIGRATION_TIMESTAMP,
      category: "Legacy category",
      scheduledDate: "2026-07-22",
    });
  });

  it("exports and imports availability while leaving tasks unchanged", () => {
    const block = createAvailabilityBlock({ id: "availability-1", name: "Focus", date: "2026-07-22", startTime: "19:00", endTime: "21:00", type: "available", isRecurring: false }, NOW);
    const backup = createPlannerBackup([task], preferences, NOW, [block], []);
    const parsed = parsePlannerBackup(JSON.stringify(backup));
    expect(parsed.tasks).toEqual([task]);
    expect(parsed.availability).toEqual([block]);
  });

  it("reports invalid availability records during import", () => {
    const backup = createPlannerBackup([task], preferences, NOW);
    expect(() => parsePlannerBackup(JSON.stringify({ ...backup, availability: [{ id: "bad" }] }))).toThrow("requires an ID and name");
  });

  it("includes templates in internal backup persistence", () => {
    const template = createAvailabilityTemplate({ id: "template", name: "Workday", blocks: [{ id: "work", name: "Work", startTime: "09:00", endTime: "18:00", type: "work" }] }, NOW);
    const backup = createPlannerBackup([task], preferences, NOW, [], [], [template]);
    expect(parsePlannerBackup(JSON.stringify(backup)).availabilityTemplates).toEqual([template]);
  });

  it("includes linked task sessions in internal backup persistence", () => {
    const session = createTaskSession({ id: "session", parentTaskId: task.id, title: "Research", estimatedMinutes: 60, status: "backlog", order: 0, isGenerated: true }, NOW);
    const backup = createPlannerBackup([task], preferences, NOW, [], [], [], [session]);
    expect(parsePlannerBackup(JSON.stringify(backup)).taskSessions).toEqual([session]);
  });

  it("includes schedule blocks while older backups default to none", () => {
    const block = migrateScheduleBlock({ id: "schedule", taskId: task.id, title: task.title, date: "2026-07-27", startTime: "19:00", endTime: "20:00", durationMinutes: 60, source: "automatic", status: "confirmed", isLocked: false, schedulingRunId: "run", createdAt: NOW, updatedAt: NOW });
    const backup = createPlannerBackup([task], preferences, NOW, [], [], [], [], [block]);
    expect(parsePlannerBackup(JSON.stringify(backup)).scheduleBlocks).toEqual([block]);
    const legacy = { ...backup, version: 5, scheduleBlocks: undefined };
    expect(parsePlannerBackup(JSON.stringify(legacy)).scheduleBlocks).toEqual([]);
  });

  it("includes time logs while older backups default to none", () => {
    const log = completeTimer(createTimerLog({ id: "timer", taskId: task.id }, NOW), "2026-07-23T00:30:00.000Z");
    const backup = createPlannerBackup([task], preferences, NOW, [], [], [], [], [], [log]);
    expect(parsePlannerBackup(JSON.stringify(backup)).timeLogs).toEqual([log]);
    const legacy = { ...backup, version: 6, timeLogs: undefined };
    expect(parsePlannerBackup(JSON.stringify(legacy)).timeLogs).toEqual([]);
  });

  it("rejects unsupported backup files before changing data", () => {
    expect(() => parsePlannerBackup('{"version":99}', NOW)).toThrow("Unsupported");
  });

  it("prevents duplicates and keeps the newest task copy", () => {
    const newer = { ...task, title: "Newest", updatedAt: "2026-07-23T00:00:00.000Z" };
    const merged = mergeBackupTasks([task], [newer, newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("Newest");
  });
});
