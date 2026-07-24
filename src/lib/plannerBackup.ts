import { migrateTasks, type TaskRecord } from "./taskHistory";
import { migrateAvailabilityBlocks, migrateAvailabilityOverrides, type AvailabilityBlock, type AvailabilityOverride } from "./availability";
import { migrateAvailabilityTemplates, type AvailabilityTemplate } from "./availabilityTemplates";
import { migrateTaskSessions, type TaskSession } from "./taskSessions";
import { migrateScheduleBlocks, type ScheduleBlock } from "./scheduleBlocks";
import { migrateTimeLogs, type TimeLog } from "./timeLogs";
import {
  migrateNotificationSettings,
  migratePlannerNotifications,
  migrateReminders,
  type NotificationSettings,
  type PlannerNotification,
  type Reminder,
} from "./notifications";
import {
  migrateCalendarConnection,
  migrateCalendarSettings,
  migrateSyncRecords,
  type CalendarConnection,
  type CalendarSyncRecord,
  type CalendarSyncSettings,
} from "./calendarIntegration";
import {
  migrateAISettings,
  migrateAssistantAudits,
  migrateAssistantMessages,
  type AIAssistantActionAudit,
  type AIAssistantSettings,
  type AssistantConversationMessage,
} from "./planningAssistant";
import {
  migrateDependencies,
  migrateGoals,
  migrateMilestones,
  migrateProjects,
  type Goal,
  type Milestone,
  type Project,
  type TaskDependency,
} from "./projectPlanning";
import { migrateRecurrenceDefinitions, migrateRecurrenceExceptions, migrateRecurrenceOccurrences, migrateRoutineTemplates, type RecurrenceDefinition, type RecurrenceException, type RecurrenceOccurrence, type RoutineTemplate } from "./recurrence";

export interface BackupPreferences {
  musicQuery: string;
  checklistByDate: unknown;
  projects: unknown;
  checklistNote: string;
}

export interface PlannerBackup {
  format: "bunbun-planner-backup";
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
  exportedAt: string;
  tasks: TaskRecord[];
  preferences: BackupPreferences;
  availability: AvailabilityBlock[];
  availabilityOverrides: AvailabilityOverride[];
  availabilityTemplates: AvailabilityTemplate[];
  taskSessions: TaskSession[];
  scheduleBlocks: ScheduleBlock[];
  timeLogs: TimeLog[];
  notifications: PlannerNotification[];
  reminders: Reminder[];
  notificationSettings: NotificationSettings;
  calendarConnection: CalendarConnection;
  calendarSettings: CalendarSyncSettings;
  calendarSyncRecords: CalendarSyncRecord[];
  aiSettings: AIAssistantSettings;
  assistantMessages: AssistantConversationMessage[];
  assistantActionAudits: AIAssistantActionAudit[];
  goals: Goal[];
  projects: Project[];
  milestones: Milestone[];
  taskDependencies: TaskDependency[];
  recurrenceDefinitions: RecurrenceDefinition[];
  recurrenceOccurrences: RecurrenceOccurrence[];
  recurrenceExceptions: RecurrenceException[];
  routineTemplates: RoutineTemplate[];
}

export function createPlannerBackup(
  tasks: TaskRecord[],
  preferences: BackupPreferences,
  exportedAt = new Date().toISOString(),
  availability: AvailabilityBlock[] = [],
  availabilityOverrides: AvailabilityOverride[] = [],
  availabilityTemplates: AvailabilityTemplate[] = [],
  taskSessions: TaskSession[] = [],
  scheduleBlocks: ScheduleBlock[] = [],
  timeLogs: TimeLog[] = [],
  notifications: PlannerNotification[] = [],
  reminders: Reminder[] = [],
  notificationSettings: NotificationSettings = migrateNotificationSettings(undefined),
  calendarConnection: CalendarConnection = migrateCalendarConnection(undefined),
  calendarSettings: CalendarSyncSettings = migrateCalendarSettings(undefined),
  calendarSyncRecords: CalendarSyncRecord[] = [],
  aiSettings: AIAssistantSettings = migrateAISettings(undefined),
  assistantMessages: AssistantConversationMessage[] = [],
  assistantActionAudits: AIAssistantActionAudit[] = [],
  goals: Goal[] = [],
  projects: Project[] = [],
  milestones: Milestone[] = [],
  taskDependencies: TaskDependency[] = [],
  recurrenceDefinitions: RecurrenceDefinition[] = [],
  recurrenceOccurrences: RecurrenceOccurrence[] = [],
  recurrenceExceptions: RecurrenceException[] = [],
  routineTemplates: RoutineTemplate[] = [],
): PlannerBackup {
  return {
    format: "bunbun-planner-backup",
    version: 13,
    exportedAt,
    tasks,
    preferences,
    availability,
    availabilityOverrides,
    availabilityTemplates,
    taskSessions,
    scheduleBlocks,
    timeLogs,
    notifications,
    reminders,
    notificationSettings,
    calendarConnection,
    calendarSettings,
    calendarSyncRecords,
    aiSettings,
    assistantMessages: aiSettings.conversationHistoryEnabled ? assistantMessages.slice(-aiSettings.maximumHistoryMessages) : [],
    assistantActionAudits,
    goals,
    projects,
    milestones,
    taskDependencies,
    recurrenceDefinitions,
    recurrenceOccurrences,
    recurrenceExceptions,
    routineTemplates,
  };
}

export function parsePlannerBackup(json: string, now = new Date().toISOString()): PlannerBackup {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== "object") throw new Error("Backup must be a JSON object.");
  const candidate = value as Partial<PlannerBackup>;
  const version = candidate.version;
  if (candidate.format !== "bunbun-planner-backup" || (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6 && version !== 7 && version !== 8 && version !== 9 && version !== 10 && version !== 11 && version !== 12 && version !== 13)) {
    throw new Error("Unsupported planner backup format or version.");
  }
  if (!candidate.preferences || typeof candidate.preferences !== "object") {
    throw new Error("Backup preferences are missing.");
  }
  const preferences = candidate.preferences as Partial<BackupPreferences>;
  if (
    typeof preferences.musicQuery !== "string" ||
    typeof preferences.checklistNote !== "string" ||
    !preferences.checklistByDate ||
    typeof preferences.checklistByDate !== "object" ||
    !Array.isArray(preferences.projects)
  ) {
    throw new Error("Backup preferences are invalid.");
  }

  return {
    format: "bunbun-planner-backup",
    version,
    exportedAt: typeof candidate.exportedAt === "string" ? candidate.exportedAt : now,
    tasks: migrateTasks(candidate.tasks),
    preferences: preferences as BackupPreferences,
    availability: candidate.availability === undefined ? [] : migrateAvailabilityBlocks(candidate.availability),
    availabilityOverrides: candidate.availabilityOverrides === undefined ? [] : migrateAvailabilityOverrides(candidate.availabilityOverrides),
    availabilityTemplates: candidate.availabilityTemplates === undefined ? [] : migrateAvailabilityTemplates(candidate.availabilityTemplates),
    taskSessions: candidate.taskSessions === undefined ? [] : migrateTaskSessions(candidate.taskSessions),
    scheduleBlocks: candidate.scheduleBlocks === undefined ? [] : migrateScheduleBlocks(candidate.scheduleBlocks),
    timeLogs: candidate.timeLogs === undefined ? [] : migrateTimeLogs(candidate.timeLogs),
    notifications: candidate.notifications === undefined ? [] : migratePlannerNotifications(candidate.notifications),
    reminders: candidate.reminders === undefined ? [] : migrateReminders(candidate.reminders),
    notificationSettings: migrateNotificationSettings(candidate.notificationSettings),
    calendarConnection: migrateCalendarConnection(candidate.calendarConnection),
    calendarSettings: migrateCalendarSettings(candidate.calendarSettings),
    calendarSyncRecords: migrateSyncRecords(candidate.calendarSyncRecords),
    aiSettings: migrateAISettings(candidate.aiSettings),
    assistantMessages: migrateAssistantMessages(candidate.assistantMessages),
    assistantActionAudits: migrateAssistantAudits(candidate.assistantActionAudits),
    goals: migrateGoals(candidate.goals),
    projects: migrateProjects(candidate.projects),
    milestones: migrateMilestones(candidate.milestones),
    taskDependencies: migrateDependencies(candidate.taskDependencies),
    recurrenceDefinitions: migrateRecurrenceDefinitions(candidate.recurrenceDefinitions),
    recurrenceOccurrences: migrateRecurrenceOccurrences(candidate.recurrenceOccurrences),
    recurrenceExceptions: migrateRecurrenceExceptions(candidate.recurrenceExceptions),
    routineTemplates: migrateRoutineTemplates(candidate.routineTemplates),
  };
}

export function mergeBackupTasks(current: TaskRecord[], imported: TaskRecord[]): TaskRecord[] {
  const merged = new Map(current.map((task) => [task.id, task]));
  imported.forEach((task) => {
    const existing = merged.get(task.id);
    if (!existing || task.updatedAt > existing.updatedAt) merged.set(task.id, task);
  });
  return Array.from(merged.values());
}
