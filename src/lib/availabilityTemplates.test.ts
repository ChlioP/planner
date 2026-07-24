import { describe, expect, it } from "vitest";
import { createAvailabilityBlock, createRecurringBlocks, totalAvailableMinutesForDate } from "./availability";
import {
  applyTemplatePreview,
  createAvailabilityTemplate,
  datesInRange,
  deleteAvailabilityTemplate,
  duplicateAvailabilityTemplate,
  editAvailabilityTemplate,
  mergeTemplateCopies,
  migrateAvailabilityTemplates,
  previewTemplateAsRecurring,
  previewTemplateForDates,
  validateTemplate,
  type AvailabilityTemplateBlock,
} from "./availabilityTemplates";
import { createTask } from "./taskHistory";

const NOW = "2026-07-22T12:00:00.000Z";
const LATER = "2026-07-23T12:00:00.000Z";

const workdayBlocks: AvailabilityTemplateBlock[] = [
  { id: "work", name: "Work", startTime: "09:00", endTime: "18:00", type: "work" },
  { id: "available", name: "Available", startTime: "19:00", endTime: "22:00", type: "available" },
  { id: "meal", name: "Meal", startTime: "19:00", endTime: "19:30", type: "meal" },
];

function workday() {
  return createAvailabilityTemplate({ id: "workday", name: "Workday", description: "Standard day", blocks: workdayBlocks }, NOW);
}

describe("availability template lifecycle", () => {
  it("creates, edits, and renames a template while preserving its ID", () => {
    const created = workday();
    const edited = editAvailabilityTemplate(created, { name: "Office Day", description: "Renamed", blocks: [...created.blocks].reverse() }, LATER);
    expect(created).toMatchObject({ id: "workday", name: "Workday", createdAt: NOW });
    expect(edited).toMatchObject({ id: "workday", name: "Office Day", description: "Renamed", createdAt: NOW, updatedAt: LATER });
  });

  it("duplicates with new template and block IDs and opens an independent copy", () => {
    const original = workday();
    const copy = duplicateAvailabilityTemplate(original, LATER);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("Workday Copy");
    expect(copy.blocks.map((block) => block.id)).not.toEqual(original.blocks.map((block) => block.id));
    expect(original.name).toBe("Workday");
  });

  it("deletes only the template and leaves applied availability and tasks untouched", () => {
    const template = workday();
    const preview = previewTemplateForDates(template, ["2026-07-27"], [], [], "missing", NOW);
    const applied = applyTemplatePreview([], preview);
    const task = createTask({ id: "task", title: "Preserve me", date: "2026-07-27", time: "08:00" }, NOW);
    expect(deleteAvailabilityTemplate([template], template.id)).toEqual([]);
    expect(applied).toHaveLength(3);
    expect(task.id).toBe("task");
  });

  it("rejects invalid ranges and duplicate blocks and warns about overlaps", () => {
    expect(() => createAvailabilityTemplate({ name: "Bad", blocks: [{ id: "bad", name: "Bad", startTime: "10:00", endTime: "09:00", type: "work" }] }, NOW)).toThrow("must end after");
    const duplicate = validateTemplate({ name: "Duplicate", blocks: [workdayBlocks[0]!, { ...workdayBlocks[0]!, id: "work-2" }] });
    expect(duplicate.errors[0]).toContain("Duplicate block");
    expect(validateTemplate({ name: "Overlap", blocks: [workdayBlocks[1]!, workdayBlocks[2]!] }).warnings[0]).toContain("overlaps");
  });
});

describe("template application", () => {
  it("applies to one date and reproduces the Phase 3 available total", () => {
    const preview = previewTemplateForDates(workday(), ["2026-07-27"], [], [], "missing", NOW);
    const applied = applyTemplatePreview([], preview);
    expect(preview.affectedDates).toEqual(["2026-07-27"]);
    expect(preview.blocksToCreate).toHaveLength(3);
    expect(totalAvailableMinutesForDate(applied, [], "2026-07-27")).toBe(150);
  });

  it("applies atomically to multiple selected dates with correct counts", () => {
    const preview = previewTemplateForDates(workday(), ["2026-07-27", "2026-07-29"], [], [], "missing", NOW);
    expect(preview.affectedDates).toHaveLength(2);
    expect(preview.blocksToCreate).toHaveLength(6);
    expect(applyTemplatePreview([], preview)).toHaveLength(6);
  });

  it("selects weekdays inside a date range", () => {
    const dates = datesInRange("2026-08-01", "2026-08-09", [1, 3, 5]);
    expect(dates).toEqual(["2026-08-03", "2026-08-05", "2026-08-07"]);
    expect(previewTemplateForDates(workday(), dates, [], [], "missing", NOW).blocksToCreate).toHaveLength(9);
  });

  it("applies a template as recurring weekly availability and skips exact duplicates", () => {
    const first = previewTemplateAsRecurring(workday(), [1, 2, 3, 4, 5], [], NOW);
    expect(first.blocksToCreate).toHaveLength(15);
    const second = previewTemplateAsRecurring(workday(), [1, 2, 3, 4, 5], first.blocksToCreate, LATER);
    expect(second.blocksToCreate).toHaveLength(0);
    expect(second.skippedDuplicates).toBe(15);
  });

  it("skips exact date duplicates when the same template is applied twice", () => {
    const first = previewTemplateForDates(workday(), ["2026-07-27"], [], [], "missing", NOW);
    const applied = applyTemplatePreview([], first);
    const second = previewTemplateForDates(workday(), ["2026-07-27"], applied, [], "missing", LATER);
    expect(second.blocksToCreate).toHaveLength(0);
    expect(second.skippedDuplicates).toBe(3);
  });

  it("replace mode affects only selected date-specific blocks and preserves recurring blocks", () => {
    const selected = createAvailabilityBlock({ id: "selected", name: "Old Monday", date: "2026-07-27", startTime: "08:00", endTime: "09:00", type: "available", isRecurring: false }, NOW);
    const otherDate = createAvailabilityBlock({ id: "other", name: "Other day", date: "2026-07-28", startTime: "08:00", endTime: "09:00", type: "available", isRecurring: false }, NOW);
    const recurring = createRecurringBlocks({ name: "Recurring work", startTime: "09:00", endTime: "18:00", type: "work" }, [1], NOW)[0]!;
    const existing = [selected, otherDate, recurring];
    const preview = previewTemplateForDates(workday(), ["2026-07-27"], existing, [], "replace", LATER);
    const applied = applyTemplatePreview(existing, preview);
    expect(preview.dateSpecificBlockIdsToRemove).toEqual(["selected"]);
    expect(applied.some((block) => block.id === "selected")).toBe(false);
    expect(applied.some((block) => block.id === "other")).toBe(true);
    expect(applied.some((block) => block.id === recurring.id)).toBe(true);
    expect(existing).toEqual([selected, otherDate, recurring]);
  });

  it("reports overlap conflicts in plain language", () => {
    const appointment = createAvailabilityBlock({ name: "Appointment", date: "2026-07-27", startTime: "20:00", endTime: "21:00", type: "appointment", isRecurring: false }, NOW);
    const preview = previewTemplateForDates(workday(), ["2026-07-27"], [appointment], [], "missing", NOW);
    expect(preview.warnings.some((warning) => warning.includes("Available overlaps Appointment"))).toBe(true);
  });

  it("warns for large date ranges and previews all counts", () => {
    const dates = datesInRange("2026-01-01", "2026-05-01", []);
    const preview = previewTemplateForDates(workday(), dates, [], [], "missing", NOW);
    expect(preview.affectedDates.length).toBeGreaterThan(90);
    expect(preview.blocksToCreate.length).toBe(preview.affectedDates.length * 3);
    expect(preview.largeRangeWarning).toContain("Review");
  });
});

describe("template persistence", () => {
  it("survives refresh-like cache serialization and repeated migration", () => {
    const template = workday();
    const loaded = migrateAvailabilityTemplates(JSON.parse(JSON.stringify([template])));
    expect(loaded).toEqual([template]);
    expect(migrateAvailabilityTemplates(loaded)).toEqual(loaded);
  });

  it("preserves Firebase-style copies by stable ID and newest timestamp", () => {
    const local = workday();
    const remote = editAvailabilityTemplate(local, { name: "Remote name" }, LATER);
    expect(mergeTemplateCopies([local], [remote, remote])).toEqual([remote]);
  });

  it("keeps HH:mm values stable across timezone settings", () => {
    const originalTimezone = process.env.TZ;
    const values = ["America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Honolulu"].map((timezone) => {
      process.env.TZ = timezone;
      return migrateAvailabilityTemplates(JSON.parse(JSON.stringify([workday()])))[0]?.blocks.map((block) => [block.startTime, block.endTime]);
    });
    process.env.TZ = originalTimezone;
    expect(values[0]).toEqual(values[1]);
    expect(values[1]).toEqual(values[2]);
  });
});
