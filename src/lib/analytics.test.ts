import { describe, expect, it } from "vitest";
import {
  ANALYTICS_THRESHOLDS,
  analyticsCsv,
  analyticsCsvFilename,
  analyticsRangeForPreset,
  buildAnalyticsSummary,
  deriveAnalyticsInsights,
  validateAnalyticsRange,
  type AnalyticsSummary,
} from "./analytics";
import { migrateScheduleBlock, type ScheduleBlock } from "./scheduleBlocks";
import { archiveTask, completeTask, createTask, type TaskRecord } from "./taskHistory";
import { completeTaskSession, createTaskSession } from "./taskSessions";
import { completeTimer, createTimerLog, discardTimer, pauseTimer, type TimeLog } from "./timeLogs";

const NOW = "2026-07-23T19:00:00.000Z";
const RANGE = { start: "2026-07-20", end: "2026-07-26" };
const task = (id: string, title: string, category: string, estimate: number, patch: Partial<TaskRecord> = {}) => createTask({ id, title, category, estimatedMinutes: estimate, date: "2026-07-20", time: "", dueDate: "2026-07-25", status: "planned", ...patch }, NOW);
const completedTask = (id: string, title: string, category: string, estimate: number, completedAt: string, dueDate = "2026-07-25") => completeTask(task(id, title, category, estimate, { dueDate }), completedAt);
const log = (id: string, taskId: string, minutes: number, date = "2026-07-22", sessionId?: string, source: TimeLog["source"] = "timer") => {
  const startedAt = `${date}T19:00:00.000Z`;
  return { ...completeTimer(createTimerLog({ id, taskId, sessionId }, startedAt), new Date(Date.parse(startedAt) + minutes * 60_000).toISOString()), source };
};
const block = (id: string, taskId: string, minutes: number, status: ScheduleBlock["status"], date = "2026-07-22") => migrateScheduleBlock({
  id, taskId, title: id, date, startTime: "19:00", endTime: `${String(19 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
  durationMinutes: minutes, source: "automatic", status, isLocked: false, createdAt: NOW, updatedAt: NOW,
});

describe("analytics source inclusion and schedule metrics", () => {
  it("returns calm empty states without misleading rates", () => {
    const result = buildAnalyticsSummary([], [], [], [], RANGE, "2026-07-23");
    expect(result).toMatchObject({ trackedMinutes: 0, plannedMinutes: 0, completedTaskCount: 0 });
    expect(result.scheduleCompletionRate).toBeUndefined();
    expect(result.estimateAccuracy).toBeUndefined();
    expect(result.insights[0]?.type).toBe("insufficient-data");
  });

  it("includes completed timer, manual, and schedule-completion logs but excludes running, paused, and discarded", () => {
    const item = task("task", "Task", "school", 300);
    const completed = log("timer", item.id, 30);
    const manual = { ...log("manual", item.id, 20), source: "manual" as const };
    const scheduleCompletion = { ...log("schedule", item.id, 10), source: "schedule-completion" as const };
    const running = createTimerLog({ id: "running", taskId: item.id }, NOW);
    const paused = pauseTimer(createTimerLog({ id: "paused", taskId: item.id }, NOW), "2026-07-23T19:05:00.000Z");
    const discarded = discardTimer(createTimerLog({ id: "discard", taskId: item.id }, NOW), "2026-07-23T19:05:00.000Z");
    expect(buildAnalyticsSummary([item], [], [completed, manual, scheduleCompletion, running, paused, discarded], [], RANGE, "2026-07-23").trackedMinutes).toBe(60);
  });

  it("preserves legacy actual time once and counts direct and session logs once in the parent category", () => {
    const parent = task("parent", "Essay", "school", 180, { actualMinutes: 15, completedAt: "2026-07-22T19:00:00.000Z" });
    const child = createTaskSession({ id: "child", parentTaskId: parent.id, title: "Research", estimatedMinutes: 60, status: "planned", order: 0, isGenerated: true }, NOW);
    const result = buildAnalyticsSummary([parent], [child], [log("direct", parent.id, 20), log("child-log", parent.id, 25, "2026-07-22", child.id)], [], RANGE, "2026-07-23");
    expect(result.trackedMinutes).toBe(60);
    expect(result.categoryBreakdown[0]).toMatchObject({ categoryName: "school", trackedMinutes: 60, percentageOfTrackedTime: 1 });
  });

  it("keeps uncategorized tracked time", () => {
    const item = task("none", "No category", "", 30);
    expect(buildAnalyticsSummary([item], [], [log("l", item.id, 30)], [], RANGE, "2026-07-23").categoryBreakdown[0]?.categoryName).toBe("Uncategorized");
  });

  it("separates completed, missed, cancelled, future, proposed, and past incomplete planned time", () => {
    const item = task("task", "Task", "school", 60);
    const blocks = [
      block("done", item.id, 60, "completed"),
      block("missed", item.id, 30, "missed"),
      block("cancel", item.id, 20, "cancelled"),
      block("proposal", item.id, 40, "proposed"),
      block("future", item.id, 50, "confirmed", "2026-07-25"),
      block("incomplete", item.id, 30, "confirmed", "2026-07-21"),
    ];
    const result = buildAnalyticsSummary([item], [], [], blocks, RANGE, "2026-07-23", "12:00");
    expect(result).toMatchObject({ plannedMinutes: 170, completedPlannedMinutes: 60, missedPlannedMinutes: 30, cancelledPlannedMinutes: 20, futurePlannedMinutes: 50 });
    expect(result.scheduleCompletionRate).toBeCloseTo(0.5);
  });

  it("deduplicates replacement copies by stable schedule ID", () => {
    const item = task("task", "Task", "school", 60);
    const older = block("same", item.id, 60, "completed");
    expect(buildAnalyticsSummary([item], [], [], [older, older], RANGE, "2026-07-23").plannedMinutes).toBe(60);
  });

  it("does not count future confirmed time against schedule completion", () => {
    const item = task("task", "Task", "school", 60);
    const result = buildAnalyticsSummary([item], [], [], [block("future", item.id, 60, "confirmed", "2026-07-25")], RANGE, "2026-07-23");
    expect(result.scheduleCompletionRate).toBeUndefined();
  });
});

describe("completion and estimate hierarchy", () => {
  it("counts completed tasks and sessions separately and excludes sessions as tasks", () => {
    const parent = completedTask("parent", "Essay", "school", 60, "2026-07-22T19:00:00.000Z");
    const child = completeTaskSession(createTaskSession({ id: "child", parentTaskId: parent.id, title: "Research", estimatedMinutes: 30, status: "planned", order: 0, isGenerated: true }, NOW), "2026-07-22T20:00:00.000Z");
    const result = buildAnalyticsSummary([parent], [child], [], [], RANGE, "2026-07-23");
    expect(result.completedTaskCount).toBe(1);
    expect(result.completedSessionCount).toBe(1);
  });

  it("uses local completion dates for on-time status and excludes missing deadlines", () => {
    const onTime = completedTask("on", "On", "school", 60, "2026-07-25T19:00:00.000Z", "2026-07-25");
    const late = completedTask("late", "Late", "school", 60, "2026-07-26T19:00:00.000Z", "2026-07-25");
    const undated = completeTask(task("none", "None", "school", 60, { dueDate: undefined }), "2026-07-24T19:00:00.000Z");
    const result = buildAnalyticsSummary([onTime, late, undated], [], [], [], RANGE, "2026-07-23");
    expect(result.onTimeCompletedCount).toBe(1);
    expect(result.lateCompletedCount).toBe(1);
  });

  it("calculates task estimate variance and ratio", () => {
    const item = completedTask("task", "Task", "school", 60, "2026-07-22T20:00:00.000Z");
    const comparison = buildAnalyticsSummary([item], [], [log("actual", item.id, 90)], [], RANGE, "2026-07-23").estimateComparisons[0]!;
    expect(comparison).toMatchObject({ estimateMinutes: 60, actualMinutes: 90, varianceMinutes: 30, ratio: 1.5 });
  });

  it("excludes missing estimates, missing actual time, and parent estimates when sessions exist", () => {
    const parent = completedTask("parent", "Parent", "school", 300, "2026-07-22T20:00:00.000Z");
    const child = completeTaskSession(createTaskSession({ id: "child", parentTaskId: parent.id, title: "Child", estimatedMinutes: 60, status: "planned", order: 0, isGenerated: true }, NOW), "2026-07-22T20:00:00.000Z");
    const noEstimate = completeTask(task("no-est", "No estimate", "school", 0, { estimatedMinutes: undefined }), "2026-07-22T20:00:00.000Z");
    const noActual = completedTask("no-actual", "No actual", "school", 60, "2026-07-22T20:00:00.000Z");
    const result = buildAnalyticsSummary([parent, noEstimate, noActual], [child], [log("child-time", parent.id, 75, "2026-07-22", child.id)], [], RANGE, "2026-07-23");
    expect(result.estimateComparisons).toHaveLength(1);
    expect(result.estimateComparisons[0]?.sessionId).toBe("child");
  });

  it("requires three comparable items before estimate-pattern insight", () => {
    const items = [completedTask("a", "A", "school", 60, "2026-07-22T20:00:00.000Z"), completedTask("b", "B", "school", 60, "2026-07-22T20:00:00.000Z")];
    expect(buildAnalyticsSummary(items, [], [log("a-log", "a", 90), log("b-log", "b", 90)], [], RANGE, "2026-07-23").insights.some((item) => item.type === "estimate-pattern")).toBe(false);
  });
});

describe("date ranges, daily totals, and insight rules", () => {
  it("produces stable local range presets and inclusive custom ranges", () => {
    expect(analyticsRangeForPreset("this-week", "2026-07-23")).toEqual({ start: "2026-07-20", end: "2026-07-26" });
    expect(analyticsRangeForPreset("last-7-days", "2026-07-23")).toEqual({ start: "2026-07-17", end: "2026-07-23" });
    expect(() => validateAnalyticsRange({ start: "2026-07-24", end: "2026-07-23" })).toThrow("on or before");
    const item = task("task", "Task", "school", 60);
    expect(buildAnalyticsSummary([item], [], [log("start", item.id, 10, RANGE.start), log("end", item.id, 20, RANGE.end), log("outside", item.id, 30, "2026-07-27")], [], RANGE, "2026-07-23").trackedMinutes).toBe(30);
  });

  it("calculates daily tracked and planned totals", () => {
    const item = task("task", "Task", "school", 60);
    const day = buildAnalyticsSummary([item], [], [log("tracked", item.id, 45)], [block("planned", item.id, 60, "completed")], RANGE, "2026-07-23").dailyBreakdown.find((entry) => entry.date === "2026-07-22")!;
    expect(day).toMatchObject({ trackedMinutes: 45, plannedMinutes: 60, completedPlannedMinutes: 60 });
  });

  it("uses named estimate insight boundaries without contradiction", () => {
    const base = buildAnalyticsSummary([], [], [], [], RANGE, "2026-07-23");
    const longer = deriveAnalyticsInsights({ ...base, insights: undefined as never, comparableEstimateCount: 3, medianEstimateRatio: ANALYTICS_THRESHOLDS.estimateLongerRatio + 0.01 } as Omit<AnalyticsSummary, "insights">);
    expect(longer.filter((item) => item.type === "estimate-pattern").map((item) => item.id)).toEqual(["estimate-longer"]);
    const close = deriveAnalyticsInsights({ ...base, insights: undefined as never, comparableEstimateCount: 3, medianEstimateRatio: ANALYTICS_THRESHOLDS.estimateCloseHigh } as Omit<AnalyticsSummary, "insights">);
    expect(close.filter((item) => item.type === "estimate-pattern").map((item) => item.id)).toEqual(["estimate-close"]);
  });

  it("uses category, schedule, workload, and deadline thresholds and limits insight count", () => {
    const base = buildAnalyticsSummary([], [], [], [], RANGE, "2026-07-23");
    const insights = deriveAnalyticsInsights({
      ...base,
      insights: undefined as never,
      trackedMinutes: 400,
      categoryBreakdown: [{ categoryName: "School", trackedMinutes: 240, estimatedMinutes: 0, completedTasks: 0, completedSessions: 0, percentageOfTrackedTime: 0.6 }],
      completedPlannedMinutes: 96,
      scheduleCompletionRate: 0.8,
      dailyBreakdown: [
        { date: "1", trackedMinutes: 150, plannedMinutes: 0, completedPlannedMinutes: 0, missedMinutes: 0, completedTasks: 0 },
        { date: "2", trackedMinutes: 110, plannedMinutes: 0, completedPlannedMinutes: 0, missedMinutes: 0, completedTasks: 0 },
        { date: "3", trackedMinutes: 70, plannedMinutes: 0, completedPlannedMinutes: 0, missedMinutes: 0, completedTasks: 0 },
        { date: "4", trackedMinutes: 70, plannedMinutes: 0, completedPlannedMinutes: 0, missedMinutes: 0, completedTasks: 0 },
      ],
      onTimeCompletedCount: 4, lateCompletedCount: 1,
      comparableEstimateCount: 3, medianEstimateRatio: 1,
    } as Omit<AnalyticsSummary, "insights">);
    expect(insights.length).toBeLessThanOrEqual(ANALYTICS_THRESHOLDS.maximumInsights);
    expect(insights.map((item) => item.type)).toEqual(expect.arrayContaining(["estimate-pattern", "category-focus", "schedule-follow-through", "workload-distribution", "deadline-pattern"]));
  });
});

describe("updates, CSV, determinism, and scale", () => {
  it("updates after log save, edit, deletion, and schedule status changes", () => {
    const item = task("task", "Task", "school", 60);
    const saved = log("saved", item.id, 30);
    expect(buildAnalyticsSummary([item], [], [], [], RANGE, "2026-07-23").trackedMinutes).toBe(0);
    expect(buildAnalyticsSummary([item], [], [saved], [], RANGE, "2026-07-23").trackedMinutes).toBe(30);
    expect(buildAnalyticsSummary([item], [], [{ ...saved, accumulatedSeconds: 2700 }], [], RANGE, "2026-07-23").trackedMinutes).toBe(45);
    expect(buildAnalyticsSummary([item], [], [], [block("b", item.id, 60, "missed")], RANGE, "2026-07-23").missedPlannedMinutes).toBe(60);
  });

  it("handles archived history and deleted references without breaking totals", () => {
    const archived = archiveTask(completedTask("archived", "Archived", "school", 60, "2026-07-22T20:00:00.000Z"), "2026-07-23T20:00:00.000Z");
    const deletedLog = log("deleted", "missing", 30);
    const result = buildAnalyticsSummary([archived], [], [deletedLog], [], RANGE, "2026-07-23");
    expect(result.trackedMinutes).toBe(30);
    expect(result.completedTaskCount).toBe(1);
    expect(result.records.some((record) => record.taskTitle === "Deleted task")).toBe(true);
  });

  it("exports selected records with CSV escaping and no internal IDs", () => {
    const csv = analyticsCsv([{ date: "2026-07-22", taskTitle: 'Essay, "draft"\nreview', category: "School", trackedMinutes: 30, plannedMinutes: 60, completionStatus: "completed" }]);
    expect(csv).toContain('"Essay, ""draft""\nreview"');
    expect(csv).not.toContain("taskId");
    expect(analyticsCsvFilename(RANGE)).toBe("planner-analytics-2026-07-20-to-2026-07-26.csv");
  });

  it("is deterministic and handles large histories without mutating source data", () => {
    const item = task("task", "Task", "school", 60);
    const logs = Array.from({ length: 1000 }, (_, index) => log(`log-${index}`, item.id, 1));
    const snapshot = JSON.stringify({ item, first: logs[0], last: logs.at(-1) });
    const first = buildAnalyticsSummary([item], [], logs, [], RANGE, "2026-07-23");
    const second = buildAnalyticsSummary([item], [], logs, [], RANGE, "2026-07-23");
    expect(second).toEqual(first);
    expect(first.trackedMinutes).toBe(1000);
    expect(JSON.stringify({ item, first: logs[0], last: logs.at(-1) })).toBe(snapshot);
  });
});
