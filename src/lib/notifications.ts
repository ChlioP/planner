import { dayOfWeekForLocalDate, isValidTime, localDateFromDate, localDateToDate, timeToMinutes } from "./localDateTime";
import { assessActiveTaskRisks } from "./riskAssessment";
import { detectScheduleConflicts, type ScheduleBlock } from "./scheduleBlocks";
import type { TaskRecord } from "./taskHistory";
import type { TaskSession } from "./taskSessions";
import { elapsedSeconds, runningTimeLogs, type TimeLog } from "./timeLogs";
import type { AvailabilityBlock, AvailabilityOverride } from "./availability";

export const NOTIFICATION_SCHEMA_VERSION = 1 as const;
export const NOTIFICATION_RETENTION = { handledDays: 30, inactiveDays: 14 } as const;
export type NotificationType = "schedule-upcoming" | "deadline-upcoming" | "deadline-overdue" | "schedule-conflict" | "schedule-missed" | "risk-unscheduled" | "timer-running" | "replan-recommended" | "daily-summary" | "manual-reminder";
export type NotificationStatus = "scheduled" | "delivered" | "read" | "dismissed" | "cancelled" | "expired";
export type NotificationActionType = "open-task" | "open-session" | "open-schedule-block" | "open-planning-health" | "open-daily-plan" | "open-timer" | "replan-work" | "mark-complete" | "snooze";

export interface PlannerNotification {
  schemaVersion: typeof NOTIFICATION_SCHEMA_VERSION;
  id: string; userId?: string; type: NotificationType; title: string; message: string;
  taskId?: string; sessionId?: string; scheduleBlockId?: string; timeLogId?: string; reminderId?: string;
  scheduledFor?: string; generatedAt: string; status: NotificationStatus;
  deliveryChannels: Array<"in-app" | "browser">; deduplicationKey: string;
  action?: { type: NotificationActionType; label: string };
  readAt?: string; dismissedAt?: string; deliveredAt?: string; browserDeliveredAt?: string;
  expiresAt?: string; snoozedUntil?: string; createdAt: string; updatedAt: string;
}

export type ReminderTrigger =
  | { type: "absolute"; dateTime: string }
  | { type: "before-deadline"; offsetMinutes: number }
  | { type: "before-schedule"; offsetMinutes: number }
  | { type: "daily"; localTime: string };
export interface Reminder {
  schemaVersion: typeof NOTIFICATION_SCHEMA_VERSION;
  id: string; userId?: string; targetType: "task" | "session" | "schedule-block" | "custom";
  taskId?: string; sessionId?: string; scheduleBlockId?: string;
  title: string; note?: string; trigger: ReminderTrigger; channels: Array<"in-app" | "browser">;
  isEnabled: boolean; disabledReason?: string; snoozedUntil?: string; lastTriggeredAt?: string; nextTriggerAt?: string;
  createdAt: string; updatedAt: string;
}

export interface NotificationSettings {
  schemaVersion: typeof NOTIFICATION_SCHEMA_VERSION; id: "notifications"; userId?: string;
  inAppEnabled: boolean; browserEnabled: boolean; allPaused: boolean;
  upcomingScheduleEnabled: boolean; deadlineReminderEnabled: boolean; overdueReminderEnabled: boolean;
  conflictReminderEnabled: boolean; missedBlockReminderEnabled: boolean; riskReminderEnabled: boolean;
  timerReminderEnabled: boolean; dailySummaryEnabled: boolean;
  scheduleReminderOffsets: number[]; deadlineReminderOffsets: number[]; timerReminderThresholdMinutes: number;
  dailySummaryTime: string; quietHoursEnabled: boolean; quietHoursStart: string; quietHoursEnd: string;
  weekendNotificationsEnabled: boolean; maximumNotificationsPerDay: number; timezone?: string;
  createdAt: string; updatedAt: string;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  schemaVersion: 1, id: "notifications", inAppEnabled: true, browserEnabled: false, allPaused: false,
  upcomingScheduleEnabled: true, deadlineReminderEnabled: true, overdueReminderEnabled: true,
  conflictReminderEnabled: true, missedBlockReminderEnabled: true, riskReminderEnabled: false,
  timerReminderEnabled: true, dailySummaryEnabled: false,
  scheduleReminderOffsets: [15], deadlineReminderOffsets: [1440, 60], timerReminderThresholdMinutes: 240,
  dailySummaryTime: "08:00", quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00",
  weekendNotificationsEnabled: true, maximumNotificationsPerDay: 8,
  timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
  createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
};

function validIso(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}
function notificationId(key: string): string { return `notification-${stableHash(key)}`; }

export function migratePlannerNotification(value: unknown): PlannerNotification {
  if (!value || typeof value !== "object") throw new Error("Notification must be an object.");
  const item = value as Partial<PlannerNotification>;
  if (typeof item.id !== "string" || !item.id || typeof item.deduplicationKey !== "string" || !item.deduplicationKey) throw new Error("Notification requires stable and deduplication IDs.");
  if (typeof item.title !== "string" || typeof item.message !== "string" || !validIso(item.generatedAt)) throw new Error(`Notification ${item.id} is invalid.`);
  if (!["scheduled", "delivered", "read", "dismissed", "cancelled", "expired"].includes(item.status ?? "")) throw new Error(`Notification ${item.id} has an invalid status.`);
  const createdAt = validIso(item.createdAt) ? item.createdAt : item.generatedAt;
  return { schemaVersion: 1, id: item.id, userId: item.userId, type: item.type!, title: item.title, message: item.message, taskId: item.taskId, sessionId: item.sessionId, scheduleBlockId: item.scheduleBlockId, timeLogId: item.timeLogId, reminderId: item.reminderId, scheduledFor: item.scheduledFor, generatedAt: item.generatedAt, status: item.status as NotificationStatus, deliveryChannels: Array.isArray(item.deliveryChannels) ? item.deliveryChannels.filter((channel): channel is "in-app" | "browser" => channel === "in-app" || channel === "browser") : ["in-app"], deduplicationKey: item.deduplicationKey, action: item.action, readAt: item.readAt, dismissedAt: item.dismissedAt, deliveredAt: item.deliveredAt, browserDeliveredAt: item.browserDeliveredAt, expiresAt: item.expiresAt, snoozedUntil: item.snoozedUntil, createdAt, updatedAt: validIso(item.updatedAt) ? item.updatedAt : createdAt };
}
export function migratePlannerNotifications(value: unknown): PlannerNotification[] { if (!Array.isArray(value)) throw new Error("Notifications must be an array."); return value.map(migratePlannerNotification); }

export function migrateReminder(value: unknown): Reminder {
  if (!value || typeof value !== "object") throw new Error("Reminder must be an object.");
  const item = value as Partial<Reminder>;
  if (typeof item.id !== "string" || !item.id || typeof item.title !== "string" || !item.title.trim() || !item.trigger) throw new Error("Reminder requires an ID, title, and trigger.");
  const createdAt = validIso(item.createdAt) ? item.createdAt : "1970-01-01T00:00:00.000Z";
  return { schemaVersion: 1, id: item.id, userId: item.userId, targetType: item.targetType ?? "custom", taskId: item.taskId, sessionId: item.sessionId, scheduleBlockId: item.scheduleBlockId, title: item.title, note: item.note, trigger: item.trigger, channels: item.channels?.filter((channel): channel is "in-app" | "browser" => channel === "in-app" || channel === "browser") ?? ["in-app"], isEnabled: item.isEnabled !== false, disabledReason: item.disabledReason, snoozedUntil: item.snoozedUntil, lastTriggeredAt: item.lastTriggeredAt, nextTriggerAt: item.nextTriggerAt, createdAt, updatedAt: validIso(item.updatedAt) ? item.updatedAt : createdAt };
}
export function migrateReminders(value: unknown): Reminder[] { if (!Array.isArray(value)) throw new Error("Reminders must be an array."); return value.map(migrateReminder); }

export function migrateNotificationSettings(value: unknown): NotificationSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_NOTIFICATION_SETTINGS };
  const item = value as Partial<NotificationSettings>;
  const createdAt = validIso(item.createdAt) ? item.createdAt : DEFAULT_NOTIFICATION_SETTINGS.createdAt;
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS, ...item, schemaVersion: 1, id: "notifications",
    browserEnabled: item.browserEnabled === true, inAppEnabled: item.inAppEnabled !== false,
    scheduleReminderOffsets: validOffsets(item.scheduleReminderOffsets, [15]),
    deadlineReminderOffsets: validOffsets(item.deadlineReminderOffsets, [1440, 60]),
    maximumNotificationsPerDay: Number.isInteger(item.maximumNotificationsPerDay) && item.maximumNotificationsPerDay! > 0 ? item.maximumNotificationsPerDay! : 8,
    createdAt, updatedAt: validIso(item.updatedAt) ? item.updatedAt : createdAt,
  };
}
function validOffsets(value: unknown, fallback: number[]): number[] { return Array.isArray(value) ? Array.from(new Set(value.filter((item): item is number => Number.isInteger(item) && item >= 0))).sort((a, b) => b - a) : fallback; }

function localDateTimeIso(date: string, time: string): string {
  const parsed = localDateToDate(date);
  const [hours, minutes] = time.split(":").map(Number);
  parsed.setHours(hours, minutes, 0, 0);
  return parsed.toISOString();
}
function endOfLocalDateIso(date: string): string { return localDateTimeIso(date, "23:59"); }
function addMinutesIso(timestamp: string, minutes: number): string { return new Date(Date.parse(timestamp) + minutes * 60_000).toISOString(); }
function withinMinute(now: string, trigger: string): boolean { const delta = Date.parse(now) - Date.parse(trigger); return delta >= 0 && delta < 60_000; }
function taskRemaining(task: TaskRecord, sessions: TaskSession[]): number | undefined {
  const linked = sessions.filter((session) => session.parentTaskId === task.id && session.status !== "archived" && session.status !== "completed");
  if (linked.length) return linked.reduce((sum, session) => sum + session.estimatedMinutes, 0);
  return task.estimatedMinutes === undefined ? undefined : Math.max(task.estimatedMinutes - (task.actualMinutes ?? 0), 0);
}
function candidate(key: string, input: Omit<PlannerNotification, "schemaVersion" | "id" | "deduplicationKey" | "createdAt" | "updatedAt">): PlannerNotification {
  return migratePlannerNotification({ ...input, id: notificationId(key), deduplicationKey: key, createdAt: input.generatedAt, updatedAt: input.generatedAt });
}

export function resolveReminderTrigger(reminder: Reminder, tasks: TaskRecord[], blocks: ScheduleBlock[], now: string): { nextTriggerAt?: string; disabledReason?: string } {
  if (reminder.snoozedUntil && Date.parse(reminder.snoozedUntil) > Date.parse(now)) return { nextTriggerAt: reminder.snoozedUntil };
  if (reminder.trigger.type === "absolute") return validIso(reminder.trigger.dateTime) ? { nextTriggerAt: reminder.trigger.dateTime } : { disabledReason: "The reminder date and time is invalid." };
  if (reminder.trigger.type === "before-deadline") {
    const task = tasks.find((item) => item.id === reminder.taskId);
    return task?.dueDate ? { nextTriggerAt: addMinutesIso(task.dueTime ? localDateTimeIso(task.dueDate, task.dueTime) : endOfLocalDateIso(task.dueDate), -reminder.trigger.offsetMinutes) } : { disabledReason: "The linked task has no deadline." };
  }
  if (reminder.trigger.type === "before-schedule") {
    const block = blocks.find((item) => item.id === reminder.scheduleBlockId && item.status === "confirmed");
    return block ? { nextTriggerAt: addMinutesIso(localDateTimeIso(block.date, block.startTime), -reminder.trigger.offsetMinutes) } : { disabledReason: "The linked schedule block is no longer active." };
  }
  if (!isValidTime(reminder.trigger.localTime)) return { disabledReason: "The daily reminder time is invalid." };
  const today = localDateFromDate(new Date(now));
  let trigger = localDateTimeIso(today, reminder.trigger.localTime);
  const currentLocalTime = `${String(new Date(now).getHours()).padStart(2, "0")}:${String(new Date(now).getMinutes()).padStart(2, "0")}`;
  if (currentLocalTime !== reminder.trigger.localTime && Date.parse(trigger) <= Date.parse(now)) {
    const tomorrow = new Date(localDateToDate(today)); tomorrow.setDate(tomorrow.getDate() + 1);
    trigger = localDateTimeIso(localDateFromDate(tomorrow), reminder.trigger.localTime);
  }
  return { nextTriggerAt: trigger };
}

type ReminderInput = Omit<Reminder, "schemaVersion" | "id" | "createdAt" | "updatedAt" | "lastTriggeredAt" | "nextTriggerAt" | "disabledReason"> & { id?: string };
export function createReminder(input: ReminderInput, existing: Reminder[], tasks: TaskRecord[], blocks: ScheduleBlock[], now = new Date().toISOString()): Reminder {
  const draft = migrateReminder({ ...input, id: input.id ?? crypto.randomUUID(), createdAt: now, updatedAt: now });
  const resolved = resolveReminderTrigger(draft, tasks, blocks, now);
  if (resolved.disabledReason) throw new Error(resolved.disabledReason);
  if (draft.trigger.type !== "daily" && (!resolved.nextTriggerAt || Date.parse(resolved.nextTriggerAt) <= Date.parse(now))) throw new Error("Reminder time must be in the future.");
  const duplicate = existing.some((item) => item.title === draft.title && item.targetType === draft.targetType && item.taskId === draft.taskId && item.sessionId === draft.sessionId && item.scheduleBlockId === draft.scheduleBlockId && JSON.stringify(item.trigger) === JSON.stringify(draft.trigger));
  if (duplicate) throw new Error("This reminder already exists.");
  return { ...draft, nextTriggerAt: resolved.nextTriggerAt };
}
export function editReminder(reminder: Reminder, changes: Partial<Omit<Reminder, "id" | "createdAt">>, tasks: TaskRecord[], blocks: ScheduleBlock[], now = new Date().toISOString()): Reminder {
  const next = migrateReminder({ ...reminder, ...changes, id: reminder.id, createdAt: reminder.createdAt, updatedAt: now });
  const resolved = resolveReminderTrigger(next, tasks, blocks, now);
  return { ...next, nextTriggerAt: resolved.nextTriggerAt, disabledReason: resolved.disabledReason, isEnabled: resolved.disabledReason ? false : next.isEnabled };
}

export function isQuietTime(localTime: string, settings: NotificationSettings): boolean {
  if (!settings.quietHoursEnabled) return false;
  const value = timeToMinutes(localTime), start = timeToMinutes(settings.quietHoursStart), end = timeToMinutes(settings.quietHoursEnd);
  return start === end ? true : start < end ? value >= start && value < end : value >= start || value < end;
}

export interface NotificationEngineInput {
  now: string; tasks: TaskRecord[]; sessions: TaskSession[]; scheduleBlocks: ScheduleBlock[];
  availability: AvailabilityBlock[]; overrides: AvailabilityOverride[]; timeLogs: TimeLog[];
  reminders: Reminder[]; notifications: PlannerNotification[]; settings: NotificationSettings;
  dailyCapMinutes?: number;
}
export interface NotificationEngineResult {
  notifications: PlannerNotification[]; reminders: Reminder[]; created: PlannerNotification[];
  browserDeliveries: PlannerNotification[]; suppressedReasons: string[];
}

export function evaluateNotifications(input: NotificationEngineInput): NotificationEngineResult {
  const nowDate = new Date(input.now), localDate = localDateFromDate(nowDate);
  const localTime = `${String(nowDate.getHours()).padStart(2, "0")}:${String(nowDate.getMinutes()).padStart(2, "0")}`;
  const settings = migrateNotificationSettings(input.settings);
  const candidates: PlannerNotification[] = [];
  const channels: Array<"in-app" | "browser"> = [
    ...(settings.inAppEnabled ? ["in-app" as const] : []),
    ...(settings.browserEnabled ? ["browser" as const] : []),
  ];
  const activeTasks = input.tasks.filter((task) => task.status !== "completed" && task.status !== "archived");
  const taskMap = new Map(input.tasks.map((task) => [task.id, task]));
  const allowedToday = settings.weekendNotificationsEnabled || ![0, 6].includes(dayOfWeekForLocalDate(localDate));
  const add = (item: PlannerNotification) => {
    if (!settings.allPaused && allowedToday && item.deliveryChannels.length) candidates.push(item);
  };

  if (settings.upcomingScheduleEnabled) for (const block of input.scheduleBlocks.filter((item) => item.status === "confirmed" && taskMap.get(item.taskId)?.status !== "archived")) {
    const start = localDateTimeIso(block.date, block.startTime);
    for (const offset of settings.scheduleReminderOffsets) {
      const trigger = addMinutesIso(start, -offset);
      if (Date.parse(trigger) < Date.parse(input.now) - 60_000 || Date.parse(start) <= Date.parse(input.now)) continue;
      const key = `schedule-upcoming:${block.id}:${offset}:${start}`;
      add(candidate(key, { type: "schedule-upcoming", title: "Work session starts soon", message: `${block.title} is scheduled for ${new Date(start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`, taskId: block.taskId, sessionId: block.sessionId, scheduleBlockId: block.id, scheduledFor: trigger, generatedAt: input.now, status: withinMinute(input.now, trigger) ? "delivered" : "scheduled", deliveryChannels: channels, action: { type: "open-schedule-block", label: "Open daily plan" }, deliveredAt: withinMinute(input.now, trigger) ? input.now : undefined }));
    }
  }
  for (const task of activeTasks) {
    const remaining = taskRemaining(task, input.sessions);
    if (!task.dueDate || remaining === 0) continue;
    const deadline = task.dueTime ? localDateTimeIso(task.dueDate, task.dueTime) : endOfLocalDateIso(task.dueDate);
    if (Date.parse(deadline) < Date.parse(input.now)) {
      if (settings.overdueReminderEnabled) {
        const key = `deadline-overdue:${task.id}:${deadline}`;
        add(candidate(key, { type: "deadline-overdue", title: "Task deadline passed", message: `${task.title} is past its deadline${remaining === undefined ? "." : ` with ${remaining} minutes remaining.`}`, taskId: task.id, generatedAt: input.now, status: "delivered", deliveryChannels: channels, action: { type: "replan-work", label: "Review task" }, deliveredAt: input.now }));
      }
    } else if (settings.deadlineReminderEnabled) for (const offset of settings.deadlineReminderOffsets) {
      const trigger = addMinutesIso(deadline, -offset);
      if (Date.parse(trigger) < Date.parse(input.now) - 60_000) continue;
      const key = `deadline-upcoming:${task.id}:${offset}:${deadline}`;
      add(candidate(key, { type: "deadline-upcoming", title: "Task deadline approaching", message: `${task.title} is due ${offset >= 1440 ? "tomorrow" : "soon"}${remaining === undefined ? "." : `. ${remaining} minutes remain.`}`, taskId: task.id, scheduledFor: trigger, generatedAt: input.now, status: withinMinute(input.now, trigger) ? "delivered" : "scheduled", deliveryChannels: channels, action: { type: "open-task", label: "Open task" }, deliveredAt: withinMinute(input.now, trigger) ? input.now : undefined }));
    }
  }
  const conflicts = detectScheduleConflicts(input.scheduleBlocks, input.tasks, input.availability, input.overrides, input.dailyCapMinutes ?? 180);
  if (settings.conflictReminderEnabled) for (const conflict of conflicts) {
    const block = input.scheduleBlocks.find((item) => item.id === conflict.blockId);
    if (!block) continue;
    const key = `schedule-conflict:${block.id}:${stableHash(conflict.reason)}`;
    add(candidate(key, { type: "schedule-conflict", title: "Scheduled work needs review", message: `${block.title} on ${block.date}: ${conflict.reason}`, taskId: block.taskId, sessionId: block.sessionId, scheduleBlockId: block.id, generatedAt: input.now, status: "delivered", deliveryChannels: channels, action: { type: "open-schedule-block", label: "Review conflict" }, deliveredAt: input.now }));
  }
  if (settings.missedBlockReminderEnabled) for (const block of input.scheduleBlocks.filter((item) => item.status === "confirmed")) {
    const end = localDateTimeIso(block.date, block.endTime);
    if (Date.parse(end) >= Date.parse(input.now)) continue;
    const key = `schedule-missed:${block.id}:${end}`;
    add(candidate(key, { type: "schedule-missed", title: "Review past session", message: `${block.title} ended at ${new Date(end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Mark it completed, missed, or cancelled when convenient.`, taskId: block.taskId, sessionId: block.sessionId, scheduleBlockId: block.id, generatedAt: input.now, status: "delivered", deliveryChannels: channels, action: { type: "open-schedule-block", label: "Review session" }, deliveredAt: input.now }));
  }
  if (settings.riskReminderEnabled) {
    const risks = assessActiveTaskRisks({ tasks: input.tasks, sessions: input.sessions, availability: input.availability, overrides: input.overrides, scheduleBlocks: input.scheduleBlocks, timeLogs: input.timeLogs, today: localDate, currentTime: localTime, dailyCapMinutes: input.dailyCapMinutes ?? 180, calculatedAt: input.now });
    for (const risk of risks.filter((item) => item.status === "at-risk" && (item.unscheduledMinutes ?? 0) >= 30)) {
      const task = taskMap.get(risk.taskId)!;
      const bucket = Math.floor((risk.unscheduledMinutes ?? 0) / 30) * 30;
      const key = `risk-unscheduled:${task.id}:${risk.status}:${task.dueDate ?? "none"}:${bucket}`;
      add(candidate(key, { type: "risk-unscheduled", title: "Some work remains unscheduled", message: `${risk.unscheduledMinutes} minutes remain unscheduled${task.dueDate ? ` before ${task.dueDate}` : ""}.`, taskId: task.id, generatedAt: input.now, status: "delivered", deliveryChannels: channels, action: { type: "open-planning-health", label: "Review planning health" }, deliveredAt: input.now }));
    }
  }
  if (settings.timerReminderEnabled) for (const log of runningTimeLogs(input.timeLogs)) {
    const elapsedMinutes = Math.floor(elapsedSeconds(log, input.now) / 60);
    if (elapsedMinutes < settings.timerReminderThresholdMinutes) continue;
    const key = `timer-running:${log.id}:${settings.timerReminderThresholdMinutes}`;
    const task = taskMap.get(log.taskId);
    add(candidate(key, { type: "timer-running", title: "Focus timer is still running", message: `Your timer for ${task?.title ?? "this task"} has been running for ${Math.floor(elapsedMinutes / 60)} hours. Review it when convenient.`, taskId: log.taskId, sessionId: log.sessionId, timeLogId: log.id, generatedAt: input.now, status: "delivered", deliveryChannels: channels, action: { type: "open-timer", label: "Open timer" }, deliveredAt: input.now }));
  }
  if (settings.dailySummaryEnabled && localTime === settings.dailySummaryTime) {
    const todayBlocks = input.scheduleBlocks.filter((block) => block.date === localDate && block.status === "confirmed");
    const due = activeTasks.filter((task) => task.dueDate === localDate);
    if (todayBlocks.length || due.length || conflicts.length) {
      const key = `daily-summary:${localDate}`;
      const minutes = todayBlocks.reduce((sum, block) => sum + block.durationMinutes, 0);
      add(candidate(key, { type: "daily-summary", title: "Today’s plan", message: `Today: ${todayBlocks.length} work session${todayBlocks.length === 1 ? "" : "s"}, ${minutes} minutes planned, and ${due.length} task${due.length === 1 ? "" : "s"} due.`, generatedAt: input.now, status: "delivered", deliveryChannels: channels, action: { type: "open-daily-plan", label: "Open daily plan" }, deliveredAt: input.now }));
    }
  }

  const nextReminders = input.reminders.map((reminder) => {
    const resolved = resolveReminderTrigger(reminder, input.tasks, input.scheduleBlocks, input.now);
    const updated = { ...reminder, nextTriggerAt: resolved.nextTriggerAt, disabledReason: resolved.disabledReason, isEnabled: resolved.disabledReason ? false : reminder.isEnabled };
    if (!updated.isEnabled || !updated.nextTriggerAt) return updated;
    const key = `manual-reminder:${updated.id}:${updated.nextTriggerAt}`;
    const due = withinMinute(input.now, updated.nextTriggerAt);
    if (Date.parse(updated.nextTriggerAt) >= Date.parse(input.now) - 60_000) add(candidate(key, { type: "manual-reminder", title: updated.title, message: updated.note || "A reminder you created is due.", taskId: updated.taskId, sessionId: updated.sessionId, scheduleBlockId: updated.scheduleBlockId, reminderId: updated.id, scheduledFor: updated.nextTriggerAt, generatedAt: input.now, status: due ? "delivered" : "scheduled", deliveryChannels: updated.channels, action: updated.taskId ? { type: "open-task", label: "Open task" } : { type: "snooze", label: "Snooze" }, deliveredAt: due ? input.now : undefined }));
    return due ? { ...updated, lastTriggeredAt: input.now, snoozedUntil: undefined } : updated;
  });

  const candidateKeys = new Set(candidates.map((item) => item.deduplicationKey));
  const existingByKey = new Map(input.notifications.map((item) => [item.deduplicationKey, item]));
  const created: PlannerNotification[] = [];
  if (settings.allPaused) {
    return { notifications: input.notifications, reminders: nextReminders, created: [], browserDeliveries: [], suppressedReasons: ["Notification delivery is paused."] };
  }
  const resolveDeliveredTypes: NotificationType[] = ["schedule-conflict", "schedule-missed", "risk-unscheduled", "timer-running"];
  const merged: PlannerNotification[] = input.notifications.map((item) => {
    const mayCancel = item.status === "scheduled" || (item.status === "delivered" && resolveDeliveredTypes.includes(item.type));
    if (!candidateKeys.has(item.deduplicationKey) && mayCancel) return { ...item, status: "cancelled", updatedAt: input.now };
    return item;
  });
  for (const item of candidates) {
    const existing = existingByKey.get(item.deduplicationKey);
    if (!existing) { merged.push(item); created.push(item); continue; }
    const index = merged.findIndex((value) => value.id === existing.id);
    const snoozed = existing.snoozedUntil && Date.parse(existing.snoozedUntil) > Date.parse(input.now);
    if (existing.status === "scheduled" && item.status === "delivered" && !snoozed) merged[index] = { ...existing, status: "delivered", deliveredAt: input.now, updatedAt: input.now };
  }
  const localDeliveredToday = merged.filter((item) => item.browserDeliveredAt && localDateFromDate(new Date(item.browserDeliveredAt)) === localDate).length;
  const quiet = isQuietTime(localTime, settings);
  const browserDeliveries: PlannerNotification[] = [];
  const suppressedReasons: string[] = [];
  for (const item of merged.filter((value) => value.status === "delivered" && value.deliveryChannels.includes("browser") && !value.browserDeliveredAt)) {
    if (quiet) { suppressedReasons.push(`${item.title}: browser delivery deferred by quiet hours.`); continue; }
    if (localDeliveredToday + browserDeliveries.length >= settings.maximumNotificationsPerDay && item.type !== "schedule-conflict" && item.type !== "timer-running") { suppressedReasons.push(`${item.title}: daily browser notification limit reached.`); continue; }
    browserDeliveries.push(item);
  }
  return { notifications: merged, reminders: nextReminders, created, browserDeliveries, suppressedReasons };
}

export function markNotificationRead(item: PlannerNotification, read: boolean, now = new Date().toISOString()): PlannerNotification {
  if (read) return { ...item, status: "read", readAt: now, updatedAt: now };
  return { ...item, status: "delivered", readAt: undefined, updatedAt: now };
}
export function dismissNotification(item: PlannerNotification, now = new Date().toISOString()): PlannerNotification { return { ...item, status: "dismissed", dismissedAt: now, updatedAt: now }; }
export function snoozeNotification(item: PlannerNotification, minutes: number, now = new Date().toISOString()): PlannerNotification {
  if (!Number.isInteger(minutes) || minutes <= 0) throw new Error("Snooze time must be greater than zero.");
  const trigger = addMinutesIso(now, minutes);
  return { ...item, status: "scheduled", scheduledFor: trigger, snoozedUntil: trigger, updatedAt: now };
}
export function cleanupNotificationRetention(items: PlannerNotification[], now = new Date().toISOString()): PlannerNotification[] {
  return items.filter((item) => {
    if (item.status === "delivered" || item.status === "scheduled") return true;
    const days = (Date.parse(now) - Date.parse(item.updatedAt)) / 86_400_000;
    return days <= (item.status === "read" || item.status === "dismissed" ? NOTIFICATION_RETENTION.handledDays : NOTIFICATION_RETENTION.inactiveDays);
  });
}
export function mergeNotificationCopies(current: PlannerNotification[], incoming: PlannerNotification[]): PlannerNotification[] {
  const byKey = new Map<string, PlannerNotification>();
  for (const item of [...current, ...incoming]) {
    const existing = byKey.get(item.deduplicationKey);
    if (!existing || item.updatedAt > existing.updatedAt || (item.updatedAt === existing.updatedAt && item.id < existing.id)) byKey.set(item.deduplicationKey, item);
  }
  return Array.from(byKey.values());
}
export function mergeReminderCopies(current: Reminder[], incoming: Reminder[]): Reminder[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) { const existing = byId.get(item.id); if (!existing || item.updatedAt > existing.updatedAt) byId.set(item.id, item); }
  return Array.from(byId.values());
}
