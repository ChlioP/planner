import type { TaskRecord, TaskStatus } from "./taskHistory";

export const TASK_SESSION_SCHEMA_VERSION = 1 as const;
export const STABLE_SESSION_MIGRATION_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export interface TaskSession {
  schemaVersion: typeof TASK_SESSION_SCHEMA_VERSION;
  id: string;
  userId?: string;
  parentTaskId: string;
  title: string;
  description?: string;
  estimatedMinutes: number;
  actualMinutes?: number;
  status: TaskStatus;
  statusBeforeArchive?: Exclude<TaskStatus, "archived">;
  order: number;
  scheduledDate?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  isGenerated: boolean;
  isLocked?: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  archivedAt?: string;
}

export interface SplitInput {
  remainingTaskMinutes: number;
  preferredSessionMinutes: number;
  minimumSessionMinutes: number;
  maximumSessionMinutes: number;
  numberOfSessions?: number;
  existingCompletedSessionMinutes?: number;
}

export interface SplitResult {
  durations: number[];
  totalProposedMinutes: number;
  remainder: number;
  warnings: string[];
}

export interface SessionTotals {
  assignedMinutes: number;
  completedMinutes: number;
  unassignedMinutes: number;
  incompleteMinutes: number;
  sessionActualMinutes: number;
  activeSessionCount: number;
  completedSessionCount: number;
  progressPercent: number;
  allActiveSessionsComplete: boolean;
}

export interface SessionDraft {
  title: string;
  estimatedMinutes: number;
}

const STATUSES = new Set<TaskStatus>(["backlog", "planned", "in-progress", "completed", "archived"]);

export function splitTaskEffort(input: SplitInput): SplitResult {
  const values = [input.remainingTaskMinutes, input.preferredSessionMinutes, input.minimumSessionMinutes, input.maximumSessionMinutes];
  if (values.some((value) => !Number.isInteger(value) || value <= 0)) throw new Error("Split values must be positive whole minutes.");
  if (input.maximumSessionMinutes < input.minimumSessionMinutes) throw new Error("Maximum session time must be at least the minimum.");
  if (input.numberOfSessions !== undefined && (!Number.isInteger(input.numberOfSessions) || input.numberOfSessions <= 0)) throw new Error("Number of sessions must be a positive whole number.");
  const completed = Math.max(0, input.existingCompletedSessionMinutes ?? 0);
  const total = Math.max(input.remainingTaskMinutes - completed, 0);
  if (total === 0) return { durations: [], totalProposedMinutes: 0, remainder: 0, warnings: ["No remaining effort is available to split."] };
  const warnings: string[] = [];
  if (total < input.minimumSessionMinutes) {
    warnings.push("Remaining effort is shorter than the minimum session, so one shorter session is proposed.");
    return { durations: [total], totalProposedMinutes: total, remainder: 0, warnings };
  }
  const minimumCount = Math.ceil(total / input.maximumSessionMinutes);
  const maximumCount = Math.floor(total / input.minimumSessionMinutes);
  let count = input.numberOfSessions ?? Math.max(1, Math.round(total / input.preferredSessionMinutes));
  if (count < minimumCount) { warnings.push(`At least ${minimumCount} sessions are needed to respect the maximum.`); count = minimumCount; }
  if (count > maximumCount) { warnings.push(`At most ${maximumCount} sessions fit without going below the minimum.`); count = maximumCount; }
  const base = Math.floor(total / count);
  const extra = total % count;
  const durations = Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
  return { durations, totalProposedMinutes: durations.reduce((sum, value) => sum + value, 0), remainder: 0, warnings };
}

export function migrateTaskSession(value: unknown): TaskSession {
  if (!value || typeof value !== "object") throw new Error("Task session must be an object.");
  const session = value as Partial<TaskSession>;
  if (typeof session.id !== "string" || !session.id || typeof session.parentTaskId !== "string" || !session.parentTaskId) throw new Error("Task session requires stable session and parent IDs.");
  if (session.id === session.parentTaskId) throw new Error("A work session cannot be its own parent.");
  if (typeof session.title !== "string" || !session.title.trim()) throw new Error(`Task session ${session.id} requires a title.`);
  if (!Number.isInteger(session.estimatedMinutes) || session.estimatedMinutes! <= 0) throw new Error(`Task session ${session.id} requires a positive duration.`);
  if (session.actualMinutes !== undefined && (!Number.isInteger(session.actualMinutes) || session.actualMinutes < 0)) throw new Error(`Task session ${session.id} has invalid actual time.`);
  if (!STATUSES.has(session.status as TaskStatus)) throw new Error(`Task session ${session.id} has an invalid status.`);
  if (!Number.isInteger(session.order) || session.order! < 0) throw new Error(`Task session ${session.id} requires a valid order.`);
  const createdAt = typeof session.createdAt === "string" ? session.createdAt : STABLE_SESSION_MIGRATION_TIMESTAMP;
  return {
    schemaVersion: TASK_SESSION_SCHEMA_VERSION,
    id: session.id,
    userId: typeof session.userId === "string" ? session.userId : undefined,
    parentTaskId: session.parentTaskId,
    title: session.title,
    description: typeof session.description === "string" ? session.description : undefined,
    estimatedMinutes: session.estimatedMinutes!,
    actualMinutes: session.actualMinutes,
    status: session.status as TaskStatus,
    statusBeforeArchive: session.statusBeforeArchive,
    order: session.order!,
    scheduledDate: typeof session.scheduledDate === "string" ? session.scheduledDate : undefined,
    scheduledStartTime: typeof session.scheduledStartTime === "string" ? session.scheduledStartTime : undefined,
    scheduledEndTime: typeof session.scheduledEndTime === "string" ? session.scheduledEndTime : undefined,
    isGenerated: session.isGenerated === true,
    isLocked: session.isLocked === true ? true : undefined,
    createdAt,
    updatedAt: typeof session.updatedAt === "string" ? session.updatedAt : createdAt,
    completedAt: typeof session.completedAt === "string" ? session.completedAt : undefined,
    archivedAt: typeof session.archivedAt === "string" ? session.archivedAt : undefined,
  };
}

export function migrateTaskSessions(value: unknown): TaskSession[] {
  if (!Array.isArray(value)) throw new Error("Task sessions must be an array.");
  return value.map(migrateTaskSession);
}

type SessionInput = Omit<TaskSession, "schemaVersion" | "id" | "createdAt" | "updatedAt" | "completedAt" | "archivedAt"> & { id?: string };

export function createTaskSession(input: SessionInput, now = new Date().toISOString()): TaskSession {
  return migrateTaskSession({ ...input, id: input.id ?? crypto.randomUUID(), createdAt: now, updatedAt: now, completedAt: input.status === "completed" ? now : undefined, archivedAt: input.status === "archived" ? now : undefined });
}

export function createGeneratedSessions(parent: Pick<TaskRecord, "id" | "title">, durations: number[], names?: string[], now = new Date().toISOString()): TaskSession[] {
  return durations.map((estimatedMinutes, order) => createTaskSession({
    parentTaskId: parent.id,
    title: names?.[order]?.trim() || `${parent.title} Session ${order + 1}`,
    estimatedMinutes,
    status: "backlog",
    order,
    isGenerated: true,
  }, now));
}

export function confirmGeneratedSessionPreview(current: TaskSession[], parent: Pick<TaskRecord, "id" | "title">, drafts: SessionDraft[], now = new Date().toISOString()): { sessions: TaskSession[]; created: TaskSession[]; skippedDuplicates: number } {
  const linked = sessionsForParent(current, parent.id);
  const uniqueDrafts = drafts.filter((draft, index) => drafts.findIndex((item) => item.title === draft.title && item.estimatedMinutes === draft.estimatedMinutes) === index);
  const created: TaskSession[] = [];
  let skippedDuplicates = drafts.length - uniqueDrafts.length;
  for (const draft of uniqueDrafts) {
    if (linked.some((session) => session.isGenerated && session.title === draft.title && session.estimatedMinutes === draft.estimatedMinutes)) {
      skippedDuplicates += 1;
      continue;
    }
    created.push(createTaskSession({ parentTaskId: parent.id, title: draft.title, estimatedMinutes: draft.estimatedMinutes, status: "backlog", order: linked.length + created.length, isGenerated: true }, now));
  }
  return { sessions: [...current, ...created], created, skippedDuplicates };
}

export function automaticBreakdownEligibility(parent: Pick<TaskRecord, "estimatedMinutes" | "isSplittable" | "status">): { eligible: boolean; message?: string } {
  if (parent.estimatedMinutes === undefined || parent.estimatedMinutes <= 0) return { eligible: false, message: "Add an estimate before creating work sessions." };
  if (parent.status === "archived" || parent.status === "completed") return { eligible: false, message: "Reopen this task before generating new sessions." };
  if (!parent.isSplittable) return { eligible: false, message: "Mark this task as splittable before automatic generation." };
  return { eligible: true };
}

export function editTaskSession(session: TaskSession, changes: Partial<Omit<TaskSession, "id" | "parentTaskId" | "createdAt">>, now = new Date().toISOString()): TaskSession {
  return migrateTaskSession({ ...session, ...changes, id: session.id, parentTaskId: session.parentTaskId, createdAt: session.createdAt, updatedAt: now });
}

export function reorderTaskSessions(sessions: TaskSession[], parentTaskId: string, orderedIds: string[], now = new Date().toISOString()): TaskSession[] {
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  return sessions.map((session) => session.parentTaskId === parentTaskId && order.has(session.id)
    ? editTaskSession(session, { order: order.get(session.id)! }, now)
    : session);
}

export function completeTaskSession(session: TaskSession, now = new Date().toISOString()): TaskSession {
  if (session.status === "completed") return editTaskSession(session, { status: "planned", completedAt: undefined }, now);
  return editTaskSession(session, { status: "completed", completedAt: now }, now);
}

export function archiveTaskSession(session: TaskSession, now = new Date().toISOString()): TaskSession {
  if (session.status === "archived") return session;
  return editTaskSession(session, { status: "archived", statusBeforeArchive: session.status, archivedAt: now }, now);
}

export function restoreTaskSession(session: TaskSession, now = new Date().toISOString()): TaskSession {
  return editTaskSession(session, { status: session.statusBeforeArchive ?? "planned", statusBeforeArchive: undefined, archivedAt: undefined }, now);
}

export function sessionsForParent(sessions: TaskSession[], parentTaskId: string): TaskSession[] {
  return sessions.filter((session) => session.parentTaskId === parentTaskId).slice().sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export function sessionTotals(parent: Pick<TaskRecord, "estimatedMinutes">, sessions: TaskSession[]): SessionTotals {
  const structurallyActive = sessions.filter((session) => session.status !== "archived" || session.statusBeforeArchive === "completed");
  const active = sessions.filter((session) => session.status !== "archived");
  const completed = structurallyActive.filter((session) => session.status === "completed" || (session.status === "archived" && session.statusBeforeArchive === "completed"));
  const assignedMinutes = structurallyActive.reduce((sum, session) => sum + session.estimatedMinutes, 0);
  const completedMinutes = completed.reduce((sum, session) => sum + session.estimatedMinutes, 0);
  const estimate = parent.estimatedMinutes ?? 0;
  return {
    assignedMinutes,
    completedMinutes,
    unassignedMinutes: Math.max(estimate - assignedMinutes, 0),
    incompleteMinutes: Math.max(assignedMinutes - completedMinutes, 0),
    sessionActualMinutes: sessions.reduce((sum, session) => sum + (session.actualMinutes ?? 0), 0),
    activeSessionCount: active.length,
    completedSessionCount: completed.length,
    progressPercent: estimate > 0 ? Math.min(100, Math.round((completedMinutes / estimate) * 100)) : 0,
    allActiveSessionsComplete: active.length > 0 && active.every((session) => session.status === "completed"),
  };
}

export function manualBreakdownWarnings(parentEstimate: number, existingAssigned: number, proposed: Array<Pick<TaskSession, "estimatedMinutes">>): string[] {
  const total = existingAssigned + proposed.reduce((sum, session) => sum + session.estimatedMinutes, 0);
  if (total < parentEstimate) return [`${parentEstimate - total} minutes will remain unassigned.`];
  if (total > parentEstimate) return [`Session time exceeds the parent estimate by ${total - parentEstimate} minutes.`];
  return [];
}

export function parentEstimateWarnings(nextEstimate: number | undefined, sessions: TaskSession[]): string[] {
  if (nextEstimate === undefined) return sessions.length ? ["Removing the estimate leaves existing work sessions without a parent total. Sessions will be preserved."] : [];
  const assigned = sessionTotals({ estimatedMinutes: nextEstimate }, sessions).assignedMinutes;
  return assigned > nextEstimate ? [`Existing session time exceeds the new estimate by ${assigned - nextEstimate} minutes. Sessions will not be changed.`] : [];
}

export function breakdownState(parent: Pick<TaskRecord, "estimatedMinutes" | "isSplittable">, sessions: TaskSession[]): "Needs breakdown" | "Partially broken down" | "Sessions ready" | "All sessions complete" | "No breakdown" {
  if (!sessions.length) return parent.isSplittable && parent.estimatedMinutes ? "Needs breakdown" : "No breakdown";
  const totals = sessionTotals(parent, sessions);
  if (totals.allActiveSessionsComplete) return "All sessions complete";
  if (totals.unassignedMinutes > 0) return "Partially broken down";
  return "Sessions ready";
}

export function validateSessionParent(session: Pick<TaskSession, "id" | "parentTaskId">, tasks: TaskRecord[]): void {
  if (session.id === session.parentTaskId) throw new Error("A work session cannot be its own parent.");
  const parent = tasks.find((task) => task.id === session.parentTaskId);
  if (!parent || parent.isGeneratedSession || parent.parentTaskId) throw new Error("Work sessions must link directly to a valid parent task.");
}

export function mergeSessionCopies(current: TaskSession[], incoming: TaskSession[]): TaskSession[] {
  const merged = new Map(current.map((session) => [session.id, session]));
  for (const session of incoming) {
    const existing = merged.get(session.id);
    if (!existing || session.updatedAt > existing.updatedAt) merged.set(session.id, session);
  }
  return Array.from(merged.values());
}
