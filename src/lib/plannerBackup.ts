import { migrateTasks, type TaskRecord } from "./taskHistory";

export interface BackupPreferences {
  musicQuery: string;
  checklistByDate: unknown;
  projects: unknown;
  checklistNote: string;
}

export interface PlannerBackup {
  format: "bunbun-planner-backup";
  version: 1;
  exportedAt: string;
  tasks: TaskRecord[];
  preferences: BackupPreferences;
}

export function createPlannerBackup(
  tasks: TaskRecord[],
  preferences: BackupPreferences,
  exportedAt = new Date().toISOString(),
): PlannerBackup {
  return {
    format: "bunbun-planner-backup",
    version: 1,
    exportedAt,
    tasks,
    preferences,
  };
}

export function parsePlannerBackup(json: string, now = new Date().toISOString()): PlannerBackup {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== "object") throw new Error("Backup must be a JSON object.");
  const candidate = value as Partial<PlannerBackup>;
  if (candidate.format !== "bunbun-planner-backup" || candidate.version !== 1) {
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
    version: 1,
    exportedAt: typeof candidate.exportedAt === "string" ? candidate.exportedAt : now,
    tasks: migrateTasks(candidate.tasks, now),
    preferences: preferences as BackupPreferences,
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
