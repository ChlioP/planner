import { describe, expect, it } from "vitest";
import { createAvailabilityBlock } from "./availability";
import { createAvailabilityTemplate } from "./availabilityTemplates";
import {
  LARGE_ESTIMATE_WARNING_MINUTES,
  effortPatch,
  estimateState,
  formatEffortMinutes,
  minutesFromHoursAndMinutes,
  needsEstimateForScheduling,
  planningEffortSummary,
  remainingMinutes,
  tasksMissingEstimates,
  validateTaskEffort,
} from "./taskEffort";
import { archiveTask, completeTask, createTask, migrateTask, migrateTasks, restoreTask, updateTask } from "./taskHistory";

const NOW = "2026-07-23T12:00:00.000Z";

describe("task estimate entry", () => {
  it("creates legacy-compatible tasks without an estimate", () => {
    const task = createTask({ title: "No estimate", date: "", time: "", status: "backlog" }, NOW);
    expect(task.estimatedMinutes).toBeUndefined();
    expect(estimateState(task)).toBe("No estimate");
  });

  it("creates tasks with quick and custom estimates stored as whole minutes", () => {
    expect(createTask({ title: "Quick", date: "", time: "", estimatedMinutes: 30 }, NOW).estimatedMinutes).toBe(30);
    expect(minutesFromHoursAndMinutes(1, 30)).toBe(90);
    expect(createTask({ title: "Custom", date: "", time: "", estimatedMinutes: minutesFromHoursAndMinutes(2, 0) }, NOW).estimatedMinutes).toBe(120);
  });

  it("edits and removes an estimate without changing task identity", () => {
    const task = createTask({ id: "stable", title: "Edit", date: "", time: "", estimatedMinutes: 30 }, NOW);
    const edited = updateTask(task, "estimatedMinutes", 90, "2026-07-24T00:00:00.000Z");
    const removed = updateTask(edited, "estimatedMinutes", undefined, "2026-07-25T00:00:00.000Z");
    expect(edited).toMatchObject({ id: "stable", estimatedMinutes: 90 });
    expect(removed).toMatchObject({ id: "stable", estimatedMinutes: undefined });
  });

  it("rejects zero, negative, fractional, and invalid custom input", () => {
    expect(() => minutesFromHoursAndMinutes(0, 0)).toThrow("greater than zero");
    expect(() => minutesFromHoursAndMinutes(-1, 0)).toThrow("non-negative");
    expect(() => minutesFromHoursAndMinutes(Number.NaN, 30)).toThrow("whole numbers");
    expect(validateTaskEffort({ estimatedMinutes: 1.5, isSplittable: false }).errors).not.toHaveLength(0);
  });

  it("accepts a large valid estimate with a review warning", () => {
    const estimate = LARGE_ESTIMATE_WARNING_MINUTES + 60;
    const validation = validateTaskEffort({ estimatedMinutes: estimate, isSplittable: false });
    expect(validation.errors).toEqual([]);
    expect(validation.warnings[0]).toContain("unusually large");
    expect(effortPatch({ estimatedMinutes: estimate, isSplittable: false }).estimatedMinutes).toBe(estimate);
  });

  it("formats readable effort labels", () => {
    expect(formatEffortMinutes(undefined)).toBe("No estimate");
    expect(formatEffortMinutes(45)).toBe("45 min");
    expect(formatEffortMinutes(120)).toBe("2 hr");
    expect(formatEffortMinutes(150)).toBe("2 hr 30 min");
  });
});

describe("splittable task validation", () => {
  it("stores editable minimum and maximum session values without generating sessions", () => {
    const patch = effortPatch({ estimatedMinutes: 600, isSplittable: true, minimumSessionMinutes: 30, maximumSessionMinutes: 90 });
    expect(patch).toEqual({ estimatedMinutes: 600, actualMinutes: undefined, isSplittable: true, minimumSessionMinutes: 30, maximumSessionMinutes: 90 });
  });

  it("requires positive minimum and maximum session durations", () => {
    expect(validateTaskEffort({ estimatedMinutes: 60, isSplittable: true, minimumSessionMinutes: 0, maximumSessionMinutes: 60 }).errors).toContain("Minimum session time must be greater than zero.");
    expect(validateTaskEffort({ estimatedMinutes: 60, isSplittable: true, minimumSessionMinutes: 15, maximumSessionMinutes: -1 }).errors).toContain("Maximum session time must be greater than zero.");
  });

  it("rejects a maximum below the minimum", () => {
    expect(validateTaskEffort({ estimatedMinutes: 120, isSplittable: true, minimumSessionMinutes: 60, maximumSessionMinutes: 30 }).errors).toContain("Maximum session time must be equal to or greater than the minimum.");
  });

  it("rejects a minimum above the total estimate", () => {
    expect(validateTaskEffort({ estimatedMinutes: 30, isSplittable: true, minimumSessionMinutes: 45, maximumSessionMinutes: 90 }).errors).toContain("Minimum session time cannot exceed the total estimate.");
  });

  it("clears session constraints when task style becomes single-session", () => {
    expect(effortPatch({ estimatedMinutes: 60, isSplittable: false, minimumSessionMinutes: 25, maximumSessionMinutes: 90 })).toMatchObject({ isSplittable: false, minimumSessionMinutes: undefined, maximumSessionMinutes: undefined });
  });
});

describe("remaining and actual time", () => {
  it("calculates remaining time without becoming negative", () => {
    expect(remainingMinutes(undefined, 30)).toBeUndefined();
    expect(remainingMinutes(120, 30)).toBe(90);
    expect(remainingMinutes(120, 120)).toBe(0);
    expect(remainingMinutes(120, 180)).toBe(0);
  });

  it("describes actual time below, equal to, and above the estimate without completing active tasks", () => {
    const base = createTask({ title: "Actual", date: "", time: "", estimatedMinutes: 100 }, NOW);
    expect(estimateState({ ...base, actualMinutes: 80 })).toBe("Estimated");
    expect(estimateState(completeTask({ ...base, actualMinutes: 100 }, NOW))).toBe("Completed near estimate");
    expect(estimateState({ ...base, actualMinutes: 110 })).toBe("Actual exceeded estimate");
    expect({ ...base, actualMinutes: 110 }.status).toBe("backlog");
  });

  it("uses neutral completed estimate states", () => {
    const base = createTask({ title: "Complete", date: "", time: "", estimatedMinutes: 100 }, NOW);
    expect(estimateState(completeTask({ ...base, actualMinutes: 50 }, NOW))).toBe("Completed under estimate");
    expect(estimateState(completeTask({ ...base, actualMinutes: 100 }, NOW))).toBe("Completed near estimate");
    expect(estimateState(completeTask({ ...base, actualMinutes: 120 }, NOW))).toBe("Completed over estimate");
  });

  it("preserves estimate and actual values through completion, archive, and restore", () => {
    const task = createTask({ title: "Lifecycle", date: "", time: "", estimatedMinutes: 120, actualMinutes: 90, isSplittable: true, minimumSessionMinutes: 30, maximumSessionMinutes: 60 }, NOW);
    const completed = completeTask(task, NOW);
    const archived = archiveTask(completed, NOW);
    const restored = restoreTask(archived, NOW);
    expect(completed).toMatchObject({ estimatedMinutes: 120, actualMinutes: 90 });
    expect(archived).toMatchObject({ estimatedMinutes: 120, actualMinutes: 90 });
    expect(restored).toMatchObject({ status: "completed", estimatedMinutes: 120, actualMinutes: 90, minimumSessionMinutes: 30, maximumSessionMinutes: 60 });
  });
});

describe("effort persistence and planning", () => {
  it("preserves effort through local-cache serialization", () => {
    const task = createTask({ id: "cache", title: "Cache", date: "", time: "", estimatedMinutes: 600, actualMinutes: 45, isSplittable: true, minimumSessionMinutes: 30, maximumSessionMinutes: 90 }, NOW);
    expect(migrateTasks(JSON.parse(JSON.stringify([task])))).toEqual([task]);
  });

  it("loads legacy tasks without inventing estimates", () => {
    expect(migrateTask({ id: 1, title: "Legacy", date: "2025-01-01", time: "09:00", status: "todo", priority: "medium", category: "Task" }).estimatedMinutes).toBeUndefined();
  });

  it("derives scheduling-estimate guidance without blocking tasks", () => {
    expect(needsEstimateForScheduling(createTask({ title: "Planned", date: "", time: "", status: "planned" }, NOW))).toBe(true);
    expect(needsEstimateForScheduling(createTask({ title: "Idea", date: "", time: "", status: "backlog" }, NOW))).toBe(false);
  });

  it("calculates planning totals and missing-estimate filters", () => {
    const tasks = [
      createTask({ title: "Reply to recruiter", category: "career", date: "", time: "", estimatedMinutes: 20 }, NOW),
      createTask({ title: "Write essay", category: "school", date: "", time: "", estimatedMinutes: 600 }, NOW),
      createTask({ title: "Update portfolio", category: "portfolio", date: "", time: "" }, NOW),
    ];
    expect(planningEffortSummary(tasks)).toEqual({
      totalMinutes: 620,
      categoryMinutes: { school: 600, career: 20, portfolio: 0 },
      missingEstimateCount: 1,
    });
    expect(tasksMissingEstimates(tasks).map((task) => task.title)).toEqual(["Update portfolio"]);
  });

  it("does not mutate availability or templates while editing task effort", () => {
    const availability = [createAvailabilityBlock({ id: "available", name: "Focus", date: "2026-07-23", startTime: "19:00", endTime: "21:00", type: "available", isRecurring: false }, NOW)];
    const templates = [createAvailabilityTemplate({ id: "template", name: "Workday", blocks: [{ id: "work", name: "Work", startTime: "09:00", endTime: "18:00", type: "work" }] }, NOW)];
    const availabilitySnapshot = JSON.stringify(availability);
    const templateSnapshot = JSON.stringify(templates);
    effortPatch({ estimatedMinutes: 60, actualMinutes: 30, isSplittable: false });
    expect(JSON.stringify(availability)).toBe(availabilitySnapshot);
    expect(JSON.stringify(templates)).toBe(templateSnapshot);
  });
});
