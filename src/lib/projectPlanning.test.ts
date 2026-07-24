import { describe, expect, it } from "vitest";
import { createAvailabilityBlock } from "./availability";
import { completeTask, createTask, type TaskRecord } from "./taskHistory";
import { createTaskSession } from "./taskSessions";
import {
  assignTask,
  bulkAssignTasks,
  createDependency,
  createGoal,
  createMilestone,
  createProject,
  dateAlignmentWarnings,
  dependencyExplanation,
  goalProgress,
  milestoneProgress,
  projectHealth,
  projectProgress,
  reorderMilestone,
  scheduleWithDependencies,
  topologicalTaskOrder,
  unmetPredecessors,
  type TaskDependency,
} from "./projectPlanning";

const NOW = "2026-07-23T19:00:00.000Z";
const task = (id: string, patch: Partial<TaskRecord> = {}) => createTask({ id, title: id, date: "", time: "", status: "planned", estimatedMinutes: 60, projectId: "project", ...patch }, NOW);
const project = (patch = {}) => createProject({ id: "project", title: "Portfolio", status: "active", targetDate: "2026-07-31", progressMode: "task-completion", ...patch }, NOW);
const milestone = (id = "m1", patch = {}) => createMilestone({ id, projectId: "project", title: id, order: 0, ...patch }, NOW);
const dependency = (predecessorTaskId: string, successorTaskId: string, id = `${predecessorTaskId}-${successorTaskId}`): TaskDependency => ({ schemaVersion: 1, id, projectId: "project", predecessorTaskId, successorTaskId, type: "finish-to-start", createdAt: NOW, updatedAt: NOW });
const riskContext = (availability = [createAvailabilityBlock({ id: "a", name: "Available", date: "2026-07-24", startTime: "19:00", endTime: "22:00", type: "available", isRecurring: false }, NOW)]) => ({ availability, overrides: [], scheduleBlocks: [], timeLogs: [], today: "2026-07-23", currentTime: "12:00", dailyCapMinutes: 180, calculatedAt: NOW });

describe("goals, projects, milestones, and assignment", () => {
  it("creates stable optional hierarchy records and validates dates and progress", () => {
    expect(createGoal({ id: "goal", title: "Career" }, NOW)).toMatchObject({ id: "goal", timeframe: "no-deadline" });
    expect(createProject({ id: "p", title: "Applications" }, NOW)).toMatchObject({ id: "p", goalId: undefined });
    expect(createMilestone({ id: "m", projectId: "p", title: "Draft", order: 0 }, NOW)).toMatchObject({ id: "m", projectId: "p" });
    expect(() => createGoal({ title: "x", startDate: "2026-08-01", targetDate: "2026-07-01" })).toThrow("after");
    expect(() => createProject({ title: "x", manualProgressPercent: 101 })).toThrow("between");
    expect(() => createMilestone({ projectId: "p", title: "x", manualProgressPercent: -1 })).toThrow("between");
  });

  it("assigns without changing task identity, category, completion, or planning fields", () => {
    const original = task("t", { category: "school", dueDate: "2026-07-30" });
    const assigned = assignTask(original, "project", "m1", [milestone()]);
    expect(assigned).toMatchObject({ id: "t", category: "school", dueDate: "2026-07-30", projectId: "project", milestoneId: "m1", status: "planned" });
  });

  it("clears incompatible milestones when moving or removing a project", () => {
    const original = task("t", { milestoneId: "m1" });
    expect(assignTask(original, "other", undefined, [milestone()])).toMatchObject({ projectId: "other", milestoneId: undefined });
    expect(assignTask(original, undefined, undefined, [milestone()])).toMatchObject({ projectId: undefined, milestoneId: undefined });
    expect(() => assignTask(original, "other", "m1", [milestone()])).toThrow("does not belong");
  });

  it("bulk assignment is idempotent and reports partial validation failures", () => {
    const items = [task("a"), task("b")];
    const first = bulkAssignTasks(items, ["a", "missing"], "project", "m1", [milestone()], NOW);
    expect(first.tasks.find((item) => item.id === "a")?.milestoneId).toBe("m1");
    expect(first.appliedCount).toBe(1);
    expect(first.failures).toEqual([{ taskId: "missing", message: "The task no longer exists." }]);
    const second = bulkAssignTasks(first.tasks, ["a"], "project", "m1", [milestone()], NOW);
    expect(second.tasks.find((item) => item.id === "a")?.id).toBe("a");
  });

  it("reorders milestones without changing IDs", () => {
    const items = [milestone("a", { order: 0 }), milestone("b", { order: 1 })];
    const reordered = reorderMilestone(items, "b", -1, NOW);
    expect(reordered.map((item) => item.id)).toEqual(["a", "b"]);
    expect(reordered.find((item) => item.id === "b")?.order).toBe(0);
  });
});

describe("progress and health", () => {
  it("calculates task-count progress without double-counting sessions", () => {
    const tasks = [completeTask(task("done"), NOW), task("open")];
    const sessions = [createTaskSession({ id: "s", parentTaskId: "open", title: "Part", estimatedMinutes: 60, status: "completed", order: 0, isGenerated: false }, NOW)];
    expect(projectProgress(project(), [], tasks, sessions).percent).toBe(100);
    expect(project().status).toBe("active");
  });

  it("calculates effort-weighted progress and excludes missing estimates with a warning", () => {
    const result = projectProgress(project({ progressMode: "effort-weighted" }), [], [completeTask(task("done", { estimatedMinutes: 60 }), NOW), task("open", { estimatedMinutes: 120 }), task("unknown", { estimatedMinutes: undefined })], []);
    expect(result.percent).toBeCloseTo(33.33, 1);
    expect(result.warnings[0]).toContain("without estimates");
  });

  it("excludes skipped milestones and supports manual progress", () => {
    const milestones = [milestone("done", { status: "completed" }), milestone("skip", { status: "skipped", order: 1 }), milestone("open", { order: 2 })];
    expect(projectProgress(project({ progressMode: "milestone-completion" }), milestones, [], []).percent).toBe(50);
    expect(projectProgress(project({ progressMode: "manual", manualProgressPercent: 37 }), [], [], []).percent).toBe(37);
  });

  it("shows empty states and never auto-completes entities", () => {
    expect(projectProgress(project(), [], [], []).label).toBe("No tasks yet");
    const goal = createGoal({ id: "g", title: "Goal", progressMode: "project-completion" }, NOW);
    expect(goalProgress(goal, [], []).label).toBe("No projects yet");
    expect(goalProgress(goal, [createProject({ id: "p", title: "P", goalId: "g", status: "completed" }, NOW)], []).percent).toBe(100);
    expect(goal.status).toBe("not-started");
  });

  it("calculates milestone task and session progress without treating tracked time as completion", () => {
    const m = milestone();
    const linked = [task("t", { milestoneId: "m1" })];
    const sessions = [createTaskSession({ id: "s", parentTaskId: "t", title: "Part", estimatedMinutes: 60, actualMinutes: 60, status: "planned", order: 0, isGenerated: false }, NOW)];
    expect(milestoneProgress(m, linked, sessions).percent).toBe(0);
  });

  it("reports paused, overdue, missing estimate, and at-risk project health", () => {
    expect(projectHealth(project({ status: "paused" }), [], [task("t")], [], riskContext()).status).toBe("paused");
    expect(projectHealth(project({ targetDate: "2026-07-22" }), [], [task("t")], [], riskContext()).status).toBe("overdue");
    const missing = projectHealth(project({ targetDate: undefined }), [], [task("t", { estimatedMinutes: undefined })], [], riskContext());
    expect(missing.status).toBe("missing-data");
    const insufficient = projectHealth(project({ targetDate: "2026-07-24" }), [], [task("t", { estimatedMinutes: 360, dueDate: "2026-07-24" })], [], riskContext());
    expect(insufficient.status).toBe("at-risk");
  });

  it("external busy availability reduces project feasibility without modifying schedules", () => {
    const available = createAvailabilityBlock({ id: "a", name: "Available", date: "2026-07-24", startTime: "19:00", endTime: "22:00", type: "available", isRecurring: false }, NOW);
    const external = createAvailabilityBlock({ id: "g", name: "Google Calendar busy time", date: "2026-07-24", startTime: "19:00", endTime: "21:00", type: "appointment", isRecurring: false }, NOW);
    const blocks: never[] = [];
    const result = projectHealth(project({ targetDate: "2026-07-24" }), [], [task("t", { estimatedMinutes: 120, dueDate: "2026-07-24" })], [], riskContext([available, external]));
    expect(result.status).toBe("at-risk");
    expect(blocks).toEqual([]);
  });
});

describe("date alignment and dependencies", () => {
  it("detects project, milestone, task, and goal date mismatches without mutating data", () => {
    const p = project({ startDate: "2026-07-10", targetDate: "2026-07-20", goalId: "g" });
    const g = createGoal({ id: "g", title: "G", targetDate: "2026-07-15" }, NOW);
    const warnings = dateAlignmentWarnings(p, g, [milestone("m", { targetDate: "2026-07-21" })], [task("t", { dueDate: "2026-07-22" })]);
    expect(warnings.map((item) => item.type)).toEqual(expect.arrayContaining(["task-after-project", "milestone-after-project", "goal-before-project"]));
    expect(p.targetDate).toBe("2026-07-20");
  });

  it("creates dependencies and rejects self, duplicates, cross-project links, and cycles", () => {
    const tasks = [task("a"), task("b"), task("c")];
    const ab = createDependency({ id: "ab", projectId: "project", predecessorTaskId: "a", successorTaskId: "b", type: "finish-to-start" }, tasks, [], NOW);
    expect(ab.id).toBe("ab");
    expect(() => createDependency({ id: "self", projectId: "project", predecessorTaskId: "a", successorTaskId: "a", type: "finish-to-start" }, tasks, [], NOW)).toThrow("itself");
    expect(() => createDependency({ id: "dup", projectId: "project", predecessorTaskId: "a", successorTaskId: "b", type: "finish-to-start" }, tasks, [ab], NOW)).toThrow("already");
    expect(() => createDependency({ id: "cross", projectId: "project", predecessorTaskId: "a", successorTaskId: "x", type: "finish-to-start" }, [...tasks, task("x", { projectId: "other" })], [], NOW)).toThrow("same project");
    const bc = dependency("b", "c");
    expect(() => createDependency({ id: "cycle", projectId: "project", predecessorTaskId: "c", successorTaskId: "a", type: "finish-to-start" }, tasks, [ab, bc], NOW)).toThrow("circular");
  });

  it("produces deterministic topological order and handles completed/reopened predecessors", () => {
    const tasks = [task("c"), task("a"), task("b")], deps = [dependency("a", "b"), dependency("b", "c")];
    expect(topologicalTaskOrder("project", tasks, deps)).toEqual(["a", "b", "c"]);
    expect(unmetPredecessors("b", tasks, deps).map((item) => item.id)).toEqual(["a"]);
    expect(unmetPredecessors("b", tasks.map((item) => item.id === "a" ? completeTask(item, NOW) : item), deps)).toEqual([]);
    expect(dependencyExplanation("b", tasks, deps)).toContain("a");
  });

  it("warning-only scheduling reports unmet dependencies while strict mode blocks unknown completion", () => {
    const tasks = [task("a", { isSplittable: true }), task("b", { isSplittable: true })], deps = [dependency("a", "b")];
    const availability = [createAvailabilityBlock({ id: "available", name: "Available", date: "2026-07-24", startTime: "19:00", endTime: "22:00", type: "available", isRecurring: false }, NOW)];
    const options = { startDate: "2026-07-24", endDate: "2026-07-24", today: "2026-07-23", selectedTaskIds: ["b"], includeUndated: true, includeWeekends: true, includeOverdue: false, allowLateScheduling: false, allowDirectSplittable: true, allowFlexibleSessionOrder: false, allowSameTaskPerDay: true, replaceUnlockedProposed: false, dailyCapMinutes: 180, minimumBreakMinutes: 10, runId: "run", now: NOW };
    const warning = scheduleWithDependencies(tasks, [], availability, [], [], options, deps, false);
    expect(warning.proposedBlocks).toHaveLength(1);
    expect(warning.warnings.join(" ")).toContain("incomplete");
    const strict = scheduleWithDependencies(tasks, [], availability, [], [], options, deps, true);
    expect(strict.proposedBlocks).toHaveLength(0);
    expect(strict.unscheduledWork[0]?.reason).toContain("incomplete");
  });
});
