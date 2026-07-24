import { describe, expect, it } from "vitest";
import {
  activeTimeLogs,
  activeTimerConflicts,
  completeTimer,
  completedTrackedSeconds,
  createManualTimeLog,
  createTimerLog,
  discardTimer,
  editCompletedTimeLog,
  elapsedSeconds,
  formatElapsedSeconds,
  mergeTimeLogCopies,
  migrateTimeLogs,
  pauseTimer,
  remainingTrackedEstimate,
  resumeTimer,
  roundTrackedSecondsToMinutes,
  sessionActualMinutes,
  startTimer,
  taskActualMinutes,
  taskHasActiveTimer,
  timerWarnings,
} from "./timeLogs";
import { createTask } from "./taskHistory";
import { createTaskSession } from "./taskSessions";
import { assessTaskRisk } from "./riskAssessment";
import { createAvailabilityBlock } from "./availability";

const START = "2026-07-23T19:00:00.000Z";
const LATER = "2026-07-23T19:35:20.000Z";
const task = createTask({ id: "task", title: "Essay", date: "", time: "", estimatedMinutes: 60, dueDate: "2026-07-27" }, START);
const session = createTaskSession({ id: "session", parentTaskId: task.id, title: "Research", estimatedMinutes: 60, status: "planned", order: 0, isGenerated: true }, START);

describe("focus timer lifecycle", () => {
  it("starts one recoverable timer and blocks a second running timer", () => {
    const first = startTimer([], { id: "one", taskId: "task" }, START);
    expect(first.created).toMatchObject({ id: "one", status: "running", lastResumedAt: START });
    const second = startTimer(first.logs, { id: "two", taskId: "other" }, LATER);
    expect(second.created).toBeUndefined();
    expect(second.conflict).toHaveLength(1);
    expect(second.logs).toBe(first.logs);
  });

  it("pause preserves elapsed time and does not continue accumulating", () => {
    const paused = pauseTimer(createTimerLog({ id: "one", taskId: "task" }, START), LATER);
    expect(paused.accumulatedSeconds).toBe(2120);
    expect(elapsedSeconds(paused, "2026-07-24T19:00:00.000Z")).toBe(2120);
  });

  it("resume continues from accumulated time", () => {
    const paused = pauseTimer(createTimerLog({ id: "one", taskId: "task" }, START), LATER);
    const resumed = resumeTimer(paused, "2026-07-23T20:00:00.000Z");
    expect(elapsedSeconds(resumed, "2026-07-23T20:10:00.000Z")).toBe(2720);
  });

  it("derives running time across navigation, refresh, closure, and sleep from timestamps", () => {
    const original = createTimerLog({ id: "stable", taskId: "task" }, START);
    const restored = migrateTimeLogs(JSON.parse(JSON.stringify([original])))[0]!;
    expect(elapsedSeconds(restored, LATER)).toBe(2120);
    expect(restored.id).toBe("stable");
  });

  it("restores paused state exactly after refresh", () => {
    const paused = pauseTimer(createTimerLog({ id: "one", taskId: "task" }, START), LATER);
    expect(migrateTimeLogs(JSON.parse(JSON.stringify([paused])))[0]).toEqual(paused);
  });

  it("stop/save is idempotent and repeated saves do not duplicate records", () => {
    const running = createTimerLog({ id: "one", taskId: "task" }, START);
    const saved = completeTimer(running, LATER);
    expect(completeTimer(saved, "2026-07-24T00:00:00.000Z")).toBe(saved);
    expect(mergeTimeLogCopies([saved], [saved, saved])).toEqual([saved]);
  });

  it("discarded and active logs do not count toward actual time", () => {
    const running = createTimerLog({ id: "run", taskId: "task" }, START);
    const discarded = discardTimer(createTimerLog({ id: "discard", taskId: "task" }, START), LATER);
    expect(completedTrackedSeconds([running, discarded], "task")).toBe(0);
  });

  it("detects multiple-device active conflicts deterministically", () => {
    const older = createTimerLog({ id: "a", taskId: "task" }, START);
    const newer = createTimerLog({ id: "b", taskId: "other" }, LATER);
    expect(activeTimerConflicts([older, newer]).map((log) => log.id)).toEqual(["b", "a"]);
  });

  it("allows paused work to remain recoverable while another timer runs", () => {
    const paused = pauseTimer(createTimerLog({ id: "paused", taskId: "task" }, START), LATER);
    const result = startTimer([paused], { id: "new", taskId: "other" }, "2026-07-23T20:00:00.000Z");
    expect(result.created?.id).toBe("new");
    expect(activeTimeLogs(result.logs)).toHaveLength(2);
  });
});

describe("manual logs, aggregation, and rounding", () => {
  it("creates duration-only and start/end manual logs", () => {
    const duration = createManualTimeLog({ id: "duration", taskId: "task", date: "2026-07-23", durationMinutes: 35 }, [], LATER).log;
    const range = createManualTimeLog({ id: "range", taskId: "task", date: "2026-07-23", startTime: "18:00", endTime: "18:45" }, [], LATER).log;
    expect(duration.accumulatedSeconds).toBe(2100);
    expect(range.accumulatedSeconds).toBe(2700);
  });

  it("rejects zero, reversed ranges, and exact duplicates", () => {
    expect(() => createManualTimeLog({ taskId: "task", date: "2026-07-23", durationMinutes: 0 }, [])).toThrow("greater than zero");
    expect(() => createManualTimeLog({ taskId: "task", date: "2026-07-23", startTime: "19:00", endTime: "18:00" }, [])).toThrow("later");
    const existing = createManualTimeLog({ id: "same", taskId: "task", date: "2026-07-23", durationMinutes: 30 }, [], LATER).log;
    expect(() => createManualTimeLog({ taskId: "task", date: "2026-07-23", durationMinutes: 30 }, [existing], LATER)).toThrow("already exists");
  });

  it("warns for overlap and future manual time", () => {
    const existing = createManualTimeLog({ id: "old", taskId: "task", date: "2026-07-23", startTime: "18:00", endTime: "19:00" }, [], LATER).log;
    const overlap = createManualTimeLog({ taskId: "task", date: "2026-07-23", startTime: "18:30", endTime: "19:30" }, [existing], LATER);
    expect(overlap.warnings.some((warning) => warning.includes("overlaps"))).toBe(true);
    expect(createManualTimeLog({ taskId: "task", date: "2026-07-24", durationMinutes: 30 }, [], LATER).warnings[0]).toContain("future");
  });

  it("uses nearest-minute rounding with a one-minute minimum for non-zero logs", () => {
    expect([roundTrackedSecondsToMinutes(1), roundTrackedSecondsToMinutes(29), roundTrackedSecondsToMinutes(30), roundTrackedSecondsToMinutes(89), roundTrackedSecondsToMinutes(90)]).toEqual([1, 1, 1, 1, 2]);
    expect(formatElapsedSeconds(45)).toBe("00:45");
    expect(formatElapsedSeconds(754)).toBe("12:34");
    expect(formatElapsedSeconds(4328)).toBe("1:12:08");
  });

  it("aggregates session time into its parent once and preserves legacy actual minutes", () => {
    const direct = completeTimer(createTimerLog({ id: "direct", taskId: "task" }, START), "2026-07-23T19:10:00.000Z");
    const child = completeTimer(createTimerLog({ id: "child", taskId: "task", sessionId: "session" }, START), "2026-07-23T19:35:00.000Z");
    expect(taskActualMinutes({ ...task, actualMinutes: 5 }, [direct, child])).toBe(50);
    expect(sessionActualMinutes({ ...session, actualMinutes: 2 }, [direct, child])).toBe(37);
    expect(completedTrackedSeconds([direct, child], "task")).toBe(2700);
  });

  it("editing and deleting logs recalculates totals without changing IDs", () => {
    const log = createManualTimeLog({ id: "stable", taskId: "task", date: "2026-07-23", durationMinutes: 30 }, [], LATER).log;
    const edited = editCompletedTimeLog(log, { durationMinutes: 45 }, "2026-07-24T00:00:00.000Z");
    expect(edited).toMatchObject({ id: "stable", accumulatedSeconds: 2700, manuallyEdited: true });
    expect(taskActualMinutes(task, [edited])).toBe(45);
    expect(taskActualMinutes(task, [])).toBe(0);
  });

  it("actual may exceed estimate while remaining never becomes negative", () => {
    expect(remainingTrackedEstimate(60, 80)).toBe(0);
  });
});

describe("recovery, safety, schedule, and risk", () => {
  it("detects future clock reversal and very long timers without negative elapsed", () => {
    const future = createTimerLog({ id: "future", taskId: "task" }, "2026-07-24T00:00:00.000Z");
    expect(elapsedSeconds(future, START)).toBe(0);
    expect(timerWarnings(future, START)[0]).toContain("clock");
    const long = createTimerLog({ id: "long", taskId: "task" }, "2026-07-22T23:00:00.000Z");
    expect(timerWarnings(long, LATER).some((warning) => warning.includes("Review"))).toBe(true);
  });

  it("active timer prevents unsafe task mutation checks", () => {
    expect(taskHasActiveTimer([createTimerLog({ taskId: "task" }, START)], "task")).toBe(true);
    expect(taskHasActiveTimer([], "task")).toBe(false);
  });

  it("schedule-linked timer preserves schedule metadata and does not mutate the schedule", () => {
    const schedule = { id: "schedule", status: "confirmed" };
    const log = completeTimer(createTimerLog({ taskId: "task", scheduleBlockId: schedule.id }, START), LATER);
    expect(log.scheduleBlockId).toBe("schedule");
    expect(schedule.status).toBe("confirmed");
  });

  it("completed logs recalculate risk while running logs do not", () => {
    const availability = [createAvailabilityBlock({ id: "a", name: "Available", date: "2026-07-27", startTime: "19:00", endTime: "20:00", type: "available", isRecurring: false }, START)];
    const base = { tasks: [task], sessions: [], availability, overrides: [], scheduleBlocks: [], today: "2026-07-23", dailyCapMinutes: 60, calculatedAt: START };
    const running = createTimerLog({ id: "run", taskId: "task" }, START);
    const completed = completeTimer(running, "2026-07-23T19:30:00.000Z");
    expect(assessTaskRisk(task, { ...base, timeLogs: [running] }).remainingMinutes).toBe(60);
    expect(assessTaskRisk(task, { ...base, timeLogs: [completed] }).remainingMinutes).toBe(30);
  });

  it("offline create and save are pure local operations with stable serialization", () => {
    const log = completeTimer(createTimerLog({ id: "offline", taskId: "task" }, START), LATER);
    expect(migrateTimeLogs(JSON.parse(JSON.stringify([log])))).toEqual([log]);
  });
});
