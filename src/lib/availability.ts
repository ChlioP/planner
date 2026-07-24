import { addLocalDays, dayOfWeekForLocalDate, isValidTime, parseLocalDate, timeToMinutes } from "./localDateTime";

export const AVAILABILITY_SCHEMA_VERSION = 1 as const;
export const STABLE_AVAILABILITY_MIGRATION_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export type AvailabilityType = "available" | "work" | "commute" | "meal" | "sleep" | "exercise" | "appointment" | "unavailable" | "other";

export interface AvailabilityBlock {
  schemaVersion: typeof AVAILABILITY_SCHEMA_VERSION;
  id: string;
  userId?: string;
  name: string;
  date?: string;
  dayOfWeek?: number;
  startTime: string;
  endTime: string;
  type: AvailabilityType;
  isRecurring: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AvailabilityOverride {
  schemaVersion: typeof AVAILABILITY_SCHEMA_VERSION;
  id: string;
  recurringBlockId: string;
  date: string;
  action: "replace" | "remove";
  replacementBlock?: AvailabilityBlock;
  createdAt: string;
  updatedAt: string;
}

export interface AvailabilityValidation { errors: string[]; warnings: string[] }
export interface Interval { start: number; end: number }

const TYPES = new Set<AvailabilityType>(["available", "work", "commute", "meal", "sleep", "exercise", "appointment", "unavailable", "other"]);

export function migrateAvailabilityBlock(value: unknown): AvailabilityBlock {
  if (!value || typeof value !== "object") throw new Error("Availability record must be an object.");
  const block = value as Partial<AvailabilityBlock>;
  if (typeof block.id !== "string" || !block.id || typeof block.name !== "string" || !block.name.trim()) throw new Error("Availability record requires an ID and name.");
  if (!TYPES.has(block.type as AvailabilityType)) throw new Error(`Availability record ${block.id} has an invalid type.`);
  if (!isValidTime(block.startTime ?? "") || !isValidTime(block.endTime ?? "")) throw new Error(`Availability record ${block.id} has an invalid time.`);
  if (timeToMinutes(block.endTime!) <= timeToMinutes(block.startTime!)) throw new Error(`Availability record ${block.id} must end after it starts; overnight blocks are not supported.`);
  const isRecurring = block.isRecurring === true;
  if (isRecurring && (!Number.isInteger(block.dayOfWeek) || block.dayOfWeek! < 0 || block.dayOfWeek! > 6)) throw new Error(`Availability record ${block.id} requires a weekday.`);
  if (!isRecurring && (!block.date || !parseLocalDate(block.date))) throw new Error(`Availability record ${block.id} requires a YYYY-MM-DD date.`);
  const createdAt = typeof block.createdAt === "string" ? block.createdAt : STABLE_AVAILABILITY_MIGRATION_TIMESTAMP;
  return {
    schemaVersion: AVAILABILITY_SCHEMA_VERSION,
    id: block.id,
    userId: typeof block.userId === "string" ? block.userId : undefined,
    name: block.name,
    date: isRecurring ? undefined : block.date,
    dayOfWeek: isRecurring ? block.dayOfWeek : undefined,
    startTime: block.startTime!,
    endTime: block.endTime!,
    type: block.type as AvailabilityType,
    isRecurring,
    createdAt,
    updatedAt: typeof block.updatedAt === "string" ? block.updatedAt : createdAt,
  };
}

export function migrateAvailabilityBlocks(value: unknown): AvailabilityBlock[] {
  if (!Array.isArray(value)) throw new Error("Availability data must be an array.");
  return value.map(migrateAvailabilityBlock);
}

export function migrateAvailabilityOverride(value: unknown): AvailabilityOverride {
  if (!value || typeof value !== "object") throw new Error("Availability override must be an object.");
  const override = value as Partial<AvailabilityOverride>;
  if (typeof override.id !== "string" || !override.id || typeof override.recurringBlockId !== "string" || !override.recurringBlockId) throw new Error("Availability override requires stable IDs.");
  if (!override.date || !parseLocalDate(override.date)) throw new Error(`Availability override ${override.id} requires a YYYY-MM-DD date.`);
  if (override.action !== "remove" && override.action !== "replace") throw new Error(`Availability override ${override.id} has an invalid action.`);
  if (override.action === "replace" && !override.replacementBlock) throw new Error(`Availability override ${override.id} requires a replacement block.`);
  const createdAt = typeof override.createdAt === "string" ? override.createdAt : STABLE_AVAILABILITY_MIGRATION_TIMESTAMP;
  return {
    schemaVersion: AVAILABILITY_SCHEMA_VERSION,
    id: override.id,
    recurringBlockId: override.recurringBlockId,
    date: override.date,
    action: override.action,
    replacementBlock: override.replacementBlock ? migrateAvailabilityBlock(override.replacementBlock) : undefined,
    createdAt,
    updatedAt: typeof override.updatedAt === "string" ? override.updatedAt : createdAt,
  };
}

export function migrateAvailabilityOverrides(value: unknown): AvailabilityOverride[] {
  if (!Array.isArray(value)) throw new Error("Availability overrides must be an array.");
  return value.map(migrateAvailabilityOverride);
}

type BlockInput = Omit<AvailabilityBlock, "schemaVersion" | "id" | "createdAt" | "updatedAt"> & { id?: string };

export function createAvailabilityBlock(input: BlockInput, now = new Date().toISOString()): AvailabilityBlock {
  return migrateAvailabilityBlock({ ...input, id: input.id ?? crypto.randomUUID(), createdAt: now, updatedAt: now });
}

export function createRecurringBlocks(input: Omit<BlockInput, "dayOfWeek" | "date" | "isRecurring" | "id">, weekdays: number[], now = new Date().toISOString()): AvailabilityBlock[] {
  return Array.from(new Set(weekdays)).map((dayOfWeek) => createAvailabilityBlock({ ...input, dayOfWeek, isRecurring: true }, now));
}

export function editAvailabilityBlock(block: AvailabilityBlock, changes: Partial<Omit<AvailabilityBlock, "id" | "createdAt">>, now = new Date().toISOString()): AvailabilityBlock {
  return migrateAvailabilityBlock({ ...block, ...changes, id: block.id, createdAt: block.createdAt, updatedAt: now });
}

export function deleteAvailabilityBlock(blocks: AvailabilityBlock[], id: string): AvailabilityBlock[] {
  return blocks.filter((block) => block.id !== id);
}

export function isExactDuplicate(block: AvailabilityBlock, other: AvailabilityBlock): boolean {
  return block.id !== other.id && block.name === other.name && block.type === other.type && block.isRecurring === other.isRecurring && block.date === other.date && block.dayOfWeek === other.dayOfWeek && block.startTime === other.startTime && block.endTime === other.endTime;
}

function overlaps(a: AvailabilityBlock, b: AvailabilityBlock): boolean {
  return timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(b.startTime) < timeToMinutes(a.endTime);
}

export function validateAvailabilityBlock(block: AvailabilityBlock, existing: AvailabilityBlock[]): AvailabilityValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (timeToMinutes(block.endTime) <= timeToMinutes(block.startTime)) errors.push("End time must be later than start time. Overnight blocks are not supported yet.");
  if (existing.some((item) => isExactDuplicate(block, item))) errors.push("This exact block already exists.");
  const sameScope = existing.filter((item) => item.id !== block.id && item.isRecurring === block.isRecurring && (block.isRecurring ? item.dayOfWeek === block.dayOfWeek : item.date === block.date));
  for (const item of sameScope) {
    if (overlaps(block, item)) warnings.push(`${block.name} overlaps ${item.name}. Available totals will exclude commitments and avoid double-counting.`);
  }
  return { errors, warnings: Array.from(new Set(warnings)) };
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.map((interval) => ({ ...interval })).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) merged.push(interval);
    else previous.end = Math.max(previous.end, interval.end);
  }
  return merged;
}

export function subtractIntervals(available: Interval[], unavailable: Interval[]): Interval[] {
  let result = mergeIntervals(available);
  for (const blocked of mergeIntervals(unavailable)) {
    result = result.flatMap((interval) => {
      if (blocked.end <= interval.start || blocked.start >= interval.end) return [interval];
      const pieces: Interval[] = [];
      if (blocked.start > interval.start) pieces.push({ start: interval.start, end: blocked.start });
      if (blocked.end < interval.end) pieces.push({ start: blocked.end, end: interval.end });
      return pieces;
    });
  }
  return result;
}

export function blocksForDate(blocks: AvailabilityBlock[], overrides: AvailabilityOverride[], date: string): AvailabilityBlock[] {
  const weekday = dayOfWeekForLocalDate(date);
  const result = blocks.filter((block) => !block.isRecurring && block.date === date);
  for (const recurring of blocks.filter((block) => block.isRecurring && block.dayOfWeek === weekday)) {
    const override = overrides.find((item) => item.recurringBlockId === recurring.id && item.date === date);
    if (!override) result.push({ ...recurring, date });
    else if (override.action === "replace" && override.replacementBlock) result.push(override.replacementBlock);
  }
  return result;
}

export function availableIntervalsForDate(blocks: AvailabilityBlock[], overrides: AvailabilityOverride[], date: string): Interval[] {
  const effective = blocksForDate(blocks, overrides, date);
  const available = effective.filter((block) => block.type === "available").map((block) => ({ start: timeToMinutes(block.startTime), end: timeToMinutes(block.endTime) }));
  const unavailable = effective.filter((block) => block.type !== "available").map((block) => ({ start: timeToMinutes(block.startTime), end: timeToMinutes(block.endTime) }));
  return subtractIntervals(available, unavailable);
}

export function totalAvailableMinutesForDate(blocks: AvailabilityBlock[], overrides: AvailabilityOverride[], date: string): number {
  return availableIntervalsForDate(blocks, overrides, date).reduce((total, interval) => total + interval.end - interval.start, 0);
}

export function totalAvailableMinutesForWeek(blocks: AvailabilityBlock[], overrides: AvailabilityOverride[], weekStart: string): number {
  return Array.from({ length: 7 }, (_, index) => totalAvailableMinutesForDate(blocks, overrides, addLocalDays(weekStart, index))).reduce((sum, minutes) => sum + minutes, 0);
}

export function createOverride(recurringBlock: AvailabilityBlock, date: string, action: "replace" | "remove", replacementBlock?: AvailabilityBlock, now = new Date().toISOString()): AvailabilityOverride {
  return migrateAvailabilityOverride({ schemaVersion: 1, id: crypto.randomUUID(), recurringBlockId: recurringBlock.id, date, action, replacementBlock, createdAt: now, updatedAt: now });
}

export function copyDateBlocks(blocks: AvailabilityBlock[], overrides: AvailabilityOverride[], sourceDate: string, destinationDates: string[], now = new Date().toISOString()): { blocks: AvailabilityBlock[]; skipped: number } {
  const source = blocksForDate(blocks, overrides, sourceDate);
  const additions: AvailabilityBlock[] = [];
  let skipped = 0;
  for (const date of Array.from(new Set(destinationDates)).filter((item) => item !== sourceDate)) {
    for (const block of source) {
      const candidate = createAvailabilityBlock({ name: block.name, date, startTime: block.startTime, endTime: block.endTime, type: block.type, isRecurring: false, userId: block.userId }, now);
      if ([...blocks, ...additions].some((item) => isExactDuplicate(candidate, item))) skipped += 1;
      else additions.push(candidate);
    }
  }
  return { blocks: additions, skipped };
}

export function mergeAvailabilityCopies(current: AvailabilityBlock[], incoming: AvailabilityBlock[]): AvailabilityBlock[] {
  const merged = new Map(current.map((block) => [block.id, block]));
  for (const block of incoming) {
    const existing = merged.get(block.id);
    if (!existing || block.updatedAt > existing.updatedAt) merged.set(block.id, block);
  }
  return Array.from(merged.values());
}
