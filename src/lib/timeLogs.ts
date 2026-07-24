import { isValidTime, parseLocalDate, timeToMinutes } from "./localDateTime";
import type { TaskRecord } from "./taskHistory";
import type { TaskSession } from "./taskSessions";

export const TIME_LOG_SCHEMA_VERSION = 1 as const;
export const STABLE_TIME_LOG_MIGRATION_TIMESTAMP = "1970-01-01T00:00:00.000Z";
export const LONG_TIMER_WARNING_SECONDS = 16 * 60 * 60;

export type TimeLogStatus = "running" | "paused" | "completed" | "discarded";
export type TimeLogSource = "timer" | "manual" | "schedule-completion";

export interface TimeLog {
  schemaVersion: typeof TIME_LOG_SCHEMA_VERSION;
  id: string;
  userId?: string;
  taskId: string;
  sessionId?: string;
  scheduleBlockId?: string;
  startedAt: string;
  endedAt?: string;
  accumulatedSeconds: number;
  lastResumedAt?: string;
  durationMinutes?: number;
  source: TimeLogSource;
  status: TimeLogStatus;
  note?: string;
  manuallyEdited?: boolean;
  createdAt: string;
  updatedAt: string;
}

const STATUSES = new Set<TimeLogStatus>(["running", "paused", "completed", "discarded"]);
const SOURCES = new Set<TimeLogSource>(["timer", "manual", "schedule-completion"]);

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function migrateTimeLog(value: unknown): TimeLog {
  if (!value || typeof value !== "object") throw new Error("Time log must be an object.");
  const log = value as Partial<TimeLog>;
  if (typeof log.id !== "string" || !log.id || typeof log.taskId !== "string" || !log.taskId) throw new Error("Time log requires stable log and task IDs.");
  if (!validTimestamp(log.startedAt)) throw new Error(`Time log ${log.id} requires a valid start timestamp.`);
  if (!STATUSES.has(log.status as TimeLogStatus) || !SOURCES.has(log.source as TimeLogSource)) throw new Error(`Time log ${log.id} has an invalid state.`);
  if (!Number.isInteger(log.accumulatedSeconds) || log.accumulatedSeconds! < 0) throw new Error(`Time log ${log.id} has invalid elapsed time.`);
  if (log.status === "running" && !validTimestamp(log.lastResumedAt)) throw new Error(`Running time log ${log.id} requires a resume timestamp.`);
  if (log.endedAt !== undefined && !validTimestamp(log.endedAt)) throw new Error(`Time log ${log.id} has an invalid end timestamp.`);
  const createdAt = validTimestamp(log.createdAt) ? log.createdAt : STABLE_TIME_LOG_MIGRATION_TIMESTAMP;
  return {
    schemaVersion: TIME_LOG_SCHEMA_VERSION,
    id: log.id,
    userId: typeof log.userId === "string" ? log.userId : undefined,
    taskId: log.taskId,
    sessionId: typeof log.sessionId === "string" ? log.sessionId : undefined,
    scheduleBlockId: typeof log.scheduleBlockId === "string" ? log.scheduleBlockId : undefined,
    startedAt: log.startedAt,
    endedAt: log.endedAt,
    accumulatedSeconds: log.accumulatedSeconds!,
    lastResumedAt: log.status === "running" ? log.lastResumedAt : undefined,
    durationMinutes: log.status === "completed" ? roundTrackedSecondsToMinutes(log.accumulatedSeconds!) : undefined,
    source: log.source as TimeLogSource,
    status: log.status as TimeLogStatus,
    note: typeof log.note === "string" ? log.note : undefined,
    manuallyEdited: log.manuallyEdited === true ? true : undefined,
    createdAt,
    updatedAt: validTimestamp(log.updatedAt) ? log.updatedAt : createdAt,
  };
}

export function migrateTimeLogs(value: unknown): TimeLog[] {
  if (!Array.isArray(value)) throw new Error("Time logs must be an array.");
  return value.map(migrateTimeLog);
}

export function elapsedSeconds(log: TimeLog, now: string): number {
  if (log.status !== "running" || !log.lastResumedAt) return log.accumulatedSeconds;
  const delta = Math.floor((Date.parse(now) - Date.parse(log.lastResumedAt)) / 1000);
  return log.accumulatedSeconds + Math.max(delta, 0);
}

export function timerWarnings(log: TimeLog, now: string): string[] {
  const warnings: string[] = [];
  if (log.lastResumedAt && Date.parse(log.lastResumedAt) > Date.parse(now)) warnings.push("The device clock appears to have moved backward. Review the duration before saving.");
  if (elapsedSeconds(log, now) >= LONG_TIMER_WARNING_SECONDS) warnings.push(`This timer has been running for ${Math.floor(elapsedSeconds(log, now) / 3600)} hours. Review the duration before saving.`);
  return warnings;
}

export function formatElapsedSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function roundTrackedSecondsToMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Tracked seconds must not be negative.");
  if (seconds === 0) return 0;
  return Math.max(1, Math.round(seconds / 60));
}

export interface TimerStartInput { id?: string; userId?: string; taskId: string; sessionId?: string; scheduleBlockId?: string; note?: string }
export function createTimerLog(input: TimerStartInput, now = new Date().toISOString()): TimeLog {
  return migrateTimeLog({
    id: input.id ?? crypto.randomUUID(), userId: input.userId, taskId: input.taskId,
    sessionId: input.sessionId, scheduleBlockId: input.scheduleBlockId, startedAt: now,
    accumulatedSeconds: 0, lastResumedAt: now, source: "timer", status: "running",
    note: input.note, createdAt: now, updatedAt: now,
  });
}

export function activeTimeLogs(logs: TimeLog[]): TimeLog[] {
  return logs.filter((log) => log.status === "running" || log.status === "paused").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export function runningTimeLogs(logs: TimeLog[]): TimeLog[] {
  return logs.filter((log) => log.status === "running").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export function startTimer(logs: TimeLog[], input: TimerStartInput, now = new Date().toISOString()): { logs: TimeLog[]; created?: TimeLog; conflict?: TimeLog[] } {
  const active = runningTimeLogs(logs);
  if (active.length) return { logs, conflict: active };
  const created = createTimerLog(input, now);
  return { logs: [...logs, created], created };
}

export function pauseTimer(log: TimeLog, now = new Date().toISOString()): TimeLog {
  if (log.status !== "running") return log;
  return migrateTimeLog({ ...log, status: "paused", accumulatedSeconds: elapsedSeconds(log, now), lastResumedAt: undefined, updatedAt: now });
}

export function resumeTimer(log: TimeLog, now = new Date().toISOString()): TimeLog {
  if (log.status !== "paused") return log;
  return migrateTimeLog({ ...log, status: "running", lastResumedAt: now, updatedAt: now });
}

export function completeTimer(log: TimeLog, now = new Date().toISOString(), editedSeconds?: number, note?: string): TimeLog {
  if (log.status === "completed") return log;
  const seconds = editedSeconds ?? elapsedSeconds(log, now);
  if (!Number.isInteger(seconds) || seconds <= 0) throw new Error("Saved time must be greater than zero.");
  return migrateTimeLog({ ...log, status: "completed", accumulatedSeconds: seconds, lastResumedAt: undefined, endedAt: now, note: note ?? log.note, manuallyEdited: editedSeconds !== undefined ? true : log.manuallyEdited, updatedAt: now });
}

export function discardTimer(log: TimeLog, now = new Date().toISOString()): TimeLog {
  if (log.status === "discarded") return log;
  return migrateTimeLog({ ...log, status: "discarded", accumulatedSeconds: elapsedSeconds(log, now), lastResumedAt: undefined, endedAt: now, updatedAt: now });
}

export interface ManualLogInput {
  id?: string; userId?: string; taskId: string; sessionId?: string; scheduleBlockId?: string;
  date: string; durationMinutes?: number; startTime?: string; endTime?: string; note?: string;
}
export interface ManualLogResult { log: TimeLog; warnings: string[] }

export function createManualTimeLog(input: ManualLogInput, existing: TimeLog[], now = new Date().toISOString()): ManualLogResult {
  if (!parseLocalDate(input.date)) throw new Error("Date must use YYYY-MM-DD.");
  let seconds: number;
  let startedAt: string;
  let endedAt: string;
  if (input.startTime || input.endTime) {
    if (!isValidTime(input.startTime ?? "") || !isValidTime(input.endTime ?? "")) throw new Error("Start and end time must use HH:mm.");
    const duration = timeToMinutes(input.endTime!) - timeToMinutes(input.startTime!);
    if (duration <= 0) throw new Error("End time must be later than start time. Overnight logs are not supported.");
    seconds = duration * 60;
    startedAt = localTimestamp(input.date, input.startTime!);
    endedAt = localTimestamp(input.date, input.endTime!);
  } else {
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes! <= 0) throw new Error("Duration must be greater than zero.");
    seconds = input.durationMinutes! * 60;
    startedAt = localTimestamp(input.date, "12:00");
    endedAt = new Date(Date.parse(startedAt) + seconds * 1000).toISOString();
  }
  const candidate = migrateTimeLog({
    id: input.id ?? crypto.randomUUID(), userId: input.userId, taskId: input.taskId,
    sessionId: input.sessionId, scheduleBlockId: input.scheduleBlockId,
    startedAt, endedAt, accumulatedSeconds: seconds, source: "manual", status: "completed",
    note: input.note, createdAt: now, updatedAt: now,
  });
  if (existing.some((log) => log.status !== "discarded" && log.taskId === candidate.taskId && log.sessionId === candidate.sessionId && log.startedAt === candidate.startedAt && log.accumulatedSeconds === candidate.accumulatedSeconds)) throw new Error("This exact time log already exists.");
  const warnings: string[] = [];
  if (Date.parse(candidate.startedAt) > Date.parse(now)) warnings.push("This time log starts in the future. Review it before saving.");
  if (existing.some((log) => log.status === "completed" && log.endedAt && Date.parse(candidate.startedAt) < Date.parse(log.endedAt) && Date.parse(log.startedAt) < Date.parse(candidate.endedAt!))) warnings.push("This time overlaps another saved time log.");
  return { log: candidate, warnings };
}

function localTimestamp(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes).toISOString();
}

export function editCompletedTimeLog(log: TimeLog, changes: { durationMinutes?: number; note?: string }, now = new Date().toISOString()): TimeLog {
  if (log.status !== "completed") throw new Error("Only completed logs can be edited.");
  const seconds = changes.durationMinutes === undefined ? log.accumulatedSeconds : changes.durationMinutes * 60;
  if (!Number.isInteger(seconds) || seconds <= 0) throw new Error("Duration must be greater than zero.");
  return migrateTimeLog({ ...log, accumulatedSeconds: seconds, note: changes.note ?? log.note, durationMinutes: roundTrackedSecondsToMinutes(seconds), manuallyEdited: true, updatedAt: now });
}

export function completedTrackedSeconds(logs: TimeLog[], taskId: string, sessionId?: string): number {
  return logs.filter((log) => log.status === "completed" && log.taskId === taskId && (sessionId === undefined || log.sessionId === sessionId)).reduce((sum, log) => sum + log.accumulatedSeconds, 0);
}

export function taskActualMinutes(task: Pick<TaskRecord, "id" | "actualMinutes">, logs: TimeLog[]): number {
  return (task.actualMinutes ?? 0) + roundTrackedSecondsToMinutes(completedTrackedSeconds(logs, task.id));
}

export function sessionActualMinutes(session: Pick<TaskSession, "id" | "parentTaskId" | "actualMinutes">, logs: TimeLog[]): number {
  return (session.actualMinutes ?? 0) + roundTrackedSecondsToMinutes(completedTrackedSeconds(logs, session.parentTaskId, session.id));
}

export function remainingTrackedEstimate(estimateMinutes: number | undefined, trackedMinutes: number): number | undefined {
  return estimateMinutes === undefined ? undefined : Math.max(estimateMinutes - trackedMinutes, 0);
}

export function mergeTimeLogCopies(current: TimeLog[], incoming: TimeLog[]): TimeLog[] {
  const merged = new Map(current.map((log) => [log.id, log]));
  for (const log of incoming) {
    const existing = merged.get(log.id);
    if (!existing || log.updatedAt > existing.updatedAt) merged.set(log.id, log);
  }
  return Array.from(merged.values());
}

export function activeTimerConflicts(logs: TimeLog[]): TimeLog[] {
  const active = activeTimeLogs(logs);
  return active.length > 1 ? active : [];
}

export function taskHasActiveTimer(logs: TimeLog[], taskId: string): boolean {
  return logs.some((log) => log.taskId === taskId && (log.status === "running" || log.status === "paused"));
}
