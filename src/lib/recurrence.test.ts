import { describe, expect, it } from "vitest";
import {
  consistencySummary,
  convertTaskToFirstOccurrence,
  createRecurrenceException,
  createRecurrenceDefinition,
  createRoutineTemplate,
  detachOccurrenceTask,
  generateOccurrences,
  humanRecurrenceSummary,
  materializeOccurrences,
  occurrenceKey,
  markOccurrenceModified,
  reconcileOccurrenceWithTask,
  recurringWorkAnalytics,
  restoreOccurrence,
  seriesHealthSummary,
  skipOccurrence,
  splitRecurrenceSeries,
  validateRecurrenceSchedule,
  type RecurrenceDefinition,
} from "./recurrence";
import { completeTask } from "./taskHistory";

const NOW = "2026-07-23T19:00:00.000Z";
const definition = (patch: Partial<RecurrenceDefinition> = {}) => createRecurrenceDefinition({
  id: "routine", title: "Review plan", type: "task", startDate: "2026-07-01",
  schedule: { frequency: "weekly", interval: 1, weekdays: ["MO", "WE", "FR"] },
  taskTemplate: { title: "Review plan", priority: "medium", estimatedMinutes: 30, dueRule: { type: "same-day" } },
  timezone: "America/Los_Angeles", ...patch,
}, NOW);

describe("recurrence validation", () => {
  it("creates stable definitions with bounded defaults", () => {
    const item = definition();
    expect(item).toMatchObject({ id: "routine", status: "active", ruleVersion: 1 });
    expect(item.generationSettings).toMatchObject({ generateAheadDays: 30, maximumGeneratedOccurrences: 100, generationMode: "app-open" });
  });
  it("rejects empty titles, invalid end conditions, and invalid timezone", () => {
    expect(() => definition({ title: " " })).toThrow("title");
    expect(() => definition({ endCondition: { type: "until-date", endDate: "2026-06-30" } })).toThrow("before");
    expect(() => definition({ timezone: "Not/AZone" })).toThrow("IANA");
  });
  it("validates each schedule boundary", () => {
    expect(() => validateRecurrenceSchedule({ frequency: "daily", interval: 0 })).toThrow();
    expect(() => validateRecurrenceSchedule({ frequency: "weekly", interval: 1, weekdays: [] })).toThrow();
    expect(() => validateRecurrenceSchedule({ frequency: "monthly", interval: 1, monthlyRule: { type: "day-of-month", day: 32, invalidDateBehavior: "skip" } })).toThrow();
    expect(() => validateRecurrenceSchedule({ frequency: "yearly", interval: 1, month: 13, day: 1, leapDayBehavior: "skip" })).toThrow();
    expect(() => validateRecurrenceSchedule({ frequency: "times-per-week", targetCount: 3, eligibleWeekdays: ["MO", "TU"] })).toThrow();
  });
  it("removes duplicate weekdays and stores deterministic weekday order", () => {
    expect(definition({ schedule: { frequency: "weekly", interval: 1, weekdays: ["FR", "MO", "FR", "WE"] } }).schedule).toEqual({ frequency: "weekly", interval: 1, weekdays: ["MO", "WE", "FR"] });
  });
  it("rejects overnight and out-of-bounds routine windows", () => {
    expect(() => definition({ type: "routine", routineSettings: { completionMode: "check-off", preferredWindow: { startTime: "22:00", endTime: "08:00" }, schedulingMode: "manual", carryForwardBehavior: "do-not-carry", allowSkip: true, countSkippedAsEligible: true } })).toThrow("same-day");
  });
});

describe("pure occurrence generation", () => {
  it("generates weekly local dates deterministically and idempotently", () => {
    const item = definition();
    const first = generateOccurrences(item, "2026-07-20", "2026-07-26", [], NOW);
    expect(first.eligibleDates).toEqual(["2026-07-20", "2026-07-22", "2026-07-24"]);
    const second = generateOccurrences(item, "2026-07-20", "2026-07-26", first.occurrences.map((entry) => entry.occurrenceKey), NOW);
    expect(second.occurrences).toEqual([]);
  });
  it("uses deterministic rule-versioned keys", () => {
    expect(occurrenceKey(definition(), "2026-07-24")).toBe("routine:v1:2026-07-24");
    expect(occurrenceKey(definition({ schedule: { frequency: "times-per-week", targetCount: 2, eligibleWeekdays: ["MO", "WE"] } }), "2026-07-22", 1)).toBe("routine:v1:2026-07-20:1");
  });
  it("supports daily intervals", () => {
    const result = generateOccurrences(definition({ schedule: { frequency: "daily", interval: 2 } }), "2026-07-01", "2026-07-06", [], NOW);
    expect(result.eligibleDates).toEqual(["2026-07-01", "2026-07-03", "2026-07-05"]);
  });
  it("supports every two weeks without adding intervening weeks", () => {
    const result = generateOccurrences(definition({ startDate: "2026-07-03", schedule: { frequency: "weekly", interval: 2, weekdays: ["FR"] } }), "2026-07-01", "2026-07-31", [], NOW);
    expect(result.eligibleDates).toEqual(["2026-07-03", "2026-07-17", "2026-07-31"]);
  });
  it("supports monthly last-day and skip behavior", () => {
    const last = generateOccurrences(definition({ startDate: "2026-01-31", schedule: { frequency: "monthly", interval: 1, monthlyRule: { type: "day-of-month", day: 31, invalidDateBehavior: "last-day" } } }), "2026-02-01", "2026-04-30", [], NOW);
    expect(last.eligibleDates).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
    const skipped = generateOccurrences(definition({ startDate: "2026-01-31", schedule: { frequency: "monthly", interval: 1, monthlyRule: { type: "day-of-month", day: 31, invalidDateBehavior: "skip" } } }), "2026-02-01", "2026-02-28", [], NOW);
    expect(skipped.eligibleDates).toEqual([]);
    expect(skipped.skippedInvalidDates).toContain("2026-02-31");
  });
  it("supports monthly weekday positions", () => {
    const result = generateOccurrences(definition({ schedule: { frequency: "monthly", interval: 1, monthlyRule: { type: "weekday-position", weekday: "FR", position: -1 } } }), "2026-07-01", "2026-07-31", [], NOW);
    expect(result.eligibleDates).toEqual(["2026-07-31"]);
  });
  it("handles leap-day policies without shifting local dates", () => {
    const feb = generateOccurrences(definition({ startDate: "2024-02-29", schedule: { frequency: "yearly", interval: 1, month: 2, day: 29, leapDayBehavior: "february-28" } }), "2025-01-01", "2025-12-31", [], NOW);
    expect(feb.eligibleDates).toEqual(["2025-02-28"]);
    const march = generateOccurrences(definition({ startDate: "2024-02-29", schedule: { frequency: "yearly", interval: 1, month: 2, day: 29, leapDayBehavior: "march-1" } }), "2025-01-01", "2025-12-31", [], NOW);
    expect(march.eligibleDates).toEqual(["2025-03-01"]);
  });
  it("supports bounded times-per-week slots", () => {
    const result = generateOccurrences(definition({ schedule: { frequency: "times-per-week", targetCount: 2, eligibleWeekdays: ["TU", "TH", "SA"] } }), "2026-07-20", "2026-07-26", [], NOW);
    expect(result.eligibleDates).toEqual(["2026-07-21", "2026-07-23"]);
  });
  it("respects start, until-date, count, status, and hard generation limits", () => {
    expect(generateOccurrences(definition({ endCondition: { type: "until-date", endDate: "2026-07-22" } }), "2026-07-20", "2026-07-31", [], NOW).eligibleDates).toEqual(["2026-07-20", "2026-07-22"]);
    expect(generateOccurrences(definition({ schedule: { frequency: "daily", interval: 1 }, endCondition: { type: "after-occurrences", occurrenceCount: 2 } }), "2026-07-01", "2026-07-31", [], NOW).eligibleDates).toHaveLength(2);
    expect(generateOccurrences(definition({ status: "paused" }), "2026-07-01", "2026-07-31", [], NOW).occurrences).toEqual([]);
    expect(generateOccurrences(definition({ schedule: { frequency: "daily", interval: 1 }, generationSettings: { generateAheadDays: 30, keepMinimumFutureOccurrences: 5, maximumGeneratedOccurrences: 2, generationMode: "manual", duplicateProtectionVersion: 1, includePausedDateRangeOnResume: false } }), "2026-07-01", "2026-07-31", [], NOW).occurrences).toHaveLength(2);
  });
});

describe("task orchestration and history", () => {
  it("materializes normal task occurrences once with template fields", () => {
    const item = definition({ taskTemplate: { title: "Friday review", priority: "high", categoryId: "career", projectId: "p", milestoneId: "m", estimatedMinutes: 45, isSplittable: true, dueRule: { type: "same-day", dueTime: "17:00" } } });
    const generated = generateOccurrences(item, "2026-07-24", "2026-07-24", [], NOW);
    const result = materializeOccurrences(item, generated.occurrences, [], NOW);
    expect(result.tasks[0]).toMatchObject({ title: "Friday review", priority: "high", category: "career", projectId: "p", milestoneId: "m", dueDate: "2026-07-24", dueTime: "17:00", isRecurringOccurrence: true });
    expect(result.occurrences[0]).toMatchObject({ status: "generated", taskId: result.tasks[0]?.id });
    expect(materializeOccurrences(item, result.occurrences, result.tasks, NOW).tasks).toHaveLength(1);
  });
  it("keeps occurrence status synchronized with completion and reopening", () => {
    const item = definition(), generated = generateOccurrences(item, "2026-07-24", "2026-07-24", [], NOW);
    const result = materializeOccurrences(item, generated.occurrences, [], NOW), task = result.tasks[0]!;
    const completed = reconcileOccurrenceWithTask(result.occurrences[0]!, completeTask(task, NOW), NOW);
    expect(completed.status).toBe("completed");
    expect(reconcileOccurrenceWithTask(completed, task, NOW).status).toBe("generated");
  });
  it("preserves skipped history and provides neutral consistency", () => {
    const item = definition({ type: "routine", routineSettings: { completionMode: "check-off", schedulingMode: "manual", carryForwardBehavior: "do-not-carry", allowSkip: true, countSkippedAsEligible: true } });
    const generated = generateOccurrences(item, "2026-07-20", "2026-07-24", [], NOW);
    const materialized = materializeOccurrences(item, generated.occurrences, [], NOW);
    const completed = reconcileOccurrenceWithTask(materialized.occurrences[0]!, completeTask(materialized.tasks[0]!, NOW), NOW);
    const skipped = skipOccurrence(materialized.occurrences[1]!, NOW);
    expect(consistencySummary(item, [completed, skipped, materialized.occurrences[2]!], "2026-07-20", "2026-07-24")).toEqual({ completed: 1, skipped: 1, eligible: 3, open: 1, rate: 1 / 3 });
  });
  it("restores skipped occurrences without changing stable IDs", () => {
    const generated = generateOccurrences(definition(), "2026-07-24", "2026-07-24", [], NOW).occurrences[0]!;
    const skipped = skipOccurrence(generated, NOW);
    expect(restoreOccurrence(skipped, "2026-07-24T20:00:00.000Z")).toMatchObject({ id: generated.id, status: "pending", skippedAt: undefined });
  });
  it("converts an existing task without duplicating or changing its ID", () => {
    const item = definition(), generated = materializeOccurrences(item, generateOccurrences(item, "2026-07-24", "2026-07-24", [], NOW).occurrences, [], NOW);
    const oneTime = { ...generated.tasks[0]!, id: "one", recurrence: undefined, recurrenceDefinitionId: undefined, recurrenceOccurrenceId: undefined, isRecurringOccurrence: false };
    const converted = convertTaskToFirstOccurrence(oneTime, item, [], NOW);
    expect(converted.task.id).toBe("one");
    expect(converted.occurrence.taskId).toBe("one");
  });
  it("marks one occurrence modified and detaches it without changing its task ID", () => {
    const item = definition(), result = materializeOccurrences(item, generateOccurrences(item, "2026-07-24", "2026-07-24", [], NOW).occurrences, [], NOW);
    const modified = markOccurrenceModified(result.tasks[0]!, NOW);
    expect(modified.recurrence?.status).toBe("modified");
    expect(detachOccurrenceTask(modified, NOW)).toMatchObject({ id: modified.id, isRecurringOccurrence: false, recurrenceDefinitionId: undefined, recurrence: { status: "detached" } });
  });
  it("creates idempotent deletion exceptions that suppress regeneration", () => {
    const item = definition(), generated = generateOccurrences(item, "2026-07-24", "2026-07-24", [], NOW);
    const occurrence = generated.occurrences[0]!;
    const exception = createRecurrenceException({ seriesId: item.id, occurrenceKey: occurrence.occurrenceKey, occurrenceDate: occurrence.occurrenceDate, type: "deleted" }, [], NOW);
    expect(createRecurrenceException({ seriesId: item.id, occurrenceKey: occurrence.occurrenceKey, occurrenceDate: occurrence.occurrenceDate, type: "deleted" }, [exception], NOW).id).toBe(exception.id);
    expect(generateOccurrences(item, "2026-07-24", "2026-07-24", [], NOW, [exception.occurrenceKey]).occurrences).toEqual([]);
  });
  it("splits this-and-future edits without duplicating the boundary series", () => {
    const split = splitRecurrenceSeries(definition(), "2026-09-04", { schedule: { frequency: "weekly", interval: 1, weekdays: ["MO"] } }, NOW);
    expect(split.original.endCondition).toEqual({ type: "until-date", endDate: "2026-09-03" });
    expect(split.future.id).not.toBe(split.original.id);
    expect(split.future.startDate).toBe("2026-09-04");
  });
  it("routine templates remain inert until explicitly applied", () => {
    const template = createRoutineTemplate({ name: "Weekly review", taskDefaults: { title: "Review", estimatedMinutes: 30 }, recurrenceRule: { frequency: "weekly", interval: 1, weekdays: ["SU"] }, sessionBlueprints: [] });
    expect(template.name).toBe("Weekly review");
    expect(() => createRoutineTemplate({ name: "Weekly review", taskDefaults: { title: "Review" } }, [template])).toThrow("already exists");
  });
  it("derives a count-based series summary instead of a score", () => {
    const item = definition(), generated = generateOccurrences(item, "2026-07-20", "2026-07-24", [], NOW);
    const result = materializeOccurrences(item, generated.occurrences, [], NOW);
    const summary = seriesHealthSummary(item, result.occurrences, result.tasks, "2026-07-23");
    expect(summary).toMatchObject({ activeOccurrenceCount: 3, overdueOccurrenceCount: 2, status: "needs-attention" });
    expect(summary).not.toHaveProperty("score");
  });
  it("analytics counts occurrence tasks and reports skipped separately", () => {
    const item = definition(), generated = generateOccurrences(item, "2026-07-20", "2026-07-24", [], NOW);
    const result = materializeOccurrences(item, generated.occurrences, [], NOW);
    const completed = reconcileOccurrenceWithTask(result.occurrences[0]!, completeTask(result.tasks[0]!, NOW), NOW);
    const skipped = skipOccurrence(result.occurrences[1]!, NOW);
    expect(recurringWorkAnalytics(result.tasks, [completed, skipped, result.occurrences[2]!], "2026-07-20", "2026-07-24")).toMatchObject({ completedOccurrences: 1, skippedOccurrences: 1, completionDenominator: 2 });
  });
  it("describes rules without cron syntax", () => {
    expect(humanRecurrenceSummary(definition())).toContain("Monday and Wednesday and Friday");
  });
});
