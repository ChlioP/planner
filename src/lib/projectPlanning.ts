import { assessActiveTaskRisks, type RiskContext } from "./riskAssessment";
import { updateTask, type TaskRecord } from "./taskHistory";
import type { TaskSession } from "./taskSessions";
import type { ScheduleBlock, SchedulingOptions, SchedulingResult } from "./scheduleBlocks";
import { scheduleWork } from "./scheduleBlocks";
import { localDateToDate } from "./localDateTime";

export const PROJECT_SCHEMA_VERSION = 1 as const;
export type GoalStatus = "not-started" | "active" | "paused" | "completed" | "archived";
export type ProjectStatus = "planning" | "active" | "paused" | "completed" | "archived";
export type MilestoneStatus = "not-started" | "in-progress" | "completed" | "skipped" | "archived";
export interface Goal {
  schemaVersion: 1; id: string; userId?: string; title: string; description?: string; status: GoalStatus;
  timeframe: "no-deadline" | "date-range" | "target-date"; startDate?: string; targetDate?: string; successDefinition?: string;
  progressMode: "project-completion" | "milestone-completion" | "manual"; manualProgressPercent?: number;
  color?: string; icon?: string; createdAt: string; updatedAt: string; completedAt?: string; archivedAt?: string;
}
export interface Project {
  schemaVersion: 1; id: string; userId?: string; goalId?: string; title: string; description?: string; status: ProjectStatus;
  startDate?: string; targetDate?: string; priority: "low" | "medium" | "high" | "critical";
  progressMode: "task-completion" | "milestone-completion" | "effort-weighted" | "manual"; manualProgressPercent?: number;
  color?: string; icon?: string; createdAt: string; updatedAt: string; completedAt?: string; archivedAt?: string;
}
export interface Milestone {
  schemaVersion: 1; id: string; userId?: string; projectId: string; title: string; description?: string; status: MilestoneStatus;
  targetDate?: string; completedAt?: string; order: number; progressMode: "task-completion" | "effort-weighted" | "manual";
  manualProgressPercent?: number; createdAt: string; updatedAt: string; archivedAt?: string;
}
export interface TaskDependency {
  schemaVersion: 1; id: string; userId?: string; projectId: string; predecessorTaskId: string; successorTaskId: string;
  type: "finish-to-start"; createdAt: string; updatedAt: string;
}
export interface ProgressResult { percent: number; numerator: number; denominator: number; state: "calculated" | "manual" | "empty"; warnings: string[]; label: string }
export interface ProjectHealthAssessment {
  projectId: string; status: "missing-data" | "on-track" | "needs-attention" | "at-risk" | "overdue" | "completed" | "paused";
  progressPercent: number; remainingTaskCount: number; remainingEstimatedMinutes?: number; scheduledMinutes?: number;
  unscheduledMinutes?: number; availableMinutesBeforeTarget?: number; overdueTaskCount: number; atRiskTaskCount: number;
  conflictCount: number; incompleteMilestoneCount: number; reasons: string[]; recommendations: string[];
}
export interface GoalSummary { goalId: string; progress: ProgressResult; activeProjects: number; completedProjects: number; atRiskProjects: number; nextMilestone?: Milestone; remainingKnownMinutes: number; largestIssue?: string }
export interface DateAlignmentWarning { id: string; type: "task-after-project" | "milestone-after-project" | "task-before-project" | "milestone-before-project" | "goal-before-project"; message: string; taskId?: string; milestoneId?: string; projectId: string; goalId?: string }

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
function validateDate(value?: string) { if (value && (!isoDate.test(value) || Number.isNaN(localDateToDate(value).getTime()))) throw new Error("Dates must use valid YYYY-MM-DD values."); }
function validatePercent(value?: number) { if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100)) throw new Error("Manual progress must be between 0 and 100."); }
function requiredTitle(value: unknown) { if (typeof value !== "string" || !value.trim()) throw new Error("A title is required."); return value.trim(); }
function dates(start?: string, target?: string) { validateDate(start); validateDate(target); if (start && target && start > target) throw new Error("Start date cannot be after target date."); }
const timestamp = (value: unknown) => typeof value === "string" ? value : "1970-01-01T00:00:00.000Z";

export function createGoal(input: Partial<Goal> & Pick<Goal, "title">, now = new Date().toISOString()): Goal {
  const title = requiredTitle(input.title); dates(input.startDate, input.targetDate); validatePercent(input.manualProgressPercent);
  return { schemaVersion: 1, id: input.id ?? crypto.randomUUID(), userId: input.userId, title, description: input.description, status: input.status ?? "not-started", timeframe: input.timeframe ?? (input.targetDate ? "target-date" : "no-deadline"), startDate: input.startDate, targetDate: input.targetDate, successDefinition: input.successDefinition, progressMode: input.progressMode ?? "project-completion", manualProgressPercent: input.manualProgressPercent, color: input.color, icon: input.icon, createdAt: input.createdAt ?? now, updatedAt: now, completedAt: input.status === "completed" ? input.completedAt ?? now : undefined, archivedAt: input.status === "archived" ? input.archivedAt ?? now : undefined };
}
export function createProject(input: Partial<Project> & Pick<Project, "title">, now = new Date().toISOString()): Project {
  const title = requiredTitle(input.title); dates(input.startDate, input.targetDate); validatePercent(input.manualProgressPercent);
  return { schemaVersion: 1, id: input.id ?? crypto.randomUUID(), userId: input.userId, goalId: input.goalId, title, description: input.description, status: input.status ?? "planning", startDate: input.startDate, targetDate: input.targetDate, priority: input.priority ?? "medium", progressMode: input.progressMode ?? "task-completion", manualProgressPercent: input.manualProgressPercent, color: input.color, icon: input.icon, createdAt: input.createdAt ?? now, updatedAt: now, completedAt: input.status === "completed" ? input.completedAt ?? now : undefined, archivedAt: input.status === "archived" ? input.archivedAt ?? now : undefined };
}
export function createMilestone(input: Partial<Milestone> & Pick<Milestone, "projectId" | "title">, now = new Date().toISOString()): Milestone {
  const title = requiredTitle(input.title); validateDate(input.targetDate); validatePercent(input.manualProgressPercent);
  if (!input.projectId) throw new Error("A milestone requires a project.");
  return { schemaVersion: 1, id: input.id ?? crypto.randomUUID(), userId: input.userId, projectId: input.projectId, title, description: input.description, status: input.status ?? "not-started", targetDate: input.targetDate, completedAt: input.status === "completed" ? input.completedAt ?? now : undefined, order: Number.isInteger(input.order) && input.order! >= 0 ? input.order! : 0, progressMode: input.progressMode ?? "task-completion", manualProgressPercent: input.manualProgressPercent, createdAt: input.createdAt ?? now, updatedAt: now, archivedAt: input.status === "archived" ? input.archivedAt ?? now : undefined };
}
export function migrateGoals(value: unknown) { if (!Array.isArray(value)) return []; return value.map((item) => createGoal(item as Goal, timestamp((item as Goal).updatedAt))); }
export function migrateProjects(value: unknown) { if (!Array.isArray(value)) return []; return value.map((item) => createProject(item as Project, timestamp((item as Project).updatedAt))); }
export function migrateMilestones(value: unknown) { if (!Array.isArray(value)) return []; return value.map((item) => createMilestone(item as Milestone, timestamp((item as Milestone).updatedAt))); }
export function migrateDependencies(value: unknown): TaskDependency[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const value = item as TaskDependency;
    if (!value.id || !value.projectId || !value.predecessorTaskId || !value.successorTaskId || value.predecessorTaskId === value.successorTaskId) throw new Error("Invalid task dependency.");
    return { ...value, schemaVersion: 1, type: "finish-to-start", createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt) };
  });
}
export function mergePlanningRecords<T extends { id: string; updatedAt: string }>(a: T[], b: T[]) { const map = new Map(a.map((item) => [item.id, item])); for (const item of b) { const old = map.get(item.id); if (!old || item.updatedAt > old.updatedAt) map.set(item.id, item); } return [...map.values()]; }

function eligibleTasks(tasks: TaskRecord[], projectId?: string, milestoneId?: string) { return tasks.filter((task) => task.status !== "archived" && (!projectId || task.projectId === projectId) && (!milestoneId || task.milestoneId === milestoneId)); }
function taskProgress(task: TaskRecord, sessions: TaskSession[]) {
  if (task.status === "completed") return 1;
  const linked = sessions.filter((item) => item.parentTaskId === task.id && item.status !== "archived");
  if (!linked.length) return 0;
  const total = linked.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  return total ? linked.filter((item) => item.status === "completed").reduce((sum, item) => sum + item.estimatedMinutes, 0) / total : 0;
}
function taskProgressResult(tasks: TaskRecord[], sessions: TaskSession[], mode: "task-completion" | "effort-weighted" | "manual", manual?: number): ProgressResult {
  if (mode === "manual") return { percent: Math.max(0, Math.min(100, manual ?? 0)), numerator: manual ?? 0, denominator: 100, state: "manual", warnings: [], label: "Manual progress" };
  if (!tasks.length) return { percent: 0, numerator: 0, denominator: 0, state: "empty", warnings: [], label: "No tasks yet" };
  if (mode === "task-completion") {
    const numerator = tasks.reduce((sum, task) => sum + taskProgress(task, sessions), 0);
    return { percent: Math.min(100, numerator / tasks.length * 100), numerator, denominator: tasks.length, state: "calculated", warnings: [], label: "Task completion" };
  }
  const estimated = tasks.filter((task) => task.estimatedMinutes !== undefined);
  const missing = tasks.length - estimated.length;
  const denominator = estimated.reduce((sum, task) => sum + task.estimatedMinutes!, 0);
  const numerator = estimated.reduce((sum, task) => sum + task.estimatedMinutes! * taskProgress(task, sessions), 0);
  return { percent: denominator ? Math.min(100, numerator / denominator * 100) : 0, numerator, denominator, state: denominator ? "calculated" : "empty", warnings: missing ? [`${missing} task${missing === 1 ? "" : "s"} without estimates are excluded from effort weighting.`] : [], label: "Effort-weighted progress" };
}
export function milestoneProgress(milestone: Milestone, tasks: TaskRecord[], sessions: TaskSession[]) {
  if (milestone.status === "completed") return { percent: 100, numerator: 1, denominator: 1, state: "calculated" as const, warnings: [], label: "Milestone completed" };
  return taskProgressResult(eligibleTasks(tasks, undefined, milestone.id), sessions, milestone.progressMode, milestone.manualProgressPercent);
}
export function projectProgress(project: Project, milestones: Milestone[], tasks: TaskRecord[], sessions: TaskSession[]): ProgressResult {
  if (project.progressMode === "manual") return taskProgressResult([], sessions, "manual", project.manualProgressPercent);
  if (project.progressMode === "milestone-completion") {
    const eligible = milestones.filter((item) => item.projectId === project.id && item.status !== "archived" && item.status !== "skipped");
    if (!eligible.length) return { percent: 0, numerator: 0, denominator: 0, state: "empty", warnings: [], label: "No milestones yet" };
    const complete = eligible.filter((item) => item.status === "completed").length;
    return { percent: complete / eligible.length * 100, numerator: complete, denominator: eligible.length, state: "calculated", warnings: [], label: "Milestone completion" };
  }
  return taskProgressResult(eligibleTasks(tasks, project.id), sessions, project.progressMode, project.manualProgressPercent);
}
export function goalProgress(goal: Goal, projects: Project[], milestones: Milestone[]): ProgressResult {
  if (goal.progressMode === "manual") return { percent: goal.manualProgressPercent ?? 0, numerator: goal.manualProgressPercent ?? 0, denominator: 100, state: "manual", warnings: [], label: "Manual progress" };
  const eligibleProjects = projects.filter((item) => item.goalId === goal.id && item.status !== "archived");
  if (goal.progressMode === "project-completion") {
    if (!eligibleProjects.length) return { percent: 0, numerator: 0, denominator: 0, state: "empty", warnings: [], label: "No projects yet" };
    const complete = eligibleProjects.filter((item) => item.status === "completed").length;
    return { percent: complete / eligibleProjects.length * 100, numerator: complete, denominator: eligibleProjects.length, state: "calculated", warnings: [], label: "Project completion" };
  }
  const projectIds = new Set(eligibleProjects.map((item) => item.id));
  const eligible = milestones.filter((item) => projectIds.has(item.projectId) && item.status !== "archived" && item.status !== "skipped");
  if (!eligible.length) return { percent: 0, numerator: 0, denominator: 0, state: "empty", warnings: [], label: "No milestones yet" };
  const complete = eligible.filter((item) => item.status === "completed").length;
  return { percent: complete / eligible.length * 100, numerator: complete, denominator: eligible.length, state: "calculated", warnings: [], label: "Milestone completion" };
}

export function assignTask(task: TaskRecord, projectId: string | undefined, milestoneId: string | undefined, milestones: Milestone[], now = new Date().toISOString()) {
  if (milestoneId) {
    const milestone = milestones.find((item) => item.id === milestoneId);
    if (!milestone || milestone.projectId !== projectId) throw new Error("The selected milestone does not belong to this project.");
  }
  let next = updateTask(task, "projectId", projectId, now);
  next = updateTask(next, "milestoneId", projectId ? milestoneId : undefined, now);
  return next;
}
export function bulkAssignTasks(tasks: TaskRecord[], taskIds: string[], projectId: string | undefined, milestoneId: string | undefined, milestones: Milestone[], now = new Date().toISOString()) {
  const selected = new Set(taskIds), failures: Array<{ taskId: string; message: string }> = [];
  const existingIds = new Set(tasks.map((task) => task.id));
  for (const taskId of selected) {
    if (!existingIds.has(taskId)) failures.push({ taskId, message: "The task no longer exists." });
  }
  const next = tasks.map((task) => {
    if (!selected.has(task.id)) return task;
    try { return assignTask(task, projectId, milestoneId, milestones, now); }
    catch (error) { failures.push({ taskId: task.id, message: error instanceof Error ? error.message : "Assignment failed." }); return task; }
  });
  return { tasks: next, appliedCount: taskIds.length - failures.length, failures };
}

export function topologicalTaskOrder(projectId: string, tasks: TaskRecord[], dependencies: TaskDependency[]): string[] {
  const ids = tasks.filter((item) => item.projectId === projectId).map((item) => item.id).sort();
  const indegree = new Map(ids.map((id) => [id, 0])); const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  for (const dep of dependencies.filter((item) => item.projectId === projectId)) {
    if (!indegree.has(dep.predecessorTaskId) || !indegree.has(dep.successorTaskId)) continue;
    outgoing.get(dep.predecessorTaskId)!.push(dep.successorTaskId); indegree.set(dep.successorTaskId, indegree.get(dep.successorTaskId)! + 1);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0).sort(), result: string[] = [];
  while (queue.length) { const id = queue.shift()!; result.push(id); for (const next of outgoing.get(id)!.sort()) { indegree.set(next, indegree.get(next)! - 1); if (indegree.get(next) === 0) { queue.push(next); queue.sort(); } } }
  if (result.length !== ids.length) throw new Error("Task dependencies contain a circular path.");
  return result;
}
export function createDependency(input: Omit<TaskDependency, "schemaVersion" | "createdAt" | "updatedAt">, tasks: TaskRecord[], existing: TaskDependency[], now = new Date().toISOString()): TaskDependency {
  if (input.predecessorTaskId === input.successorTaskId) throw new Error("A task cannot depend on itself.");
  const predecessor = tasks.find((item) => item.id === input.predecessorTaskId), successor = tasks.find((item) => item.id === input.successorTaskId);
  if (!predecessor || !successor || predecessor.projectId !== input.projectId || successor.projectId !== input.projectId) throw new Error("Both tasks must belong to the same project.");
  if (existing.some((item) => item.projectId === input.projectId && item.predecessorTaskId === input.predecessorTaskId && item.successorTaskId === input.successorTaskId)) throw new Error("This dependency already exists.");
  const draft: TaskDependency = { ...input, schemaVersion: 1, type: "finish-to-start", createdAt: now, updatedAt: now };
  topologicalTaskOrder(input.projectId, tasks, [...existing, draft]);
  return draft;
}
export function unmetPredecessors(taskId: string, tasks: TaskRecord[], dependencies: TaskDependency[]) {
  const taskMap = new Map(tasks.map((item) => [item.id, item]));
  return dependencies.filter((item) => item.successorTaskId === taskId).map((item) => taskMap.get(item.predecessorTaskId)).filter((item): item is TaskRecord => Boolean(item && item.status !== "completed"));
}
export function dependencyExplanation(taskId: string, tasks: TaskRecord[], dependencies: TaskDependency[]) {
  const unmet = unmetPredecessors(taskId, tasks, dependencies);
  return unmet.length ? `${unmet.length} predecessor task${unmet.length === 1 ? " is" : "s are"} incomplete: ${unmet.map((item) => item.title).join(", ")}.` : "All predecessor tasks are complete.";
}
export function scheduleWithDependencies(tasks: TaskRecord[], sessions: TaskSession[], availability: Parameters<typeof scheduleWork>[2], overrides: Parameters<typeof scheduleWork>[3], blocks: ScheduleBlock[], options: SchedulingOptions, dependencies: TaskDependency[], strict: boolean): SchedulingResult {
  if (!strict) {
    const result = scheduleWork(tasks, sessions, availability, overrides, blocks, options);
    const warnings = result.proposedBlocks.flatMap((block) => unmetPredecessors(block.taskId, tasks, dependencies).length ? [`${block.title}: ${dependencyExplanation(block.taskId, tasks, dependencies)}`] : []);
    return { ...result, warnings: [...new Set([...result.warnings, ...warnings])] };
  }
  const blocked = new Set(tasks.filter((task) => unmetPredecessors(task.id, tasks, dependencies).some((predecessor) => {
    const final = blocks.filter((block) => block.taskId === predecessor.id && block.status === "confirmed").sort((a, b) => `${b.date}${b.endTime}`.localeCompare(`${a.date}${a.endTime}`))[0];
    return !final;
  })).map((task) => task.id));
  const allowed = tasks.filter((task) => !blocked.has(task.id));
  const result = scheduleWork(allowed, sessions, availability, overrides, blocks, options);
  const extra = tasks.filter((task) => blocked.has(task.id) && options.selectedTaskIds.includes(task.id)).map((task) => ({ taskId: task.id, title: task.title, remainingMinutes: task.estimatedMinutes ?? 0, reason: dependencyExplanation(task.id, tasks, dependencies) }));
  return { ...result, unscheduledWork: [...result.unscheduledWork, ...extra], warnings: [...result.warnings, ...extra.map((item) => `${item.title} remains unscheduled because a predecessor has no confirmed completion time.`)] };
}

export function projectHealth(project: Project, milestones: Milestone[], tasks: TaskRecord[], sessions: TaskSession[], riskContext: Omit<RiskContext, "tasks" | "sessions">): ProjectHealthAssessment {
  const linked = eligibleTasks(tasks, project.id), progress = projectProgress(project, milestones, tasks, sessions);
  const remaining = linked.filter((item) => item.status !== "completed"), missing = remaining.filter((item) => item.estimatedMinutes === undefined);
  const risks = assessActiveTaskRisks({ ...riskContext, tasks: linked, sessions });
  const atRisk = risks.filter((item) => item.status === "at-risk" || item.status === "overdue");
  const scheduled = risks.reduce((sum, item) => sum + (item.scheduledMinutes ?? 0), 0);
  const unscheduled = risks.reduce((sum, item) => sum + (item.unscheduledMinutes ?? 0), 0);
  const remainingMinutes = missing.length ? undefined : remaining.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
  const incompleteMilestones = milestones.filter((item) => item.projectId === project.id && !["completed", "skipped", "archived"].includes(item.status));
  let status: ProjectHealthAssessment["status"] = "on-track"; const reasons: string[] = [], recommendations: string[] = [];
  if (project.status === "completed") status = "completed";
  else if (project.status === "paused") status = "paused";
  else if (!linked.length) { status = "missing-data"; reasons.push("This project has no tasks yet."); recommendations.push("Add or assign a task."); }
  else if (project.targetDate && project.targetDate < riskContext.today) { status = "overdue"; reasons.push(`The project target date ${project.targetDate} has passed.`); recommendations.push("Review the project target and remaining work."); }
  else if (atRisk.length || incompleteMilestones.some((item) => item.targetDate && item.targetDate < riskContext.today)) { status = "at-risk"; reasons.push(`${atRisk.length} task${atRisk.length === 1 ? " is" : "s are"} currently at risk or overdue.`); recommendations.push("Review task risks and unscheduled work."); }
  else if (missing.length) { status = "missing-data"; reasons.push(`${missing.length} incomplete task${missing.length === 1 ? " needs" : "s need"} an estimate.`); recommendations.push("Add estimates to assess feasibility."); }
  else if (unscheduled > 0) { status = "needs-attention"; reasons.push(`${unscheduled} minutes remain unscheduled.`); recommendations.push("Plan remaining project work."); }
  else reasons.push("Known project work currently fits the available plan.");
  return { projectId: project.id, status, progressPercent: progress.percent, remainingTaskCount: remaining.length, remainingEstimatedMinutes: remainingMinutes, scheduledMinutes: scheduled, unscheduledMinutes: unscheduled, availableMinutesBeforeTarget: project.targetDate ? Math.max(0, ...risks.map((item) => item.availableMinutesBeforeDeadline ?? 0)) : undefined, overdueTaskCount: risks.filter((item) => item.status === "overdue").length, atRiskTaskCount: atRisk.length, conflictCount: risks.filter((item) => (item.conflictedMinutes ?? 0) > 0).length, incompleteMilestoneCount: incompleteMilestones.length, reasons, recommendations };
}
export function goalSummary(goal: Goal, projects: Project[], milestones: Milestone[], health: ProjectHealthAssessment[], tasks: TaskRecord[]): GoalSummary {
  const linked = projects.filter((item) => item.goalId === goal.id), ids = new Set(linked.map((item) => item.id));
  const nextMilestone = milestones.filter((item) => ids.has(item.projectId) && item.status !== "completed" && item.targetDate).sort((a, b) => a.targetDate!.localeCompare(b.targetDate!) || a.order - b.order || a.id.localeCompare(b.id))[0];
  const issues = health.filter((item) => ids.has(item.projectId) && ["at-risk", "overdue"].includes(item.status));
  return { goalId: goal.id, progress: goalProgress(goal, projects, milestones), activeProjects: linked.filter((item) => item.status === "active").length, completedProjects: linked.filter((item) => item.status === "completed").length, atRiskProjects: issues.length, nextMilestone, remainingKnownMinutes: tasks.filter((item) => item.projectId && ids.has(item.projectId) && item.status !== "completed").reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0), largestIssue: issues[0]?.reasons[0] };
}
export function dateAlignmentWarnings(project: Project, goal: Goal | undefined, milestones: Milestone[], tasks: TaskRecord[]): DateAlignmentWarning[] {
  const warnings: DateAlignmentWarning[] = [];
  for (const task of tasks.filter((item) => item.projectId === project.id)) {
    if (project.targetDate && task.dueDate && task.dueDate > project.targetDate) warnings.push({ id: `task-after-${task.id}-${project.targetDate}`, type: "task-after-project", projectId: project.id, taskId: task.id, message: `${task.title} is due ${task.dueDate}, after the project target ${project.targetDate}.` });
    if (project.startDate && task.dueDate && task.dueDate < project.startDate) warnings.push({ id: `task-before-${task.id}-${project.startDate}`, type: "task-before-project", projectId: project.id, taskId: task.id, message: `${task.title} is due ${task.dueDate}, before the project starts ${project.startDate}.` });
  }
  for (const milestone of milestones.filter((item) => item.projectId === project.id)) {
    if (project.targetDate && milestone.targetDate && milestone.targetDate > project.targetDate) warnings.push({ id: `milestone-after-${milestone.id}-${project.targetDate}`, type: "milestone-after-project", projectId: project.id, milestoneId: milestone.id, message: `${milestone.title} targets ${milestone.targetDate}, after the project target ${project.targetDate}.` });
    if (project.startDate && milestone.targetDate && milestone.targetDate < project.startDate) warnings.push({ id: `milestone-before-${milestone.id}-${project.startDate}`, type: "milestone-before-project", projectId: project.id, milestoneId: milestone.id, message: `${milestone.title} targets ${milestone.targetDate}, before the project starts ${project.startDate}.` });
  }
  if (goal?.targetDate && project.targetDate && project.targetDate > goal.targetDate) warnings.push({ id: `goal-before-${goal.id}-${project.id}`, type: "goal-before-project", projectId: project.id, goalId: goal.id, message: `${project.title} targets ${project.targetDate}, after the goal target ${goal.targetDate}.` });
  return warnings;
}
export function reorderMilestone(items: Milestone[], milestoneId: string, direction: -1 | 1, now = new Date().toISOString()) {
  const target = items.find((item) => item.id === milestoneId); if (!target) return items;
  const projectItems = items.filter((item) => item.projectId === target.projectId).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const index = projectItems.findIndex((item) => item.id === milestoneId), other = projectItems[index + direction]; if (!other) return items;
  return items.map((item) => item.id === target.id ? { ...item, order: other.order, updatedAt: now } : item.id === other.id ? { ...item, order: target.order, updatedAt: now } : item);
}
