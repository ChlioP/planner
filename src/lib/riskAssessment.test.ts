import { describe, expect, it } from "vitest";
import { createAvailabilityBlock, createOverride, type AvailabilityBlock } from "./availability";
import {
  assessActiveTaskRisks,
  assessTaskRisk,
  calculateCapacityBeforeDeadline,
  capacityRatioPoints,
  deadlineProximityPoints,
  filterRiskAssessments,
  riskStatusForScore,
  sortRiskAssessments,
  summarizeRisks,
  unscheduledRatioPoints,
  type RiskContext,
} from "./riskAssessment";
import { migrateScheduleBlock, type ScheduleBlock } from "./scheduleBlocks";
import { completeTask, createTask, type TaskRecord } from "./taskHistory";
import { completeTaskSession, createTaskSession, type TaskSession } from "./taskSessions";

const NOW = "2026-07-23T19:00:00.000Z";
const task = (patch: Partial<TaskRecord> = {}) => createTask({
  id: "task", title: "Write essay", date: "", time: "", status: "planned",
  estimatedMinutes: 60, dueDate: "2026-07-31", ...patch,
}, NOW);
const available = (date: string, startTime = "19:00", endTime = "22:00", id = `a-${date}-${startTime}`) =>
  createAvailabilityBlock({ id, name: "Available", date, startTime, endTime, type: "available", isRecurring: false }, NOW);
const recurring = (dayOfWeek: number, startTime = "19:00", endTime = "22:00", id = `r-${dayOfWeek}`) =>
  createAvailabilityBlock({ id, name: "Available", dayOfWeek, startTime, endTime, type: "available", isRecurring: true }, NOW);
const unavailable = (date: string, startTime: string, endTime: string, id = `u-${date}-${startTime}`) =>
  createAvailabilityBlock({ id, name: "Appointment", date, startTime, endTime, type: "appointment", isRecurring: false }, NOW);
const block = (patch: Partial<ScheduleBlock> = {}) => migrateScheduleBlock({
  id: "block", taskId: "task", title: "Write essay", date: "2026-07-27",
  startTime: "19:00", endTime: "20:00", durationMinutes: 60,
  source: "automatic", status: "confirmed", isLocked: false, createdAt: NOW, updatedAt: NOW, ...patch,
});
const session = (id: string, minutes: number, order = 0, status: TaskSession["status"] = "planned") =>
  createTaskSession({ id, parentTaskId: "task", title: id, estimatedMinutes: minutes, order, status, isGenerated: true }, NOW);
const context = (patch: Partial<RiskContext> = {}): RiskContext => ({
  tasks: [task()], sessions: [], availability: [available("2026-07-27")],
  overrides: [], scheduleBlocks: [], today: "2026-07-23", currentTime: "12:00",
  dailyCapMinutes: 180, calculatedAt: NOW, ...patch,
});

describe("risk status and formula", () => {
  it("returns Completed for completed or zero-remaining work", () => {
    expect(assessTaskRisk(completeTask(task(), NOW), context()).status).toBe("completed");
    expect(assessTaskRisk(task({ actualMinutes: 60 }), context()).status).toBe("completed");
  });

  it("returns Missing data for estimate, deadline, or availability gaps", () => {
    expect(assessTaskRisk(task({ estimatedMinutes: undefined }), context()).reasons[0]?.code).toBe("missing-estimate");
    expect(assessTaskRisk(task({ dueDate: undefined }), context()).reasons[0]?.code).toBe("missing-deadline");
    expect(assessTaskRisk(task(), context({ availability: [] })).reasons[0]?.code).toBe("availability-not-configured");
  });

  it("returns Overdue with exact deadline and remaining effort", () => {
    const assessment = assessTaskRisk(task({ dueDate: "2026-07-22", estimatedMinutes: 20 }), context());
    expect(assessment).toMatchObject({ status: "overdue", remainingMinutes: 20, score: 100 });
    expect(assessment.reasons[0]?.message).toContain("2026-07-22");
  });

  it("classifies enough capacity as On track", () => {
    const assessment = assessTaskRisk(task(), context({ scheduleBlocks: [block()] }));
    expect(assessment.status).toBe("on-track");
    expect(assessment.bufferMinutes).toBe(120);
  });

  it("classifies limited buffer and unscheduled work as Tight", () => {
    const item = task({ estimatedMinutes: 240, dueDate: "2026-07-25" });
    const assessment = assessTaskRisk(item, context({ tasks: [item], availability: [available("2026-07-24", "18:00", "22:30")], scheduleBlocks: [block({ date: "2026-07-24", startTime: "18:00", endTime: "21:00", durationMinutes: 180 })], dailyCapMinutes: 300 }));
    expect(assessment.status).toBe("tight");
    expect(assessment.unscheduledMinutes).toBe(60);
  });

  it("classifies insufficient capacity as At risk and clamps scores", () => {
    const item = task({ estimatedMinutes: 360, dueDate: "2026-07-24" });
    const assessment = assessTaskRisk(item, context({ tasks: [item], availability: [available("2026-07-24")] }));
    expect(assessment.status).toBe("at-risk");
    expect(assessment.bufferMinutes).toBe(-180);
    expect(assessment.score).toBeGreaterThanOrEqual(0);
    expect(assessment.score).toBeLessThanOrEqual(100);
  });

  it("uses documented score component boundaries", () => {
    expect([capacityRatioPoints(0.6), capacityRatioPoints(0.8), capacityRatioPoints(1), capacityRatioPoints(1.2), capacityRatioPoints(1.21)]).toEqual([0, 10, 25, 35, 40]);
    expect([unscheduledRatioPoints(0), unscheduledRatioPoints(0.25), unscheduledRatioPoints(0.5), unscheduledRatioPoints(0.75), unscheduledRatioPoints(0.76)]).toEqual([0, 5, 12, 20, 25]);
    expect([deadlineProximityPoints(15), deadlineProximityPoints(14), deadlineProximityPoints(8), deadlineProximityPoints(4), deadlineProximityPoints(1), deadlineProximityPoints(0)]).toEqual([0, 3, 3, 6, 10, 15]);
    expect([riskStatusForScore(0), riskStatusForScore(24), riskStatusForScore(25), riskStatusForScore(49), riskStatusForScore(50), riskStatusForScore(100)]).toEqual(["on-track", "on-track", "tight", "tight", "at-risk", "at-risk"]);
  });
});

describe("capacity and coverage", () => {
  it("counts own confirmed coverage and excludes cancelled, missed, completed, and post-deadline blocks", () => {
    const blocks = [
      block(),
      block({ id: "cancel", status: "cancelled", startTime: "20:00", endTime: "21:00" }),
      block({ id: "missed", status: "missed", startTime: "20:00", endTime: "21:00" }),
      block({ id: "done", status: "completed", startTime: "20:00", endTime: "21:00" }),
      block({ id: "late", date: "2026-08-01" }),
    ];
    const assessment = assessTaskRisk(task({ estimatedMinutes: 120 }), context({ scheduleBlocks: blocks }));
    expect(assessment.scheduledMinutes).toBe(60);
    expect(assessment.unscheduledMinutes).toBe(60);
  });

  it("does not double-count parent effort when sessions exist", () => {
    const sessions = [completeTaskSession(session("done", 60), NOW), session("remaining", 60, 1)];
    const assessment = assessTaskRisk(task({ estimatedMinutes: 600 }), context({ sessions }));
    expect(assessment.remainingMinutes).toBe(60);
  });

  it("other work reduces unallocated capacity and the daily cap is respected", () => {
    const other = block({ id: "other", taskId: "other", startTime: "19:00", endTime: "20:00" });
    const capacity = calculateCapacityBeforeDeadline("task", "2026-07-27", [available("2026-07-27")], [], [other], "2026-07-27", "18:00", 120);
    expect(capacity.otherAssignedMinutes).toBe(60);
    expect(capacity.totalAvailableMinutes).toBe(60);
    expect(capacity.dailyCapLimited).toBe(true);
  });

  it("excludes past time and availability after the deadline", () => {
    const capacity = calculateCapacityBeforeDeadline("task", "2026-07-23", [available("2026-07-23", "10:00", "14:00"), available("2026-07-24")], [], [], "2026-07-23", "12:00", 500);
    expect(capacity.totalAvailableMinutes).toBe(120);
  });

  it("applies recurring availability and date-specific overrides", () => {
    const regular = recurring(1);
    const override = createOverride(regular, "2026-07-27", "remove", undefined, NOW);
    expect(calculateCapacityBeforeDeadline("task", "2026-07-27", [regular], [], [], "2026-07-27", undefined, 500).totalAvailableMinutes).toBe(180);
    expect(calculateCapacityBeforeDeadline("task", "2026-07-27", [regular], [override], [], "2026-07-27", undefined, 500).totalAvailableMinutes).toBe(0);
  });

  it("does not double-count overlapping availability or double-subtract commitments", () => {
    const blocks: AvailabilityBlock[] = [
      available("2026-07-27", "19:00", "22:00", "a1"),
      available("2026-07-27", "20:00", "23:00", "a2"),
      unavailable("2026-07-27", "20:00", "21:00", "u1"),
      unavailable("2026-07-27", "20:30", "21:30", "u2"),
    ];
    expect(calculateCapacityBeforeDeadline("task", "2026-07-27", blocks, [], [], "2026-07-27", undefined, 500).totalAvailableMinutes).toBe(150);
  });

  it("calculates positive and negative buffers exactly", () => {
    expect(assessTaskRisk(task({ estimatedMinutes: 120 }), context()).bufferMinutes).toBe(60);
    expect(assessTaskRisk(task({ estimatedMinutes: 240 }), context()).bufferMinutes).toBe(-60);
  });
});

describe("fit, conflicts, missed work, and recalculation", () => {
  it("flags a fixed 90-minute session when the largest interval is 60 minutes", () => {
    const sessions = [session("interview", 90)];
    const availability = [available("2026-07-27", "19:00", "20:00"), available("2026-07-27", "21:00", "22:00", "second")];
    const assessment = assessTaskRisk(task({ estimatedMinutes: 90 }), context({ sessions, availability }));
    expect(assessment.status).toBe("at-risk");
    expect(assessment.reasons.some((item) => item.code === "session-does-not-fit")).toBe(true);
  });

  it("allows separate fixed sessions to use multiple intervals", () => {
    const sessions = [session("one", 60), session("two", 60, 1)];
    const availability = [available("2026-07-27", "19:00", "20:00"), available("2026-07-27", "21:00", "22:00", "second")];
    const assessment = assessTaskRisk(task({ estimatedMinutes: 120 }), context({ sessions, availability }));
    expect(assessment.reasons.some((item) => item.code === "session-does-not-fit")).toBe(false);
  });

  it("treats conflicted scheduled minutes as uncertain without moving the block", () => {
    const schedule = block({ startTime: "20:00", endTime: "21:00" });
    const before = JSON.stringify(schedule);
    const assessment = assessTaskRisk(task(), context({ availability: [available("2026-07-27"), unavailable("2026-07-27", "20:00", "21:00")], scheduleBlocks: [schedule] }));
    expect(assessment).toMatchObject({ scheduledMinutes: 0, conflictedMinutes: 60, unscheduledMinutes: 60 });
    expect(assessment.reasons.some((item) => item.code === "schedule-conflict")).toBe(true);
    expect(JSON.stringify(schedule)).toBe(before);
  });

  it("treats a shortened fixed-session block as uncertain coverage", () => {
    const assessment = assessTaskRisk(task({ estimatedMinutes: 90 }), context({
      sessions: [session("fixed", 90)],
      scheduleBlocks: [block({ sessionId: "fixed", durationMinutes: 60 })],
    }));
    expect(assessment.conflictedMinutes).toBe(60);
    expect(assessment.scheduledMinutes).toBe(0);
  });

  it("missed work raises a current warning only while work remains", () => {
    const assessment = assessTaskRisk(task(), context({ scheduleBlocks: [block({ status: "missed" })] }));
    expect(assessment.reasons.some((item) => item.code === "missed-work")).toBe(true);
    expect(assessTaskRisk(completeTask(task(), NOW), context({ scheduleBlocks: [block({ status: "missed" })] })).status).toBe("completed");
  });

  it("recalculates after estimate, deadline, availability, confirmation, missed status, and completion changes", () => {
    const base = assessTaskRisk(task(), context());
    expect(assessTaskRisk(task({ estimatedMinutes: 300 }), context()).status).not.toBe(base.status);
    expect(assessTaskRisk(task({ dueDate: "2026-07-22" }), context()).status).toBe("overdue");
    expect(assessTaskRisk(task(), context({ availability: [] })).status).toBe("missing-data");
    expect(assessTaskRisk(task(), context({ scheduleBlocks: [block()] })).scheduledMinutes).toBe(60);
    expect(assessTaskRisk(task(), context({ scheduleBlocks: [block({ status: "missed" })] })).scheduledMinutes).toBe(0);
    expect(assessTaskRisk(completeTask(task(), NOW), context()).status).toBe("completed");
  });

  it("uses proposed preview blocks only in the projected result and does not mutate current data", () => {
    const current = context();
    const before = assessTaskRisk(task(), current);
    const projected = assessTaskRisk(task(), { ...current, proposedBlocks: [block({ status: "proposed" })] });
    expect(before.scheduledMinutes).toBe(0);
    expect(projected.proposedScheduledMinutes).toBe(60);
    expect(current.scheduleBlocks).toEqual([]);
  });
});

describe("summary, filters, and deterministic sorting", () => {
  it("derives dashboard counts and filters", () => {
    const tasks = [
      task({ id: "safe" }),
      task({ id: "missing", estimatedMinutes: undefined }),
      task({ id: "late", dueDate: "2026-07-22" }),
    ];
    const assessments = assessActiveTaskRisks(context({ tasks, scheduleBlocks: [block({ taskId: "safe" })] }));
    const summary = summarizeRisks(assessments);
    expect(summary).toMatchObject({ onTrack: 1, overdue: 1, missingEstimates: 1 });
    expect(filterRiskAssessments(assessments, "overdue").map((item) => item.taskId)).toEqual(["late"]);
    expect(filterRiskAssessments(assessments, "missing-estimate").map((item) => item.taskId)).toEqual(["missing"]);
  });

  it("sorts highest risk deterministically with stable ID as the final tie", () => {
    const tasks = [task({ id: "b", title: "B" }), task({ id: "a", title: "A" })];
    const assessments = assessActiveTaskRisks(context({ tasks }));
    expect(sortRiskAssessments(assessments, tasks, "highest-risk").map((item) => item.taskId)).toEqual(["a", "b"]);
  });

  it("keeps legacy migrated tasks valid and never mutates source collections", () => {
    const legacy = createTask({ id: "legacy", title: "Legacy", date: "", time: "" }, NOW);
    const source = context({ tasks: [legacy] });
    const snapshot = JSON.stringify(source);
    expect(assessActiveTaskRisks(source)[0]?.status).toBe("missing-data");
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});
