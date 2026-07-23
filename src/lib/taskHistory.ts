export type TaskStatus = "backlog" | "planned" | "in-progress" | "completed" | "archived";

export interface TaskRecord {
  id: string;
  title: string;
  date: string;
  time: string;
  endTime?: string;
  durationMins?: number;
  status: TaskStatus;
  priority: "high" | "medium" | "low";
  category: string;
  description?: string;
  note?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  statusBeforeArchive?: Exclude<TaskStatus, "archived">;
}

type LegacyTaskStatus = TaskStatus | "todo" | "inProgress";
type LegacyTask = Omit<Partial<TaskRecord>, "id" | "status"> & {
  id?: string | number;
  status?: LegacyTaskStatus;
  [key: string]: unknown;
};

const VALID_STATUSES = new Set<TaskStatus>([
  "backlog",
  "planned",
  "in-progress",
  "completed",
  "archived",
]);

function migrateStatus(status: LegacyTaskStatus | undefined): TaskStatus {
  if (status === "todo") return "planned";
  if (status === "inProgress") return "in-progress";
  if (status && VALID_STATUSES.has(status as TaskStatus)) return status as TaskStatus;
  return "backlog";
}

function requireTaskShape(task: LegacyTask): void {
  if (
    (typeof task.id !== "number" && typeof task.id !== "string") ||
    typeof task.title !== "string" ||
    typeof task.date !== "string" ||
    typeof task.time !== "string" ||
    typeof task.priority !== "string" ||
    typeof task.category !== "string"
  ) {
    throw new Error("Cannot migrate an invalid task record");
  }
}

export function migrateTask(task: LegacyTask, now = new Date().toISOString()): TaskRecord {
  requireTaskShape(task);
  const status = migrateStatus(task.status);

  return {
    ...task,
    id: stableTaskId(task.id as string | number),
    title: task.title as string,
    date: task.date as string,
    time: task.time as string,
    priority: task.priority as TaskRecord["priority"],
    category: task.category as string,
    status,
    createdAt: typeof task.createdAt === "string" ? task.createdAt : now,
    updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : now,
    completedAt:
      typeof task.completedAt === "string"
        ? task.completedAt
        : status === "completed"
          ? now
          : null,
    archivedAt:
      typeof task.archivedAt === "string"
        ? task.archivedAt
        : status === "archived"
          ? now
          : null,
  } as TaskRecord;
}

export function stableTaskId(id: string | number): string {
  return typeof id === "number" ? `legacy-${id}` : id;
}

export function migrateTasks(value: unknown, now = new Date().toISOString()): TaskRecord[] {
  if (!Array.isArray(value)) throw new Error("Saved tasks must be an array");
  return value.map((task) => migrateTask(task as LegacyTask, now));
}

type NewTask = Omit<TaskRecord, "id" | "createdAt" | "updatedAt" | "completedAt" | "archivedAt"> & {
  id?: string;
};

export function createTask(task: NewTask, now = new Date().toISOString()): TaskRecord {
  return {
    ...task,
    id: task.id ?? crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    completedAt: task.status === "completed" ? now : null,
    archivedAt: task.status === "archived" ? now : null,
  };
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
  return { ...task, [key]: value, updatedAt: now };
}

export function permanentlyDeleteTask(tasks: TaskRecord[], id: string): TaskRecord[] {
  return tasks.filter((task) => task.id !== id);
}
