import {
  blocksForDate,
  createAvailabilityBlock,
  createRecurringBlocks,
  isExactDuplicate,
  type AvailabilityBlock,
  type AvailabilityOverride,
  type AvailabilityType,
} from "./availability";
import { addLocalDays, dayOfWeekForLocalDate, isValidTime, parseLocalDate, timeToMinutes } from "./localDateTime";

export const AVAILABILITY_TEMPLATE_SCHEMA_VERSION = 1 as const;
export const STABLE_TEMPLATE_MIGRATION_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export interface AvailabilityTemplateBlock {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  type: AvailabilityType;
}

export interface AvailabilityTemplate {
  schemaVersion: typeof AVAILABILITY_TEMPLATE_SCHEMA_VERSION;
  id: string;
  userId?: string;
  name: string;
  description?: string;
  blocks: AvailabilityTemplateBlock[];
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateValidation { errors: string[]; warnings: string[] }
export interface TemplateApplyPreview {
  blocksToCreate: AvailabilityBlock[];
  dateSpecificBlockIdsToRemove: string[];
  affectedDates: string[];
  skippedDuplicates: number;
  warnings: string[];
  largeRangeWarning?: string;
}

const TYPES = new Set<AvailabilityType>(["available", "work", "commute", "meal", "sleep", "exercise", "appointment", "unavailable", "other"]);

export function migrateTemplateBlock(value: unknown): AvailabilityTemplateBlock {
  if (!value || typeof value !== "object") throw new Error("Template block must be an object.");
  const block = value as Partial<AvailabilityTemplateBlock>;
  if (typeof block.id !== "string" || !block.id || typeof block.name !== "string" || !block.name.trim()) throw new Error("Every template block requires an ID and name.");
  if (!TYPES.has(block.type as AvailabilityType)) throw new Error(`Template block ${block.id} has an invalid type.`);
  if (!isValidTime(block.startTime ?? "") || !isValidTime(block.endTime ?? "")) throw new Error(`Template block ${block.id} has an invalid time.`);
  if (timeToMinutes(block.endTime!) <= timeToMinutes(block.startTime!)) throw new Error(`Template block ${block.id} must end after it starts; overnight blocks are not supported.`);
  return { id: block.id, name: block.name, startTime: block.startTime!, endTime: block.endTime!, type: block.type as AvailabilityType };
}

export function validateTemplate(template: Pick<AvailabilityTemplate, "name" | "blocks">): TemplateValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!template.name.trim()) errors.push("Template name is required.");
  const validBlocks: AvailabilityTemplateBlock[] = [];
  for (const rawBlock of template.blocks) {
    try { validBlocks.push(migrateTemplateBlock(rawBlock)); }
    catch (error) { errors.push(error instanceof Error ? error.message : "A template block is invalid."); }
  }
  for (let left = 0; left < validBlocks.length; left += 1) {
    for (let right = left + 1; right < validBlocks.length; right += 1) {
      const a = validBlocks[left]!;
      const b = validBlocks[right]!;
      const exact = a.name === b.name && a.type === b.type && a.startTime === b.startTime && a.endTime === b.endTime;
      if (exact) errors.push(`Duplicate block: ${a.name} ${a.startTime}–${a.endTime}.`);
      else if (timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(b.startTime) < timeToMinutes(a.endTime)) warnings.push(`${a.name} overlaps ${b.name}.`);
    }
  }
  return { errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)) };
}

export function migrateAvailabilityTemplate(value: unknown): AvailabilityTemplate {
  if (!value || typeof value !== "object") throw new Error("Availability template must be an object.");
  const template = value as Partial<AvailabilityTemplate>;
  if (typeof template.id !== "string" || !template.id) throw new Error("Availability template requires a stable ID.");
  if (!Array.isArray(template.blocks)) throw new Error(`Template ${template.id} requires a block list.`);
  const blocks = template.blocks.map(migrateTemplateBlock);
  const validation = validateTemplate({ name: typeof template.name === "string" ? template.name : "", blocks });
  if (validation.errors.length) throw new Error(validation.errors.join(" "));
  const createdAt = typeof template.createdAt === "string" ? template.createdAt : STABLE_TEMPLATE_MIGRATION_TIMESTAMP;
  return {
    schemaVersion: AVAILABILITY_TEMPLATE_SCHEMA_VERSION,
    id: template.id,
    userId: typeof template.userId === "string" ? template.userId : undefined,
    name: template.name!,
    description: typeof template.description === "string" ? template.description : undefined,
    blocks,
    isDefault: template.isDefault === true ? true : undefined,
    createdAt,
    updatedAt: typeof template.updatedAt === "string" ? template.updatedAt : createdAt,
  };
}

export function migrateAvailabilityTemplates(value: unknown): AvailabilityTemplate[] {
  if (!Array.isArray(value)) throw new Error("Availability templates must be an array.");
  return value.map(migrateAvailabilityTemplate);
}

type TemplateInput = Omit<AvailabilityTemplate, "schemaVersion" | "id" | "createdAt" | "updatedAt"> & { id?: string };

export function createAvailabilityTemplate(input: TemplateInput, now = new Date().toISOString()): AvailabilityTemplate {
  return migrateAvailabilityTemplate({ ...input, id: input.id ?? crypto.randomUUID(), createdAt: now, updatedAt: now });
}

export function editAvailabilityTemplate(template: AvailabilityTemplate, changes: Partial<Omit<AvailabilityTemplate, "id" | "createdAt">>, now = new Date().toISOString()): AvailabilityTemplate {
  return migrateAvailabilityTemplate({ ...template, ...changes, id: template.id, createdAt: template.createdAt, updatedAt: now });
}

export function duplicateAvailabilityTemplate(template: AvailabilityTemplate, now = new Date().toISOString()): AvailabilityTemplate {
  return createAvailabilityTemplate({
    name: `${template.name} Copy`, description: template.description,
    blocks: template.blocks.map((block) => ({ ...block, id: crypto.randomUUID() })),
  }, now);
}

export function deleteAvailabilityTemplate(templates: AvailabilityTemplate[], id: string): AvailabilityTemplate[] {
  return templates.filter((template) => template.id !== id);
}

export function mergeTemplateCopies(current: AvailabilityTemplate[], incoming: AvailabilityTemplate[]): AvailabilityTemplate[] {
  const merged = new Map(current.map((template) => [template.id, template]));
  for (const template of incoming) {
    const existing = merged.get(template.id);
    if (!existing || template.updatedAt > existing.updatedAt) merged.set(template.id, template);
  }
  return Array.from(merged.values());
}

function sameEffectiveBlock(candidate: AvailabilityBlock, existing: AvailabilityBlock): boolean {
  return candidate.name === existing.name && candidate.type === existing.type && candidate.startTime === existing.startTime && candidate.endTime === existing.endTime;
}

function overlapMessage(candidate: AvailabilityBlock, existing: AvailabilityBlock, dateOrDay: string): string | null {
  if (timeToMinutes(candidate.startTime) >= timeToMinutes(existing.endTime) || timeToMinutes(existing.startTime) >= timeToMinutes(candidate.endTime)) return null;
  return `${candidate.name} overlaps ${existing.name} on ${dateOrDay}.`;
}

export function previewTemplateForDates(
  template: AvailabilityTemplate,
  dates: string[],
  existingBlocks: AvailabilityBlock[],
  overrides: AvailabilityOverride[],
  mode: "missing" | "replace" = "missing",
  now = new Date().toISOString(),
): TemplateApplyPreview {
  const uniqueDates = Array.from(new Set(dates));
  if (uniqueDates.length === 0) throw new Error("Choose at least one destination date.");
  if (uniqueDates.some((date) => !parseLocalDate(date))) throw new Error("Every destination must use YYYY-MM-DD.");
  const removalIds = mode === "replace"
    ? existingBlocks.filter((block) => !block.isRecurring && block.date && uniqueDates.includes(block.date)).map((block) => block.id)
    : [];
  const retained = existingBlocks.filter((block) => !removalIds.includes(block.id));
  const additions: AvailabilityBlock[] = [];
  const warnings: string[] = [];
  let skippedDuplicates = 0;
  for (const date of uniqueDates) {
    const effective = blocksForDate(retained, overrides, date);
    for (const templateBlock of template.blocks) {
      const candidate = createAvailabilityBlock({ ...templateBlock, id: undefined, date, isRecurring: false }, now);
      if ([...effective, ...additions.filter((block) => block.date === date)].some((block) => sameEffectiveBlock(candidate, block))) {
        skippedDuplicates += 1;
        warnings.push(`${candidate.name} already exists from ${candidate.startTime} to ${candidate.endTime} on ${date}; it will be skipped.`);
        continue;
      }
      for (const block of effective) {
        const warning = overlapMessage(candidate, block, date);
        if (warning) warnings.push(warning);
      }
      additions.push(candidate);
    }
  }
  return {
    blocksToCreate: additions,
    dateSpecificBlockIdsToRemove: removalIds,
    affectedDates: uniqueDates,
    skippedDuplicates,
    warnings: Array.from(new Set(warnings)),
    largeRangeWarning: uniqueDates.length > 90 ? `This will affect ${uniqueDates.length} dates. Review the preview carefully.` : undefined,
  };
}

export function previewTemplateAsRecurring(template: AvailabilityTemplate, weekdays: number[], existingBlocks: AvailabilityBlock[], now = new Date().toISOString()): TemplateApplyPreview {
  const uniqueWeekdays = Array.from(new Set(weekdays));
  if (uniqueWeekdays.length === 0) throw new Error("Choose at least one weekday.");
  if (uniqueWeekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Choose valid weekdays.");
  const additions: AvailabilityBlock[] = [];
  const warnings: string[] = [];
  let skippedDuplicates = 0;
  for (const templateBlock of template.blocks) {
    const recurringInput = { name: templateBlock.name, startTime: templateBlock.startTime, endTime: templateBlock.endTime, type: templateBlock.type };
    for (const candidate of createRecurringBlocks(recurringInput, uniqueWeekdays, now)) {
      if ([...existingBlocks, ...additions].some((block) => isExactDuplicate(candidate, block))) {
        skippedDuplicates += 1;
        warnings.push(`${candidate.name} already exists from ${candidate.startTime} to ${candidate.endTime} on weekday ${candidate.dayOfWeek}; it will be skipped.`);
        continue;
      }
      for (const block of existingBlocks.filter((item) => item.isRecurring && item.dayOfWeek === candidate.dayOfWeek)) {
        const warning = overlapMessage(candidate, block, `weekday ${candidate.dayOfWeek}`);
        if (warning) warnings.push(warning);
      }
      additions.push(candidate);
    }
  }
  return { blocksToCreate: additions, dateSpecificBlockIdsToRemove: [], affectedDates: [], skippedDuplicates, warnings: Array.from(new Set(warnings)) };
}

export function datesInRange(startDate: string, endDate: string, weekdays: number[]): string[] {
  if (!parseLocalDate(startDate) || !parseLocalDate(endDate) || startDate > endDate) throw new Error("Choose a valid date range.");
  const selected = new Set(weekdays);
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addLocalDays(date, 1)) {
    if (selected.size === 0 || selected.has(dayOfWeekForLocalDate(date))) dates.push(date);
  }
  return dates;
}

export function applyTemplatePreview(blocks: AvailabilityBlock[], preview: TemplateApplyPreview): AvailabilityBlock[] {
  const remove = new Set(preview.dateSpecificBlockIdsToRemove);
  return [...blocks.filter((block) => !remove.has(block.id)), ...preview.blocksToCreate];
}
