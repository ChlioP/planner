import { availableIntervalsForDate, type AvailabilityBlock, type AvailabilityOverride, type Interval } from "./availability";
import { addLocalDays, timeToMinutes } from "./localDateTime";
import { detectScheduleConflicts, type ScheduleBlock } from "./scheduleBlocks";
import type { TaskRecord } from "./taskHistory";
import type { TaskSession } from "./taskSessions";
import { completedTrackedSeconds, roundTrackedSecondsToMinutes, type TimeLog } from "./timeLogs";

export type RiskStatus = "missing-data" | "on-track" | "tight" | "at-risk" | "overdue" | "completed";
export type RiskReasonCode =
  | "missing-estimate" | "missing-deadline" | "past-deadline" | "insufficient-availability"
  | "insufficient-scheduled-time" | "large-unscheduled-effort" | "tight-buffer"
  | "schedule-conflict" | "missed-work" | "session-does-not-fit" | "daily-cap-limited"
  | "availability-not-configured" | "all-work-complete";
export type RiskAction =
  | "add-estimate" | "add-deadline" | "add-availability" | "plan-work" | "replan-work"
  | "resolve-conflict" | "increase-daily-cap" | "add-session" | "shorten-session"
  | "change-deadline" | "reduce-scope" | "review-task";

export interface RiskReason { code: RiskReasonCode; message: string; severity: "info" | "warning" | "critical" }
export interface RiskRecommendation { action: RiskAction; label: string }
export interface TaskRiskAssessment {
  taskId: string;
  status: RiskStatus;
  score?: number;
  remainingMinutes?: number;
  scheduledMinutes?: number;
  proposedScheduledMinutes?: number;
  conflictedMinutes?: number;
  availableMinutesBeforeDeadline?: number;
  unscheduledMinutes?: number;
  bufferMinutes?: number;
  daysUntilDue?: number;
  largestContinuousAvailableMinutes?: number;
  reasons: RiskReason[];
  recommendations: RiskRecommendation[];
  calculatedAt: string;
}

export function riskLabel(assessment: TaskRiskAssessment): string {
  if (assessment.status === "missing-data") {
    if (assessment.reasons.some((item) => item.code === "missing-estimate")) return "Needs estimate";
    if (assessment.reasons.some((item) => item.code === "missing-deadline")) return "Needs deadline";
    return "Missing information";
  }
  return assessment.status === "on-track" ? "On track" : assessment.status === "at-risk" ? "At risk" : assessment.status[0]!.toUpperCase() + assessment.status.slice(1);
}

export interface CapacityResult {
  totalAvailableMinutes: number;
  unallocatedMinutes: number;
  taskAssignedMinutes: number;
  otherAssignedMinutes: number;
  usableDays: number;
  largestContinuousInterval: number;
  dailyCapLimited: boolean;
}

export interface RiskContext {
  tasks: TaskRecord[];
  sessions: TaskSession[];
  availability: AvailabilityBlock[];
  overrides: AvailabilityOverride[];
  scheduleBlocks: ScheduleBlock[];
  proposedBlocks?: ScheduleBlock[];
  today: string;
  currentTime?: string;
  dailyCapMinutes: number;
  calculatedAt: string;
  timeLogs?: TimeLog[];
}

export const RISK_SCORE_THRESHOLDS = { onTrackMax: 24, tightMax: 49, atRiskMax: 79, criticalMin: 80 } as const;

export function capacityRatioPoints(ratio: number): number {
  if (ratio <= 0.6) return 0;
  if (ratio <= 0.8) return 10;
  if (ratio <= 1) return 25;
  if (ratio <= 1.2) return 35;
  return 40;
}

export function unscheduledRatioPoints(ratio: number): number {
  if (ratio <= 0) return 0;
  if (ratio <= 0.25) return 5;
  if (ratio <= 0.5) return 12;
  if (ratio <= 0.75) return 20;
  return 25;
}

export function deadlineProximityPoints(days: number): number {
  if (days > 14) return 0;
  if (days >= 8) return 3;
  if (days >= 4) return 6;
  if (days >= 1) return 10;
  if (days === 0) return 15;
  return 15;
}

export function riskStatusForScore(score: number): "on-track" | "tight" | "at-risk" {
  if (score <= RISK_SCORE_THRESHOLDS.onTrackMax) return "on-track";
  if (score <= RISK_SCORE_THRESHOLDS.tightMax) return "tight";
  return "at-risk";
}

function localDayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function minutesIn(intervals: Interval[]): number {
  return intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0);
}

function subtractIntervals(intervals: Interval[], blocked: Interval[]): Interval[] {
  let result = intervals;
  for (const item of blocked.slice().sort((a, b) => a.start - b.start)) {
    result = result.flatMap((slot) => item.end <= slot.start || item.start >= slot.end ? [slot] : [
      ...(item.start > slot.start ? [{ start: slot.start, end: item.start }] : []),
      ...(item.end < slot.end ? [{ start: item.end, end: slot.end }] : []),
    ]);
  }
  return result;
}

function futureOnDate(block: ScheduleBlock, date: string, today: string, currentTime?: string): boolean {
  if (block.date !== date || block.date < today) return false;
  return block.date !== today || !currentTime || timeToMinutes(block.endTime) > timeToMinutes(currentTime);
}

export function calculateCapacityBeforeDeadline(
  taskId: string,
  deadline: string,
  availability: AvailabilityBlock[],
  overrides: AvailabilityOverride[],
  scheduleBlocks: ScheduleBlock[],
  today: string,
  currentTime: string | undefined,
  dailyCapMinutes: number,
): CapacityResult {
  let totalAvailableMinutes = 0;
  let unallocatedMinutes = 0;
  let taskAssignedMinutes = 0;
  let otherAssignedMinutes = 0;
  let usableDays = 0;
  let largestContinuousInterval = 0;
  let dailyCapLimited = false;
  if (deadline < today) return { totalAvailableMinutes, unallocatedMinutes, taskAssignedMinutes, otherAssignedMinutes, usableDays, largestContinuousInterval, dailyCapLimited };
  for (let date = today; date <= deadline; date = addLocalDays(date, 1)) {
    let intervals = availableIntervalsForDate(availability, overrides, date);
    if (date === today && currentTime) {
      const nowMinutes = timeToMinutes(currentTime);
      intervals = intervals.map((slot) => ({ start: Math.max(slot.start, nowMinutes), end: slot.end })).filter((slot) => slot.end > slot.start);
    }
    const active = scheduleBlocks.filter((block) => futureOnDate(block, date, today, currentTime) && (block.status === "confirmed" || (block.status === "proposed" && block.isLocked)));
    const other = active.filter((block) => block.taskId !== taskId);
    const own = active.filter((block) => block.taskId === taskId);
    const freeIntervals = subtractIntervals(intervals, other.map((block) => ({ start: timeToMinutes(block.startTime), end: timeToMinutes(block.endTime) })));
    const rawFree = minutesIn(freeIntervals);
    const otherMinutes = other.reduce((sum, block) => sum + block.durationMinutes, 0);
    const ownMinutes = own.reduce((sum, block) => sum + block.durationMinutes, 0);
    const capped = Math.min(rawFree, Math.max(dailyCapMinutes - otherMinutes, 0));
    if (capped < rawFree) dailyCapLimited = true;
    totalAvailableMinutes += capped;
    taskAssignedMinutes += ownMinutes;
    otherAssignedMinutes += otherMinutes;
    unallocatedMinutes += Math.max(capped - ownMinutes, 0);
    if (capped > 0) usableDays += 1;
    const largest = freeIntervals.reduce((max, slot) => Math.max(max, slot.end - slot.start), 0);
    largestContinuousInterval = Math.max(largestContinuousInterval, Math.min(largest, Math.max(dailyCapMinutes - otherMinutes, 0)));
  }
  return { totalAvailableMinutes, unallocatedMinutes, taskAssignedMinutes, otherAssignedMinutes, usableDays, largestContinuousInterval, dailyCapLimited };
}

function remainingEffort(task: TaskRecord, sessions: TaskSession[], logs: TimeLog[]): number | undefined {
  if (sessions.length) {
    const sessionRemaining = sessions.filter((session) => session.status !== "completed" && session.status !== "archived").reduce((sum, session) => {
      const tracked = (session.actualMinutes ?? 0) + roundTrackedSecondsToMinutes(completedTrackedSeconds(logs, task.id, session.id));
      return sum + Math.max(session.estimatedMinutes - tracked, 0);
    }, 0);
    const directTracked = roundTrackedSecondsToMinutes(logs.filter((log) => log.taskId === task.id && !log.sessionId && log.status === "completed").reduce((sum, log) => sum + log.accumulatedSeconds, 0));
    return Math.max(sessionRemaining - (task.actualMinutes ?? 0) - directTracked, 0);
  }
  const tracked = roundTrackedSecondsToMinutes(completedTrackedSeconds(logs, task.id));
  return task.estimatedMinutes === undefined ? undefined : Math.max(task.estimatedMinutes - (task.actualMinutes ?? 0) - tracked, 0);
}

function activeFutureBlocks(blocks: ScheduleBlock[], taskId: string, deadline: string, today: string, currentTime?: string): ScheduleBlock[] {
  return blocks.filter((block) => block.taskId === taskId && block.status === "confirmed" && block.date <= deadline && futureOnDate(block, block.date, today, currentTime));
}

function recommendation(action: RiskAction, label: string): RiskRecommendation { return { action, label } }
function reason(code: RiskReasonCode, message: string, severity: RiskReason["severity"]): RiskReason { return { code, message, severity } }

export function assessTaskRisk(task: TaskRecord, context: RiskContext): TaskRiskAssessment {
  const linked = context.sessions.filter((session) => session.parentTaskId === task.id);
  const remaining = remainingEffort(task, linked, context.timeLogs ?? []);
  const base = { taskId: task.id, calculatedAt: context.calculatedAt };
  if (task.status === "completed" || remaining === 0) {
    return { ...base, status: "completed", remainingMinutes: 0, reasons: [reason("all-work-complete", "All estimated work is complete.", "info")], recommendations: [] };
  }
  if (remaining === undefined) {
    return { ...base, status: "missing-data", reasons: [reason("missing-estimate", "This task has no estimate, so feasibility cannot be calculated.", "warning")], recommendations: [recommendation("add-estimate", "Add estimate")] };
  }
  if (!task.dueDate) {
    return { ...base, status: "missing-data", remainingMinutes: remaining, reasons: [reason("missing-deadline", "Add a deadline to check whether this work can finish on time.", "warning")], recommendations: [recommendation("add-deadline", "Add deadline")] };
  }
  const dueDate = task.dueDate;
  if (!context.availability.some((block) => block.type === "available")) {
    return { ...base, status: "missing-data", remainingMinutes: remaining, daysUntilDue: localDayNumber(task.dueDate) - localDayNumber(context.today), reasons: [reason("availability-not-configured", "No explicit available time is configured, so feasibility cannot be calculated.", "warning")], recommendations: [recommendation("add-availability", "Add availability")] };
  }

  const allBlocks = [...context.scheduleBlocks, ...(context.proposedBlocks ?? [])];
  const conflicts = detectScheduleConflicts(allBlocks, context.tasks, context.availability, context.overrides, context.dailyCapMinutes).filter((item) => item.taskId === task.id);
  const conflictIds = new Set(conflicts.map((item) => item.blockId));
  for (const session of linked.filter((item) => item.status !== "completed" && item.status !== "archived")) {
    const linkedBlocks = context.scheduleBlocks.filter((block) => block.sessionId === session.id && block.status === "confirmed");
    const linkedMinutes = linkedBlocks.reduce((sum, block) => sum + block.durationMinutes, 0);
    if (linkedMinutes > 0 && linkedMinutes !== session.estimatedMinutes) linkedBlocks.forEach((block) => conflictIds.add(block.id));
  }
  const future = activeFutureBlocks(context.scheduleBlocks, task.id, dueDate, context.today, context.currentTime);
  const scheduledMinutes = future.filter((block) => !conflictIds.has(block.id)).reduce((sum, block) => sum + block.durationMinutes, 0);
  const conflictedMinutes = future.filter((block) => conflictIds.has(block.id)).reduce((sum, block) => sum + block.durationMinutes, 0);
  const proposedScheduledMinutes = (context.proposedBlocks ?? []).filter((block) => block.taskId === task.id && block.date <= dueDate && !conflictIds.has(block.id)).reduce((sum, block) => sum + block.durationMinutes, 0);
  const reliableScheduled = Math.min(remaining, scheduledMinutes + proposedScheduledMinutes);
  const unscheduledMinutes = Math.max(remaining - reliableScheduled, 0);
  const capacity = calculateCapacityBeforeDeadline(task.id, dueDate, context.availability, context.overrides, allBlocks, context.today, context.currentTime, context.dailyCapMinutes);
  const bufferMinutes = capacity.totalAvailableMinutes - remaining;
  const daysUntilDue = localDayNumber(dueDate) - localDayNumber(context.today);
  const missedMinutes = context.scheduleBlocks.filter((block) => block.taskId === task.id && block.status === "missed").reduce((sum, block) => sum + block.durationMinutes, 0);
  const fixedUnscheduled = linked.filter((session) => session.status !== "completed" && session.status !== "archived").filter((session) => {
    const covered = [...future, ...(context.proposedBlocks ?? [])].filter((block) => block.sessionId === session.id && !conflictIds.has(block.id)).reduce((sum, block) => sum + block.durationMinutes, 0);
    return covered < session.estimatedMinutes;
  });
  if (!linked.length && !task.isSplittable && unscheduledMinutes > 0) fixedUnscheduled.push({ estimatedMinutes: unscheduledMinutes } as TaskSession);
  const cannotFit = fixedUnscheduled.filter((session) => session.estimatedMinutes > capacity.largestContinuousInterval);

  const reasons: RiskReason[] = [];
  const recommendations: RiskRecommendation[] = [];
  if (daysUntilDue < 0) {
    reasons.push(reason("past-deadline", `The deadline ${dueDate} has passed with ${remaining} minutes remaining.`, "critical"));
    recommendations.push(recommendation("replan-work", "Replan remaining work"), recommendation("review-task", "Review task"));
    return { ...base, status: "overdue", score: 100, remainingMinutes: remaining, scheduledMinutes, proposedScheduledMinutes, conflictedMinutes, availableMinutesBeforeDeadline: 0, unscheduledMinutes: remaining, bufferMinutes: -remaining, daysUntilDue, largestContinuousAvailableMinutes: 0, reasons, recommendations };
  }
  if (capacity.totalAvailableMinutes < remaining) {
    reasons.push(reason("insufficient-availability", `${remaining} minutes remain, but only ${capacity.totalAvailableMinutes} minutes of availability exist before ${dueDate}.`, "critical"));
    recommendations.push(recommendation("add-availability", "Add availability"), recommendation("change-deadline", "Review deadline"), recommendation("reduce-scope", "Reduce or revise scope"));
  }
  if (unscheduledMinutes > 0) {
    reasons.push(reason(unscheduledMinutes / remaining > 0.5 ? "large-unscheduled-effort" : "insufficient-scheduled-time", `${unscheduledMinutes} minutes remain unscheduled.`, unscheduledMinutes / remaining > 0.5 ? "warning" : "info"));
    recommendations.push(recommendation("plan-work", "Plan remaining work"));
  }
  if (conflictedMinutes > 0) {
    reasons.push(reason("schedule-conflict", `${conflictedMinutes} scheduled minutes are uncertain because they conflict with the current plan.`, "critical"));
    recommendations.push(recommendation("resolve-conflict", "Resolve conflict"), recommendation("replan-work", "Replan work"));
  }
  if (cannotFit.length) {
    const longest = Math.max(...cannotFit.map((session) => session.estimatedMinutes));
    reasons.push(reason("session-does-not-fit", `A ${longest}-minute session cannot fit into the available time blocks; the largest block is ${capacity.largestContinuousInterval} minutes.`, "critical"));
    recommendations.push(recommendation("add-availability", "Add a longer availability block"), recommendation("shorten-session", "Shorten session"));
  }
  if (missedMinutes > 0 && unscheduledMinutes > 0) {
    reasons.push(reason("missed-work", `${missedMinutes} planned minutes were missed and work remains unscheduled.`, "warning"));
    recommendations.push(recommendation("replan-work", "Replan work"));
  }
  if (capacity.dailyCapLimited && bufferMinutes < remaining * 0.2) {
    reasons.push(reason("daily-cap-limited", "The daily planning limit reduces usable time before the deadline.", "warning"));
    recommendations.push(recommendation("increase-daily-cap", "Review daily planning limit"));
  }
  if (bufferMinutes >= 0 && bufferMinutes < remaining * 0.2) reasons.push(reason("tight-buffer", "Very little available-time buffer remains before the deadline.", "warning"));

  const capacityRatio = remaining / Math.max(capacity.totalAvailableMinutes, 1);
  const unscheduledRatio = unscheduledMinutes / Math.max(remaining, 1);
  const conflictPoints = conflictedMinutes > 0 ? Math.min(10, Math.ceil((conflictedMinutes / remaining) * 10)) : 0;
  const missedPoints = missedMinutes > 0 && unscheduledMinutes > 0 ? Math.min(10, Math.ceil((missedMinutes / remaining) * 10)) : 0;
  const score = Math.max(0, Math.min(100, capacityRatioPoints(capacityRatio) + unscheduledRatioPoints(unscheduledRatio) + deadlineProximityPoints(daysUntilDue) + conflictPoints + missedPoints));
  let status = riskStatusForScore(score);
  if (capacity.totalAvailableMinutes < remaining || cannotFit.length || conflictedMinutes >= remaining) status = "at-risk";
  else if (bufferMinutes < remaining * 0.2 || (unscheduledMinutes > 0 && daysUntilDue <= 3)) status = "tight";
  if (!reasons.length) reasons.push(reason("all-work-complete", bufferMinutes >= remaining ? "Planned work fits with a healthy availability buffer." : "Enough available time remains before the deadline.", "info"));
  const uniqueRecommendations = recommendations.filter((item, index) => recommendations.findIndex((other) => other.action === item.action) === index).slice(0, 3);
  return { ...base, status, score, remainingMinutes: remaining, scheduledMinutes, proposedScheduledMinutes, conflictedMinutes, availableMinutesBeforeDeadline: capacity.totalAvailableMinutes, unscheduledMinutes, bufferMinutes, daysUntilDue, largestContinuousAvailableMinutes: capacity.largestContinuousInterval, reasons, recommendations: uniqueRecommendations };
}

export function assessActiveTaskRisks(context: RiskContext): TaskRiskAssessment[] {
  return context.tasks.filter((task) => task.status !== "archived").map((task) => assessTaskRisk(task, context));
}

export interface RiskSummary {
  onTrack: number; tight: number; atRisk: number; overdue: number;
  missingEstimates: number; missingDeadlines: number; scheduleConflicts: number;
}
export function summarizeRisks(assessments: TaskRiskAssessment[]): RiskSummary {
  return {
    onTrack: assessments.filter((item) => item.status === "on-track").length,
    tight: assessments.filter((item) => item.status === "tight").length,
    atRisk: assessments.filter((item) => item.status === "at-risk").length,
    overdue: assessments.filter((item) => item.status === "overdue").length,
    missingEstimates: assessments.filter((item) => item.reasons.some((reasonItem) => reasonItem.code === "missing-estimate")).length,
    missingDeadlines: assessments.filter((item) => item.reasons.some((reasonItem) => reasonItem.code === "missing-deadline")).length,
    scheduleConflicts: assessments.filter((item) => item.reasons.some((reasonItem) => reasonItem.code === "schedule-conflict")).length,
  };
}

export type RiskFilter = "all" | "at-risk" | "tight" | "overdue" | "on-track" | "missing-estimate" | "missing-deadline" | "schedule-conflict";
export type RiskSort = "highest-risk" | "earliest-deadline" | "most-unscheduled" | "least-buffer" | "highest-priority" | "recently-updated";

export function filterRiskAssessments(items: TaskRiskAssessment[], filter: RiskFilter): TaskRiskAssessment[] {
  if (filter === "all") return items;
  if (["at-risk", "tight", "overdue", "on-track"].includes(filter)) return items.filter((item) => item.status === filter);
  const code = filter === "missing-estimate" ? "missing-estimate" : filter === "missing-deadline" ? "missing-deadline" : "schedule-conflict";
  return items.filter((item) => item.reasons.some((reasonItem) => reasonItem.code === code));
}

export function sortRiskAssessments(items: TaskRiskAssessment[], tasks: TaskRecord[], sort: RiskSort): TaskRiskAssessment[] {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const statusRank: Record<RiskStatus, number> = { overdue: 0, "at-risk": 1, tight: 2, "missing-data": 3, "on-track": 4, completed: 5 };
  const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  return items.slice().sort((a, b) => {
    const taskA = taskMap.get(a.taskId)!;
    const taskB = taskMap.get(b.taskId)!;
    let comparison = 0;
    if (sort === "highest-risk") comparison = statusRank[a.status] - statusRank[b.status] || (b.score ?? -1) - (a.score ?? -1);
    if (sort === "earliest-deadline") comparison = (taskA.dueDate ?? "9999-12-31").localeCompare(taskB.dueDate ?? "9999-12-31");
    if (sort === "most-unscheduled") comparison = (b.unscheduledMinutes ?? -1) - (a.unscheduledMinutes ?? -1);
    if (sort === "least-buffer") comparison = (a.bufferMinutes ?? Number.POSITIVE_INFINITY) - (b.bufferMinutes ?? Number.POSITIVE_INFINITY);
    if (sort === "highest-priority") comparison = priorityRank[taskA.priority] - priorityRank[taskB.priority];
    if (sort === "recently-updated") comparison = taskB.updatedAt.localeCompare(taskA.updatedAt);
    return comparison || a.taskId.localeCompare(b.taskId);
  });
}
