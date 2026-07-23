import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { firestore } from "./firebase";
import { migrateTask, type TaskRecord } from "./taskHistory";

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

async function writeTasks(userId: string, tasks: TaskRecord[]) {
  const db = requireFirestore();
  const existing = await getDocs(taskCollection(userId));
  const existingById = new Map(existing.docs.map((item) => [item.id, item.data()]));
  const chunks: TaskRecord[][] = [];
  for (let index = 0; index < tasks.length; index += 450) chunks.push(tasks.slice(index, index + 450));

  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach((task) => {
      const existingTask = existingById.get(task.id);
      batch.set(doc(taskCollection(userId), task.id), {
        ...task,
        createdAt: existingTask?.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
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
  const remoteSnapshot = await getDocs(taskCollection(userId));
  const localIds = new Set(tasks.map((task) => task.id));
  await writeTasks(userId, tasks);
  await Promise.all(
    remoteSnapshot.docs
      .filter((taskDocument) => !localIds.has(taskDocument.id))
      .map((taskDocument) => deleteDoc(taskDocument.ref)),
  );
  await setDoc(preferencesDocument(userId), {
    ...preferences,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
