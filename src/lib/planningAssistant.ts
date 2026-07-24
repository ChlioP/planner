import { assessActiveTaskRisks, type TaskRiskAssessment } from "./riskAssessment";
import { scheduleWork, type ScheduleBlock, type SchedulingOptions, type SchedulingResult } from "./scheduleBlocks";
import { createTask, updateTask, type TaskCategory, type TaskPriority, type TaskRecord } from "./taskHistory";
import { createTaskSession, sessionsForParent, type TaskSession } from "./taskSessions";
import { createReminder, type Reminder } from "./notifications";
import type { AvailabilityBlock, AvailabilityOverride } from "./availability";
import type { TimeLog } from "./timeLogs";
import type { ExternalCalendarEvent } from "./calendarIntegration";
import { localDateFromDate } from "./localDateTime";

export const AI_ASSISTANT_SCHEMA_VERSION = 1 as const;
export const AI_LIMITS = { messageCharacters: 2_000, relevantTasks: 50, historyMessages: 20, descriptionCharacters: 500, repairRetries: 1 } as const;
export type AssistantIntent = "planner-summary" | "today-plan" | "week-plan" | "task-prioritization" | "task-breakdown" | "estimate-help" | "schedule-proposal" | "reschedule-proposal" | "risk-explanation" | "conflict-explanation" | "availability-explanation" | "analytics-summary" | "deadline-review" | "task-create-proposal" | "task-update-proposal" | "session-create-proposal" | "reminder-create-proposal" | "recurring-task-create-proposal" | "recurrence-explanation" | "routine-template-proposal" | "future-occurrence-review" | "recurring-work-schedule-proposal" | "recurrence-edit-proposal" | "unknown";

export interface AIAssistantSettings {
  schemaVersion: 1; id: "aiAssistant"; userId?: string; isEnabled: boolean; modelProvider?: string; modelName?: string;
  allowTaskTitles: boolean; allowTaskDescriptions: boolean; allowTaskNotes: boolean; allowCategoryNames: boolean;
  allowDeadlineData: boolean; allowEstimateData: boolean; allowScheduleData: boolean; allowAvailabilityData: boolean;
  allowTimeTrackingData: boolean; allowAnalyticsSummary: boolean; allowRiskSummary: boolean; allowCalendarEventTitles: boolean;
  conversationHistoryEnabled: boolean; maximumHistoryMessages: number; defaultResponseDetail: "concise" | "standard" | "detailed";
  confirmationRequiredForAllChanges: true; createdAt: string; updatedAt: string;
}
export const DEFAULT_AI_SETTINGS: AIAssistantSettings = {
  schemaVersion: 1, id: "aiAssistant", isEnabled: false, allowTaskTitles: false, allowTaskDescriptions: false,
  allowTaskNotes: false, allowCategoryNames: false, allowDeadlineData: false, allowEstimateData: false,
  allowScheduleData: false, allowAvailabilityData: false, allowTimeTrackingData: false, allowAnalyticsSummary: false,
  allowRiskSummary: false, allowCalendarEventTitles: false, conversationHistoryEnabled: false, maximumHistoryMessages: 20,
  defaultResponseDetail: "standard", confirmationRequiredForAllChanges: true,
  createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
};
export function migrateAISettings(value: unknown): AIAssistantSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_AI_SETTINGS };
  const item = value as Partial<AIAssistantSettings>;
  return { ...DEFAULT_AI_SETTINGS, ...item, schemaVersion: 1, id: "aiAssistant", isEnabled: item.isEnabled === true, confirmationRequiredForAllChanges: true, maximumHistoryMessages: Math.min(50, Math.max(1, Number(item.maximumHistoryMessages) || 20)), createdAt: typeof item.createdAt === "string" ? item.createdAt : DEFAULT_AI_SETTINGS.createdAt, updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : DEFAULT_AI_SETTINGS.updatedAt };
}

export interface AssistantRequest {
  schemaVersion: 1; id: string; userId?: string; message: string; intent?: AssistantIntent;
  context: { currentRoute?: string; selectedTaskId?: string; selectedSessionId?: string; selectedScheduleBlockId?: string; selectedDate?: string; selectedDateRange?: { startDate: string; endDate: string } };
  dataPermissionsSnapshot: { taskTitles: boolean; taskDescriptions: boolean; taskNotes: boolean; deadlines: boolean; estimates: boolean; schedule: boolean; availability: boolean; timeTracking: boolean; analytics: boolean; risk: boolean; calendarTitles: boolean };
  createdAt: string;
}
export interface PlannerDataCitation { type: "task" | "session" | "schedule-block" | "availability" | "risk-assessment" | "analytics-summary" | "time-log" | "calendar-event" | "planner-rule"; entityAlias?: string; label: string; detail?: string }
export type AssistantAction =
  | { type: "create-task"; temporaryId: string; title: string; description?: string; categoryId?: string; priority?: TaskPriority; dueDate?: string; estimatedMinutes?: number; isSplittable?: boolean; sourceExplanation: string }
  | { type: "update-task"; taskAlias: string; changes: { title?: string; description?: string; categoryId?: string; priority?: TaskPriority; dueDate?: string; estimatedMinutes?: number; isSplittable?: boolean }; reason: string }
  | { type: "create-session"; parentTaskAlias: string; sessions: Array<{ temporaryId: string; title: string; estimatedMinutes: number; order: number; notes?: string }>; totalEstimatedMinutes: number; reasoning: string }
  | { type: "create-schedule-preview"; taskAliases: string[]; options: Omit<SchedulingOptions, "selectedTaskIds" | "runId" | "now"> }
  | { type: "create-reminder"; taskAlias?: string; title: string; dateTime: string; note?: string };
export interface AssistantProposal {
  schemaVersion: 1; id: string; status: "draft" | "awaiting-confirmation" | "partially-applied" | "applied" | "rejected" | "expired" | "failed";
  summary: string; actions: AssistantAction[]; warnings: string[]; assumptions: string[]; basedOnPlannerVersion?: string;
  expiresAt?: string; createdAt: string; updatedAt: string;
}
export interface AssistantResponse {
  schemaVersion: 1; id: string; requestId: string; type: "answer" | "clarification" | "proposal" | "error" | "insufficient-data";
  message: string; citations: PlannerDataCitation[]; assumptions: string[]; limitations: string[]; proposal?: AssistantProposal; createdAt: string;
}
export interface AssistantConversationMessage { id: string; role: "user" | "assistant"; text: string; request?: AssistantRequest; response?: AssistantResponse; createdAt: string }
export interface AIAssistantActionAudit {
  schemaVersion: 1; id: string; userId?: string; requestId: string; responseId: string; proposalId: string;
  actionType: AssistantAction["type"]; targetAliases: string[]; status: "approved" | "rejected" | "applied" | "failed" | "expired";
  summary: string; approvedAt?: string; appliedAt?: string; errorCode?: string; errorMessage?: string; createdAt: string; updatedAt: string;
}
export function migrateAssistantMessages(value: unknown): AssistantConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AssistantConversationMessage => Boolean(item && typeof item === "object" && typeof (item as AssistantConversationMessage).id === "string" && ["user", "assistant"].includes((item as AssistantConversationMessage).role) && typeof (item as AssistantConversationMessage).text === "string" && typeof (item as AssistantConversationMessage).createdAt === "string")).slice(-50);
}
export function migrateAssistantAudits(value: unknown): AIAssistantActionAudit[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AIAssistantActionAudit => Boolean(item && typeof item === "object" && typeof (item as AIAssistantActionAudit).id === "string" && typeof (item as AIAssistantActionAudit).proposalId === "string" && typeof (item as AIAssistantActionAudit).createdAt === "string"));
}
export function mergeAssistantRecords<T extends { id: string; updatedAt?: string; createdAt: string }>(a: T[], b: T[]) {
  const map = new Map(a.map((item) => [item.id, item]));
  for (const item of b) { const old = map.get(item.id); if (!old || (item.updatedAt ?? item.createdAt) > (old.updatedAt ?? old.createdAt)) map.set(item.id, item); }
  return [...map.values()];
}

export interface AssistantPlannerState {
  tasks: TaskRecord[]; sessions: TaskSession[]; availability: AvailabilityBlock[]; overrides: AvailabilityOverride[];
  scheduleBlocks: ScheduleBlock[]; timeLogs: TimeLog[]; reminders: Reminder[]; externalEvents: ExternalCalendarEvent[];
  currentRoute?: string; selectedTaskId?: string; today: string; currentTime: string; plannerVersion: string;
}
export interface SanitizedAssistantPrompt {
  schemaVersion: 1; requestId: string; userMessage: string; intent: AssistantIntent; localDate: string; timezone: string;
  facts: { tasks: Array<Record<string, unknown>>; sessions: Array<Record<string, unknown>>; scheduleBlocks: Array<Record<string, unknown>>; availability: Array<Record<string, unknown>>; risks: Array<Record<string, unknown>>; calendarEvents: Array<Record<string, unknown>> };
  aliasMap: Record<string, { type: "task" | "session" | "schedule-block"; id: string }>;
  calculated: { risks: TaskRiskAssessment[] }; prohibitedActions: string[]; allowedActionTypes: AssistantAction["type"][];
}
export interface ProviderAssistantResult { response: AssistantResponse }
export interface PlanningAssistantProvider { generateResponse(request: SanitizedAssistantPrompt): Promise<ProviderAssistantResult> }

export function classifyAssistantIntent(message: string): AssistantIntent {
  const value = message.toLowerCase();
  if (/(delete all|clear history|connect google|browser permission)/.test(value)) return "unknown";
  if (/(every day|every weekday|every (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|recurring task|repeat this)/.test(value)) return "recurring-task-create-proposal";
  if (/(explain|what).*(recurrence|repeating|routine)/.test(value)) return "recurrence-explanation";
  if (/(edit|change).*(recurrence|series|routine)/.test(value)) return "recurrence-edit-proposal";
  if (/(why|explain).*(risk|at risk)/.test(value)) return "risk-explanation";
  if (/(break|split).*(session|task|essay|assignment|interview)/.test(value)) return "task-breakdown";
  if (/(estimate|how long)/.test(value)) return "estimate-help";
  if (/(schedule|find time|plan work)/.test(value)) return "schedule-proposal";
  if (/(move|reschedule|replan)/.test(value)) return "reschedule-proposal";
  if (/(today|focus first|work on first)/.test(value)) return "today-plan";
  if (/(week|this week)/.test(value)) return "week-plan";
  if (/(priority|prioritize|most important)/.test(value)) return "task-prioritization";
  if (/(analytics|tracked|estimate accuracy|category.*time)/.test(value)) return "analytics-summary";
  if (/(deadline|due)/.test(value)) return "deadline-review";
  if (/(summary|workload|planner)/.test(value)) return "planner-summary";
  if (/(remind|reminder)/.test(value)) return "reminder-create-proposal";
  return "unknown";
}
function permissions(settings: AIAssistantSettings): AssistantRequest["dataPermissionsSnapshot"] {
  return { taskTitles: settings.allowTaskTitles, taskDescriptions: settings.allowTaskDescriptions, taskNotes: settings.allowTaskNotes, deadlines: settings.allowDeadlineData, estimates: settings.allowEstimateData, schedule: settings.allowScheduleData, availability: settings.allowAvailabilityData, timeTracking: settings.allowTimeTrackingData, analytics: settings.allowAnalyticsSummary, risk: settings.allowRiskSummary, calendarTitles: settings.allowCalendarEventTitles };
}
function stableAlias(prefix: string, index: number) { return `${prefix}-${index + 1}`; }
export function plannerVersion(state: Pick<AssistantPlannerState, "tasks" | "sessions" | "scheduleBlocks" | "availability">) {
  return [state.tasks, state.sessions, state.scheduleBlocks, state.availability].flat().map((item) => `${item.id}:${item.updatedAt}`).sort().join("|");
}
export function buildSanitizedPrompt(message: string, settings: AIAssistantSettings, state: AssistantPlannerState, requestId: string = crypto.randomUUID()): { request: AssistantRequest; prompt: SanitizedAssistantPrompt } {
  if (!settings.isEnabled) throw new Error("Enable AI assistance before sharing planner data.");
  if (!message.trim() || message.length > AI_LIMITS.messageCharacters) throw new Error(`Message must contain 1–${AI_LIMITS.messageCharacters} characters.`);
  const snapshot = permissions(settings), intent = classifyAssistantIntent(message), aliasMap: SanitizedAssistantPrompt["aliasMap"] = {};
  const relevantTasks = state.tasks.filter((task) => task.status !== "archived").sort((a, b) => Number(b.id === state.selectedTaskId) - Number(a.id === state.selectedTaskId)).slice(0, AI_LIMITS.relevantTasks);
  const tasks = relevantTasks.map((task, index) => {
    const alias = stableAlias("task", index); aliasMap[alias] = { type: "task", id: task.id };
    return { alias, selected: task.id === state.selectedTaskId, title: snapshot.taskTitles ? task.title : "Task", description: snapshot.taskDescriptions ? task.description?.slice(0, AI_LIMITS.descriptionCharacters) : undefined, notes: snapshot.taskNotes ? (task.notes ?? task.note)?.slice(0, AI_LIMITS.descriptionCharacters) : undefined, category: settings.allowCategoryNames ? task.category : undefined, dueDate: snapshot.deadlines ? task.dueDate : undefined, estimatedMinutes: snapshot.estimates ? task.estimatedMinutes : undefined, status: task.status, priority: task.priority };
  });
  const taskAliasById = new Map(Object.entries(aliasMap).filter(([, value]) => value.type === "task").map(([alias, value]) => [value.id, alias]));
  const sessions = state.sessions.filter((item) => taskAliasById.has(item.parentTaskId)).slice(0, 100).map((item, index) => { const alias = stableAlias("session", index); aliasMap[alias] = { type: "session", id: item.id }; return { alias, parentTaskAlias: taskAliasById.get(item.parentTaskId), title: snapshot.taskTitles ? item.title : "Work session", estimatedMinutes: snapshot.estimates ? item.estimatedMinutes : undefined, status: item.status, order: item.order }; });
  const blocks = snapshot.schedule ? state.scheduleBlocks.slice(0, 100).map((item, index) => { const alias = stableAlias("block", index); aliasMap[alias] = { type: "schedule-block", id: item.id }; return { alias, taskAlias: taskAliasById.get(item.taskId), title: snapshot.taskTitles ? item.title : "Scheduled work", date: item.date, startTime: item.startTime, endTime: item.endTime, status: item.status, locked: item.isLocked }; }) : [];
  const risks = snapshot.risk ? assessActiveTaskRisks({ tasks: state.tasks, sessions: state.sessions, availability: state.availability, overrides: state.overrides, scheduleBlocks: state.scheduleBlocks, timeLogs: snapshot.timeTracking ? state.timeLogs : [], today: state.today, currentTime: state.currentTime, dailyCapMinutes: 180, calculatedAt: new Date().toISOString() }) : [];
  const calendarEvents = state.externalEvents.slice(0, 50).map((item) => ({ title: snapshot.calendarTitles ? item.title : "External calendar event", startDateTime: item.startDateTime, endDateTime: item.endDateTime, startDate: item.startDate, endDate: item.endDate, status: item.status, transparency: item.transparency }));
  const request: AssistantRequest = { schemaVersion: 1, id: requestId, message, intent, context: { currentRoute: state.currentRoute, selectedTaskId: state.selectedTaskId, selectedDate: state.today }, dataPermissionsSnapshot: snapshot, createdAt: new Date().toISOString() };
  return { request, prompt: { schemaVersion: 1, requestId, userMessage: message, intent, localDate: state.today, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, facts: { tasks, sessions, scheduleBlocks: blocks, availability: snapshot.availability ? state.availability.slice(0, 100).map((item) => ({ name: item.name, date: item.date, dayOfWeek: item.dayOfWeek, startTime: item.startTime, endTime: item.endTime, type: item.type })) : [], risks: risks.map((item) => ({ taskAlias: taskAliasById.get(item.taskId), status: item.status, remainingMinutes: item.remainingMinutes, scheduledMinutes: item.scheduledMinutes, unscheduledMinutes: item.unscheduledMinutes, availableMinutesBeforeDeadline: item.availableMinutesBeforeDeadline, bufferMinutes: item.bufferMinutes, reasons: item.reasons.map((reason) => reason.message) })), calendarEvents }, aliasMap, calculated: { risks }, prohibitedActions: ["delete tasks", "connect calendars", "request browser permission", "publish calendar events", "change account permissions", "run arbitrary code"], allowedActionTypes: ["create-task", "update-task", "create-session", "create-schedule-preview", "create-reminder"] } };
}

function findTask(prompt: SanitizedAssistantPrompt): { alias: string; fact: Record<string, unknown> } | null {
  const selected = Object.entries(prompt.aliasMap).find(([, value]) => value.type === "task");
  if (!selected) return null;
  const fact = prompt.facts.tasks.find((item) => item.alias === selected[0]);
  return fact ? { alias: selected[0], fact } : null;
}
export class LocalPlanningAssistantProvider implements PlanningAssistantProvider {
  async generateResponse(prompt: SanitizedAssistantPrompt): Promise<ProviderAssistantResult> {
    const now = new Date().toISOString(), responseId = crypto.randomUUID();
    const base = { schemaVersion: 1 as const, id: responseId, requestId: prompt.requestId, assumptions: [] as string[], limitations: ["This local planning assistant uses deterministic planner data and does not contact a production language model."], createdAt: now };
    if (/\bthis task\b/i.test(prompt.userMessage) && !prompt.facts.tasks.some((task) => task.selected === true)) return { response: { ...base, type: "clarification", message: "Which task do you mean? Select a task before asking about “this task.”", citations: [], limitations: ["I will not guess between planner records."] } };
    if (/(delete all|clear planner|connect google|browser permission)/i.test(prompt.userMessage)) return { response: { ...base, type: "answer", message: "I can’t perform that action. You can use the planner’s existing review and confirmation flows instead.", citations: [{ type: "planner-rule", label: "Protected planner action", detail: "AI cannot delete planner history, connect calendars, or request permissions." }] } };
    if (prompt.intent === "risk-explanation") {
      const risk = prompt.facts.risks.find((item) => prompt.userMessage.toLowerCase().includes(String(prompt.facts.tasks.find((task) => task.alias === item.taskAlias)?.title ?? "").toLowerCase())) ?? prompt.facts.risks[0];
      if (!risk) return { response: { ...base, type: "insufficient-data", message: "Risk data is not enabled or no active risk assessment is available.", citations: [], limitations: ["Enable risk summaries to explain feasibility."] } };
      return { response: { ...base, type: "answer", message: `${risk.status === "at-risk" ? "This task is at risk" : `This task is ${String(risk.status).replace("-", " ")}`} because ${(risk.reasons as string[])?.[0] ?? "of its current deterministic planner assessment"}. Remaining: ${risk.remainingMinutes ?? "unknown"} minutes; scheduled: ${risk.scheduledMinutes ?? 0}; unscheduled: ${risk.unscheduledMinutes ?? "unknown"}; available capacity: ${risk.availableMinutesBeforeDeadline ?? "unknown"} minutes.`, citations: [{ type: "risk-assessment", entityAlias: String(risk.taskAlias), label: "Planner-calculated risk", detail: "Uses the Phase 8 capacity and coverage calculation." }] } };
    }
    if (prompt.intent === "task-breakdown") {
      const target = findTask(prompt);
      if (!target || typeof target.fact.estimatedMinutes !== "number") return { response: { ...base, type: "insufficient-data", message: "Select an estimated task before preparing work sessions.", citations: [], limitations: ["A task estimate is required."] } };
      const minutes = target.fact.estimatedMinutes as number, count = Math.max(1, Math.ceil(minutes / 60)), baseMinutes = Math.floor(minutes / count), remainder = minutes % count;
      const action: AssistantAction = { type: "create-session", parentTaskAlias: target.alias, sessions: Array.from({ length: count }, (_, index) => ({ temporaryId: `draft-session-${index + 1}`, title: `${String(target.fact.title)} · Session ${index + 1}`, estimatedMinutes: baseMinutes + (index < remainder ? 1 : 0), order: index })), totalEstimatedMinutes: minutes, reasoning: "Generic balanced sessions based on the current task estimate." };
      return { response: { ...base, type: "proposal", message: `I prepared ${count} balanced work sessions totaling ${minutes} minutes. Review the generic names and durations before applying.`, citations: [{ type: "task", entityAlias: target.alias, label: String(target.fact.title), detail: `Current estimate: ${minutes} minutes.` }, { type: "planner-rule", label: "Phase 6 session validation" }], proposal: { schemaVersion: 1, id: crypto.randomUUID(), status: "awaiting-confirmation", summary: `Create ${count} work sessions`, actions: [action], warnings: [], assumptions: ["Session names are generic because no subject-specific model is configured."], basedOnPlannerVersion: undefined, createdAt: now, updatedAt: now } } };
    }
    if (prompt.intent === "schedule-proposal") {
      const target = findTask(prompt);
      if (!target || typeof target.fact.estimatedMinutes !== "number") return { response: { ...base, type: "insufficient-data", message: "Select a task with an estimate before preparing a schedule preview.", citations: [], limitations: ["The deterministic scheduler requires an estimate."] } };
      const endDate = typeof target.fact.dueDate === "string" ? target.fact.dueDate : prompt.localDate;
      const action: AssistantAction = { type: "create-schedule-preview", taskAliases: [target.alias], options: { startDate: prompt.localDate, endDate, today: prompt.localDate, includeUndated: false, includeWeekends: true, includeOverdue: true, allowLateScheduling: false, allowDirectSplittable: false, allowFlexibleSessionOrder: false, allowSameTaskPerDay: true, replaceUnlockedProposed: false, dailyCapMinutes: 180, minimumBreakMinutes: 10 } };
      return { response: { ...base, type: "proposal", message: "I prepared a request for the deterministic scheduler. The planner—not the AI—will choose and validate any time slots.", citations: [{ type: "task", entityAlias: target.alias, label: String(target.fact.title) }, { type: "planner-rule", label: "Phase 7 deterministic scheduler", detail: "Availability, external busy time, locked blocks, breaks, and deadlines remain enforced." }], proposal: { schemaVersion: 1, id: crypto.randomUUID(), status: "awaiting-confirmation", summary: `Preview scheduling for ${String(target.fact.title)}`, actions: [action], warnings: ["Schedule blocks remain unsaved until confirmed in the existing planning flow."], assumptions: [], createdAt: now, updatedAt: now } } };
    }
    const risks = prompt.facts.risks as Array<Record<string, unknown>>;
    const ordered = [...prompt.facts.tasks].filter((task) => task.status !== "completed").sort((a, b) => {
      const ra = risks.find((item) => item.taskAlias === a.alias), rb = risks.find((item) => item.taskAlias === b.alias);
      const rank = (value: unknown) => value === "overdue" ? 4 : value === "at-risk" ? 3 : value === "tight" ? 2 : 1;
      return rank(rb?.status) - rank(ra?.status) || String(a.dueDate ?? "9999").localeCompare(String(b.dueDate ?? "9999")) || String(a.alias).localeCompare(String(b.alias));
    });
    if (!ordered.length) return { response: { ...base, type: "insufficient-data", message: "I found no active tasks in the shared planner context.", citations: [] } };
    const top = ordered.slice(0, 3);
    return { response: { ...base, type: prompt.intent === "unknown" ? "clarification" : "answer", message: prompt.intent === "unknown" ? "I can help review today, explain task risk, estimate work, break down an estimated task, or prepare a scheduling preview. What would you like to review?" : `Start with ${top.map((item) => item.title).join(", then ")}. This ordering uses current risk, deadlines, and stable planner ordering; it does not change task priority.`, citations: top.map((item) => ({ type: "task" as const, entityAlias: String(item.alias), label: String(item.title), detail: item.dueDate ? `Due ${item.dueDate}` : "No deadline shared" })) } };
  }
}

const allowedKeys: Record<AssistantAction["type"], Set<string>> = {
  "create-task": new Set(["type", "temporaryId", "title", "description", "categoryId", "priority", "dueDate", "estimatedMinutes", "isSplittable", "sourceExplanation"]),
  "update-task": new Set(["type", "taskAlias", "changes", "reason"]),
  "create-session": new Set(["type", "parentTaskAlias", "sessions", "totalEstimatedMinutes", "reasoning"]),
  "create-schedule-preview": new Set(["type", "taskAliases", "options"]),
  "create-reminder": new Set(["type", "taskAlias", "title", "dateTime", "note"]),
};
export function validateAssistantAction(value: unknown, aliasMap: SanitizedAssistantPrompt["aliasMap"]): AssistantAction {
  if (!value || typeof value !== "object") throw new Error("The proposal action is invalid.");
  const action = value as Record<string, unknown>, type = action.type;
  if (typeof type !== "string" || !(type in allowedKeys)) throw new Error("The proposal contains an unsupported action.");
  if (Object.keys(action).some((key) => !allowedKeys[type as AssistantAction["type"]].has(key))) throw new Error("The proposal contains an unexpected field.");
  if (type === "update-task" && (typeof action.taskAlias !== "string" || aliasMap[action.taskAlias]?.type !== "task")) throw new Error("The proposal references an unknown task.");
  if (type === "create-session" && (typeof action.parentTaskAlias !== "string" || aliasMap[action.parentTaskAlias]?.type !== "task")) throw new Error("The session proposal references an unknown task.");
  if (type === "create-task" && (typeof action.title !== "string" || !action.title.trim())) throw new Error("A proposed task needs a title.");
  return action as unknown as AssistantAction;
}
export function validateAssistantProposal(proposal: AssistantProposal, aliasMap: SanitizedAssistantPrompt["aliasMap"]) {
  if (proposal.schemaVersion !== 1 || !Array.isArray(proposal.actions)) throw new Error("The assistant proposal is invalid.");
  return { ...proposal, actions: proposal.actions.map((action) => validateAssistantAction(action, aliasMap)) };
}
export function estimateSuggestion(comparableMinutes: number[]): { lowMinutes: number; likelyMinutes: number; highMinutes: number; confidence: "low" | "medium" | "high"; comparableItemCount: number; factors: string[] } {
  const valid = comparableMinutes.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (valid.length < 3) return { lowMinutes: 30, likelyMinutes: 60, highMinutes: 120, confidence: "low", comparableItemCount: valid.length, factors: ["Generic range; fewer than three comparable completed items are available."] };
  const median = valid[Math.floor(valid.length / 2)]!;
  return { lowMinutes: valid[Math.floor((valid.length - 1) * .25)]!, likelyMinutes: median, highMinutes: valid[Math.ceil((valid.length - 1) * .75)]!, confidence: valid.length >= 5 ? "high" : "medium", comparableItemCount: valid.length, factors: [`Based on ${valid.length} comparable completed items.`] };
}

export interface ApplyAssistantState { tasks: TaskRecord[]; sessions: TaskSession[]; reminders: Reminder[] }
export function applyAssistantProposal(proposal: AssistantProposal, selectedActionIndexes: number[], aliasMap: SanitizedAssistantPrompt["aliasMap"], current: ApplyAssistantState, currentPlannerVersion: string, requestId: string, responseId: string, now = new Date().toISOString()): { state: ApplyAssistantState; proposal: AssistantProposal; audits: AIAssistantActionAudit[] } {
  if (proposal.status === "applied") return { state: current, proposal, audits: [] };
  if (proposal.basedOnPlannerVersion && proposal.basedOnPlannerVersion !== currentPlannerVersion) throw new Error("This proposal is stale because the planner changed. Review a refreshed proposal.");
  let tasks = current.tasks, sessions = current.sessions, reminders = current.reminders; const audits: AIAssistantActionAudit[] = [];
  proposal.actions.forEach((action, index) => {
    if (!selectedActionIndexes.includes(index)) return;
    let status: AIAssistantActionAudit["status"] = "applied", summary = "", errorMessage: string | undefined;
    try {
      if (action.type === "create-task") {
        const stableId = `assistant-${proposal.id}-${action.temporaryId}`;
        if (!tasks.some((item) => item.id === stableId)) tasks = [...tasks, createTask({ id: stableId, title: action.title, description: action.description, category: (action.categoryId as TaskCategory | undefined) ?? "other", priority: action.priority ?? "medium", dueDate: action.dueDate, estimatedMinutes: action.estimatedMinutes, isSplittable: action.isSplittable ?? false, date: "", time: "" }, now)];
        summary = `Created task “${action.title}”.`;
      } else if (action.type === "update-task") {
        const targetId = aliasMap[action.taskAlias]?.id, target = tasks.find((item) => item.id === targetId);
        if (!target) throw new Error("The task no longer exists.");
        tasks = tasks.map((item) => {
          if (item.id !== targetId) return item;
          let updated = item;
          for (const [key, value] of Object.entries(action.changes)) {
            if (value === undefined) continue;
            const taskKey = key === "categoryId" ? "category" : key;
            if (!["title", "description", "category", "priority", "dueDate", "estimatedMinutes", "isSplittable"].includes(taskKey)) continue;
            updated = updateTask(updated, taskKey as keyof TaskRecord, value as TaskRecord[keyof TaskRecord], now);
          }
          return updated;
        });
        summary = `Updated task “${target.title}”.`;
      } else if (action.type === "create-session") {
        const parentId = aliasMap[action.parentTaskAlias]?.id, parent = tasks.find((item) => item.id === parentId);
        if (!parent) throw new Error("The parent task no longer exists.");
        const existing = sessionsForParent(sessions, parent.id);
        for (const draft of action.sessions) {
          if (existing.some((item) => item.title.toLowerCase() === draft.title.toLowerCase())) throw new Error(`A session named “${draft.title}” already exists.`);
          const id = `assistant-${proposal.id}-${draft.temporaryId}`;
          if (!sessions.some((item) => item.id === id)) sessions = [...sessions, createTaskSession({ id, parentTaskId: parent.id, title: draft.title, description: draft.notes, estimatedMinutes: draft.estimatedMinutes, order: draft.order, status: "planned", isGenerated: false }, now)];
        }
        summary = `Created ${action.sessions.length} sessions for “${parent.title}”.`;
      } else if (action.type === "create-reminder") {
        const taskId = action.taskAlias ? aliasMap[action.taskAlias]?.id : undefined;
        const created = createReminder({ id: `assistant-${proposal.id}-${index}`, targetType: taskId ? "task" : "custom", taskId, title: action.title, note: action.note, trigger: { type: "absolute", dateTime: action.dateTime }, channels: ["in-app"], isEnabled: true }, reminders, tasks, [], now);
        reminders = [...reminders, created]; summary = `Created reminder “${action.title}”.`;
      } else throw new Error("Schedule proposals must be confirmed in the existing scheduling preview.");
    } catch (error) { status = "failed"; errorMessage = error instanceof Error ? error.message : "Action failed."; summary = `Could not apply ${action.type}.`; }
    audits.push({ schemaVersion: 1, id: `audit-${proposal.id}-${index}`, requestId, responseId, proposalId: proposal.id, actionType: action.type, targetAliases: "taskAlias" in action && action.taskAlias ? [action.taskAlias] : "parentTaskAlias" in action ? [action.parentTaskAlias] : [], status, summary, appliedAt: status === "applied" ? now : undefined, errorCode: status === "failed" ? "validation" : undefined, errorMessage, createdAt: now, updatedAt: now });
  });
  const applied = audits.filter((item) => item.status === "applied").length, failed = audits.filter((item) => item.status === "failed").length;
  return { state: { tasks, sessions, reminders }, proposal: { ...proposal, status: failed ? (applied ? "partially-applied" : "failed") : "applied", updatedAt: now }, audits };
}
export function runDeterministicScheduleProposal(prompt: SanitizedAssistantPrompt, state: AssistantPlannerState, action: Extract<AssistantAction, { type: "create-schedule-preview" }>, now = new Date().toISOString()): SchedulingResult {
  const ids = action.taskAliases.map((alias) => prompt.aliasMap[alias]).filter((item) => item?.type === "task").map((item) => item.id);
  return scheduleWork(state.tasks, state.sessions, state.availability, state.overrides, state.scheduleBlocks, { ...action.options, selectedTaskIds: ids, runId: `assistant-preview-${prompt.requestId}`, now });
}
export function trimConversation(messages: AssistantConversationMessage[], settings: AIAssistantSettings) {
  return settings.conversationHistoryEnabled ? messages.slice(-settings.maximumHistoryMessages) : [];
}
export function todayForAssistant() { return localDateFromDate(new Date()); }
