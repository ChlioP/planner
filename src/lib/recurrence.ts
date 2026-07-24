import { addLocalDays, dayOfWeekForLocalDate, isValidTime, localDateFromDate, localDateFromParts, localDateToDate, startOfLocalWeek, timeToMinutes } from "./localDateTime";
import { createTask, type TaskPriority, type TaskRecord } from "./taskHistory";
import { createTaskSession, type TaskSession } from "./taskSessions";

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
export type RecurrenceSchedule =
  | { frequency: "daily"; interval: number }
  | { frequency: "weekly"; interval: number; weekdays: Weekday[] }
  | { frequency: "monthly"; interval: number; monthlyRule: { type: "day-of-month"; day: number; invalidDateBehavior: "skip" | "last-day" } | { type: "weekday-position"; weekday: Weekday; position: 1 | 2 | 3 | 4 | -1 } }
  | { frequency: "yearly"; interval: number; month: number; day: number; leapDayBehavior: "skip" | "february-28" | "march-1" }
  | { frequency: "times-per-week"; targetCount: number; eligibleWeekdays: Weekday[] };
export interface RecurringTaskTemplate {
  title: string; description?: string; categoryId?: string; projectId?: string; milestoneId?: string; priority: TaskPriority;
  estimatedMinutes?: number; isSplittable?: boolean;
  dueRule: { type: "same-day"; dueTime?: string } | { type: "after-occurrence"; offsetDays: number; dueTime?: string } | { type: "before-next-occurrence"; dueTime?: string } | { type: "no-deadline" };
  reminderOffsets?: number[]; sessionTemplate?: Array<{ title: string; estimatedMinutes: number; order: number }>;
}
export interface RoutineSettings {
  completionMode: "check-off" | "tracked-time" | "task-completion"; targetMinutes?: number;
  preferredWindow?: { startTime: string; endTime: string }; allowedWindow?: { startTime: string; endTime: string };
  schedulingMode: "manual" | "suggest" | "auto-preview"; carryForwardBehavior: "do-not-carry" | "offer-reschedule";
  allowSkip: boolean; countSkippedAsEligible: boolean;
}
export interface RecurrenceGenerationSettings {
  generateAheadDays: number; keepMinimumFutureOccurrences: number; maximumGeneratedOccurrences: number;
  generationMode: "app-open" | "manual" | "supported-backend"; duplicateProtectionVersion: number; includePausedDateRangeOnResume: boolean;
}
export interface RecurrenceDefinition {
  schemaVersion: 1; id: string; userId?: string; title: string; description?: string; type: "task" | "routine";
  status: "active" | "paused" | "completed" | "archived"; schedule: RecurrenceSchedule; startDate: string;
  endCondition: { type: "never" } | { type: "until-date"; endDate: string } | { type: "after-occurrences"; occurrenceCount: number };
  timezone: string; taskTemplate: RecurringTaskTemplate; generationSettings: RecurrenceGenerationSettings; routineSettings?: RoutineSettings;
  ruleVersion: number; createdAt: string; updatedAt: string; pausedAt?: string; completedAt?: string; archivedAt?: string;
}
export interface RecurrenceOccurrence {
  schemaVersion: 1; id: string; userId?: string; recurrenceDefinitionId: string; occurrenceKey: string; occurrenceDate: string; taskId?: string;
  status: "pending" | "generated" | "completed" | "skipped" | "cancelled" | "superseded";
  source: "generated" | "manual-recovery" | "rescheduled"; originalOccurrenceDate?: string; replacementOccurrenceId?: string;
  generatedAt?: string; completedAt?: string; skippedAt?: string; cancelledAt?: string; createdAt: string; updatedAt: string;
}
export interface RecurrenceException {
  schemaVersion: 1; id: string; userId?: string; seriesId: string; occurrenceKey: string; occurrenceDate: string;
  type: "deleted" | "suppressed" | "moved-to-series" | "detached"; replacementSeriesId?: string; replacementTaskId?: string;
  createdAt: string; updatedAt: string;
}
export interface RoutineTemplate {
  schemaVersion: 1; id: string; userId?: string; name: string; description?: string;
  taskDefaults: { title: string; description?: string; categoryId?: string; priority?: TaskPriority; estimatedMinutes?: number; isSplittable?: boolean; dueTime?: string };
  recurrenceRule?: RecurrenceSchedule; sessionBlueprints?: Array<{ title: string; estimatedMinutes: number; order: number }>;
  createdAt: string; updatedAt: string;
}
export interface RecurrenceSeriesSummary {
  seriesId: string; nextOccurrenceDate?: string; activeOccurrenceCount: number; completedOccurrenceCount: number; skippedOccurrenceCount: number;
  overdueOccurrenceCount: number; scheduledOccurrenceCount: number; unscheduledOccurrenceCount: number; nextUnscheduledOccurrenceDate?: string;
  status: "active" | "paused" | "completed" | "archived" | "needs-attention"; reasons: string[];
}
export interface GenerationResult { eligibleDates: string[]; occurrences: RecurrenceOccurrence[]; skippedInvalidDates: string[]; reachedEndCondition: boolean }
export const DEFAULT_GENERATION_SETTINGS: RecurrenceGenerationSettings = { generateAheadDays: 30, keepMinimumFutureOccurrences: 5, maximumGeneratedOccurrences: 100, generationMode: "app-open", duplicateProtectionVersion: 1, includePausedDateRangeOnResume: false };
const weekdays: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const validStatus = new Set(["active", "paused", "completed", "archived"]);
const validDate = (value: string) => { localDateToDate(value); return value; };
const validZone = (zone: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(); return zone; } catch { throw new Error("Timezone must be a valid IANA timezone."); } };
const positive = (value: number, label: string) => { if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`); };
const lastDay = (year: number, month: number) => new Date(year, month, 0).getDate();
const monthDistance = (start: string, date: string) => { const a = localDateToDate(start), b = localDateToDate(date); return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth(); };
const weekdayOrder: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
function normalizeSchedule(schedule: RecurrenceSchedule): RecurrenceSchedule {
  if (schedule.frequency === "weekly") return { ...schedule, weekdays: [...new Set(schedule.weekdays)].sort((a, b) => weekdayOrder.indexOf(a) - weekdayOrder.indexOf(b)) };
  if (schedule.frequency === "times-per-week") return { ...schedule, eligibleWeekdays: [...new Set(schedule.eligibleWeekdays)].sort((a, b) => weekdayOrder.indexOf(a) - weekdayOrder.indexOf(b)) };
  return schedule;
}

export function validateRecurrenceSchedule(schedule: RecurrenceSchedule): void {
  if ("version" in schedule && schedule.version !== 1) throw new Error("Unsupported recurrence rule version.");
  if (schedule.frequency === "daily") positive(schedule.interval, "Interval");
  if (schedule.frequency === "weekly") { positive(schedule.interval, "Interval"); if (!schedule.weekdays.length) throw new Error("Choose at least one weekday."); }
  if (schedule.frequency === "monthly") {
    positive(schedule.interval, "Interval");
    if (schedule.monthlyRule.type === "day-of-month" && (!Number.isInteger(schedule.monthlyRule.day) || schedule.monthlyRule.day < 1 || schedule.monthlyRule.day > 31)) throw new Error("Day of month must be between 1 and 31.");
  }
  if (schedule.frequency === "yearly") {
    positive(schedule.interval, "Interval");
    if (!Number.isInteger(schedule.month) || schedule.month < 1 || schedule.month > 12) throw new Error("Month must be between 1 and 12.");
    if (!Number.isInteger(schedule.day) || schedule.day < 1 || schedule.day > 31 || (schedule.month !== 2 || schedule.day !== 29) && schedule.day > lastDay(2025, schedule.month)) throw new Error("Choose a valid yearly date.");
  }
  if (schedule.frequency === "times-per-week") {
    positive(schedule.targetCount, "Weekly target");
    if (!schedule.eligibleWeekdays.length || schedule.targetCount > new Set(schedule.eligibleWeekdays).size) throw new Error("Weekly target cannot exceed eligible weekdays.");
  }
}
function validateWindow(window?: { startTime: string; endTime: string }) {
  if (!window) return;
  if (!isValidTime(window.startTime) || !isValidTime(window.endTime) || timeToMinutes(window.endTime) <= timeToMinutes(window.startTime)) throw new Error("Routine windows must use same-day start and end times.");
}
export function createRecurrenceDefinition(input: Partial<RecurrenceDefinition> & Pick<RecurrenceDefinition, "title" | "schedule" | "startDate" | "taskTemplate">, now = new Date().toISOString()): RecurrenceDefinition {
  if (!input.title.trim()) throw new Error("A recurrence title is required.");
  const schedule = normalizeSchedule(input.schedule); validateRecurrenceSchedule(schedule); validDate(input.startDate);
  const end = input.endCondition ?? { type: "never" as const };
  if (end.type === "until-date" && validDate(end.endDate) < input.startDate) throw new Error("End date cannot be before start date.");
  if (end.type === "after-occurrences") positive(end.occurrenceCount, "Occurrence count");
  if (!input.taskTemplate.title.trim()) throw new Error("A task template title is required.");
  if (input.taskTemplate.estimatedMinutes !== undefined) positive(input.taskTemplate.estimatedMinutes, "Estimate");
  if (input.taskTemplate.milestoneId && !input.taskTemplate.projectId) throw new Error("A milestone template requires a project.");
  for (const session of input.taskTemplate.sessionTemplate ?? []) positive(session.estimatedMinutes, "Session estimate");
  const routine = input.routineSettings;
  if ((input.type ?? "task") === "routine" && routine?.completionMode === "tracked-time") positive(routine.targetMinutes ?? 0, "Tracked-time target");
  validateWindow(routine?.preferredWindow); validateWindow(routine?.allowedWindow);
  if (routine?.preferredWindow && routine.allowedWindow && (routine.preferredWindow.startTime < routine.allowedWindow.startTime || routine.preferredWindow.endTime > routine.allowedWindow.endTime)) throw new Error("Preferred window must fit inside the allowed window.");
  const settings = { ...DEFAULT_GENERATION_SETTINGS, ...input.generationSettings };
  positive(settings.generateAheadDays, "Generation horizon"); positive(settings.keepMinimumFutureOccurrences, "Minimum future occurrences"); positive(settings.maximumGeneratedOccurrences, "Generation limit");
  if (settings.maximumGeneratedOccurrences > 500) throw new Error("Generation limit cannot exceed 500.");
  const status = input.status ?? "active"; if (!validStatus.has(status)) throw new Error("Invalid recurrence status.");
  return { ...input, schemaVersion: 1, id: input.id ?? crypto.randomUUID(), title: input.title.trim(), type: input.type ?? "task", status, schedule, startDate: input.startDate, endCondition: end, timezone: validZone(input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone), taskTemplate: { ...input.taskTemplate, title: input.taskTemplate.title.trim(), priority: input.taskTemplate.priority ?? "medium", dueRule: input.taskTemplate.dueRule ?? { type: "same-day" } }, generationSettings: settings, ruleVersion: input.ruleVersion ?? 1, createdAt: input.createdAt ?? now, updatedAt: now, pausedAt: status === "paused" ? input.pausedAt ?? now : undefined, completedAt: status === "completed" ? input.completedAt ?? now : undefined, archivedAt: status === "archived" ? input.archivedAt ?? now : undefined };
}
export function migrateRecurrenceDefinitions(value: unknown): RecurrenceDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => createRecurrenceDefinition(item as RecurrenceDefinition, typeof (item as RecurrenceDefinition).updatedAt === "string" ? (item as RecurrenceDefinition).updatedAt : "1970-01-01T00:00:00.000Z"));
}
export function migrateRecurrenceOccurrences(value: unknown): RecurrenceOccurrence[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => { const item = raw as RecurrenceOccurrence; if (!item.id || !item.recurrenceDefinitionId || !item.occurrenceKey) throw new Error("Invalid recurrence occurrence."); validDate(item.occurrenceDate); return { ...item, schemaVersion: 1, createdAt: item.createdAt ?? "1970-01-01T00:00:00.000Z", updatedAt: item.updatedAt ?? item.createdAt ?? "1970-01-01T00:00:00.000Z" }; });
}
export function createRecurrenceException(input: Omit<RecurrenceException, "schemaVersion" | "id" | "createdAt" | "updatedAt"> & { id?: string }, existing: RecurrenceException[], now = new Date().toISOString()): RecurrenceException {
  validDate(input.occurrenceDate);
  if (!input.seriesId || !input.occurrenceKey) throw new Error("A recurrence exception requires a series and occurrence key.");
  const duplicate = existing.find((item) => item.seriesId === input.seriesId && item.occurrenceKey === input.occurrenceKey);
  if (duplicate) return duplicate;
  return { ...input, schemaVersion: 1, id: input.id ?? crypto.randomUUID(), createdAt: now, updatedAt: now };
}
export function migrateRecurrenceExceptions(value: unknown): RecurrenceException[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => { const item = raw as RecurrenceException; if (!item.id || !item.seriesId || !item.occurrenceKey) throw new Error("Invalid recurrence exception."); validDate(item.occurrenceDate); return { ...item, schemaVersion: 1, createdAt: item.createdAt ?? "1970-01-01T00:00:00.000Z", updatedAt: item.updatedAt ?? item.createdAt ?? "1970-01-01T00:00:00.000Z" }; });
}
export function createRoutineTemplate(input: Omit<RoutineTemplate, "schemaVersion" | "id" | "createdAt" | "updatedAt"> & { id?: string }, existing: RoutineTemplate[] = [], now = new Date().toISOString()): RoutineTemplate {
  if (!input.name.trim() || !input.taskDefaults.title.trim()) throw new Error("Template and task titles are required.");
  if (input.recurrenceRule) validateRecurrenceSchedule(input.recurrenceRule);
  if (input.taskDefaults.estimatedMinutes !== undefined) positive(input.taskDefaults.estimatedMinutes, "Estimate");
  for (const blueprint of input.sessionBlueprints ?? []) positive(blueprint.estimatedMinutes, "Session estimate");
  if (existing.some((item) => item.name.trim().toLowerCase() === input.name.trim().toLowerCase() && item.taskDefaults.title.trim().toLowerCase() === input.taskDefaults.title.trim().toLowerCase())) throw new Error("This routine template already exists.");
  return { ...input, schemaVersion: 1, id: input.id ?? crypto.randomUUID(), name: input.name.trim(), taskDefaults: { ...input.taskDefaults, title: input.taskDefaults.title.trim() }, createdAt: now, updatedAt: now };
}
export function migrateRoutineTemplates(value: unknown): RoutineTemplate[] {
  if (!Array.isArray(value)) return [];
  const migrated: RoutineTemplate[] = [];
  for (const raw of value) {
    const item = raw as RoutineTemplate;
    migrated.push(createRoutineTemplate({ ...item, id: item.id }, migrated, item.updatedAt ?? "1970-01-01T00:00:00.000Z"));
  }
  return migrated;
}
export const mergeRecurrenceRecords = <T extends { id: string; updatedAt: string }>(local: T[], remote: T[]) => { const map = new Map(local.map((item) => [item.id, item])); for (const item of remote) { const prior = map.get(item.id); if (!prior || item.updatedAt > prior.updatedAt) map.set(item.id, item); } return [...map.values()]; };
export function occurrenceKey(definition: RecurrenceDefinition, date: string, slotIndex?: number): string {
  return definition.schedule.frequency === "times-per-week" ? `${definition.id}:v${definition.ruleVersion}:${startOfLocalWeek(date)}:${slotIndex ?? 0}` : `${definition.id}:v${definition.ruleVersion}:${date}`;
}
function nthWeekday(year: number, month: number, weekday: Weekday, position: 1 | 2 | 3 | 4 | -1): number | null {
  const target = weekdays.indexOf(weekday), max = lastDay(year, month);
  if (position === -1) { for (let day = max; day >= 1; day--) if (new Date(year, month - 1, day).getDay() === target) return day; }
  else { let count = 0; for (let day = 1; day <= max; day++) if (new Date(year, month - 1, day).getDay() === target && ++count === position) return day; }
  return null;
}
function scheduleMatches(definition: RecurrenceDefinition, date: string): { matches: boolean; invalid?: string; slot?: number } {
  const schedule = definition.schedule, start = definition.startDate;
  if (date < start) return { matches: false };
  const days = Math.round((localDateToDate(date).getTime() - localDateToDate(start).getTime()) / 86_400_000);
  if (schedule.frequency === "daily") return { matches: days % schedule.interval === 0 };
  if (schedule.frequency === "weekly") return { matches: Math.floor(days / 7) % schedule.interval === 0 && schedule.weekdays.includes(weekdays[dayOfWeekForLocalDate(date)]) };
  if (schedule.frequency === "times-per-week") {
    const weekday = weekdays[dayOfWeekForLocalDate(date)], selected = schedule.eligibleWeekdays.filter((day) => day !== "SU" || true).slice(0, schedule.targetCount);
    const slot = selected.indexOf(weekday); return { matches: slot >= 0, slot };
  }
  const value = localDateToDate(date), year = value.getFullYear(), month = value.getMonth() + 1;
  if (schedule.frequency === "monthly") {
    if (monthDistance(start, date) % schedule.interval !== 0) return { matches: false };
    if (schedule.monthlyRule.type === "weekday-position") return { matches: value.getDate() === nthWeekday(year, month, schedule.monthlyRule.weekday, schedule.monthlyRule.position) };
    const desired = schedule.monthlyRule.day, max = lastDay(year, month);
    if (desired > max) return schedule.monthlyRule.invalidDateBehavior === "last-day" ? { matches: value.getDate() === max } : { matches: false, invalid: localDateFromParts(year, month, desired) };
    return { matches: value.getDate() === desired };
  }
  if ((year - localDateToDate(start).getFullYear()) % schedule.interval !== 0) return { matches: false };
  if (schedule.month === 2 && schedule.day === 29 && lastDay(year, 2) === 28) {
    if (schedule.leapDayBehavior === "skip") return { matches: false, invalid: `${year}-02-29` };
    return { matches: date === (schedule.leapDayBehavior === "february-28" ? `${year}-02-28` : `${year}-03-01`) };
  }
  return { matches: month === schedule.month && value.getDate() === schedule.day };
}
export function generateOccurrences(definition: RecurrenceDefinition, rangeStart: string, rangeEnd: string, existingKeys: Iterable<string>, now: string, exceptionKeys: Iterable<string> = []): GenerationResult {
  validDate(rangeStart); validDate(rangeEnd); if (rangeEnd < rangeStart) throw new Error("Generation end cannot be before start.");
  if (definition.status !== "active") return { eligibleDates: [], occurrences: [], skippedInvalidDates: [], reachedEndCondition: definition.status === "completed" };
  const existing = new Set([...existingKeys, ...exceptionKeys]), eligibleDates: string[] = [], occurrences: RecurrenceOccurrence[] = [], skippedInvalidDates: string[] = [];
  const limit = Math.min(definition.generationSettings.maximumGeneratedOccurrences, 500);
  let eligibleOrdinal = 0, reachedEndCondition = false;
  for (let date = definition.startDate; date <= rangeEnd; date = addLocalDays(date, 1)) {
    const match = scheduleMatches(definition, date);
    if (match.invalid && !skippedInvalidDates.includes(match.invalid)) skippedInvalidDates.push(match.invalid);
    if (!match.matches) continue;
    eligibleOrdinal++;
    if (definition.endCondition.type === "after-occurrences" && eligibleOrdinal > definition.endCondition.occurrenceCount) { reachedEndCondition = true; break; }
    if (definition.endCondition.type === "until-date" && date > definition.endCondition.endDate) { reachedEndCondition = true; break; }
    if (date < rangeStart) continue;
    eligibleDates.push(date);
    const key = occurrenceKey(definition, date, match.slot);
    if (!existing.has(key) && occurrences.length < limit) occurrences.push({ schemaVersion: 1, id: crypto.randomUUID(), recurrenceDefinitionId: definition.id, occurrenceKey: key, occurrenceDate: date, status: "pending", source: "generated", createdAt: now, updatedAt: now });
  }
  return { eligibleDates, occurrences, skippedInvalidDates, reachedEndCondition };
}
function occurrenceDueDate(definition: RecurrenceDefinition, occurrenceDate: string, nextDate?: string) {
  const rule = definition.taskTemplate.dueRule;
  if (rule.type === "no-deadline") return undefined;
  if (rule.type === "after-occurrence") return addLocalDays(occurrenceDate, rule.offsetDays);
  if (rule.type === "before-next-occurrence") return nextDate ? addLocalDays(nextDate, -1) : occurrenceDate;
  return occurrenceDate;
}
export function materializeOccurrences(definition: RecurrenceDefinition, occurrences: RecurrenceOccurrence[], existingTasks: TaskRecord[], now: string, existingSessions: TaskSession[] = []): { occurrences: RecurrenceOccurrence[]; tasks: TaskRecord[]; sessions: TaskSession[]; failures: Array<{ occurrenceKey: string; message: string }> } {
  const tasks = [...existingTasks], taskByOccurrence = new Map(tasks.filter((task) => task.recurrenceOccurrenceId).map((task) => [task.recurrenceOccurrenceId!, task]));
  const sessions = [...existingSessions];
  const failures: Array<{ occurrenceKey: string; message: string }> = [];
  const sorted = [...occurrences].sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
  const next = sorted.map((occurrence, index) => {
    if (occurrence.taskId || taskByOccurrence.has(occurrence.id) || occurrence.status !== "pending") return occurrence;
    try {
      const template = definition.taskTemplate, dueDate = occurrenceDueDate(definition, occurrence.occurrenceDate, sorted[index + 1]?.occurrenceDate);
      const task = createTask({ title: template.title, description: template.description, category: template.categoryId ?? "other", projectId: template.projectId, milestoneId: template.milestoneId, priority: template.priority, estimatedMinutes: template.estimatedMinutes, isSplittable: template.isSplittable, dueDate, dueTime: "dueTime" in template.dueRule ? template.dueRule.dueTime : undefined, date: occurrence.occurrenceDate, scheduledDate: occurrence.occurrenceDate, status: "planned", recurrenceDefinitionId: definition.id, recurrenceOccurrenceId: occurrence.id, recurrenceOccurrenceDate: occurrence.occurrenceDate, isRecurringOccurrence: true, recurrence: { seriesId: definition.id, occurrenceKey: occurrence.occurrenceKey, occurrenceDate: occurrence.occurrenceDate, status: "generated", originalDueDate: dueDate ?? occurrence.occurrenceDate } }, now);
      tasks.push(task);
      for (const session of template.sessionTemplate ?? []) sessions.push(createTaskSession({ parentTaskId: task.id, title: session.title, estimatedMinutes: session.estimatedMinutes, order: session.order, status: "planned", isGenerated: true }, now));
      return { ...occurrence, taskId: task.id, status: "generated" as const, generatedAt: now, updatedAt: now };
    } catch (error) { failures.push({ occurrenceKey: occurrence.occurrenceKey, message: error instanceof Error ? error.message : "Task generation failed." }); return occurrence; }
  });
  return { occurrences: next, tasks, sessions, failures };
}
export function reconcileOccurrenceWithTask(occurrence: RecurrenceOccurrence, task: TaskRecord, now: string): RecurrenceOccurrence {
  if (task.status === "completed") return { ...occurrence, status: "completed", completedAt: task.completedAt ?? now, updatedAt: now };
  if (occurrence.status === "completed") return { ...occurrence, status: "generated", completedAt: undefined, updatedAt: now };
  return occurrence;
}
export function skipOccurrence(occurrence: RecurrenceOccurrence, now: string): RecurrenceOccurrence {
  if (occurrence.status === "completed") throw new Error("A completed occurrence cannot be skipped.");
  return { ...occurrence, status: "skipped", skippedAt: now, updatedAt: now };
}
export function restoreOccurrence(occurrence: RecurrenceOccurrence, now: string): RecurrenceOccurrence {
  if (occurrence.status !== "skipped") return occurrence;
  return { ...occurrence, status: occurrence.taskId ? "generated" : "pending", skippedAt: undefined, updatedAt: now };
}
export function markOccurrenceModified(task: TaskRecord, now: string): TaskRecord {
  if (!task.recurrence) return task;
  return { ...task, recurrence: { ...task.recurrence, status: "modified" }, updatedAt: now };
}
export function detachOccurrenceTask(task: TaskRecord, now: string): TaskRecord {
  if (!task.recurrence) return task;
  return { ...task, recurrence: { ...task.recurrence, status: "detached", detachedAt: now }, recurrenceDefinitionId: undefined, recurrenceOccurrenceId: undefined, isRecurringOccurrence: false, updatedAt: now };
}
export function convertTaskToFirstOccurrence(task: TaskRecord, definition: RecurrenceDefinition, existing: RecurrenceOccurrence[], now: string): { task: TaskRecord; occurrence: RecurrenceOccurrence } {
  if (task.recurrence || task.recurrenceOccurrenceId) throw new Error("This task is already linked to recurrence.");
  const date = task.dueDate ?? task.date ?? definition.startDate;
  validDate(date);
  const key = occurrenceKey(definition, date);
  const prior = existing.find((item) => item.occurrenceKey === key);
  const occurrence: RecurrenceOccurrence = prior ?? { schemaVersion: 1, id: crypto.randomUUID(), recurrenceDefinitionId: definition.id, occurrenceKey: key, occurrenceDate: date, taskId: task.id, status: task.status === "completed" ? "completed" : "generated", source: "generated", generatedAt: now, completedAt: task.completedAt ?? undefined, createdAt: now, updatedAt: now };
  return { occurrence, task: { ...task, recurrenceDefinitionId: definition.id, recurrenceOccurrenceId: occurrence.id, recurrenceOccurrenceDate: date, isRecurringOccurrence: true, recurrence: { seriesId: definition.id, occurrenceKey: key, occurrenceDate: date, status: "generated", originalDueDate: task.dueDate ?? date }, updatedAt: now } };
}
export function occurrenceHasMeaningfulActivity(task: TaskRecord, sessions: TaskSession[], scheduleBlockTaskIds: Set<string>, timeLogTaskIds: Set<string>, reminderTaskIds: Set<string>): boolean {
  return task.status === "completed" || task.recurrence?.status === "modified" || Boolean(task.note || task.notes || sessions.some((item) => item.parentTaskId === task.id) || scheduleBlockTaskIds.has(task.id) || timeLogTaskIds.has(task.id) || reminderTaskIds.has(task.id));
}
export function splitRecurrenceSeries(definition: RecurrenceDefinition, boundaryDate: string, changes: Partial<Pick<RecurrenceDefinition, "title" | "schedule" | "taskTemplate" | "timezone">>, now: string): { original: RecurrenceDefinition; future: RecurrenceDefinition } {
  validDate(boundaryDate);
  if (boundaryDate <= definition.startDate) throw new Error("Split boundary must be after the original series start.");
  const original = createRecurrenceDefinition({ ...definition, endCondition: { type: "until-date", endDate: addLocalDays(boundaryDate, -1) } }, now);
  const future = createRecurrenceDefinition({ ...definition, ...changes, id: crypto.randomUUID(), startDate: boundaryDate, endCondition: definition.endCondition.type === "until-date" && definition.endCondition.endDate < boundaryDate ? { type: "never" } : definition.endCondition, ruleVersion: 1, createdAt: now }, now);
  return { original, future };
}
export function seriesHealthSummary(definition: RecurrenceDefinition, occurrences: RecurrenceOccurrence[], tasks: TaskRecord[], today: string, scheduledTaskIds: Set<string> = new Set()): RecurrenceSeriesSummary {
  const linked = occurrences.filter((item) => item.recurrenceDefinitionId === definition.id && item.status !== "cancelled" && item.status !== "superseded");
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const active = linked.filter((item) => item.status === "generated" || item.status === "pending");
  const overdue = active.filter((item) => item.occurrenceDate < today && (!item.taskId || taskById.get(item.taskId)?.status !== "completed"));
  const scheduled = active.filter((item) => item.taskId && scheduledTaskIds.has(item.taskId));
  const unscheduled = active.filter((item) => !item.taskId || !scheduledTaskIds.has(item.taskId)).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
  const reasons: string[] = [];
  if (overdue.length) reasons.push(`${overdue.length} occurrence${overdue.length === 1 ? "" : "s"} need review.`);
  if (unscheduled.length) reasons.push(`${unscheduled.length} generated occurrence${unscheduled.length === 1 ? " is" : "s are"} unscheduled.`);
  return { seriesId: definition.id, nextOccurrenceDate: active.filter((item) => item.occurrenceDate >= today).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate))[0]?.occurrenceDate, activeOccurrenceCount: active.length, completedOccurrenceCount: linked.filter((item) => item.status === "completed").length, skippedOccurrenceCount: linked.filter((item) => item.status === "skipped").length, overdueOccurrenceCount: overdue.length, scheduledOccurrenceCount: scheduled.length, unscheduledOccurrenceCount: unscheduled.length, nextUnscheduledOccurrenceDate: unscheduled[0]?.occurrenceDate, status: definition.status === "active" && overdue.length ? "needs-attention" : definition.status, reasons };
}
export function recurringWorkAnalytics(tasks: TaskRecord[], occurrences: RecurrenceOccurrence[], rangeStart: string, rangeEnd: string) {
  const taskByOccurrence = new Map(tasks.filter((task) => task.recurrenceOccurrenceId).map((task) => [task.recurrenceOccurrenceId!, task]));
  const relevant = occurrences.filter((item) => item.occurrenceDate >= rangeStart && item.occurrenceDate <= rangeEnd && item.status !== "cancelled" && item.status !== "superseded");
  const skipped = relevant.filter((item) => item.status === "skipped").length;
  const eligible = relevant.filter((item) => item.status !== "skipped");
  return {
    completedOccurrences: eligible.filter((item) => item.status === "completed").length,
    skippedOccurrences: skipped,
    overdueOccurrences: eligible.filter((item) => item.occurrenceDate < rangeEnd && item.status !== "completed").length,
    activeOccurrenceCount: eligible.filter((item) => item.status === "generated" || item.status === "pending").length,
    completedEstimateMinutes: eligible.filter((item) => item.status === "completed").reduce((sum, item) => sum + (item.taskId ? taskByOccurrence.get(item.id)?.estimatedMinutes ?? tasks.find((task) => task.id === item.taskId)?.estimatedMinutes ?? 0 : 0), 0),
    completionDenominator: eligible.length,
  };
}
export function consistencySummary(definition: RecurrenceDefinition, occurrences: RecurrenceOccurrence[], rangeStart: string, rangeEnd: string) {
  const relevant = occurrences.filter((item) => item.recurrenceDefinitionId === definition.id && item.occurrenceDate >= rangeStart && item.occurrenceDate <= rangeEnd && item.status !== "cancelled" && item.status !== "superseded");
  const completed = relevant.filter((item) => item.status === "completed").length, skipped = relevant.filter((item) => item.status === "skipped").length;
  const eligible = relevant.filter((item) => item.status !== "skipped" || definition.routineSettings?.countSkippedAsEligible !== false).length;
  return { completed, skipped, eligible, open: relevant.filter((item) => item.status === "pending" || item.status === "generated").length, rate: eligible ? completed / eligible : undefined };
}
export function humanRecurrenceSummary(definition: Pick<RecurrenceDefinition, "schedule" | "startDate">): string {
  const schedule = definition.schedule;
  const dayName = (day: Weekday) => ({ MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday" })[day];
  if (schedule.frequency === "daily") return `Every ${schedule.interval === 1 ? "day" : `${schedule.interval} days`} starting ${definition.startDate}.`;
  if (schedule.frequency === "weekly") return `Every ${schedule.interval === 1 ? "" : `${schedule.interval} weeks on `}${schedule.weekdays.map(dayName).join(" and ")} starting ${definition.startDate}.`;
  if (schedule.frequency === "times-per-week") return `${schedule.targetCount} times per week on eligible days ${schedule.eligibleWeekdays.map(dayName).join(", ")}.`;
  if (schedule.frequency === "monthly") {
    const prefix = schedule.interval === 1 ? "Monthly" : `Every ${schedule.interval} months`;
    if (schedule.monthlyRule.type === "weekday-position") {
      const position = schedule.monthlyRule.position === -1 ? "last" : ["", "first", "second", "third", "fourth"][schedule.monthlyRule.position];
      return `${prefix} on the ${position} ${dayName(schedule.monthlyRule.weekday)}.`;
    }
    const mod100 = schedule.monthlyRule.day % 100, mod10 = schedule.monthlyRule.day % 10;
    const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
    return `${prefix} on the ${schedule.monthlyRule.day}${suffix}${schedule.monthlyRule.invalidDateBehavior === "last-day" ? ", using the last day when needed" : ", skipping months without that date"}.`;
  }
  return `Every ${schedule.interval === 1 ? "year" : `${schedule.interval} years`} starting ${definition.startDate}.`;
}
export function todayInTimezone(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
}
export const nextGenerationEnd = (definition: RecurrenceDefinition, today: string) => addLocalDays(today, definition.generationSettings.generateAheadDays);
export const catchUpStart = (today: string) => addLocalDays(today, -14);
export const dateFromLocal = localDateFromDate;
