import { availableIntervalsForDate, type AvailabilityBlock, type AvailabilityOverride, type Interval } from "./availability";
import { addLocalDays, dayOfWeekForLocalDate, isValidTime, parseLocalDate, timeToMinutes } from "./localDateTime";
import type { TaskRecord } from "./taskHistory";
import type { TaskSession } from "./taskSessions";

export const SCHEDULE_BLOCK_SCHEMA_VERSION = 1 as const;
export const STABLE_SCHEDULE_MIGRATION_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export type ScheduleBlockStatus = "proposed" | "confirmed" | "completed" | "missed" | "cancelled";
export interface ScheduleBlock {
  schemaVersion: typeof SCHEDULE_BLOCK_SCHEMA_VERSION;
  id: string;
  userId?: string;
  taskId: string;
  sessionId?: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  source: "automatic" | "manual";
  status: ScheduleBlockStatus;
  isLocked: boolean;
  schedulingRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulingOptions {
  startDate: string;
  endDate: string;
  today: string;
  currentTime?: string;
  selectedTaskIds: string[];
  includeUndated: boolean;
  includeWeekends: boolean;
  includeOverdue: boolean;
  allowLateScheduling: boolean;
  allowDirectSplittable: boolean;
  allowFlexibleSessionOrder: boolean;
  allowSameTaskPerDay: boolean;
  replaceUnlockedProposed: boolean;
  replaceUnlockedAutomatic?: boolean;
  dailyCapMinutes: number;
  minimumBreakMinutes: number;
  runId: string;
  now: string;
}

export interface UnscheduledWork {
  taskId: string;
  sessionId?: string;
  title: string;
  remainingMinutes: number;
  reason: string;
}

export interface SchedulingResult {
  proposedBlocks: ScheduleBlock[];
  unscheduledWork: UnscheduledWork[];
  warnings: string[];
  perDayTotals: Record<string, number>;
  perTaskTotals: Record<string, { scheduledMinutes: number; unscheduledMinutes: number }>;
  replaceBlockIds: string[];
}

interface WorkItem {
  key: string;
  task: TaskRecord;
  session?: TaskSession;
  minutes: number;
  splittable: boolean;
}

const PRIORITY = { critical: 0, high: 1, medium: 2, low: 3 } as const;
const ACTIVE = new Set<ScheduleBlockStatus>(["proposed", "confirmed"]);

export function migrateScheduleBlock(value: unknown): ScheduleBlock {
  if (!value || typeof value !== "object") throw new Error("Schedule block must be an object.");
  const block = value as Partial<ScheduleBlock>;
  if (typeof block.id !== "string" || !block.id || typeof block.taskId !== "string" || !block.taskId) throw new Error("Schedule block requires stable block and task IDs.");
  if (typeof block.title !== "string" || !block.title.trim()) throw new Error(`Schedule block ${block.id} requires a title.`);
  if (!block.date || !parseLocalDate(block.date)) throw new Error(`Schedule block ${block.id} requires a YYYY-MM-DD date.`);
  if (!isValidTime(block.startTime ?? "") || !isValidTime(block.endTime ?? "")) throw new Error(`Schedule block ${block.id} has an invalid time.`);
  const duration = timeToMinutes(block.endTime!) - timeToMinutes(block.startTime!);
  if (duration <= 0) throw new Error(`Schedule block ${block.id} must end after it starts; overnight blocks are not supported.`);
  if (block.durationMinutes !== duration) throw new Error(`Schedule block ${block.id} duration must match its start and end time.`);
  if (block.source !== "automatic" && block.source !== "manual") throw new Error(`Schedule block ${block.id} has an invalid source.`);
  if (!["proposed", "confirmed", "completed", "missed", "cancelled"].includes(block.status ?? "")) throw new Error(`Schedule block ${block.id} has an invalid status.`);
  const createdAt = typeof block.createdAt === "string" ? block.createdAt : STABLE_SCHEDULE_MIGRATION_TIMESTAMP;
  return {
    schemaVersion: SCHEDULE_BLOCK_SCHEMA_VERSION,
    id: block.id,
    userId: typeof block.userId === "string" ? block.userId : undefined,
    taskId: block.taskId,
    sessionId: typeof block.sessionId === "string" ? block.sessionId : undefined,
    title: block.title,
    date: block.date,
    startTime: block.startTime!,
    endTime: block.endTime!,
    durationMinutes: duration,
    source: block.source,
    status: block.status as ScheduleBlockStatus,
    isLocked: block.isLocked === true || block.source === "manual",
    schedulingRunId: typeof block.schedulingRunId === "string" ? block.schedulingRunId : undefined,
    createdAt,
    updatedAt: typeof block.updatedAt === "string" ? block.updatedAt : createdAt,
  };
}

export function migrateScheduleBlocks(value: unknown): ScheduleBlock[] {
  if (!Array.isArray(value)) throw new Error("Schedule blocks must be an array.");
  return value.map(migrateScheduleBlock);
}

export function mergeScheduleBlockCopies(current: ScheduleBlock[], incoming: ScheduleBlock[]): ScheduleBlock[] {
  const merged = new Map(current.map((block) => [block.id, block]));
  for (const block of incoming) {
    const existing = merged.get(block.id);
    if (!existing || block.updatedAt > existing.updatedAt) merged.set(block.id, block);
  }
  return Array.from(merged.values());
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function dateRange(start: string, end: string): string[] {
  if (!parseLocalDate(start) || !parseLocalDate(end) || end < start) return [];
  const dates: string[] = [];
  for (let date = start; date <= end; date = addLocalDays(date, 1)) dates.push(date);
  return dates;
}

function compareWork(a: WorkItem, b: WorkItem, today: string): number {
  const aOverdue = Boolean(a.task.dueDate && a.task.dueDate < today);
  const bOverdue = Boolean(b.task.dueDate && b.task.dueDate < today);
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
  const due = (a.task.dueDate ?? "9999-12-31").localeCompare(b.task.dueDate ?? "9999-12-31");
  if (due) return due;
  const priority = PRIORITY[a.task.priority] - PRIORITY[b.task.priority];
  if (priority) return priority;
  const aStarted = (a.task.actualMinutes ?? 0) > 0 || a.task.status === "in-progress";
  const bStarted = (b.task.actualMinutes ?? 0) > 0 || b.task.status === "in-progress";
  if (aStarted !== bStarted) return aStarted ? -1 : 1;
  if (a.task.id === b.task.id && a.session && b.session && a.session.order !== b.session.order) return a.session.order - b.session.order;
  if (a.minutes !== b.minutes) return a.minutes - b.minutes;
  const created = a.task.createdAt.localeCompare(b.task.createdAt);
  return created || a.key.localeCompare(b.key);
}

function eligibleWork(tasks: TaskRecord[], sessions: TaskSession[], blocks: ScheduleBlock[], options: SchedulingOptions): { work: WorkItem[]; warnings: string[] } {
  const selected = new Set(options.selectedTaskIds);
  const warnings: string[] = [];
  const work: WorkItem[] = [];
  for (const task of tasks.filter((item) => selected.has(item.id))) {
    if (task.status === "completed" || task.status === "archived") continue;
    if (!task.dueDate && !options.includeUndated) continue;
    if (task.dueDate && task.dueDate < options.today && !options.includeOverdue) continue;
    const linked = sessions.filter((session) => session.parentTaskId === task.id && session.status !== "completed" && session.status !== "archived").sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    if (linked.length) {
      for (const session of linked) {
        const covered = blocks.filter((block) => block.sessionId === session.id && ACTIVE.has(block.status)).reduce((sum, block) => sum + block.durationMinutes, 0);
        const remaining = Math.max(session.estimatedMinutes - covered, 0);
        if (remaining) work.push({ key: session.id, task, session, minutes: remaining, splittable: false });
      }
      continue;
    }
    if (!task.estimatedMinutes) {
      warnings.push(`${task.title}: Add an estimate before scheduling this task.`);
      continue;
    }
    if (task.isSplittable && !options.allowDirectSplittable) {
      warnings.push(`${task.title}: Create work sessions or allow direct scheduling.`);
      continue;
    }
    const covered = blocks.filter((block) => block.taskId === task.id && !block.sessionId && ACTIVE.has(block.status)).reduce((sum, block) => sum + block.durationMinutes, 0);
    const remaining = Math.max(task.estimatedMinutes - (task.actualMinutes ?? 0) - covered, 0);
    if (remaining) work.push({ key: task.id, task, minutes: remaining, splittable: task.isSplittable });
  }
  return { work: work.sort((a, b) => compareWork(a, b, options.today)), warnings };
}

function subtractSchedule(intervals: Interval[], occupied: Interval[]): Interval[] {
  let result = intervals;
  for (const block of occupied.sort((a, b) => a.start - b.start)) {
    result = result.flatMap((slot) => block.end <= slot.start || block.start >= slot.end ? [slot] : [
      ...(block.start > slot.start ? [{ start: slot.start, end: block.start }] : []),
      ...(block.end < slot.end ? [{ start: block.end, end: slot.end }] : []),
    ]);
  }
  return result;
}

function reasonFor(item: WorkItem, hadAvailability: boolean, dailyCapHit: boolean): string {
  if (!hadAvailability) return "No available time was found before the deadline.";
  if (dailyCapHit) return "Your daily planning limit prevented additional work.";
  if (!item.splittable) return `This ${item.minutes}-minute session needs one continuous available block.`;
  return `${item.minutes} minutes remain unscheduled before the deadline.`;
}

export function scheduleWork(
  tasks: TaskRecord[],
  sessions: TaskSession[],
  availability: AvailabilityBlock[],
  overrides: AvailabilityOverride[],
  existingBlocks: ScheduleBlock[],
  options: SchedulingOptions,
): SchedulingResult {
  const replaceBlockIds = existingBlocks.filter((block) => block.source === "automatic" && !block.isLocked && (
    (options.replaceUnlockedProposed && block.status === "proposed")
    || (options.replaceUnlockedAutomatic && (block.status === "proposed" || (block.status === "confirmed" && block.date >= options.today)))
  )).map((block) => block.id);
  const replaced = new Set(replaceBlockIds);
  const preserved = existingBlocks.filter((block) => !replaced.has(block.id));
  const eligible = eligibleWork(tasks, sessions, preserved, options);
  const proposedBlocks: ScheduleBlock[] = [];
  const unscheduledWork: UnscheduledWork[] = [];
  const perDayTotals: Record<string, number> = {};
  const perTaskTotals: SchedulingResult["perTaskTotals"] = {};
  const dates = dateRange(options.startDate < options.today ? options.today : options.startDate, options.endDate)
    .filter((date) => options.includeWeekends || ![0, 6].includes(dayOfWeekForLocalDate(date)));
  for (const block of preserved.filter((item) => ACTIVE.has(item.status))) perDayTotals[block.date] = (perDayTotals[block.date] ?? 0) + block.durationMinutes;

  const blockedEarlierSession = new Set<string>();
  for (const item of eligible.work) {
    const taskId = item.task.id;
    if (!options.allowFlexibleSessionOrder && item.session && blockedEarlierSession.has(taskId)) {
      unscheduledWork.push({ taskId, sessionId: item.session.id, title: item.session.title, remainingMinutes: item.minutes, reason: "An earlier work session could not be scheduled." });
      continue;
    }
    let remaining = item.minutes;
    let hadAvailability = false;
    let dailyCapHit = false;
    const itemDates = dates.filter((date) => (!item.task.dueDate || options.allowLateScheduling || date <= item.task.dueDate));
    for (const date of itemDates) {
      if (!remaining) break;
      if (!options.allowSameTaskPerDay && proposedBlocks.some((block) => block.taskId === taskId && block.date === date)) continue;
      const capRemaining = Math.max(options.dailyCapMinutes - (perDayTotals[date] ?? 0), 0);
      if (!capRemaining) { dailyCapHit = true; continue; }
      const existingForDate = [...preserved, ...proposedBlocks].filter((block) => block.date === date && ACTIVE.has(block.status));
      const occupied = existingForDate.map((block) => ({
        start: Math.max(0, timeToMinutes(block.startTime) - (block.status === "proposed" && block.schedulingRunId === options.runId ? options.minimumBreakMinutes : 0)),
        end: Math.min(1440, timeToMinutes(block.endTime) + (block.status === "proposed" && block.schedulingRunId === options.runId ? options.minimumBreakMinutes : 0)),
      }));
      let slots = subtractSchedule(availableIntervalsForDate(availability, overrides, date), occupied);
      if (date === options.today && options.currentTime) slots = slots.map((slot) => ({ ...slot, start: Math.max(slot.start, timeToMinutes(options.currentTime!)) })).filter((slot) => slot.end > slot.start);
      hadAvailability ||= slots.length > 0;
      for (const slot of slots) {
        if (!remaining || (!options.allowSameTaskPerDay && proposedBlocks.some((block) => block.taskId === taskId && block.date === date))) break;
        const capacity = Math.min(slot.end - slot.start, Math.max(options.dailyCapMinutes - (perDayTotals[date] ?? 0), 0));
        const duration = item.splittable ? Math.min(remaining, capacity, item.task.maximumSessionMinutes ?? remaining) : remaining;
        if (item.splittable && duration < (item.task.minimumSessionMinutes ?? 1)) continue;
        if (duration <= 0 || (!item.splittable && duration > capacity)) continue;
        const start = slot.start;
        const end = start + duration;
        const id = `schedule-${stableHash(`${options.runId}|${item.key}|${date}|${start}|${duration}`)}`;
        proposedBlocks.push(migrateScheduleBlock({
          id, taskId, sessionId: item.session?.id, title: item.session?.title ?? item.task.title,
          date, startTime: minutesToTime(start), endTime: minutesToTime(end), durationMinutes: duration,
          source: "automatic", status: "proposed", isLocked: false, schedulingRunId: options.runId,
          createdAt: options.now, updatedAt: options.now,
        }));
        remaining -= duration;
        perDayTotals[date] = (perDayTotals[date] ?? 0) + duration;
        if (!item.splittable) break;
      }
    }
    const scheduled = item.minutes - remaining;
    const totals = perTaskTotals[taskId] ?? { scheduledMinutes: 0, unscheduledMinutes: 0 };
    totals.scheduledMinutes += scheduled;
    totals.unscheduledMinutes += remaining;
    perTaskTotals[taskId] = totals;
    if (remaining) {
      unscheduledWork.push({ taskId, sessionId: item.session?.id, title: item.session?.title ?? item.task.title, remainingMinutes: remaining, reason: reasonFor({ ...item, minutes: remaining }, hadAvailability, dailyCapHit) });
      if (item.session && !options.allowFlexibleSessionOrder) blockedEarlierSession.add(taskId);
    }
  }
  if (!dates.length || !availability.some((block) => block.type === "available")) eligible.warnings.push("No available time is configured in the selected range.");
  return { proposedBlocks, unscheduledWork, warnings: Array.from(new Set(eligible.warnings)), perDayTotals, perTaskTotals, replaceBlockIds };
}

export function confirmSchedulePreview(existing: ScheduleBlock[], preview: ScheduleBlock[], selectedIds: string[], replaceBlockIds: string[], now = new Date().toISOString()): ScheduleBlock[] {
  const selected = new Set(selectedIds);
  const replacements = new Set(replaceBlockIds);
  const kept = existing.filter((block) => !replacements.has(block.id));
  const confirmed = preview.filter((block) => selected.has(block.id)).map((block) => migrateScheduleBlock({ ...block, status: "confirmed", updatedAt: now }));
  return mergeScheduleBlockCopies(kept, confirmed);
}

export function validateScheduleMovement(
  block: ScheduleBlock,
  availability: AvailabilityBlock[],
  overrides: AvailabilityOverride[],
  existing: ScheduleBlock[],
  range: Pick<SchedulingOptions, "startDate" | "endDate" | "dailyCapMinutes" | "allowLateScheduling">,
  dueDate?: string,
): string[] {
  const errors: string[] = [];
  if (block.date < range.startDate || block.date > range.endDate) errors.push("Choose a date inside the planning range.");
  if (dueDate && !range.allowLateScheduling && block.date > dueDate) errors.push("This time is after the task deadline.");
  const start = timeToMinutes(block.startTime);
  const end = timeToMinutes(block.endTime);
  if (!availableIntervalsForDate(availability, overrides, block.date).some((slot) => start >= slot.start && end <= slot.end)) errors.push("Choose a time inside explicit available time and outside commitments.");
  if (existing.some((item) => item.id !== block.id && item.date === block.date && ACTIVE.has(item.status) && start < timeToMinutes(item.endTime) && timeToMinutes(item.startTime) < end)) errors.push("This time overlaps scheduled work.");
  const dayTotal = existing.filter((item) => item.id !== block.id && item.date === block.date && ACTIVE.has(item.status)).reduce((sum, item) => sum + item.durationMinutes, 0);
  if (dayTotal + block.durationMinutes > range.dailyCapMinutes) errors.push("This move exceeds the daily planning limit.");
  return errors;
}

export interface SchedulingConflict { blockId: string; taskId: string; date: string; reason: string }
export function detectScheduleConflicts(blocks: ScheduleBlock[], tasks: TaskRecord[], availability: AvailabilityBlock[], overrides: AvailabilityOverride[], dailyCapMinutes = Number.POSITIVE_INFINITY): SchedulingConflict[] {
  const conflicts: SchedulingConflict[] = [];
  for (const block of blocks.filter((item) => item.status === "confirmed")) {
    const start = timeToMinutes(block.startTime);
    const end = timeToMinutes(block.endTime);
    if (!availableIntervalsForDate(availability, overrides, block.date).some((slot) => start >= slot.start && end <= slot.end)) conflicts.push({ blockId: block.id, taskId: block.taskId, date: block.date, reason: "Availability or a commitment now overlaps this work." });
    const task = tasks.find((item) => item.id === block.taskId);
    if (task?.dueDate && block.date > task.dueDate) conflicts.push({ blockId: block.id, taskId: block.taskId, date: block.date, reason: "The task deadline is now earlier than this work block." });
  }
  for (const date of new Set(blocks.filter((item) => item.status === "confirmed").map((item) => item.date))) {
    const daily = blocks.filter((item) => item.status === "confirmed" && item.date === date);
    for (const block of daily) {
      if (daily.some((other) => other.id !== block.id && timeToMinutes(block.startTime) < timeToMinutes(other.endTime) && timeToMinutes(other.startTime) < timeToMinutes(block.endTime))) {
        conflicts.push({ blockId: block.id, taskId: block.taskId, date, reason: "This work block overlaps another confirmed block." });
      }
    }
    if (daily.reduce((sum, item) => sum + item.durationMinutes, 0) > dailyCapMinutes) daily.forEach((block) => conflicts.push({ blockId: block.id, taskId: block.taskId, date, reason: "The daily planning limit is now lower than planned work." }));
  }
  return conflicts.filter((conflict, index) => conflicts.findIndex((item) => item.blockId === conflict.blockId && item.reason === conflict.reason) === index);
}

export function updateScheduleBlock(block: ScheduleBlock, changes: Partial<Omit<ScheduleBlock, "id" | "taskId" | "sessionId" | "createdAt">>, now = new Date().toISOString()): ScheduleBlock {
  return migrateScheduleBlock({ ...block, ...changes, id: block.id, taskId: block.taskId, sessionId: block.sessionId, createdAt: block.createdAt, updatedAt: now });
}

export function schedulingState(task: TaskRecord, sessions: TaskSession[], blocks: ScheduleBlock[], hasConflict = false): "Not ready" | "Ready to schedule" | "Partially scheduled" | "Fully scheduled" | "Scheduling conflict" | "Past deadline" | "Completed" {
  if (task.status === "completed") return "Completed";
  if (hasConflict) return "Scheduling conflict";
  if (!task.estimatedMinutes || (task.isSplittable && !sessions.length)) return "Not ready";
  const remaining = sessions.length
    ? sessions.filter((session) => session.status !== "completed" && session.status !== "archived").reduce((sum, session) => sum + session.estimatedMinutes, 0)
    : Math.max(task.estimatedMinutes - (task.actualMinutes ?? 0), 0);
  const scheduled = blocks.filter((block) => block.taskId === task.id && ACTIVE.has(block.status)).reduce((sum, block) => sum + block.durationMinutes, 0);
  if (task.dueDate && task.dueDate < new Date().toLocaleDateString("en-CA")) return "Past deadline";
  if (!scheduled) return "Ready to schedule";
  return scheduled >= remaining ? "Fully scheduled" : "Partially scheduled";
}

export function cleanupBlocksForTaskDeletion(blocks: ScheduleBlock[], taskId: string): ScheduleBlock[] {
  return blocks.filter((block) => block.taskId !== taskId);
}

export function cleanupBlocksForSessionDeletion(blocks: ScheduleBlock[], sessionId: string, now = new Date().toISOString()): ScheduleBlock[] {
  return blocks.map((block) => block.sessionId === sessionId && ACTIVE.has(block.status)
    ? updateScheduleBlock(block, { status: "cancelled" }, now)
    : block);
}
