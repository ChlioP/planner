import { describe, expect, it } from "vitest";
import {
  blocksForDate,
  copyDateBlocks,
  createAvailabilityBlock,
  createOverride,
  createRecurringBlocks,
  deleteAvailabilityBlock,
  editAvailabilityBlock,
  mergeAvailabilityCopies,
  mergeIntervals,
  migrateAvailabilityBlocks,
  migrateAvailabilityOverrides,
  totalAvailableMinutesForDate,
  totalAvailableMinutesForWeek,
  validateAvailabilityBlock,
} from "./availability";

const NOW = "2026-07-22T12:00:00.000Z";

function oneDate(overrides: Partial<Parameters<typeof createAvailabilityBlock>[0]> = {}) {
  return createAvailabilityBlock({ name: "Evening", date: "2026-07-20", startTime: "19:00", endTime: "22:00", type: "available", isRecurring: false, ...overrides }, NOW);
}

describe("availability records", () => {
  it("creates a one-date available block with stable values", () => {
    expect(oneDate({ id: "one-date" })).toMatchObject({ id: "one-date", date: "2026-07-20", startTime: "19:00", endTime: "22:00", type: "available", isRecurring: false, createdAt: NOW });
  });

  it("creates one recurring record per selected weekday", () => {
    const records = createRecurringBlocks({ name: "Work", startTime: "09:00", endTime: "18:00", type: "work" }, [1, 2, 2, 4], NOW);
    expect(records.map((block) => block.dayOfWeek)).toEqual([1, 2, 4]);
    expect(records.every((block) => block.isRecurring && !block.date)).toBe(true);
  });

  it("edits and deletes a block without changing other records", () => {
    const first = oneDate({ id: "first" });
    const second = oneDate({ id: "second", name: "Second", startTime: "17:00", endTime: "18:00" });
    const edited = editAvailabilityBlock(first, { name: "Updated", endTime: "21:00" }, "2026-07-23T00:00:00.000Z");
    expect(edited).toMatchObject({ id: "first", name: "Updated", endTime: "21:00", createdAt: NOW, updatedAt: "2026-07-23T00:00:00.000Z" });
    expect(deleteAvailabilityBlock([edited, second], edited.id)).toEqual([second]);
  });

  it("rejects an end before or equal to the start", () => {
    expect(() => oneDate({ startTime: "22:00", endTime: "21:00" })).toThrow("must end after");
    expect(() => oneDate({ startTime: "22:00", endTime: "22:00" })).toThrow("must end after");
  });

  it("rejects exact duplicates and warns for non-identical overlaps", () => {
    const existing = oneDate({ id: "existing" });
    const duplicate = oneDate({ id: "duplicate" });
    const overlap = oneDate({ id: "overlap", name: "Meal", type: "meal", startTime: "19:00", endTime: "19:30" });
    expect(validateAvailabilityBlock(duplicate, [existing]).errors).toContain("This exact block already exists.");
    expect(validateAvailabilityBlock(overlap, [existing]).warnings[0]).toContain("overlaps");
  });

  it("applies recurring records only to their weekday", () => {
    const monday = createRecurringBlocks({ name: "Monday work", startTime: "09:00", endTime: "18:00", type: "work" }, [1], NOW)[0]!;
    expect(blocksForDate([monday], [], "2026-07-20")).toHaveLength(1);
    expect(blocksForDate([monday], [], "2026-07-21")).toHaveLength(0);
  });

  it("applies remove and replace overrides without changing the recurring source", () => {
    const recurring = createRecurringBlocks({ name: "Work", startTime: "09:00", endTime: "18:00", type: "work" }, [1], NOW)[0]!;
    const replacement = oneDate({ name: "Short workday", startTime: "09:00", endTime: "12:00", type: "work" });
    const removed = createOverride(recurring, "2026-07-20", "remove", undefined, NOW);
    const replaced = createOverride(recurring, "2026-07-20", "replace", replacement, NOW);
    expect(blocksForDate([recurring], [removed], "2026-07-20")).toEqual([]);
    expect(blocksForDate([recurring], [replaced], "2026-07-20")).toEqual([replacement]);
    expect(recurring.endTime).toBe("18:00");
  });

  it("copies effective day blocks, skips duplicates, and requires no template", () => {
    const source = oneDate({ id: "source", name: "Study" });
    const existingDestination = oneDate({ id: "destination", name: "Study", date: "2026-07-21" });
    const copy = copyDateBlocks([source, existingDestination], [], "2026-07-20", ["2026-07-21", "2026-07-22"], NOW);
    expect(copy.blocks).toHaveLength(1);
    expect(copy.blocks[0]?.date).toBe("2026-07-22");
    expect(copy.skipped).toBe(1);
  });
});

describe("availability calculations", () => {
  it("merges overlapping available intervals", () => {
    expect(mergeIntervals([{ start: 420, end: 540 }, { start: 480, end: 600 }])).toEqual([{ start: 420, end: 600 }]);
  });

  it("subtracts commitments and does not double-subtract overlapping commitments", () => {
    const available = oneDate();
    const meal = oneDate({ name: "Meal", type: "meal", startTime: "19:00", endTime: "20:00" });
    const appointment = oneDate({ name: "Appointment", type: "appointment", startTime: "19:30", endTime: "20:30" });
    expect(totalAvailableMinutesForDate([available, meal, appointment], [], "2026-07-20")).toBe(90);
  });

  it("matches the manual work, evening, meal, and appointment example", () => {
    const blocks = [
      oneDate({ name: "Work", type: "work", startTime: "09:00", endTime: "18:00" }),
      oneDate(),
      oneDate({ name: "Meal", type: "meal", startTime: "19:00", endTime: "19:30" }),
    ];
    expect(totalAvailableMinutesForDate(blocks, [], "2026-07-20")).toBe(150);
    blocks.push(oneDate({ name: "Appointment", type: "appointment", startTime: "20:00", endTime: "21:00" }));
    expect(totalAvailableMinutesForDate(blocks, [], "2026-07-20")).toBe(90);
  });

  it("calculates weekly available minutes from explicit availability only", () => {
    const weekdays = createRecurringBlocks({ name: "Focus", startTime: "19:00", endTime: "20:00", type: "available" }, [1, 2, 3, 4, 5], NOW);
    expect(totalAvailableMinutesForWeek(weekdays, [], "2026-07-20")).toBe(300);
  });
});

describe("availability persistence", () => {
  it("preserves values through refresh-like local serialization and repeated migration", () => {
    const block = oneDate({ id: "persisted", userId: "user-1" });
    const loaded = migrateAvailabilityBlocks(JSON.parse(JSON.stringify([block])));
    expect(loaded).toEqual([block]);
    expect(migrateAvailabilityBlocks(loaded)).toEqual(loaded);
  });

  it("preserves override records through serialization", () => {
    const recurring = createRecurringBlocks({ name: "Work", startTime: "09:00", endTime: "18:00", type: "work" }, [1], NOW)[0]!;
    const override = createOverride(recurring, "2026-07-20", "remove", undefined, NOW);
    expect(migrateAvailabilityOverrides(JSON.parse(JSON.stringify([override])))).toEqual([override]);
  });

  it("deduplicates synced copies by stable ID and keeps the newest", () => {
    const local = oneDate({ id: "shared", name: "Local" });
    const remote = editAvailabilityBlock(local, { name: "Remote" }, "2026-07-23T00:00:00.000Z");
    expect(mergeAvailabilityCopies([local], [remote, remote])).toEqual([remote]);
  });

  it("preserves local date strings under different timezone settings", () => {
    const originalTimezone = process.env.TZ;
    const results = ["America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Honolulu"].map((timezone) => {
      process.env.TZ = timezone;
      return migrateAvailabilityBlocks(JSON.parse(JSON.stringify([oneDate({ id: timezone })])))[0]?.date;
    });
    process.env.TZ = originalTimezone;
    expect(results).toEqual(["2026-07-20", "2026-07-20", "2026-07-20"]);
  });
});
