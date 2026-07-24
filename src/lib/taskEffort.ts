import type { TaskCategory, TaskRecord } from "./taskHistory";

export const QUICK_EFFORT_MINUTES = [15, 30, 45, 60, 120, 180, 300] as const;
export const DEFAULT_MINIMUM_SESSION_MINUTES = 25;
export const DEFAULT_MAXIMUM_SESSION_MINUTES = 90;
export const LARGE_ESTIMATE_WARNING_MINUTES = 40 * 60;
export const MAX_ESTIMATE_MINUTES = 10 * 7 * 24 * 60;

export interface TaskEffort {
  estimatedMinutes?: number;
  actualMinutes?: number;
  remainingMinutes?: number;
  minimumSessionMinutes?: number;
  maximumSessionMinutes?: number;
  isSplittable: boolean;
}

export type EstimateState =
  | "No estimate"
  | "Estimated"
  | "Actual exceeded estimate"
  | "Completed under estimate"
  | "Completed near estimate"
  | "Completed over estimate";

export interface EffortValidation {
  errors: string[];
  warnings: string[];
}

export interface PlanningEffortSummary {
  totalMinutes: number;
  categoryMinutes: Record<"school" | "career" | "portfolio", number>;
  missingEstimateCount: number;
}

function validWholeMinutes(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value > 0);
}

export function minutesFromHoursAndMinutes(hours: number, minutes: number): number {
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new Error("Hours and minutes must be whole numbers.");
  }
  if (hours < 0 || minutes < 0 || minutes > 59) throw new Error("Enter non-negative hours and minutes from 0 to 59.");
  const total = hours * 60 + minutes;
  if (total <= 0) throw new Error("Time must be greater than zero.");
  if (total > MAX_ESTIMATE_MINUTES) throw new Error("Time is above the supported limit of 10 weeks.");
  return total;
}

export function validateTaskEffort(effort: TaskEffort): EffortValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!validWholeMinutes(effort.estimatedMinutes)) errors.push("Estimate must be a whole number greater than zero.");
  if (effort.actualMinutes !== undefined && (!Number.isInteger(effort.actualMinutes) || effort.actualMinutes < 0)) errors.push("Actual time must be zero or a positive whole number.");
  if (effort.estimatedMinutes !== undefined && effort.estimatedMinutes > MAX_ESTIMATE_MINUTES) errors.push("Estimate is above the supported limit of 10 weeks.");
  if (effort.estimatedMinutes !== undefined && effort.estimatedMinutes > LARGE_ESTIMATE_WARNING_MINUTES) warnings.push("This is an unusually large estimate. Review it before saving.");
  if (effort.isSplittable) {
    if (!validWholeMinutes(effort.minimumSessionMinutes)) errors.push("Minimum session time must be greater than zero.");
    if (!validWholeMinutes(effort.maximumSessionMinutes)) errors.push("Maximum session time must be greater than zero.");
    if (
      effort.minimumSessionMinutes !== undefined &&
      effort.maximumSessionMinutes !== undefined &&
      effort.maximumSessionMinutes < effort.minimumSessionMinutes
    ) errors.push("Maximum session time must be equal to or greater than the minimum.");
    if (
      effort.estimatedMinutes !== undefined &&
      effort.minimumSessionMinutes !== undefined &&
      effort.minimumSessionMinutes > effort.estimatedMinutes
    ) errors.push("Minimum session time cannot exceed the total estimate.");
  }
  return { errors: Array.from(new Set(errors)), warnings };
}

export function remainingMinutes(estimatedMinutes?: number, actualMinutes?: number): number | undefined {
  if (estimatedMinutes === undefined) return undefined;
  return Math.max(estimatedMinutes - (actualMinutes ?? 0), 0);
}

export function displayedRemainingMinutes(task: Pick<TaskRecord, "status" | "estimatedMinutes" | "actualMinutes">): number | undefined {
  if (task.estimatedMinutes === undefined) return undefined;
  return task.status === "completed" ? 0 : remainingMinutes(task.estimatedMinutes, task.actualMinutes);
}

export function formatEffortMinutes(minutes: number | undefined): string {
  if (minutes === undefined) return "No estimate";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}

export function estimateState(task: Pick<TaskRecord, "status" | "estimatedMinutes" | "actualMinutes">): EstimateState {
  const estimate = task.estimatedMinutes;
  const actual = task.actualMinutes;
  if (estimate === undefined) return "No estimate";
  if (task.status !== "completed") return actual !== undefined && actual > estimate ? "Actual exceeded estimate" : "Estimated";
  if (actual === undefined) return "Estimated";
  const ratio = actual / estimate;
  if (ratio < 0.9) return "Completed under estimate";
  if (ratio <= 1.1) return "Completed near estimate";
  return "Completed over estimate";
}

export function needsEstimateForScheduling(task: Pick<TaskRecord, "status" | "dueDate" | "estimatedMinutes">): boolean {
  return task.estimatedMinutes === undefined && (
    Boolean(task.dueDate) ||
    task.status === "planned" ||
    task.status === "in-progress"
  );
}

export function tasksMissingEstimates(tasks: TaskRecord[]): TaskRecord[] {
  return tasks.filter((task) => task.status !== "archived" && task.status !== "completed" && task.estimatedMinutes === undefined);
}

export function planningEffortSummary(tasks: TaskRecord[]): PlanningEffortSummary {
  const active = tasks.filter((task) => task.status !== "archived" && task.status !== "completed");
  const categoryMinutes = { school: 0, career: 0, portfolio: 0 };
  let totalMinutes = 0;
  let missingEstimateCount = 0;
  for (const task of active) {
    if (task.estimatedMinutes === undefined) missingEstimateCount += 1;
    else {
      totalMinutes += task.estimatedMinutes;
      if (task.category === "school" || task.category === "career" || task.category === "portfolio") {
        categoryMinutes[task.category as Extract<TaskCategory, "school" | "career" | "portfolio">] += task.estimatedMinutes;
      }
    }
  }
  return { totalMinutes, categoryMinutes, missingEstimateCount };
}

export function effortPatch(effort: TaskEffort): Pick<TaskRecord, "estimatedMinutes" | "actualMinutes" | "isSplittable" | "minimumSessionMinutes" | "maximumSessionMinutes"> {
  const validation = validateTaskEffort(effort);
  if (validation.errors.length) throw new Error(validation.errors.join(" "));
  return {
    estimatedMinutes: effort.estimatedMinutes,
    actualMinutes: effort.actualMinutes,
    isSplittable: effort.isSplittable,
    minimumSessionMinutes: effort.isSplittable ? effort.minimumSessionMinutes : undefined,
    maximumSessionMinutes: effort.isSplittable ? effort.maximumSessionMinutes : undefined,
  };
}
