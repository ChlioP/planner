export const TASK_SCHEMA_VERSION = 5 as const;
export const STABLE_LEGACY_MIGRATION_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export type TaskStatus = "backlog" | "planned" | "in-progress" | "completed" | "archived";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskCategory = "work" | "school" | "career" | "portfolio" | "health" | "personal" | "other";

/**
 * TaskRecord keeps the original schedule fields and free-form category values because the
 * existing planner UI and saved records use them. Standard TaskCategory values are used for
 * newly categorized planning data, while legacy strings remain valid and are never rewritten.
 */
export interface TaskRecord {
  schemaVersion: typeof TASK_SCHEMA_VERSION;
  id: string;
  title: string;
  description?: string;
  note?: string;
  notes?: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory | (string & {});
  tags: string[];
  dueDate?: string;
  dueTime?: string;
  scheduledDate?: string;
  estimatedMinutes?: number;
  actualMinutes?: number;
  isSplittable: boolean;
  minimumSessionMinutes?: number;
  maximumSessionMinutes?: number;
  parentTaskId?: string;
  isGeneratedSession: boolean;
  sessionOrder?: number;
  projectId?: string;
  milestoneId?: string;
  recurrenceDefinitionId?: string;
  recurrenceOccurrenceId?: string;
  recurrenceOccurrenceDate?: string;
  isRecurringOccurrence?: boolean;
  recurrence?: {
    seriesId: string;
    occurrenceKey: string;
    occurrenceDate: string;
    sequenceNumber?: number;
    status: "generated" | "modified" | "skipped" | "detached";
    originalDueDate: string;
    detachedAt?: string;
  };

  // Backward-compatible fields used by the current daily, weekly, and Google views.
  date: string;
  time: string;
  endTime?: string;
  durationMins?: number;

  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  statusBeforeArchive?: Exclude<TaskStatus, "archived">;
  originalData?: unknown;
}

type LegacyTaskStatus = TaskStatus | "todo" | "inProgress";
type LegacyTask = Partial<Omit<TaskRecord, "id" | "status" | "priority">> & {
  id?: string | number;
  status?: LegacyTaskStatus;
  priority?: string;
};

const VALID_STATUSES = new Set<TaskStatus>([
  "backlog",
  "planned",
  "in-progress",
  "completed",
  "archived",
]);
const VALID_PRIORITIES = new Set<TaskPriority>(["low", "medium", "high", "critical"]);

function migrateStatus(status: LegacyTaskStatus | undefined, hasSchedule: boolean): TaskStatus {
  if (status === "todo") return "planned";
  if (status === "inProgress") return "in-progress";
  if (status && VALID_STATUSES.has(status as TaskStatus)) return status as TaskStatus;
  return hasSchedule ? "planned" : "backlog";
}

function migratePriority(priority: string | undefined): TaskPriority {
  return priority && VALID_PRIORITIES.has(priority as TaskPriority)
    ? priority as TaskPriority
    : "medium";
}

function requireTaskShape(task: LegacyTask): void {
  if (
    (typeof task.id !== "number" && typeof task.id !== "string") ||
    typeof task.title !== "string"
  ) {
    throw new Error("Cannot migrate an invalid task record");
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function optionalPositiveMinutes(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function migrateTask(
  task: LegacyTask,
  migrationTimestamp = STABLE_LEGACY_MIGRATION_TIMESTAMP,
): TaskRecord {
  requireTaskShape(task);
  const date = typeof task.date === "string" ? task.date : "";
  const time = typeof task.time === "string" ? task.time : "";
  const status = migrateStatus(task.status, Boolean(date || time || task.scheduledDate));
  const createdAt = typeof task.createdAt === "string" ? task.createdAt : migrationTimestamp;
  const updatedAt = typeof task.updatedAt === "string" ? task.updatedAt : createdAt;
  const existingDuration = optionalNumber(task.durationMins);

  return {
    ...task,
    schemaVersion: TASK_SCHEMA_VERSION,
    id: stableTaskId(task.id as string | number),
    title: task.title as string,
    description: optionalString(task.description),
    note: optionalString(task.note),
    notes: optionalString(task.notes),
    status,
    priority: migratePriority(task.priority),
    category: typeof task.category === "string" ? task.category : "other",
    tags: Array.isArray(task.tags) ? task.tags.filter((tag): tag is string => typeof tag === "string") : [],
    dueDate: optionalString(task.dueDate),
    dueTime: optionalString(task.dueTime),
    scheduledDate: optionalString(task.scheduledDate) ?? (date || undefined),
    estimatedMinutes: optionalPositiveMinutes(task.estimatedMinutes) ?? optionalPositiveMinutes(existingDuration),
    actualMinutes: optionalNumber(task.actualMinutes),
    isSplittable: typeof task.isSplittable === "boolean" ? task.isSplittable : false,
    minimumSessionMinutes: optionalPositiveMinutes(task.minimumSessionMinutes),
    maximumSessionMinutes: optionalPositiveMinutes(task.maximumSessionMinutes),
    parentTaskId: optionalString(task.parentTaskId),
    isGeneratedSession: typeof task.isGeneratedSession === "boolean" ? task.isGeneratedSession : false,
    sessionOrder: optionalNumber(task.sessionOrder),
    projectId: optionalString(task.projectId),
    milestoneId: optionalString(task.milestoneId),
    recurrenceDefinitionId: optionalString(task.recurrenceDefinitionId),
    recurrenceOccurrenceId: optionalString(task.recurrenceOccurrenceId),
    recurrenceOccurrenceDate: optionalString(task.recurrenceOccurrenceDate),
    isRecurringOccurrence: task.isRecurringOccurrence === true,
    recurrence: task.recurrence && typeof task.recurrence === "object"
      && typeof task.recurrence.seriesId === "string"
      && typeof task.recurrence.occurrenceKey === "string"
      && typeof task.recurrence.occurrenceDate === "string"
      ? {
          seriesId: task.recurrence.seriesId,
          occurrenceKey: task.recurrence.occurrenceKey,
          occurrenceDate: task.recurrence.occurrenceDate,
          sequenceNumber: optionalNumber(task.recurrence.sequenceNumber),
          status: ["generated", "modified", "skipped", "detached"].includes(task.recurrence.status) ? task.recurrence.status : "generated",
          originalDueDate: optionalString(task.recurrence.originalDueDate) ?? task.recurrence.occurrenceDate,
          detachedAt: optionalString(task.recurrence.detachedAt),
        }
      : undefined,
    date,
    time,
    endTime: optionalString(task.endTime),
    durationMins: existingDuration,
    createdAt,
    updatedAt,
    completedAt:
      typeof task.completedAt === "string"
        ? task.completedAt
        : status === "completed"
          ? migrationTimestamp
          : null,
    archivedAt:
      typeof task.archivedAt === "string"
        ? task.archivedAt
        : status === "archived"
          ? migrationTimestamp
          : null,
  };
}

export function stableTaskId(id: string | number): string {
  return typeof id === "number" ? `legacy-${id}` : id;
}

export function migrateTasks(
  value: unknown,
  migrationTimestamp = STABLE_LEGACY_MIGRATION_TIMESTAMP,
): TaskRecord[] {
  if (!Array.isArray(value)) throw new Error("Saved tasks must be an array");
  return value.map((task) => migrateTask(task as LegacyTask, migrationTimestamp));
}

type NewTask = Pick<TaskRecord, "title"> &
  Partial<Omit<TaskRecord, "schemaVersion" | "id" | "title" | "createdAt" | "updatedAt" | "completedAt" | "archivedAt">> & {
    id?: string;
  };

export function createTask(task: NewTask, now = new Date().toISOString()): TaskRecord {
  const withIdentity = {
    ...task,
    id: task.id ?? crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    completedAt: task.status === "completed" ? now : null,
    archivedAt: task.status === "archived" ? now : null,
  };
  return migrateTask(withIdentity, now);
}

export function completeTask(task: TaskRecord, now = new Date().toISOString()): TaskRecord {
  if (task.status === "completed") {
    return { ...task, status: "planned", completedAt: null, updatedAt: now };
  }
  return { ...task, status: "completed", completedAt: now, updatedAt: now };
}

export function archiveTask(task: TaskRecord, now = new Date().toISOString()): TaskRecord {
  if (task.status === "archived") return task;
  return {
    ...task,
    status: "archived",
    statusBeforeArchive: task.status,
    archivedAt: now,
    updatedAt: now,
  };
}

export function restoreTask(task: TaskRecord, now = new Date().toISOString()): TaskRecord {
  const { statusBeforeArchive, ...rest } = task;
  return {
    ...rest,
    status: statusBeforeArchive ?? "planned",
    archivedAt: null,
    updatedAt: now,
  };
}

export function updateTask<K extends keyof TaskRecord>(
  task: TaskRecord,
  key: K,
  value: TaskRecord[K],
  now = new Date().toISOString(),
): TaskRecord {
  const updated = { ...task, [key]: value, updatedAt: now };
  if (key === "date") updated.scheduledDate = value as string || undefined;
  if (key === "durationMins" && updated.estimatedMinutes === undefined) {
    updated.estimatedMinutes = value as number | undefined;
  }
  return updated;
}

export function permanentlyDeleteTask(tasks: TaskRecord[], id: string): TaskRecord[] {
  return tasks.filter((task) => task.id !== id);
}
