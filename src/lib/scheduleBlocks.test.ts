import { describe, expect, it } from "vitest";
import { createAvailabilityBlock, type AvailabilityBlock } from "./availability";
import {
  cleanupBlocksForSessionDeletion,
  confirmSchedulePreview,
  detectScheduleConflicts,
  mergeScheduleBlockCopies,
  migrateScheduleBlock,
  scheduleWork,
  updateScheduleBlock,
  validateScheduleMovement,
  type ScheduleBlock,
  type SchedulingOptions,
} from "./scheduleBlocks";
import { createTask, type TaskRecord } from "./taskHistory";
import { createTaskSession, type TaskSession } from "./taskSessions";

const NOW = "2026-07-23T12:00:00.000Z";
const TODAY = "2026-07-23";
const options = (patch: Partial<SchedulingOptions> = {}): SchedulingOptions => ({
  startDate: "2026-07-27", endDate: "2026-07-31", today: TODAY,
  selectedTaskIds: ["task"], includeUndated: false, includeWeekends: true, includeOverdue: false,
  allowLateScheduling: false, allowDirectSplittable: false, allowFlexibleSessionOrder: false,
  allowSameTaskPerDay: true, replaceUnlockedProposed: false, dailyCapMinutes: 180,
  minimumBreakMinutes: 10, runId: "stable-run", now: NOW, ...patch,
});
const task = (patch: Partial<TaskRecord> = {}) => createTask({
  id: "task", title: "Write essay", date: "", time: "", dueDate: "2026-08-07",
  estimatedMinutes: 60, priority: "medium", status: "planned", ...patch,
}, NOW);
const available = (date = "2026-07-27", startTime = "19:00", endTime = "22:00"): AvailabilityBlock =>
  createAvailabilityBlock({ id: `available-${date}-${startTime}`, name: "Available", date, startTime, endTime, type: "available", isRecurring: false }, NOW);
const commitment = (date: string, startTime: string, endTime: string) =>
  createAvailabilityBlock({ id: `meal-${date}-${startTime}`, name: "Meal", date, startTime, endTime, type: "meal", isRecurring: false }, NOW);
const session = (id: string, order: number, minutes = 60, status: TaskSession["status"] = "planned") =>
  createTaskSession({ id, parentTaskId: "task", title: `Session ${order + 1}`, estimatedMinutes: minutes, status, order, isGenerated: true }, NOW);
const saved = (patch: Partial<ScheduleBlock> = {}) => migrateScheduleBlock({
  id: "block", taskId: "task", title: "Write essay", date: "2026-07-27", startTime: "19:00", endTime: "20:00",
  durationMinutes: 60, source: "automatic", status: "confirmed", isLocked: false, schedulingRunId: "old",
  createdAt: NOW, updatedAt: NOW, ...patch,
});

describe("automatic scheduling", () => {
  it("excludes tasks without estimates, completed tasks, and archived tasks", () => {
    const blocks = [available()];
    const missing = scheduleWork([task({ estimatedMinutes: undefined })], [], blocks, [], [], options());
    expect(missing.proposedBlocks).toHaveLength(0);
    expect(missing.warnings[0]).toContain("Add an estimate");
    expect(scheduleWork([task({ status: "completed" })], [], blocks, [], [], options()).proposedBlocks).toHaveLength(0);
    expect(scheduleWork([task({ status: "archived" })], [], blocks, [], [], options()).proposedBlocks).toHaveLength(0);
  });

  it("places a single-session task in one continuous explicit interval without splitting", () => {
    const result = scheduleWork([task({ estimatedMinutes: 20 })], [], [available()], [], [], options());
    expect(result.proposedBlocks).toMatchObject([{ startTime: "19:00", endTime: "19:20", durationMinutes: 20 }]);
  });

  it("subtracts commitments and starts after a meal", () => {
    const result = scheduleWork([task()], [], [available(), commitment("2026-07-27", "19:00", "19:30")], [], [], options());
    expect(result.proposedBlocks[0]).toMatchObject({ startTime: "19:30", endTime: "20:30" });
  });

  it("does not split a session across intervals that are too short", () => {
    const result = scheduleWork([task({ estimatedMinutes: 90, isSplittable: true })], [session("s1", 0, 90)], [available("2026-07-27", "19:00", "20:00")], [], [], options());
    expect(result.proposedBlocks).toHaveLength(0);
    expect(result.unscheduledWork[0]?.reason).toContain("continuous");
  });

  it("existing confirmed, manual, and locked work consumes availability", () => {
    const existing = [
      saved(),
      saved({ id: "manual", source: "manual", startTime: "20:00", endTime: "20:30", durationMinutes: 30 }),
      saved({ id: "locked", status: "proposed", isLocked: true, startTime: "20:30", endTime: "21:00", durationMinutes: 30 }),
    ];
    const result = scheduleWork([task({ estimatedMinutes: 180 })], [], [available()], [], existing, options());
    expect(result.proposedBlocks[0]?.startTime).toBe("21:00");
  });

  it("replaces only unlocked proposed blocks when selected", () => {
    const proposed = saved({ status: "proposed" });
    const locked = saved({ id: "locked", taskId: "other", status: "proposed", isLocked: true, startTime: "20:00", endTime: "21:00" });
    const result = scheduleWork([task()], [], [available()], [], [proposed, locked], options({ replaceUnlockedProposed: true }));
    expect(result.replaceBlockIds).toEqual(["block"]);
    expect(result.proposedBlocks[0]?.startTime).toBe("19:00");
  });

  it("replanning replaces unlocked future automatic blocks but preserves locked, manual, and completed blocks", () => {
    const blocks = [
      saved(),
      saved({ id: "locked", taskId: "other", isLocked: true, startTime: "20:00", endTime: "21:00" }),
      saved({ id: "manual", taskId: "other", source: "manual", startTime: "21:00", endTime: "22:00" }),
      saved({ id: "done", status: "completed", date: "2026-07-26" }),
    ];
    const result = scheduleWork([task()], [], [available()], [], blocks, options({ replaceUnlockedAutomatic: true }));
    expect(result.replaceBlockIds).toEqual(["block"]);
    expect(result.proposedBlocks[0]?.startTime).toBe("19:00");
  });

  it("does not schedule in the past or after a deadline", () => {
    const result = scheduleWork([task({ dueDate: "2026-07-24" })], [], [available("2026-07-22"), available("2026-07-25")], [], [], options({ startDate: "2026-07-22", endDate: "2026-07-25" }));
    expect(result.proposedBlocks).toHaveLength(0);
  });

  it("respects daily cap, minimum break, and non-overlap", () => {
    const sessions = [session("s1", 0), session("s2", 1), session("s3", 2)];
    const result = scheduleWork([task({ estimatedMinutes: 180, isSplittable: true })], sessions, [available()], [], [], options({ dailyCapMinutes: 120 }));
    expect(result.proposedBlocks).toHaveLength(2);
    expect(result.proposedBlocks.map((block) => block.startTime)).toEqual(["19:00", "20:10"]);
    expect(result.perDayTotals["2026-07-27"]).toBe(120);
  });

  it("keeps ordered sessions blocked after an earlier session cannot fit", () => {
    const result = scheduleWork([task({ isSplittable: true, estimatedMinutes: 120 })], [session("s1", 0, 90), session("s2", 1, 30)], [available("2026-07-27", "19:00", "20:00")], [], [], options());
    expect(result.proposedBlocks).toHaveLength(0);
    expect(result.unscheduledWork[1]?.reason).toContain("earlier");
  });

  it("allows flexible order when enabled", () => {
    const result = scheduleWork([task({ isSplittable: true, estimatedMinutes: 120 })], [session("s1", 0, 90), session("s2", 1, 30)], [available("2026-07-27", "19:00", "20:00")], [], [], options({ allowFlexibleSessionOrder: true }));
    expect(result.proposedBlocks).toMatchObject([{ sessionId: "s2", durationMinutes: 30 }]);
  });

  it("prioritizes earliest deadline, then explicit priority, then stable ID", () => {
    const tasks = [
      task({ id: "z", title: "Later", dueDate: "2026-07-30", priority: "critical" }),
      task({ id: "b", title: "Medium", dueDate: "2026-07-29", priority: "medium" }),
      task({ id: "a", title: "High", dueDate: "2026-07-29", priority: "high" }),
    ];
    const result = scheduleWork(tasks, [], [available()], [], [], options({ selectedTaskIds: ["z", "b", "a"], dailyCapMinutes: 60 }));
    expect(result.proposedBlocks[0]?.taskId).toBe("a");
  });

  it("is deterministic and reports partial scheduling", () => {
    const input = [task({ estimatedMinutes: 120, isSplittable: true, minimumSessionMinutes: 30, maximumSessionMinutes: 60 })];
    const opts = options({ allowDirectSplittable: true, dailyCapMinutes: 60, endDate: "2026-07-27" });
    const first = scheduleWork(input, [], [available()], [], [], opts);
    const second = scheduleWork(input, [], [available()], [], [], opts);
    expect(second).toEqual(first);
    expect(first.unscheduledWork[0]?.remainingMinutes).toBe(60);
  });

  it("does not create a direct-split block shorter than the task minimum", () => {
    const result = scheduleWork([task({ estimatedMinutes: 65, isSplittable: true, minimumSessionMinutes: 30, maximumSessionMinutes: 60 })], [], [available()], [], [], options({ allowDirectSplittable: true }));
    expect(result.proposedBlocks.map((block) => block.durationMinutes)).toEqual([60]);
    expect(result.unscheduledWork[0]?.remainingMinutes).toBe(5);
  });

  it("returns a clear warning when no availability exists", () => {
    const result = scheduleWork([task()], [], [], [], [], options());
    expect(result.warnings).toContain("No available time is configured in the selected range.");
  });
});

describe("preview, persistence, movement, and conflicts", () => {
  it("preview does not mutate existing data and confirmation is selected and idempotent", () => {
    const existing: ScheduleBlock[] = [];
    const preview = scheduleWork([task()], [], [available()], [], existing, options()).proposedBlocks;
    expect(existing).toEqual([]);
    const once = confirmSchedulePreview(existing, preview, [preview[0]!.id], [], NOW);
    const twice = confirmSchedulePreview(once, preview, [preview[0]!.id], [], NOW);
    expect(twice).toEqual(once);
    expect(once[0]).toMatchObject({ id: preview[0]!.id, status: "confirmed" });
  });

  it("cancel is represented by making no confirmation call", () => {
    const existing = [saved()];
    scheduleWork([task()], [], [available()], [], existing, options());
    expect(existing).toEqual([saved()]);
  });

  it("validates movement inside availability, conflicts, deadline, and daily cap", () => {
    const block = saved({ status: "proposed" });
    expect(validateScheduleMovement(block, [available()], [], [], { startDate: "2026-07-27", endDate: "2026-07-31", dailyCapMinutes: 60, allowLateScheduling: false }, "2026-07-31")).toEqual([]);
    const invalid = updateScheduleBlock(block, { startTime: "18:00", endTime: "19:00" }, NOW);
    expect(validateScheduleMovement(invalid, [available()], [], [], { startDate: "2026-07-27", endDate: "2026-07-31", dailyCapMinutes: 60, allowLateScheduling: false }, "2026-07-31")).toContain("Choose a time inside explicit available time and outside commitments.");
  });

  it("lock, unlock, statuses, IDs, dates, and duration survive serialization", () => {
    const locked = updateScheduleBlock(saved(), { isLocked: true }, NOW);
    const unlocked = updateScheduleBlock(locked, { isLocked: false, status: "missed" }, NOW);
    const loaded = migrateScheduleBlock(JSON.parse(JSON.stringify(unlocked)));
    expect(loaded).toMatchObject({ id: "block", date: "2026-07-27", isLocked: false, status: "missed", durationMinutes: 60 });
  });

  it("rejects a duration that differs from start and end", () => {
    expect(() => migrateScheduleBlock({ ...saved(), durationMinutes: 30 })).toThrow("duration must match");
  });

  it("detects availability and moved-deadline conflicts without changing blocks", () => {
    const block = saved();
    const before = JSON.stringify(block);
    const conflicts = detectScheduleConflicts([block], [task({ dueDate: "2026-07-26" })], [available("2026-07-27", "20:00", "22:00")], []);
    expect(conflicts.map((item) => item.reason)).toEqual(expect.arrayContaining([
      "Availability or a commitment now overlaps this work.",
      "The task deadline is now earlier than this work block.",
    ]));
    expect(JSON.stringify(block)).toBe(before);
  });

  it("detects confirmed block overlaps", () => {
    const conflicts = detectScheduleConflicts([saved(), saved({ id: "overlap", taskId: "other", startTime: "19:30", endTime: "20:30" })], [task()], [available()], []);
    expect(conflicts.some((item) => item.reason.includes("overlaps another"))).toBe(true);
  });

  it("missed and cancelled blocks do not cover future work", () => {
    for (const status of ["missed", "cancelled"] as const) {
      const result = scheduleWork([task()], [], [available()], [], [saved({ status })], options());
      expect(result.proposedBlocks).toHaveLength(1);
    }
  });

  it("session deletion cancels active future blocks and preserves history", () => {
    const blocks = [
      saved({ id: "active", sessionId: "s1" }),
      saved({ id: "history", sessionId: "s1", status: "completed" }),
    ];
    expect(cleanupBlocksForSessionDeletion(blocks, "s1", NOW).map((block) => block.status)).toEqual(["cancelled", "completed"]);
  });

  it("merge prevents duplicate Firebase/cache copies and keeps newer data", () => {
    const newer = updateScheduleBlock(saved(), { isLocked: true }, "2026-07-24T00:00:00.000Z");
    expect(mergeScheduleBlockCopies([saved()], [newer, newer])).toEqual([newer]);
  });
});
