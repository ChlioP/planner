import { describe, expect, it } from "vitest";
import { createPlannerBackup, mergeBackupTasks, parsePlannerBackup } from "./plannerBackup";
import { createTask } from "./taskHistory";

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
    expect(parsePlannerBackup(JSON.stringify(backup), NOW)).toEqual(backup);
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
