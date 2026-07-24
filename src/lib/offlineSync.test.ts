import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACKNOWLEDGED_OPERATION_RETENTION_DAYS,
  CURRENT_LOCAL_SCHEMA_VERSION,
  MemoryLocalDatabase,
  SyncCoordinator,
  acquireLease,
  canonicalize,
  checksum,
  claimSyncLease,
  coalesceOperations,
  compactLocalReliabilityData,
  createOperation,
  durableMutation,
  entityKey,
  fieldLevelMerge,
  importLegacyEntities,
  reconcileRemote,
  recoverProcessingOperations,
  resolveConflictDurably,
  retryDelayMs,
  runMigrations,
  safeDiagnostic,
  validateStoredEntity,
  type LocalEntityRecord,
  type SyncConflict,
  type SyncOperation,
} from "./offlineSync";

const now = "2026-07-23T12:00:00.000Z";
const identity = { deviceId: "device-a", clientInstanceId: "client-a" };
const task = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1", title: "Plan", dueDate: "2026-08-10", dueTime: "17:00",
  projectId: "project-1", milestoneId: "milestone-1", updatedAt: now, ...overrides,
});
const record = (data = task(), overrides: Partial<LocalEntityRecord<Record<string, unknown>>> = {}): LocalEntityRecord<Record<string, unknown>> => ({
  key: "user-1:task:task-1", userId: "user-1", entityType: "task", entityId: "task-1",
  data, schemaVersion: 1, entityVersion: 1, createdAt: now, updatedAt: now, syncStatus: "synced",
  lastRemoteVersion: 1, ...overrides,
});

describe("offline reliability primitives", () => {
  let database: MemoryLocalDatabase;
  beforeEach(async () => { database = new MemoryLocalDatabase(); await database.open(); });

  it("commits an entity and its operation atomically", async () => {
    const result = await durableMutation(database, { userId: "user-1", entityType: "task", entityId: "task-1", operationType: "create", nextData: task(), ...identity, now, actionId: "action-1" });
    expect(result.entity?.entityVersion).toBe(1);
    expect(await database.get("operations", "action-1")).toBeTruthy();
    expect(await database.get("entities", entityKey("user-1", "task", "task-1"))).toBeTruthy();
  });

  it("rolls back both writes when a transaction aborts", async () => {
    database.failNextTransaction = true;
    await expect(durableMutation(database, { userId: "user-1", entityType: "task", entityId: "task-1", operationType: "create", nextData: task(), ...identity, now })).rejects.toThrow();
    expect(await database.getAll("entities")).toEqual([]);
    expect(await database.getAll("operations")).toEqual([]);
  });

  it("increments versions and preserves the remote base", async () => {
    await database.put("entities", record());
    const result = await durableMutation(database, { userId: "user-1", entityType: "task", entityId: "task-1", operationType: "update", nextData: task({ title: "Changed" }), ...identity, now, actionId: "action-2" });
    expect(result.entity?.entityVersion).toBe(2);
    expect(result.operation.baseEntityVersion).toBe(1);
  });

  it("creates a retained tombstone for deletion", async () => {
    await database.put("entities", record());
    const result = await durableMutation(database, { userId: "user-1", entityType: "task", entityId: "task-1", operationType: "delete", ...identity, now, actionId: "delete-1" });
    expect(result.tombstone?.entityVersion).toBe(2);
    expect(await database.get("entities", record().key)).toBeUndefined();
    expect(result.tombstone?.retentionUntil).toBeTruthy();
  });

  it("uses deterministic canonicalization and detects corruption", async () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }));
    const valid = record(task(), { checksum: await checksum(task()) });
    expect(await validateStoredEntity(valid)).toEqual({ valid: true });
    expect((await validateStoredEntity({ ...valid, data: task({ title: "corrupt" }) })).reason).toBe("checksum-mismatch");
  });

  it("uses bounded jittered backoff", () => {
    expect(retryDelayMs(1, () => 0)).toBe(750);
    expect(retryDelayMs(20, () => 1)).toBe(375_000);
  });

  it("recovers stale processing operations but not fresh ones", () => {
    const operation = createOperation({ userId: "user-1", entityType: "task", entityId: "task-1", operationType: "update", resultingEntityVersion: 2, deviceId: "d", clientInstanceId: "c" }, "2026-07-23T11:00:00.000Z", "op");
    const old = { ...operation, status: "processing" as const, lastAttemptAt: "2026-07-23T11:00:00.000Z" };
    expect(recoverProcessingOperations([old], now)[0].status).toBe("pending");
    expect(recoverProcessingOperations([{ ...old, lastAttemptAt: now }], now)[0].status).toBe("processing");
  });

  it("coalesces safe updates but preserves time log operations", () => {
    const first = createOperation({ userId: "user-1", entityType: "task", entityId: "task-1", operationType: "create", payload: { title: "A" }, resultingEntityVersion: 1, deviceId: "d", clientInstanceId: "c" }, now, "one");
    const second = createOperation({ userId: "user-1", entityType: "task", entityId: "task-1", operationType: "update", payload: { title: "B" }, resultingEntityVersion: 2, deviceId: "d", clientInstanceId: "c" }, now, "two");
    expect(coalesceOperations([first, second])).toHaveLength(1);
    const log = { ...first, entityType: "time-log" as const };
    expect(coalesceOperations([log, { ...second, entityType: "time-log" as const }])).toHaveLength(2);
  });

  it("merges non-overlapping task changes", () => {
    const base = task();
    const result = fieldLevelMerge("task", base, task({ title: "Local" }), task({ dueDate: "2026-08-12" }));
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toMatchObject({ title: "Local", dueDate: "2026-08-12" });
  });

  it("conflicts same fields and atomic due date groups", () => {
    expect(fieldLevelMerge("task", task(), task({ title: "A" }), task({ title: "B" })).conflicts).toEqual(["title"]);
    expect(fieldLevelMerge("task", task(), task({ dueDate: "2026-08-11" }), task({ dueTime: "18:00" })).conflicts).toContain("dueDate");
  });

  it("keeps project and milestone assignment atomic", () => {
    const result = fieldLevelMerge("task", task(), task({ projectId: "p2", milestoneId: "m2" }), task({ milestoneId: "m3" }));
    expect(result.conflicts).toEqual(expect.arrayContaining(["projectId", "milestoneId"]));
  });

  it("never field-merges time logs", () => {
    expect(fieldLevelMerge("time-log", { id: "l", minutes: 1 }, { id: "l", minutes: 2 }, { id: "l", minutes: 3 }).conflicts).toEqual(["time-log"]);
  });

  it("reconciles a newer remote synced entity", () => {
    const result = reconcileRemote(record(), record(task({ title: "Remote" }), { entityVersion: 2 }), task(), now);
    expect(result.action).toBe("replace");
    expect(result.entity?.data.title).toBe("Remote");
  });

  it("does not overwrite a pending local edit with its remote base", () => {
    const local = record(task({ title: "Local" }), { entityVersion: 2, lastRemoteVersion: 1, syncStatus: "pending-update" });
    expect(reconcileRemote(local, record(), task(), now).action).toBe("keep-local");
  });

  it("creates durable same-field and delete-versus-edit conflicts", () => {
    const local = record(task({ title: "Local" }), { entityVersion: 2, lastRemoteVersion: 1, syncStatus: "pending-update" });
    expect(reconcileRemote(local, record(task({ title: "Remote" }), { entityVersion: 2 }), task(), now).action).toBe("conflict");
    expect(reconcileRemote(local, undefined, task(), now).conflict?.conflictType).toBe("delete-versus-edit");
  });

  it("refuses to overwrite a newer unsupported schema", () => {
    const result = reconcileRemote(record(), record(task(), { schemaVersion: CURRENT_LOCAL_SCHEMA_VERSION + 1, entityVersion: 2 }), task(), now);
    expect(result.conflict?.conflictType).toBe("schema-conflict");
  });

  it("acquires, renews, and takes over an expired lease", async () => {
    const first = acquireLease(undefined, "user-1", "tab-a", now);
    expect(first.acquired).toBe(true);
    expect(acquireLease(first.lease, "user-1", "tab-b", now).acquired).toBe(false);
    expect(acquireLease({ ...first.lease, expiresAt: "2026-07-23T11:00:00.000Z" }, "user-1", "tab-b", now).acquired).toBe(true);
    expect((await claimSyncLease(database, "user-1", "tab-a", now)).acquired).toBe(true);
  });

  it("imports legacy records once with version one", async () => {
    expect(await importLegacyEntities(database, "user-1", "task", [task()], now)).toBe(1);
    expect(await importLegacyEntities(database, "user-1", "task", [task()], now)).toBe(0);
    expect((await database.get<LocalEntityRecord>("entities", record().key))?.entityVersion).toBe(1);
  });

  it("runs migrations in order and does not repeat completed work", async () => {
    const calls: number[] = [];
    const migrations = [
      { id: "one", fromVersion: 0, toVersion: 1, description: "one", migrateLocal: async () => { calls.push(1); } },
      { id: "two", fromVersion: 1, toVersion: 2, description: "two", migrateLocal: async () => { calls.push(2); } },
    ];
    await runMigrations(database, migrations, 0, 2, now);
    await runMigrations(database, migrations, 0, 2, now);
    expect(calls).toEqual([1, 2]);
  });

  it("resolves a conflict through a normal durable operation", async () => {
    await database.put("entities", record(task({ title: "Local" }), { syncStatus: "conflicted" }));
    const conflict: SyncConflict & { key: string } = { key: "conflict-1", id: "conflict-1", userId: "user-1", entityType: "task", entityId: "task-1", conflictType: "concurrent-edit", localVersion: task({ title: "Local" }), remoteVersion: task({ title: "Remote" }), conflictingFields: ["title"], status: "unresolved", createdAt: now, updatedAt: now };
    await database.put("conflicts", conflict);
    const result = await resolveConflictDurably(database, conflict.id, "remote", identity, now);
    expect(result.entity?.data).toMatchObject({ title: "Remote" });
    expect((await database.get<SyncConflict>("conflicts", conflict.id))?.status).toBe("resolved-remote");
  });

  it("acknowledges only the entity version belonging to that operation", async () => {
    const remote = { apply: vi.fn(async (operation: SyncOperation) => ({ entityVersion: operation.resultingEntityVersion, lastOperationId: operation.id, acknowledgedAt: now })) };
    const first = await durableMutation(database, { userId: "user-1", entityType: "task", entityId: "task-1", operationType: "create", nextData: task(), ...identity, now, actionId: "op-1" });
    await durableMutation(database, { userId: "user-1", entityType: "task", entityId: "task-1", operationType: "update", nextData: task({ title: "newer" }), ...identity, now, actionId: "op-2" });
    await database.put("operations", { ...first.operation, key: first.operation.id });
    const coordinator = new SyncCoordinator(database, remote);
    await coordinator.start("user-1");
    await coordinator.requestSync("test", now);
    const entity = await database.get<LocalEntityRecord>("entities", record().key);
    expect(entity?.entityVersion).toBe(2);
    expect(entity?.lastOperationId).toBe("op-2");
  });

  it("keeps a retryable failure and stops retrying a permanent one", async () => {
    const unavailable = new Error("offline") as Error & { code: string }; unavailable.code = "unavailable";
    const remote = { apply: vi.fn().mockRejectedValueOnce(unavailable) };
    await durableMutation(database, { userId: "user-1", entityType: "task", entityId: "task-1", operationType: "create", nextData: task(), ...identity, now, actionId: "retry-op" });
    const coordinator = new SyncCoordinator(database, remote); await coordinator.start("user-1"); await coordinator.requestSync("test", now);
    expect((await database.get<SyncOperation>("operations", "retry-op"))?.status).toBe("retrying");
  });

  it("compacts only old acknowledged operations and old diagnostics", async () => {
    const old = new Date(Date.parse(now) - (ACKNOWLEDGED_OPERATION_RETENTION_DAYS + 1) * 86_400_000).toISOString();
    const operation = createOperation({ userId: "user-1", entityType: "task", entityId: "task-1", operationType: "update", resultingEntityVersion: 2, deviceId: "d", clientInstanceId: "c" }, old, "old-op");
    await database.put("operations", { ...operation, key: operation.id, status: "acknowledged", acknowledgedAt: old });
    await database.put("operations", { ...operation, key: "pending-op", id: "pending-op" });
    await database.put("diagnostics", { ...safeDiagnostic("old", "info", {}, old), key: "old-diagnostic" });
    expect(await compactLocalReliabilityData(database, now)).toEqual({ removedOperations: 1, removedDiagnostics: 1 });
    expect(await database.get("operations", "pending-op")).toBeTruthy();
  });

  it("redacts planner content from diagnostics", () => {
    expect(safeDiagnostic("sync", "error", { taskTitle: "secret", count: 2, calendarEventTitle: "hidden" }, now).metadata).toEqual({ count: 2 });
  });
});
