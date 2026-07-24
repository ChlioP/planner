import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  runTransaction,
  type DocumentData,
} from "firebase/firestore";
import { firestore } from "./firebase";
import { migrateTask, type TaskRecord } from "./taskHistory";
import {
  mergeAvailabilityCopies,
  migrateAvailabilityBlock,
  migrateAvailabilityOverride,
  type AvailabilityBlock,
  type AvailabilityOverride,
} from "./availability";
import { mergeTemplateCopies, migrateAvailabilityTemplate, type AvailabilityTemplate } from "./availabilityTemplates";
import { mergeSessionCopies, migrateTaskSession, type TaskSession } from "./taskSessions";
import { mergeScheduleBlockCopies, migrateScheduleBlock, type ScheduleBlock } from "./scheduleBlocks";
import { mergeTimeLogCopies, migrateTimeLog, type TimeLog } from "./timeLogs";
import {
  mergeNotificationCopies,
  mergeReminderCopies,
  migrateNotificationSettings,
  migratePlannerNotification,
  migrateReminder,
  type NotificationSettings,
  type PlannerNotification,
  type Reminder,
} from "./notifications";
import {
  mergeSyncRecords,
  migrateCalendarConnection,
  migrateCalendarSettings,
  migrateSyncRecords,
  type CalendarConnection,
  type CalendarSyncRecord,
  type CalendarSyncSettings,
} from "./calendarIntegration";
import {
  mergeAssistantRecords,
  migrateAISettings,
  migrateAssistantAudits,
  migrateAssistantMessages,
  type AIAssistantActionAudit,
  type AIAssistantSettings,
  type AssistantConversationMessage,
} from "./planningAssistant";
import {
  mergePlanningRecords,
  migrateDependencies,
  migrateGoals,
  migrateMilestones,
  migrateProjects,
  type Goal,
  type Milestone,
  type Project,
  type TaskDependency,
} from "./projectPlanning";
import {
  mergeRecurrenceRecords,
  migrateRecurrenceDefinitions,
  migrateRecurrenceExceptions,
  migrateRecurrenceOccurrences,
  migrateRoutineTemplates,
  type RecurrenceDefinition,
  type RecurrenceOccurrence,
  type RecurrenceException,
  type RoutineTemplate,
} from "./recurrence";

export interface PlannerPreferences {
  musicQuery: string;
  checklistByDate: unknown;
  projects: unknown;
  checklistNote: string;
}

function requireFirestore() {
  if (!firestore) throw new Error("Firebase is not configured.");
  return firestore;
}

function taskCollection(userId: string) {
  return collection(requireFirestore(), "users", userId, "tasks");
}

function preferencesDocument(userId: string) {
  return doc(requireFirestore(), "users", userId, "settings", "preferences");
}

function availabilityCollection(userId: string) {
  return collection(requireFirestore(), "users", userId, "availability");
}

function availabilityOverridesCollection(userId: string) {
  return collection(requireFirestore(), "users", userId, "availabilityOverrides");
}

function availabilityTemplatesCollection(userId: string) {
  return collection(requireFirestore(), "users", userId, "availabilityTemplates");
}

function taskSessionsCollection(userId: string) {
  return collection(requireFirestore(), "users", userId, "taskSessions");
}

function scheduleBlocksCollection(userId: string) {
  return collection(requireFirestore(), "users", userId, "scheduleBlocks");
}

function timeLogsCollection(userId: string) {
  return collection(requireFirestore(), "users", userId, "timeLogs");
}
function notificationsCollection(userId: string) { return collection(requireFirestore(), "users", userId, "notifications"); }
function remindersCollection(userId: string) { return collection(requireFirestore(), "users", userId, "reminders"); }
function notificationSettingsDocument(userId: string) { return doc(requireFirestore(), "users", userId, "settings", "notifications"); }
function calendarConnectionDocument(userId: string) { return doc(requireFirestore(), "users", userId, "calendarConnections", "google"); }
function calendarSettingsDocument(userId: string) { return doc(requireFirestore(), "users", userId, "calendarSyncSettings", "google"); }
function calendarSyncRecordsCollection(userId: string) { return collection(requireFirestore(), "users", userId, "calendarSyncRecords"); }
function aiSettingsDocument(userId: string) { return doc(requireFirestore(), "users", userId, "settings", "aiAssistant"); }
function assistantMessagesCollection(userId: string) { return collection(requireFirestore(), "users", userId, "assistantMessages"); }
function assistantAuditsCollection(userId: string) { return collection(requireFirestore(), "users", userId, "assistantActionAudits"); }
function goalsCollection(userId: string) { return collection(requireFirestore(), "users", userId, "goals"); }
function projectsCollection(userId: string) { return collection(requireFirestore(), "users", userId, "projects"); }
function milestonesCollection(userId: string) { return collection(requireFirestore(), "users", userId, "milestones"); }
function dependenciesCollection(userId: string) { return collection(requireFirestore(), "users", userId, "taskDependencies"); }
function recurrenceDefinitionsCollection(userId: string) { return collection(requireFirestore(), "users", userId, "recurrenceDefinitions"); }
function recurrenceOccurrencesCollection(userId: string) { return collection(requireFirestore(), "users", userId, "recurrenceOccurrences"); }
function recurrenceExceptionsCollection(userId: string) { return collection(requireFirestore(), "users", userId, "recurrenceExceptions"); }
function routineTemplatesCollection(userId: string) { return collection(requireFirestore(), "users", userId, "routineTemplates"); }

function toISOString(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return typeof value === "string" ? value : null;
}

function fromFirestoreTask(data: DocumentData, id: string): TaskRecord {
  return migrateTask({
    ...data,
    id,
    createdAt: toISOString(data.createdAt) ?? undefined,
    updatedAt: toISOString(data.updatedAt) ?? undefined,
    completedAt: toISOString(data.completedAt),
    archivedAt: toISOString(data.archivedAt),
  });
}

export function mergeTaskCopies(localTasks: TaskRecord[], remoteTasks: TaskRecord[]): TaskRecord[] {
  const merged = new Map(localTasks.map((task) => [task.id, task]));
  remoteTasks.forEach((remoteTask) => {
    const localTask = merged.get(remoteTask.id);
    if (!localTask || remoteTask.updatedAt > localTask.updatedAt) merged.set(remoteTask.id, remoteTask);
  });
  return Array.from(merged.values());
}

export async function getUserPreferences(userId: string) {
  const snapshot = await getDoc(preferencesDocument(userId));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function loadUserTasks(userId: string): Promise<TaskRecord[]> {
  const snapshot = await getDocs(taskCollection(userId));
  return snapshot.docs.map((taskDocument) => fromFirestoreTask(taskDocument.data(), taskDocument.id));
}

export async function loadUserAvailability(userId: string): Promise<{ blocks: AvailabilityBlock[]; overrides: AvailabilityOverride[] }> {
  const [blockSnapshot, overrideSnapshot] = await Promise.all([
    getDocs(availabilityCollection(userId)),
    getDocs(availabilityOverridesCollection(userId)),
  ]);
  return {
    blocks: blockSnapshot.docs.map((item) => migrateAvailabilityBlock({ ...item.data(), id: item.id, createdAt: toISOString(item.data().createdAt) ?? undefined, updatedAt: toISOString(item.data().updatedAt) ?? undefined })),
    overrides: overrideSnapshot.docs.map((item) => migrateAvailabilityOverride({ ...item.data(), id: item.id, createdAt: toISOString(item.data().createdAt) ?? undefined, updatedAt: toISOString(item.data().updatedAt) ?? undefined })),
  };
}

export async function loadUserAvailabilityTemplates(userId: string): Promise<AvailabilityTemplate[]> {
  const snapshot = await getDocs(availabilityTemplatesCollection(userId));
  return snapshot.docs.map((item) => migrateAvailabilityTemplate({
    ...item.data(),
    id: item.id,
    createdAt: toISOString(item.data().createdAt) ?? undefined,
    updatedAt: toISOString(item.data().updatedAt) ?? undefined,
  }));
}

export async function loadUserTaskSessions(userId: string): Promise<TaskSession[]> {
  const snapshot = await getDocs(taskSessionsCollection(userId));
  return snapshot.docs.map((item) => migrateTaskSession({
    ...item.data(),
    id: item.id,
    createdAt: toISOString(item.data().createdAt) ?? undefined,
    updatedAt: toISOString(item.data().updatedAt) ?? undefined,
    completedAt: toISOString(item.data().completedAt) ?? undefined,
    archivedAt: toISOString(item.data().archivedAt) ?? undefined,
  }));
}

export async function loadUserScheduleBlocks(userId: string): Promise<ScheduleBlock[]> {
  const snapshot = await getDocs(scheduleBlocksCollection(userId));
  return snapshot.docs.map((item) => migrateScheduleBlock({
    ...item.data(),
    id: item.id,
    createdAt: toISOString(item.data().createdAt) ?? undefined,
    updatedAt: toISOString(item.data().updatedAt) ?? undefined,
  }));
}

export async function loadUserTimeLogs(userId: string): Promise<TimeLog[]> {
  const snapshot = await getDocs(timeLogsCollection(userId));
  return snapshot.docs.map((item) => migrateTimeLog({
    ...item.data(), id: item.id,
    startedAt: toISOString(item.data().startedAt) ?? item.data().startedAt,
    endedAt: toISOString(item.data().endedAt) ?? item.data().endedAt,
    lastResumedAt: toISOString(item.data().lastResumedAt) ?? item.data().lastResumedAt,
    createdAt: toISOString(item.data().createdAt) ?? undefined,
    updatedAt: toISOString(item.data().updatedAt) ?? undefined,
  }));
}

export async function loadUserNotifications(userId: string): Promise<PlannerNotification[]> {
  const snapshot = await getDocs(notificationsCollection(userId));
  return snapshot.docs.map((item) => migratePlannerNotification({
    ...item.data(), id: item.id,
    generatedAt: toISOString(item.data().generatedAt) ?? item.data().generatedAt,
    scheduledFor: toISOString(item.data().scheduledFor) ?? item.data().scheduledFor,
    readAt: toISOString(item.data().readAt) ?? item.data().readAt,
    dismissedAt: toISOString(item.data().dismissedAt) ?? item.data().dismissedAt,
    deliveredAt: toISOString(item.data().deliveredAt) ?? item.data().deliveredAt,
    expiresAt: toISOString(item.data().expiresAt) ?? item.data().expiresAt,
    createdAt: toISOString(item.data().createdAt) ?? undefined,
    updatedAt: toISOString(item.data().updatedAt) ?? undefined,
  }));
}

export async function loadUserReminders(userId: string): Promise<Reminder[]> {
  const snapshot = await getDocs(remindersCollection(userId));
  return snapshot.docs.map((item) => migrateReminder({
    ...item.data(), id: item.id,
    snoozedUntil: toISOString(item.data().snoozedUntil) ?? item.data().snoozedUntil,
    lastTriggeredAt: toISOString(item.data().lastTriggeredAt) ?? item.data().lastTriggeredAt,
    nextTriggerAt: toISOString(item.data().nextTriggerAt) ?? item.data().nextTriggerAt,
    createdAt: toISOString(item.data().createdAt) ?? undefined,
    updatedAt: toISOString(item.data().updatedAt) ?? undefined,
  }));
}

export async function loadUserNotificationSettings(userId: string): Promise<NotificationSettings | null> {
  const snapshot = await getDoc(notificationSettingsDocument(userId));
  return snapshot.exists() ? migrateNotificationSettings(snapshot.data()) : null;
}
export async function loadUserCalendarData(userId: string): Promise<{ connection: CalendarConnection | null; settings: CalendarSyncSettings | null; records: CalendarSyncRecord[] }> {
  const [connection, settings, records] = await Promise.all([
    getDoc(calendarConnectionDocument(userId)), getDoc(calendarSettingsDocument(userId)), getDocs(calendarSyncRecordsCollection(userId)),
  ]);
  return {
    connection: connection.exists() ? migrateCalendarConnection(connection.data()) : null,
    settings: settings.exists() ? migrateCalendarSettings(settings.data()) : null,
    records: migrateSyncRecords(records.docs.map((item) => ({ ...item.data(), id: item.id, createdAt: toISOString(item.data().createdAt) ?? item.data().createdAt, updatedAt: toISOString(item.data().updatedAt) ?? item.data().updatedAt }))),
  };
}
export async function loadUserAssistantData(userId: string): Promise<{ settings: AIAssistantSettings | null; messages: AssistantConversationMessage[]; audits: AIAssistantActionAudit[] }> {
  const [settings, messages, audits] = await Promise.all([getDoc(aiSettingsDocument(userId)), getDocs(assistantMessagesCollection(userId)), getDocs(assistantAuditsCollection(userId))]);
  return {
    settings: settings.exists() ? migrateAISettings(settings.data()) : null,
    messages: migrateAssistantMessages(messages.docs.map((item) => ({ ...item.data(), id: item.id, createdAt: toISOString(item.data().createdAt) ?? item.data().createdAt }))),
    audits: migrateAssistantAudits(audits.docs.map((item) => ({ ...item.data(), id: item.id, createdAt: toISOString(item.data().createdAt) ?? item.data().createdAt, updatedAt: toISOString(item.data().updatedAt) ?? item.data().updatedAt }))),
  };
}
export async function loadUserProjectPlanning(userId: string): Promise<{ goals: Goal[]; projects: Project[]; milestones: Milestone[]; dependencies: TaskDependency[] }> {
  const [goals, projects, milestones, dependencies] = await Promise.all([getDocs(goalsCollection(userId)), getDocs(projectsCollection(userId)), getDocs(milestonesCollection(userId)), getDocs(dependenciesCollection(userId))]);
  const records = (snapshot: typeof goals) => snapshot.docs.map((item) => ({ ...item.data(), id: item.id, createdAt: toISOString(item.data().createdAt) ?? item.data().createdAt, updatedAt: toISOString(item.data().updatedAt) ?? item.data().updatedAt, completedAt: toISOString(item.data().completedAt) ?? item.data().completedAt, archivedAt: toISOString(item.data().archivedAt) ?? item.data().archivedAt }));
  return { goals: migrateGoals(records(goals)), projects: migrateProjects(records(projects)), milestones: migrateMilestones(records(milestones)), dependencies: migrateDependencies(records(dependencies)) };
}
export async function loadUserRecurrenceData(userId: string): Promise<{ definitions: RecurrenceDefinition[]; occurrences: RecurrenceOccurrence[]; exceptions: RecurrenceException[]; templates: RoutineTemplate[] }> {
  const [definitions, occurrences, exceptions, templates] = await Promise.all([getDocs(recurrenceDefinitionsCollection(userId)), getDocs(recurrenceOccurrencesCollection(userId)), getDocs(recurrenceExceptionsCollection(userId)), getDocs(routineTemplatesCollection(userId))]);
  const records = (snapshot: typeof definitions) => snapshot.docs.map((item) => ({ ...item.data(), id: item.id, createdAt: toISOString(item.data().createdAt) ?? item.data().createdAt, updatedAt: toISOString(item.data().updatedAt) ?? item.data().updatedAt, completedAt: toISOString(item.data().completedAt) ?? item.data().completedAt, archivedAt: toISOString(item.data().archivedAt) ?? item.data().archivedAt }));
  return { definitions: migrateRecurrenceDefinitions(records(definitions)), occurrences: migrateRecurrenceOccurrences(records(occurrences)), exceptions: migrateRecurrenceExceptions(records(exceptions)), templates: migrateRoutineTemplates(records(templates)) };
}
export const mergeRecurrenceDefinitionData = mergeRecurrenceRecords<RecurrenceDefinition>;
export const mergeRecurrenceOccurrenceData = mergeRecurrenceRecords<RecurrenceOccurrence>;
export const mergeRecurrenceExceptionData = mergeRecurrenceRecords<RecurrenceException>;
export const mergeRoutineTemplateData = mergeRecurrenceRecords<RoutineTemplate>;

async function syncCollection<T extends { id: string; createdAt: string }>(
  reference: ReturnType<typeof collection>,
  records: T[],
) {
  const db = requireFirestore();
  const chunks: T[][] = [];
  for (let index = 0; index < records.length; index += 100) chunks.push(records.slice(index, index + 100));
  for (const chunk of chunks) {
    await Promise.all(chunk.map((record) => runTransaction(db, async (transaction) => {
      const target = doc(reference, record.id);
      const existing = await transaction.get(target);
      const data = existing.data();
      const operationId = `${record.id}:${"updatedAt" in record ? String(record.updatedAt) : record.createdAt}`;
      if (data?.lastOperationId === operationId) return;
      transaction.set(target, {
        ...record,
        createdAt: data?.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
        schemaVersion: typeof data?.schemaVersion === "number" ? data.schemaVersion : 1,
        entityVersion: (typeof data?.entityVersion === "number" ? data.entityVersion : 0) + 1,
        lastOperationId: operationId,
      }, { merge: true });
    })));
  }
}

export async function syncUserAvailability(userId: string, blocks: AvailabilityBlock[], overrides: AvailabilityOverride[]) {
  await Promise.all([
    syncCollection(availabilityCollection(userId), blocks),
    syncCollection(availabilityOverridesCollection(userId), overrides),
  ]);
}

export async function syncUserAvailabilityTemplates(userId: string, templates: AvailabilityTemplate[]) {
  await syncCollection(availabilityTemplatesCollection(userId), templates);
}

export async function syncUserTaskSessions(userId: string, sessions: TaskSession[]) {
  await syncCollection(taskSessionsCollection(userId), sessions);
}

export async function syncUserScheduleBlocks(userId: string, blocks: ScheduleBlock[]) {
  await syncCollection(scheduleBlocksCollection(userId), blocks);
}

export async function syncUserTimeLogs(userId: string, logs: TimeLog[]) {
  await syncCollection(timeLogsCollection(userId), logs);
}
export async function syncUserNotifications(userId: string, records: PlannerNotification[]) { await syncCollection(notificationsCollection(userId), records); }
export async function syncUserReminders(userId: string, records: Reminder[]) { await syncCollection(remindersCollection(userId), records); }
export async function syncUserNotificationSettings(userId: string, settings: NotificationSettings) {
  await setDoc(notificationSettingsDocument(userId), { ...settings, updatedAt: serverTimestamp() }, { merge: true });
}
export async function syncUserCalendarData(userId: string, connection: CalendarConnection, settings: CalendarSyncSettings, records: CalendarSyncRecord[]) {
  const safeConnection = { ...connection } as Record<string, unknown>;
  delete safeConnection.accessToken; delete safeConnection.refreshToken; delete safeConnection.clientSecret;
  await Promise.all([
    setDoc(calendarConnectionDocument(userId), { ...safeConnection, updatedAt: serverTimestamp() }, { merge: true }),
    setDoc(calendarSettingsDocument(userId), { ...settings, updatedAt: serverTimestamp() }, { merge: true }),
    syncCollection(calendarSyncRecordsCollection(userId), records),
  ]);
}
export async function syncUserAssistantData(userId: string, settings: AIAssistantSettings, messages: AssistantConversationMessage[], audits: AIAssistantActionAudit[]) {
  await Promise.all([
    setDoc(aiSettingsDocument(userId), { ...settings, updatedAt: serverTimestamp() }, { merge: true }),
    syncCollection(assistantMessagesCollection(userId), settings.conversationHistoryEnabled ? messages.slice(-settings.maximumHistoryMessages) : []),
    syncCollection(assistantAuditsCollection(userId), audits),
  ]);
}
export async function syncUserProjectPlanning(userId: string, goals: Goal[], projects: Project[], milestones: Milestone[], dependencies: TaskDependency[]) {
  await Promise.all([syncCollection(goalsCollection(userId), goals), syncCollection(projectsCollection(userId), projects), syncCollection(milestonesCollection(userId), milestones), syncCollection(dependenciesCollection(userId), dependencies)]);
}
export async function syncUserRecurrenceData(userId: string, definitions: RecurrenceDefinition[], occurrences: RecurrenceOccurrence[], exceptions: RecurrenceException[], templates: RoutineTemplate[]) {
  await Promise.all([syncCollection(recurrenceDefinitionsCollection(userId), definitions), syncCollection(recurrenceOccurrencesCollection(userId), occurrences), syncCollection(recurrenceExceptionsCollection(userId), exceptions), syncCollection(routineTemplatesCollection(userId), templates)]);
}

export function mergeAvailabilityData(local: AvailabilityBlock[], remote: AvailabilityBlock[]): AvailabilityBlock[] {
  return mergeAvailabilityCopies(local, remote);
}

export function mergeOverrideCopies(local: AvailabilityOverride[], remote: AvailabilityOverride[]): AvailabilityOverride[] {
  const merged = new Map(local.map((override) => [override.id, override]));
  for (const override of remote) {
    const existing = merged.get(override.id);
    if (!existing || override.updatedAt > existing.updatedAt) merged.set(override.id, override);
  }
  return Array.from(merged.values());
}

export function mergeAvailabilityTemplateData(local: AvailabilityTemplate[], remote: AvailabilityTemplate[]): AvailabilityTemplate[] {
  return mergeTemplateCopies(local, remote);
}

export function mergeTaskSessionData(local: TaskSession[], remote: TaskSession[]): TaskSession[] {
  return mergeSessionCopies(local, remote);
}

export function mergeScheduleBlockData(local: ScheduleBlock[], remote: ScheduleBlock[]): ScheduleBlock[] {
  return mergeScheduleBlockCopies(local, remote);
}

export function mergeTimeLogData(local: TimeLog[], remote: TimeLog[]): TimeLog[] {
  return mergeTimeLogCopies(local, remote);
}
export function mergeNotificationData(local: PlannerNotification[], remote: PlannerNotification[]) { return mergeNotificationCopies(local, remote); }
export function mergeReminderData(local: Reminder[], remote: Reminder[]) { return mergeReminderCopies(local, remote); }
export function mergeCalendarSyncRecordData(local: CalendarSyncRecord[], remote: CalendarSyncRecord[]) { return mergeSyncRecords(local, remote); }
export function mergeAssistantMessageData(local: AssistantConversationMessage[], remote: AssistantConversationMessage[]) { return mergeAssistantRecords(local, remote); }
export function mergeAssistantAuditData(local: AIAssistantActionAudit[], remote: AIAssistantActionAudit[]) { return mergeAssistantRecords(local, remote); }
export function mergeGoalData(local: Goal[], remote: Goal[]) { return mergePlanningRecords(local, remote); }
export function mergeProjectData(local: Project[], remote: Project[]) { return mergePlanningRecords(local, remote); }
export function mergeMilestoneData(local: Milestone[], remote: Milestone[]) { return mergePlanningRecords(local, remote); }
export function mergeDependencyData(local: TaskDependency[], remote: TaskDependency[]) { return mergePlanningRecords(local, remote); }

async function writeTasks(userId: string, tasks: TaskRecord[]) {
  const db = requireFirestore();
  const chunks: TaskRecord[][] = [];
  for (let index = 0; index < tasks.length; index += 100) chunks.push(tasks.slice(index, index + 100));

  for (const chunk of chunks) {
    await Promise.all(chunk.map((task) => runTransaction(db, async (transaction) => {
      const target = doc(taskCollection(userId), task.id);
      const existing = await transaction.get(target);
      const data = existing.data();
      const operationId = `${task.id}:${task.updatedAt}`;
      if (data?.lastOperationId === operationId) return;
      transaction.set(target, {
        ...task,
        createdAt: data?.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
        schemaVersion: typeof data?.schemaVersion === "number" ? data.schemaVersion : 1,
        entityVersion: (typeof data?.entityVersion === "number" ? data.entityVersion : 0) + 1,
        lastOperationId: operationId,
      }, { merge: true });
    })));
  }
}

export async function migrateLocalData(
  userId: string,
  tasks: TaskRecord[],
  preferences: PlannerPreferences,
) {
  await writeTasks(userId, tasks);

  const verification = await getDocs(taskCollection(userId));
  const verifiedIds = new Set(verification.docs.map((item) => item.id));
  if (!tasks.every((task) => verifiedIds.has(task.id))) {
    throw new Error("Firestore migration verification failed.");
  }

  await setDoc(preferencesDocument(userId), {
    ...preferences,
    localMigrationComplete: true,
    migratedTaskCount: tasks.length,
    migrationCompletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function syncUserData(
  userId: string,
  tasks: TaskRecord[],
  preferences: PlannerPreferences,
) {
  await writeTasks(userId, tasks);
  await setDoc(preferencesDocument(userId), {
    ...preferences,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
