import { addLocalDays, localDateFromDate, localDateToDate, startOfLocalWeek } from "./localDateTime";
import type { ScheduleBlock } from "./scheduleBlocks";
import type { TaskRecord } from "./taskHistory";
import type { TaskSession } from "./taskSessions";
import { roundTrackedSecondsToMinutes, sessionActualMinutes, taskActualMinutes, type TimeLog } from "./timeLogs";

export type AnalyticsRangePreset = "this-week" | "last-week" | "last-7-days" | "last-30-days" | "this-month" | "last-month" | "custom";
export interface AnalyticsRange { start: string; end: string }
export interface CategoryAnalytics { categoryName: string; trackedMinutes: number; estimatedMinutes: number; completedTasks: number; completedSessions: number; percentageOfTrackedTime: number }
export interface DailyAnalytics { date: string; trackedMinutes: number; plannedMinutes: number; completedPlannedMinutes: number; missedMinutes: number; completedTasks: number }
export interface AnalyticsInsight {
  id: string;
  type: "estimate-pattern" | "category-focus" | "schedule-follow-through" | "workload-distribution" | "deadline-pattern" | "insufficient-data";
  severity: "neutral" | "informational" | "attention";
  title: string;
  message: string;
  supportingMetric?: string;
  action?: { label: string; route?: string };
}
export interface EstimateComparison { taskId: string; sessionId?: string; title: string; estimateMinutes: number; actualMinutes: number; varianceMinutes: number; ratio: number }
export interface AnalyticsRecord {
  date: string; taskTitle: string; sessionTitle?: string; category: string;
  estimatedMinutes?: number; trackedMinutes: number; plannedMinutes: number;
  scheduleStatus?: string; completionStatus: string; dueDate?: string; completedDate?: string; estimateVarianceMinutes?: number;
}
export interface AnalyticsSummary {
  rangeStart: string; rangeEnd: string;
  trackedMinutes: number; plannedMinutes: number; completedPlannedMinutes: number; missedPlannedMinutes: number; cancelledPlannedMinutes: number; futurePlannedMinutes: number;
  completedTaskCount: number; openTaskCount: number; completedSessionCount: number;
  estimateAccuracy?: number; medianEstimateRatio?: number; medianAbsoluteVarianceMinutes?: number; comparableEstimateCount: number;
  scheduleCompletionRate?: number; taskCompletionRate?: number;
  onTimeCompletedCount: number; lateCompletedCount: number;
  categoryBreakdown: CategoryAnalytics[]; dailyBreakdown: DailyAnalytics[]; estimateComparisons: EstimateComparison[];
  records: AnalyticsRecord[]; insights: AnalyticsInsight[];
}

export const ANALYTICS_THRESHOLDS = {
  estimateMinimumSamples: 3, estimateLongerRatio: 1.25, estimateShorterRatio: 0.75, estimateCloseLow: 0.8, estimateCloseHigh: 1.2,
  categoryFocusShare: 0.6, categoryFocusMinimumMinutes: 60,
  scheduleMinimumMinutes: 120, scheduleStrongRate: 0.8, scheduleMixedRate: 0.5,
  concentrationShare: 0.65, concentrationMinimumActiveDays: 4,
  deadlineMinimumSamples: 3, deadlineMostlyOnTime: 0.8, deadlineOftenLate: 0.5,
  maximumInsights: 5,
} as const;

export function analyticsRangeForPreset(preset: AnalyticsRangePreset, today: string): AnalyticsRange {
  const weekStart = startOfLocalWeek(today);
  if (preset === "this-week") return { start: weekStart, end: addLocalDays(weekStart, 6) };
  if (preset === "last-week") return { start: addLocalDays(weekStart, -7), end: addLocalDays(weekStart, -1) };
  if (preset === "last-7-days") return { start: addLocalDays(today, -6), end: today };
  if (preset === "last-30-days") return { start: addLocalDays(today, -29), end: today };
  const parsed = localDateToDate(today);
  if (preset === "this-month") {
    const start = localDateFromDate(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    return { start, end: localDateFromDate(new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0)) };
  }
  if (preset === "last-month") {
    return {
      start: localDateFromDate(new Date(parsed.getFullYear(), parsed.getMonth() - 1, 1)),
      end: localDateFromDate(new Date(parsed.getFullYear(), parsed.getMonth(), 0)),
    };
  }
  return { start: today, end: today };
}

export function validateAnalyticsRange(range: AnalyticsRange): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end) || range.end < range.start) throw new Error("Range start must be on or before range end.");
  localDateToDate(range.start);
  localDateToDate(range.end);
}

function inRange(date: string | undefined, range: AnalyticsRange): boolean {
  return Boolean(date && date >= range.start && date <= range.end);
}

function timestampLocalDate(timestamp: string | null | undefined): string | undefined {
  return timestamp ? localDateFromDate(new Date(timestamp)) : undefined;
}

function rangeDates(range: AnalyticsRange): string[] {
  const result: string[] = [];
  for (let date = range.start; date <= range.end; date = addLocalDays(date, 1)) result.push(date);
  return result;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function completedLogsInRange(logs: TimeLog[], range: AnalyticsRange): TimeLog[] {
  return logs.filter((log) => log.status === "completed" && inRange(timestampLocalDate(log.startedAt), range));
}

function legacyActualAnchor(task: TaskRecord): string | undefined {
  return timestampLocalDate(task.completedAt) ?? task.scheduledDate ?? (task.date || undefined);
}

function uniqueScheduleBlocks(blocks: ScheduleBlock[]): ScheduleBlock[] {
  const byId = new Map<string, ScheduleBlock>();
  for (const block of blocks) {
    const existing = byId.get(block.id);
    if (!existing || block.updatedAt > existing.updatedAt) byId.set(block.id, block);
  }
  return Array.from(byId.values());
}

export function buildAnalyticsSummary(
  tasks: TaskRecord[],
  sessions: TaskSession[],
  logs: TimeLog[],
  scheduleBlocks: ScheduleBlock[],
  range: AnalyticsRange,
  today: string,
  currentTime = "23:59",
): AnalyticsSummary {
  validateAnalyticsRange(range);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const linkedSessions = new Map<string, TaskSession[]>();
  for (const session of sessions) linkedSessions.set(session.parentTaskId, [...(linkedSessions.get(session.parentTaskId) ?? []), session]);
  const rangeLogs = completedLogsInRange(logs, range);
  const trackedSecondsByTask = new Map<string, number>();
  const trackedSecondsByDate = new Map<string, number>();
  for (const log of rangeLogs) {
    trackedSecondsByTask.set(log.taskId, (trackedSecondsByTask.get(log.taskId) ?? 0) + log.accumulatedSeconds);
    const date = timestampLocalDate(log.startedAt)!;
    trackedSecondsByDate.set(date, (trackedSecondsByDate.get(date) ?? 0) + log.accumulatedSeconds);
  }
  for (const item of tasks) {
    if (!item.actualMinutes || !inRange(legacyActualAnchor(item), range)) continue;
    trackedSecondsByTask.set(item.id, (trackedSecondsByTask.get(item.id) ?? 0) + item.actualMinutes * 60);
    const date = legacyActualAnchor(item)!;
    trackedSecondsByDate.set(date, (trackedSecondsByDate.get(date) ?? 0) + item.actualMinutes * 60);
  }
  const trackedMinutes = roundTrackedSecondsToMinutes(Array.from(trackedSecondsByTask.values()).reduce((sum, value) => sum + value, 0));

  const rangeBlocks = uniqueScheduleBlocks(scheduleBlocks).filter((block) => inRange(block.date, range) && block.status !== "proposed");
  const plannedBlocks = rangeBlocks.filter((block) => block.status !== "cancelled");
  const plannedMinutes = plannedBlocks.reduce((sum, block) => sum + block.durationMinutes, 0);
  const completedPlannedMinutes = plannedBlocks.filter((block) => block.status === "completed").reduce((sum, block) => sum + block.durationMinutes, 0);
  const missedPlannedMinutes = plannedBlocks.filter((block) => block.status === "missed").reduce((sum, block) => sum + block.durationMinutes, 0);
  const cancelledPlannedMinutes = rangeBlocks.filter((block) => block.status === "cancelled").reduce((sum, block) => sum + block.durationMinutes, 0);
  const isPastBlock = (block: ScheduleBlock) => block.date < today || (block.date === today && block.endTime <= currentTime);
  const futurePlannedMinutes = plannedBlocks.filter((block) => !isPastBlock(block) && block.status === "confirmed").reduce((sum, block) => sum + block.durationMinutes, 0);
  const eligiblePastMinutes = plannedBlocks.filter((block) => isPastBlock(block) && (block.status === "completed" || block.status === "missed" || block.status === "confirmed")).reduce((sum, block) => sum + block.durationMinutes, 0);
  const scheduleCompletionRate = eligiblePastMinutes ? completedPlannedMinutes / eligiblePastMinutes : undefined;

  const completedTasks = tasks.filter((task) => (task.status === "completed" || (task.status === "archived" && task.statusBeforeArchive === "completed")) && inRange(timestampLocalDate(task.completedAt), range) && !task.parentTaskId && !task.isGeneratedSession);
  const eligibleOpenTasks = tasks.filter((task) => task.status !== "completed" && task.status !== "archived" && !task.parentTaskId && !task.isGeneratedSession && (inRange(task.dueDate, range) || task.createdAt.slice(0, 10) <= range.end));
  const completedSessions = sessions.filter((session) => (session.status === "completed" || (session.status === "archived" && session.statusBeforeArchive === "completed")) && inRange(timestampLocalDate(session.completedAt), range));
  const taskCompletionDenominator = completedTasks.length + eligibleOpenTasks.length;
  const onTimeCompleted = completedTasks.filter((task) => task.dueDate && timestampLocalDate(task.completedAt)! <= task.dueDate);
  const lateCompleted = completedTasks.filter((task) => task.dueDate && timestampLocalDate(task.completedAt)! > task.dueDate);

  const estimateComparisons: EstimateComparison[] = [];
  for (const item of tasks) {
    const children = linkedSessions.get(item.id) ?? [];
    if (children.length) {
      for (const child of children.filter((session) => (session.status === "completed" || (session.status === "archived" && session.statusBeforeArchive === "completed")) && inRange(timestampLocalDate(session.completedAt), range))) {
        const actual = sessionActualMinutes(child, logs);
        if (!child.estimatedMinutes || !actual) continue;
        estimateComparisons.push({ taskId: item.id, sessionId: child.id, title: child.title, estimateMinutes: child.estimatedMinutes, actualMinutes: actual, varianceMinutes: actual - child.estimatedMinutes, ratio: actual / child.estimatedMinutes });
      }
    } else if ((item.status === "completed" || (item.status === "archived" && item.statusBeforeArchive === "completed")) && inRange(timestampLocalDate(item.completedAt), range) && item.estimatedMinutes) {
      const actual = taskActualMinutes(item, logs);
      if (actual) estimateComparisons.push({ taskId: item.id, title: item.title, estimateMinutes: item.estimatedMinutes, actualMinutes: actual, varianceMinutes: actual - item.estimatedMinutes, ratio: actual / item.estimatedMinutes });
    }
  }
  const medianEstimateRatio = median(estimateComparisons.map((item) => item.ratio));
  const medianAbsoluteVarianceMinutes = median(estimateComparisons.map((item) => Math.abs(item.varianceMinutes)));
  const estimateAccuracy = estimateComparisons.length
    ? Math.max(0, Math.min(1, 1 - estimateComparisons.reduce((sum, item) => sum + Math.abs(item.actualMinutes - item.estimateMinutes) / Math.max(item.estimateMinutes, 1), 0) / estimateComparisons.length))
    : undefined;

  const categoryMap = new Map<string, CategoryAnalytics>();
  for (const [taskId, seconds] of trackedSecondsByTask) {
    const item = taskMap.get(taskId);
    const category = item?.category?.trim() || "Uncategorized";
    const current = categoryMap.get(category) ?? { categoryName: category, trackedMinutes: 0, estimatedMinutes: 0, completedTasks: 0, completedSessions: 0, percentageOfTrackedTime: 0 };
    current.trackedMinutes += roundTrackedSecondsToMinutes(seconds);
    categoryMap.set(category, current);
  }
  for (const item of completedTasks) {
    const category = item.category?.trim() || "Uncategorized";
    const current = categoryMap.get(category) ?? { categoryName: category, trackedMinutes: 0, estimatedMinutes: 0, completedTasks: 0, completedSessions: 0, percentageOfTrackedTime: 0 };
    current.completedTasks += 1;
    if (!(linkedSessions.get(item.id)?.length)) current.estimatedMinutes += item.estimatedMinutes ?? 0;
    categoryMap.set(category, current);
  }
  for (const child of completedSessions) {
    const parent = taskMap.get(child.parentTaskId);
    const category = parent?.category?.trim() || "Uncategorized";
    const current = categoryMap.get(category) ?? { categoryName: category, trackedMinutes: 0, estimatedMinutes: 0, completedTasks: 0, completedSessions: 0, percentageOfTrackedTime: 0 };
    current.completedSessions += 1;
    current.estimatedMinutes += child.estimatedMinutes;
    categoryMap.set(category, current);
  }
  const categoryBreakdown = Array.from(categoryMap.values()).map((item) => ({ ...item, percentageOfTrackedTime: trackedMinutes ? item.trackedMinutes / trackedMinutes : 0 })).sort((a, b) => b.trackedMinutes - a.trackedMinutes || a.categoryName.localeCompare(b.categoryName));

  const dailyBreakdown = rangeDates(range).map((date) => {
    const dayBlocks = plannedBlocks.filter((block) => block.date === date);
    return {
      date,
      trackedMinutes: roundTrackedSecondsToMinutes(trackedSecondsByDate.get(date) ?? 0),
      plannedMinutes: dayBlocks.reduce((sum, block) => sum + block.durationMinutes, 0),
      completedPlannedMinutes: dayBlocks.filter((block) => block.status === "completed").reduce((sum, block) => sum + block.durationMinutes, 0),
      missedMinutes: dayBlocks.filter((block) => block.status === "missed").reduce((sum, block) => sum + block.durationMinutes, 0),
      completedTasks: completedTasks.filter((task) => timestampLocalDate(task.completedAt) === date).length,
    };
  });

  const records = buildAnalyticsRecords(tasks, sessions, rangeLogs, rangeBlocks, range, taskMap);
  const partial: Omit<AnalyticsSummary, "insights"> = {
    rangeStart: range.start, rangeEnd: range.end, trackedMinutes, plannedMinutes, completedPlannedMinutes, missedPlannedMinutes, cancelledPlannedMinutes, futurePlannedMinutes,
    completedTaskCount: completedTasks.length, openTaskCount: eligibleOpenTasks.length, completedSessionCount: completedSessions.length,
    estimateAccuracy, medianEstimateRatio, medianAbsoluteVarianceMinutes, comparableEstimateCount: estimateComparisons.length,
    scheduleCompletionRate, taskCompletionRate: taskCompletionDenominator ? completedTasks.length / taskCompletionDenominator : undefined,
    onTimeCompletedCount: onTimeCompleted.length, lateCompletedCount: lateCompleted.length,
    categoryBreakdown, dailyBreakdown, estimateComparisons, records,
  };
  return { ...partial, insights: deriveAnalyticsInsights(partial) };
}

function buildAnalyticsRecords(tasks: TaskRecord[], sessions: TaskSession[], logs: TimeLog[], blocks: ScheduleBlock[], range: AnalyticsRange, taskMap: Map<string, TaskRecord>): AnalyticsRecord[] {
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const keys = new Set<string>();
  const recordByKey = new Map<string, AnalyticsRecord>();
  const records: AnalyticsRecord[] = [];
  for (const log of logs) {
    const date = timestampLocalDate(log.startedAt)!;
    const key = `${date}|${log.taskId}|${log.sessionId ?? ""}`;
    if (keys.has(key)) continue;
    keys.add(key);
    const matching = logs.filter((item) => timestampLocalDate(item.startedAt) === date && item.taskId === log.taskId && item.sessionId === log.sessionId);
    const item = taskMap.get(log.taskId);
    const child = log.sessionId ? sessionMap.get(log.sessionId) : undefined;
    const tracked = roundTrackedSecondsToMinutes(matching.reduce((sum, itemLog) => sum + itemLog.accumulatedSeconds, 0));
    const planned = blocks.filter((block) => block.date === date && block.taskId === log.taskId && block.sessionId === log.sessionId).reduce((sum, block) => sum + block.durationMinutes, 0);
    const record = { date, taskTitle: item?.title ?? "Deleted task", sessionTitle: child?.title, category: item?.category || "Uncategorized", estimatedMinutes: child?.estimatedMinutes ?? item?.estimatedMinutes, trackedMinutes: tracked, plannedMinutes: planned, scheduleStatus: blocks.find((block) => block.date === date && block.taskId === log.taskId)?.status, completionStatus: child?.status ?? item?.status ?? "historical", dueDate: item?.dueDate, completedDate: timestampLocalDate(child?.completedAt ?? item?.completedAt), estimateVarianceMinutes: (child?.estimatedMinutes ?? item?.estimatedMinutes) !== undefined ? tracked - (child?.estimatedMinutes ?? item!.estimatedMinutes!) : undefined };
    records.push(record);
    recordByKey.set(key, record);
  }
  for (const item of tasks.filter((task) => task.actualMinutes && inRange(legacyActualAnchor(task), range))) {
    const date = legacyActualAnchor(item)!;
    const key = `${date}|${item.id}|`;
    const existing = recordByKey.get(key);
    if (existing) {
      existing.trackedMinutes += item.actualMinutes!;
      if (existing.estimatedMinutes !== undefined) existing.estimateVarianceMinutes = existing.trackedMinutes - existing.estimatedMinutes;
    } else {
      const record = { date, taskTitle: item.title, category: item.category || "Uncategorized", estimatedMinutes: item.estimatedMinutes, trackedMinutes: item.actualMinutes!, plannedMinutes: blocks.filter((block) => block.date === date && block.taskId === item.id && !block.sessionId).reduce((sum, block) => sum + block.durationMinutes, 0), completionStatus: item.status, dueDate: item.dueDate, completedDate: timestampLocalDate(item.completedAt), estimateVarianceMinutes: item.estimatedMinutes === undefined ? undefined : item.actualMinutes! - item.estimatedMinutes };
      records.push(record);
      recordByKey.set(key, record);
    }
  }
  for (const schedule of blocks) {
    const item = taskMap.get(schedule.taskId);
    const child = schedule.sessionId ? sessionMap.get(schedule.sessionId) : undefined;
    const key = `${schedule.date}|${schedule.taskId}|${schedule.sessionId ?? ""}`;
    if (!recordByKey.has(key)) {
      const record = { date: schedule.date, taskTitle: item?.title ?? "Deleted task", sessionTitle: child?.title, category: item?.category || "Uncategorized", estimatedMinutes: child?.estimatedMinutes ?? item?.estimatedMinutes, trackedMinutes: 0, plannedMinutes: blocks.filter((block) => block.date === schedule.date && block.taskId === schedule.taskId && block.sessionId === schedule.sessionId).reduce((sum, block) => sum + block.durationMinutes, 0), scheduleStatus: schedule.status, completionStatus: child?.status ?? item?.status ?? "historical", dueDate: item?.dueDate, completedDate: timestampLocalDate(child?.completedAt ?? item?.completedAt) };
      records.push(record);
      recordByKey.set(key, record);
    }
  }
  for (const item of tasks.filter((task) => (task.status === "completed" || (task.status === "archived" && task.statusBeforeArchive === "completed")) && inRange(timestampLocalDate(task.completedAt), range) && !records.some((record) => record.taskTitle === task.title && record.completedDate === timestampLocalDate(task.completedAt)))) {
    records.push({ date: timestampLocalDate(item.completedAt)!, taskTitle: item.title, category: item.category || "Uncategorized", estimatedMinutes: item.estimatedMinutes, trackedMinutes: 0, plannedMinutes: 0, completionStatus: item.status, dueDate: item.dueDate, completedDate: timestampLocalDate(item.completedAt) });
  }
  return records.sort((a, b) => b.date.localeCompare(a.date) || a.taskTitle.localeCompare(b.taskTitle));
}

export function deriveAnalyticsInsights(summary: Omit<AnalyticsSummary, "insights">): AnalyticsInsight[] {
  const insights: AnalyticsInsight[] = [];
  const add = (insight: AnalyticsInsight) => { if (insights.length < ANALYTICS_THRESHOLDS.maximumInsights) insights.push(insight); };
  if (summary.comparableEstimateCount >= ANALYTICS_THRESHOLDS.estimateMinimumSamples && summary.medianEstimateRatio !== undefined) {
    if (summary.medianEstimateRatio > ANALYTICS_THRESHOLDS.estimateLongerRatio) add({ id: "estimate-longer", type: "estimate-pattern", severity: "informational", title: "Estimate pattern", message: "Recent completed work often took longer than estimated.", supportingMetric: `Based on ${summary.comparableEstimateCount} completed work items.` });
    else if (summary.medianEstimateRatio < ANALYTICS_THRESHOLDS.estimateShorterRatio) add({ id: "estimate-shorter", type: "estimate-pattern", severity: "neutral", title: "Estimate pattern", message: "Recent completed work often took less time than estimated.", supportingMetric: `Based on ${summary.comparableEstimateCount} completed work items.` });
    else if (summary.medianEstimateRatio >= ANALYTICS_THRESHOLDS.estimateCloseLow && summary.medianEstimateRatio <= ANALYTICS_THRESHOLDS.estimateCloseHigh) add({ id: "estimate-close", type: "estimate-pattern", severity: "neutral", title: "Estimate pattern", message: "Recent estimates were generally close to tracked time.", supportingMetric: `Based on ${summary.comparableEstimateCount} completed work items.` });
  }
  const topCategory = summary.categoryBreakdown[0];
  if (topCategory && summary.trackedMinutes >= ANALYTICS_THRESHOLDS.categoryFocusMinimumMinutes && topCategory.percentageOfTrackedTime >= ANALYTICS_THRESHOLDS.categoryFocusShare) add({ id: `category-${topCategory.categoryName}`, type: "category-focus", severity: "neutral", title: "Time by category", message: `Most tracked time this period went to ${topCategory.categoryName}.`, supportingMetric: `${Math.round(topCategory.percentageOfTrackedTime * 100)}% of tracked time.` });
  const pastEligible = summary.scheduleCompletionRate === undefined ? 0 : summary.completedPlannedMinutes / Math.max(summary.scheduleCompletionRate, 0.0001);
  if (pastEligible >= ANALYTICS_THRESHOLDS.scheduleMinimumMinutes && summary.scheduleCompletionRate !== undefined) {
    if (summary.scheduleCompletionRate >= ANALYTICS_THRESHOLDS.scheduleStrongRate) add({ id: "schedule-most", type: "schedule-follow-through", severity: "neutral", title: "Planned time", message: "Most past planned work was completed.", supportingMetric: `${Math.round(summary.scheduleCompletionRate * 100)}% of eligible planned minutes.` });
    else if (summary.scheduleCompletionRate >= ANALYTICS_THRESHOLDS.scheduleMixedRate) add({ id: "schedule-some", type: "schedule-follow-through", severity: "informational", title: "Planned time", message: "Some planned work was missed or left incomplete.", supportingMetric: `${Math.round(summary.scheduleCompletionRate * 100)}% of eligible planned minutes completed.` });
    else add({ id: "schedule-less-half", type: "schedule-follow-through", severity: "attention", title: "Planned time", message: "More than half of past planned time was not completed as scheduled.", supportingMetric: `${Math.round(summary.scheduleCompletionRate * 100)}% of eligible planned minutes completed.` });
  }
  const activeDays = summary.dailyBreakdown.filter((day) => day.trackedMinutes > 0).sort((a, b) => b.trackedMinutes - a.trackedMinutes);
  const topTwoShare = summary.trackedMinutes ? activeDays.slice(0, 2).reduce((sum, day) => sum + day.trackedMinutes, 0) / summary.trackedMinutes : 0;
  if (activeDays.length >= ANALYTICS_THRESHOLDS.concentrationMinimumActiveDays && topTwoShare >= ANALYTICS_THRESHOLDS.concentrationShare) add({ id: "workload-concentrated", type: "workload-distribution", severity: "neutral", title: "Workload distribution", message: "Tracked work was concentrated on two days.", supportingMetric: `${Math.round(topTwoShare * 100)}% of tracked time.` });
  const deadlineTotal = summary.onTimeCompletedCount + summary.lateCompletedCount;
  if (deadlineTotal >= ANALYTICS_THRESHOLDS.deadlineMinimumSamples) {
    const rate = summary.onTimeCompletedCount / deadlineTotal;
    if (rate >= ANALYTICS_THRESHOLDS.deadlineMostlyOnTime) add({ id: "deadlines-most-on-time", type: "deadline-pattern", severity: "neutral", title: "Deadline completion", message: "Most deadline-based tasks were completed on time.", supportingMetric: `${summary.onTimeCompletedCount} of ${deadlineTotal} tasks.` });
    else if (rate < ANALYTICS_THRESHOLDS.deadlineOftenLate) add({ id: "deadlines-several-late", type: "deadline-pattern", severity: "informational", title: "Deadline completion", message: "Several deadline-based tasks were completed after their deadline.", supportingMetric: `${summary.lateCompletedCount} of ${deadlineTotal} tasks.` });
  }
  if (!insights.length) add({ id: "insufficient-data", type: "insufficient-data", severity: "neutral", title: "More data needed", message: summary.trackedMinutes ? "More completed estimated work is needed for broader planning insights." : "Track time on a task to see actual-time insights." });
  return insights;
}

function csvEscape(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function analyticsCsv(records: AnalyticsRecord[]): string {
  const headers = ["Date", "Task", "Session", "Category", "Estimated minutes", "Tracked minutes", "Planned minutes", "Schedule status", "Completion status", "Due date", "Completed date", "Estimate variance minutes"];
  const rows = records.map((record) => [record.date, record.taskTitle, record.sessionTitle, record.category, record.estimatedMinutes, record.trackedMinutes, record.plannedMinutes, record.scheduleStatus, record.completionStatus, record.dueDate, record.completedDate, record.estimateVarianceMinutes].map(csvEscape).join(","));
  return [headers.join(","), ...rows].join("\n");
}

export function analyticsCsvFilename(range: AnalyticsRange): string {
  return `planner-analytics-${range.start}-to-${range.end}.csv`;
}
