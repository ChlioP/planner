export const LOCAL_DATABASE_NAME = "bunbun-planner-offline";
export const LOCAL_DATABASE_VERSION = 1;
export const CURRENT_LOCAL_SCHEMA_VERSION = 1;
export const TOMBSTONE_RETENTION_DAYS = 90;
export const ACKNOWLEDGED_OPERATION_RETENTION_DAYS = 30;
export const SYNC_LEASE_DURATION_MS = 15_000;
export const SYNC_LEASE_RENEW_MS = 5_000;
export const MAX_SYNC_BATCH_SIZE = 100;

export type PlannerEntityType =
  | "task" | "session" | "availability" | "availability-override" | "availability-template"
  | "schedule-block" | "time-log" | "reminder" | "notification-settings" | "notification"
  | "calendar-settings" | "calendar-sync-record" | "ai-settings" | "ai-conversation" | "ai-proposal"
  | "ai-audit" | "goal" | "project" | "milestone" | "dependency" | "recurrence-series"
  | "recurrence-occurrence" | "recurrence-exception" | "routine-template" | "planner-settings";
export type LocalStoreName = "entities" | "operations" | "syncState" | "conflicts" | "tombstones" | "migrations" | "leases" | "diagnostics" | "snapshots";
export type SyncStatus = "synced" | "pending-create" | "pending-update" | "pending-delete" | "conflicted" | "local-only" | "error";
export interface LocalEntityRecord<T = unknown> {
  key: string; userId: string; entityType: PlannerEntityType; entityId: string; data: T;
  schemaVersion: number; entityVersion: number; createdAt: string; updatedAt: string; syncStatus: SyncStatus;
  lastRemoteVersion?: number; lastSyncedAt?: string; checksum?: string; lastOperationId?: string;
}
export interface SyncOperation {
  id: string; userId: string; entityType: PlannerEntityType; entityId: string; operationType: "create" | "update" | "delete" | "restore" | "batch";
  payload?: unknown; baseEntityVersion?: number; resultingEntityVersion: number; idempotencyKey: string;
  status: "pending" | "processing" | "acknowledged" | "retrying" | "conflicted" | "failed" | "cancelled";
  attemptCount: number; nextAttemptAt?: string; createdAt: string; updatedAt: string; lastAttemptAt?: string; acknowledgedAt?: string;
  errorCode?: string; errorMessage?: string; deviceId: string; clientInstanceId: string; priorEntity?: LocalEntityRecord;
}
export interface EntityTombstone {
  key: string; userId: string; entityType: PlannerEntityType; entityId: string; entityVersion: number; deletedAt: string;
  deletedByDeviceId?: string; operationId: string; retentionUntil?: string;
}
export interface SyncConflict {
  id: string; userId: string; entityType: PlannerEntityType; entityId: string;
  conflictType: "concurrent-edit" | "delete-versus-edit" | "restore-versus-update" | "invalid-merge" | "reorder-conflict" | "series-definition-conflict" | "permission-conflict" | "schema-conflict";
  baseVersion?: unknown; localVersion?: unknown; remoteVersion?: unknown; conflictingFields: string[];
  status: "unresolved" | "resolved-local" | "resolved-remote" | "resolved-merged" | "dismissed" | "error";
  createdAt: string; updatedAt: string; resolvedAt?: string; sourceDeviceLabels?: { local?: string; remote?: string }; resolutionSummary?: string;
}
export interface SyncLease { key: string; userId: string; holderTabId: string; acquiredAt: string; expiresAt: string; renewedAt: string }
export interface SyncDiagnosticEvent {
  id: string; code: string; severity: "info" | "warning" | "error"; entityType?: PlannerEntityType; operationType?: string;
  metadata?: Record<string, string | number | boolean>; createdAt: string;
}
export interface MigrationRecord { key: string; id: string; fromVersion: number; toVersion: number; status: "pending" | "processing" | "completed" | "failed"; checkpoint?: number; updatedAt: string; errorCode?: string }
export interface RecoverySnapshot { key: string; userId: string; entityType: PlannerEntityType; entityId: string; kind: "acknowledged" | "optimistic"; entityVersion: number; data: unknown; createdAt: string }
export interface SyncStateRecord { key: string; userId: string; lastSuccessfulSyncAt?: string; startupPhase?: string; remotePaused?: boolean; compatibilityIssue?: boolean; updatedAt: string }

export interface LocalDatabaseTransaction {
  get<T>(store: LocalStoreName, key: string): Promise<T | undefined>;
  put<T extends { key?: string; id?: string }>(store: LocalStoreName, value: T): Promise<void>;
  delete(store: LocalStoreName, key: string): Promise<void>;
  getAll<T>(store: LocalStoreName): Promise<T[]>;
}
export interface LocalDatabase {
  open(): Promise<void>; close(): Promise<void>;
  transaction<T>(stores: LocalStoreName[], mode: "readonly" | "readwrite", operation: (transaction: LocalDatabaseTransaction) => Promise<T>): Promise<T>;
  get<T>(store: LocalStoreName, key: string): Promise<T | undefined>; put<T extends { key?: string; id?: string }>(store: LocalStoreName, value: T): Promise<void>;
  delete(store: LocalStoreName, key: string): Promise<void>; getAll<T>(store: LocalStoreName): Promise<T[]>;
  query<T>(store: LocalStoreName, indexName: string, range?: IDBKeyRange): Promise<T[]>;
}
const stores: LocalStoreName[] = ["entities", "operations", "syncState", "conflicts", "tombstones", "migrations", "leases", "diagnostics", "snapshots"];
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed.")); });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed.")); transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted.")); });
}
export class IndexedDbLocalDatabase implements LocalDatabase {
  private database?: IDBDatabase;
  private readonly name: string;
  constructor(name = LOCAL_DATABASE_NAME) { this.name = name; }
  async open() {
    if (this.database) return;
    if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable. Changes may not survive browser closure.");
    const request = indexedDB.open(this.name, LOCAL_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of stores) {
        if (database.objectStoreNames.contains(name)) continue;
        const store = database.createObjectStore(name, { keyPath: "key" });
        if (name === "entities") {
          store.createIndex("userId", "userId"); store.createIndex("entityType", "entityType");
          store.createIndex("syncStatus", "syncStatus"); store.createIndex("updatedAt", "updatedAt");
          store.createIndex("userEntityType", ["userId", "entityType"]);
        }
        if (name === "operations") {
          store.createIndex("userId", "userId"); store.createIndex("status", "status"); store.createIndex("nextAttemptAt", "nextAttemptAt");
          store.createIndex("userStatus", ["userId", "status"]);
        }
        if (name === "conflicts") { store.createIndex("userId", "userId"); store.createIndex("status", "status"); }
        if (name === "diagnostics") store.createIndex("createdAt", "createdAt");
      }
    };
    this.database = await requestResult(request);
  }
  close() { this.database?.close(); this.database = undefined; return Promise.resolve(); }
  async transaction<T>(storeNames: LocalStoreName[], mode: "readonly" | "readwrite", operation: (transaction: LocalDatabaseTransaction) => Promise<T>) {
    if (!this.database) throw new Error("Local database is not open.");
    const transaction = this.database.transaction(storeNames, mode);
    const adapter: LocalDatabaseTransaction = {
      get: <V>(store: LocalStoreName, key: string) => requestResult(transaction.objectStore(store).get(key)) as Promise<V | undefined>,
      put: async <V extends { key?: string; id?: string }>(store: LocalStoreName, value: V) => { await requestResult(transaction.objectStore(store).put({ ...value, key: value.key ?? value.id })); },
      delete: async (store, key) => { await requestResult(transaction.objectStore(store).delete(key)); },
      getAll: <V>(store: LocalStoreName) => requestResult(transaction.objectStore(store).getAll()) as Promise<V[]>,
    };
    const result = await operation(adapter);
    await transactionDone(transaction);
    return result;
  }
  get<T>(store: LocalStoreName, key: string) { return this.transaction([store], "readonly", (tx) => tx.get<T>(store, key)); }
  put<T extends { key?: string; id?: string }>(store: LocalStoreName, value: T) { return this.transaction([store], "readwrite", async (tx) => { await tx.put(store, value); }); }
  delete(store: LocalStoreName, key: string) { return this.transaction([store], "readwrite", async (tx) => { await tx.delete(store, key); }); }
  getAll<T>(store: LocalStoreName) { return this.transaction([store], "readonly", (tx) => tx.getAll<T>(store)); }
  async query<T>(store: LocalStoreName, indexName: string, range?: IDBKeyRange) {
    if (!this.database) throw new Error("Local database is not open.");
    const transaction = this.database.transaction([store], "readonly");
    const result = await requestResult(transaction.objectStore(store).index(indexName).getAll(range));
    await transactionDone(transaction); return result as T[];
  }
}
export class MemoryLocalDatabase implements LocalDatabase {
  readonly data = new Map<LocalStoreName, Map<string, unknown>>(stores.map((name) => [name, new Map()]));
  isOpen = false; failNextTransaction = false;
  async open() { this.isOpen = true; } async close() { this.isOpen = false; }
  async transaction<T>(storeNames: LocalStoreName[], _mode: "readonly" | "readwrite", operation: (transaction: LocalDatabaseTransaction) => Promise<T>) {
    if (!this.isOpen) throw new Error("Local database is not open.");
    if (this.failNextTransaction) { this.failNextTransaction = false; throw new Error("Injected transaction failure."); }
    const draft = new Map(storeNames.map((name) => [name, new Map(this.data.get(name))]));
    const tx: LocalDatabaseTransaction = {
      get: async <V>(store: LocalStoreName, key: string) => draft.get(store)?.get(key) as V | undefined,
      put: async (store, value) => { const key = value.key ?? value.id; if (!key) throw new Error("Stored value requires a key."); draft.get(store)?.set(key, structuredClone(value)); },
      delete: async (store, key) => { draft.get(store)?.delete(key); },
      getAll: async <V>(store: LocalStoreName) => [...(draft.get(store)?.values() ?? [])].map((item) => structuredClone(item)) as V[],
    };
    const result = await operation(tx);
    for (const name of storeNames) this.data.set(name, draft.get(name)!);
    return result;
  }
  get<T>(store: LocalStoreName, key: string) { return this.transaction([store], "readonly", (tx) => tx.get<T>(store, key)); }
  put<T extends { key?: string; id?: string }>(store: LocalStoreName, value: T) { return this.transaction([store], "readwrite", async (tx) => { await tx.put(store, value); }); }
  delete(store: LocalStoreName, key: string) { return this.transaction([store], "readwrite", async (tx) => { await tx.delete(store, key); }); }
  getAll<T>(store: LocalStoreName) { return this.transaction([store], "readonly", (tx) => tx.getAll<T>(store)); }
  async query<T>(store: LocalStoreName, indexName: string, range?: IDBKeyRange) {
    const values = await this.getAll<T & Record<string, unknown>>(store);
    if (!range) return values;
    return values.filter((value) => {
      const candidate = value[indexName]; try { return range.includes(candidate); } catch { return false; }
    });
  }
}

export const entityKey = (userId: string, entityType: PlannerEntityType, entityId: string) => `${userId}:${entityType}:${entityId}`;
export const operationKey = (id: string) => id;
export function stableLocalId(storage: Storage | undefined, key: string): string {
  const old = storage?.getItem(key); if (old) return old;
  const id = crypto.randomUUID(); try { storage?.setItem(key, id); } catch { /* identity remains valid for this lifecycle */ } return id;
}
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}
export async function checksum(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}
function plusDays(iso: string, days: number) { return new Date(Date.parse(iso) + days * 86_400_000).toISOString(); }
export function createOperation(input: Omit<SyncOperation, "id" | "idempotencyKey" | "status" | "attemptCount" | "createdAt" | "updatedAt">, now: string, actionId: string = crypto.randomUUID()): SyncOperation {
  return { ...input, id: actionId, idempotencyKey: `${input.userId}:${input.entityType}:${input.entityId}:${input.resultingEntityVersion}:${actionId}`, status: "pending", attemptCount: 0, createdAt: now, updatedAt: now };
}
export async function durableMutation<T>(database: LocalDatabase, input: {
  userId: string; entityType: PlannerEntityType; entityId: string; operationType: SyncOperation["operationType"]; nextData?: T;
  deviceId: string; clientInstanceId: string; now: string; actionId?: string;
}): Promise<{ entity?: LocalEntityRecord<T>; operation: SyncOperation; tombstone?: EntityTombstone }> {
  const key = entityKey(input.userId, input.entityType, input.entityId);
  const nextChecksum = input.nextData === undefined ? undefined : await checksum(input.nextData);
  return database.transaction(["entities", "operations", "tombstones", "snapshots"], "readwrite", async (tx) => {
    const current = await tx.get<LocalEntityRecord<T>>("entities", key);
    const version = (current?.entityVersion ?? 0) + 1;
    const actionId = input.actionId ?? crypto.randomUUID();
    const operation = createOperation({ userId: input.userId, entityType: input.entityType, entityId: input.entityId, operationType: input.operationType, payload: input.nextData, baseEntityVersion: current?.lastRemoteVersion ?? current?.entityVersion ?? 0, resultingEntityVersion: version, deviceId: input.deviceId, clientInstanceId: input.clientInstanceId, priorEntity: current }, input.now, actionId);
    if (current) await tx.put("snapshots", { key: `${key}:optimistic`, userId: input.userId, entityType: input.entityType, entityId: input.entityId, kind: "optimistic", entityVersion: current.entityVersion, data: current.data, createdAt: input.now } satisfies RecoverySnapshot);
    let entity: LocalEntityRecord<T> | undefined; let tombstone: EntityTombstone | undefined;
    if (input.operationType === "delete") {
      tombstone = { key, userId: input.userId, entityType: input.entityType, entityId: input.entityId, entityVersion: version, deletedAt: input.now, deletedByDeviceId: input.deviceId, operationId: operation.id, retentionUntil: plusDays(input.now, TOMBSTONE_RETENTION_DAYS) };
      await tx.delete("entities", key); await tx.put("tombstones", tombstone);
    } else {
      if (input.nextData === undefined) throw new Error("A non-delete mutation requires entity data.");
      entity = { key, userId: input.userId, entityType: input.entityType, entityId: input.entityId, data: input.nextData, schemaVersion: CURRENT_LOCAL_SCHEMA_VERSION, entityVersion: version, createdAt: current?.createdAt ?? input.now, updatedAt: input.now, syncStatus: current ? "pending-update" : "pending-create", lastRemoteVersion: current?.lastRemoteVersion, checksum: nextChecksum, lastOperationId: operation.id };
      await tx.put("entities", entity);
    }
    await tx.put("operations", { ...operation, key: operation.id });
    return { entity, operation, tombstone };
  });
}
export function retryDelayMs(attempt: number, random = Math.random): number {
  const base = Math.min(300_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (.75 + random() * .5));
}
export function isRetryableError(code?: string) { return ["unavailable", "deadline-exceeded", "resource-exhausted", "aborted", "network", "timeout", "unauthenticated"].includes(code ?? ""); }
export function recoverProcessingOperations(operations: SyncOperation[], now: string, staleMs = 60_000): SyncOperation[] {
  return operations.map((operation) => operation.status === "processing" && Date.parse(now) - Date.parse(operation.lastAttemptAt ?? operation.updatedAt) >= staleMs ? { ...operation, status: "pending", updatedAt: now, errorCode: "recovered-stale-processing" } : operation);
}
const unsafeCoalesce = new Set<PlannerEntityType>(["time-log", "recurrence-exception", "calendar-sync-record", "ai-audit"]);
export function coalesceOperations(operations: SyncOperation[]): SyncOperation[] {
  const result: SyncOperation[] = [], latest = new Map<string, number>();
  for (const operation of operations) {
    const key = `${operation.userId}:${operation.entityType}:${operation.entityId}`;
    const priorIndex = latest.get(key), prior = priorIndex === undefined ? undefined : result[priorIndex];
    const safe = !unsafeCoalesce.has(operation.entityType) && prior?.status === "pending" && operation.status === "pending";
    if (safe && prior && prior.operationType === "create" && operation.operationType === "update") {
      result[priorIndex!] = { ...operation, id: prior.id, idempotencyKey: prior.idempotencyKey, operationType: "create", baseEntityVersion: prior.baseEntityVersion, createdAt: prior.createdAt, priorEntity: prior.priorEntity }; continue;
    }
    if (safe && prior?.operationType === "update" && operation.operationType === "update") { result[priorIndex!] = { ...operation, priorEntity: prior.priorEntity, createdAt: prior.createdAt }; continue; }
    result.push(operation); latest.set(key, result.length - 1);
  }
  return result;
}

export const atomicGroups: Partial<Record<PlannerEntityType, string[][]>> = {
  task: [["projectId", "milestoneId"], ["dueDate", "dueTime"], ["status", "completedAt", "archivedAt"], ["recurrence", "recurrenceDefinitionId", "recurrenceOccurrenceId"]],
  "schedule-block": [["date", "startTime", "endTime", "durationMinutes"], ["status", "isLocked"]],
  project: [["status", "completedAt", "archivedAt"], ["progressMode", "manualProgressPercent"]],
  goal: [["status", "completedAt", "archivedAt"], ["progressMode", "manualProgressPercent"]],
  milestone: [["status", "completedAt", "archivedAt"], ["order"]],
  "recurrence-series": [["schedule", "startDate", "endCondition", "timezone"], ["status", "pausedAt", "completedAt", "archivedAt"]],
};
function changedPaths(base: Record<string, unknown>, value: Record<string, unknown>) {
  const paths = new Set<string>(); for (const key of new Set([...Object.keys(base), ...Object.keys(value)])) if (canonicalize(base[key]) !== canonicalize(value[key])) paths.add(key); return paths;
}
function expandGroups(type: PlannerEntityType, paths: Set<string>) {
  const expanded = new Set(paths);
  for (const group of atomicGroups[type] ?? []) if (group.some((path) => paths.has(path))) group.forEach((path) => expanded.add(path));
  return expanded;
}
export function fieldLevelMerge<T extends Record<string, unknown>>(entityType: PlannerEntityType, base: T, local: T, remote: T): { merged?: T; conflicts: string[] } {
  if (entityType === "time-log" && canonicalize(local) !== canonicalize(remote)) return { conflicts: ["time-log"] };
  const localChanged = expandGroups(entityType, changedPaths(base, local)), remoteChanged = expandGroups(entityType, changedPaths(base, remote));
  const conflicts = [...localChanged].filter((path) => remoteChanged.has(path) && canonicalize(local[path]) !== canonicalize(remote[path])).sort();
  if (conflicts.length) return { conflicts };
  const merged = { ...base, ...remote } as T; for (const path of localChanged) merged[path as keyof T] = local[path as keyof T]; return { merged, conflicts: [] };
}
function conflictId(userId: string, type: PlannerEntityType, id: string, remoteVersion: number) { return `conflict:${userId}:${type}:${id}:${remoteVersion}`; }
export function reconcileRemote<T extends Record<string, unknown>>(local: LocalEntityRecord<T> | undefined, remote: LocalEntityRecord<T> | undefined, base: T | undefined, now: string): { action: "insert" | "replace" | "keep-local" | "merge" | "conflict" | "ignore"; entity?: LocalEntityRecord<T>; conflict?: SyncConflict } {
  if (!remote) {
    if (!local) return { action: "ignore" };
    if (local.syncStatus === "pending-update" || local.syncStatus === "pending-create") return { action: "conflict", conflict: { id: conflictId(local.userId, local.entityType, local.entityId, local.lastRemoteVersion ?? 0), userId: local.userId, entityType: local.entityType, entityId: local.entityId, conflictType: "delete-versus-edit", baseVersion: base, localVersion: local.data, remoteVersion: undefined, conflictingFields: ["deletion"], status: "unresolved", createdAt: now, updatedAt: now } };
    return { action: "ignore" };
  }
  if (!local) return { action: "insert", entity: { ...remote, syncStatus: "synced", lastRemoteVersion: remote.entityVersion } };
  if (remote.userId !== local.userId) return { action: "ignore" };
  if (remote.schemaVersion > CURRENT_LOCAL_SCHEMA_VERSION) return { action: "conflict", conflict: { id: conflictId(local.userId, local.entityType, local.entityId, remote.entityVersion), userId: local.userId, entityType: local.entityType, entityId: local.entityId, conflictType: "schema-conflict", localVersion: local.data, remoteVersion: remote.data, conflictingFields: ["schemaVersion"], status: "unresolved", createdAt: now, updatedAt: now } };
  if (local.syncStatus === "synced") return remote.entityVersion > local.entityVersion ? { action: "replace", entity: { ...remote, syncStatus: "synced", lastRemoteVersion: remote.entityVersion } } : { action: "ignore" };
  if (remote.entityVersion === local.lastRemoteVersion || remote.entityVersion === local.entityVersion - 1) return { action: "keep-local", entity: { ...local, lastRemoteVersion: remote.entityVersion } };
  if (base) {
    const result = fieldLevelMerge(local.entityType, base, local.data, remote.data);
    if (result.merged) return { action: "merge", entity: { ...local, data: result.merged, lastRemoteVersion: remote.entityVersion, syncStatus: "pending-update" } };
    return { action: "conflict", conflict: { id: conflictId(local.userId, local.entityType, local.entityId, remote.entityVersion), userId: local.userId, entityType: local.entityType, entityId: local.entityId, conflictType: local.entityType === "recurrence-series" && result.conflicts.some((path) => ["schedule", "startDate", "endCondition", "timezone"].includes(path)) ? "series-definition-conflict" : "concurrent-edit", baseVersion: base, localVersion: local.data, remoteVersion: remote.data, conflictingFields: result.conflicts, status: "unresolved", createdAt: now, updatedAt: now } };
  }
  return { action: "conflict", conflict: { id: conflictId(local.userId, local.entityType, local.entityId, remote.entityVersion), userId: local.userId, entityType: local.entityType, entityId: local.entityId, conflictType: "concurrent-edit", localVersion: local.data, remoteVersion: remote.data, conflictingFields: ["unknown"], status: "unresolved", createdAt: now, updatedAt: now } };
}

export function acquireLease(current: SyncLease | undefined, userId: string, tabId: string, now: string): { acquired: boolean; lease: SyncLease } {
  if (current && current.userId === userId && current.holderTabId !== tabId && Date.parse(current.expiresAt) > Date.parse(now)) return { acquired: false, lease: current };
  return { acquired: true, lease: { key: `lease:${userId}`, userId, holderTabId: tabId, acquiredAt: current?.holderTabId === tabId ? current.acquiredAt : now, renewedAt: now, expiresAt: new Date(Date.parse(now) + SYNC_LEASE_DURATION_MS).toISOString() } };
}
export class MultiTabSyncChannel {
  private channel?: BroadcastChannel;
  private listeners = new Set<(message: { type: string; userId: string }) => void>();
  constructor(channelName = "bunbun-planner-sync") {
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(channelName);
      this.channel.onmessage = (event: MessageEvent<{ type: string; userId: string }>) => {
        if (event.data?.type && event.data.userId) this.listeners.forEach((listener) => listener(event.data));
      };
    }
  }
  post(message: { type: string; userId: string }) { this.channel?.postMessage(message); }
  subscribe(listener: (message: { type: string; userId: string }) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() { this.listeners.clear(); this.channel?.close(); }
}
export async function claimSyncLease(database: LocalDatabase, userId: string, tabId: string, now: string) {
  return database.transaction(["leases"], "readwrite", async (tx) => {
    const key = `lease:${userId}`;
    const result = acquireLease(await tx.get<SyncLease>("leases", key), userId, tabId, now);
    if (result.acquired) await tx.put("leases", result.lease);
    return result;
  });
}

export async function resolveConflictDurably<T extends Record<string, unknown>>(
  database: LocalDatabase,
  conflictIdValue: string,
  resolution: "local" | "remote" | { merged: T },
  identity: { deviceId: string; clientInstanceId: string },
  now: string,
) {
  const conflict = await database.get<SyncConflict & { key?: string }>("conflicts", conflictIdValue);
  if (!conflict || conflict.status !== "unresolved") throw new Error("This conflict is no longer available.");
  const data = resolution === "local" ? conflict.localVersion : resolution === "remote" ? conflict.remoteVersion : resolution.merged;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The selected conflict version is invalid.");
  const result = await durableMutation(database, {
    userId: conflict.userId,
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    operationType: conflict.remoteVersion === undefined ? "restore" : "update",
    nextData: data as T,
    deviceId: identity.deviceId,
    clientInstanceId: identity.clientInstanceId,
    now,
    actionId: `resolve:${conflict.id}`,
  });
  await database.put("conflicts", {
    ...conflict,
    key: conflict.id,
    status: resolution === "local" ? "resolved-local" : resolution === "remote" ? "resolved-remote" : "resolved-merged",
    resolvedAt: now,
    updatedAt: now,
    resolutionSummary: resolution === "local" ? "Kept this device's version." : resolution === "remote" ? "Kept the other version." : "Saved a reviewed merge.",
  });
  return result;
}
export interface RemoteSyncAdapter {
  apply(operation: SyncOperation): Promise<{ entityVersion: number; lastOperationId: string; acknowledgedAt: string }>;
}
export type SyncCoordinatorStatus = { state: "offline" | "saved-local" | "syncing" | "synced" | "paused" | "action-required" | "compatibility"; pending: number; failed: number; conflicts: number; lastSuccessfulSyncAt?: string };
export class SyncCoordinator {
  private userId?: string; private processing = false; private stopped = true;
  private readonly database: LocalDatabase;
  private readonly remote: RemoteSyncAdapter;
  constructor(database: LocalDatabase, remote: RemoteSyncAdapter) {
    this.database = database;
    this.remote = remote;
  }
  async start(userId: string) { this.userId = userId; this.stopped = false; await this.recoverStuck(); }
  async stop() { this.stopped = true; this.userId = undefined; }
  async requestSync(_reason: string, now = new Date().toISOString()) {
    if (this.stopped || !this.userId || this.processing) return;
    this.processing = true;
    try {
      const all = (await this.database.getAll<SyncOperation & { key: string }>("operations")).filter((item) => item.userId === this.userId && ["pending", "retrying"].includes(item.status) && (!item.nextAttemptAt || item.nextAttemptAt <= now));
      for (const operation of coalesceOperations(all).slice(0, MAX_SYNC_BATCH_SIZE)) await this.process(operation, now);
    } finally { this.processing = false; }
  }
  private async process(operation: SyncOperation, now: string) {
    const processing = { ...operation, key: operation.id, status: "processing" as const, attemptCount: operation.attemptCount + 1, lastAttemptAt: now, updatedAt: now };
    await this.database.put("operations", processing);
    try {
      const acknowledgment = await this.remote.apply(processing);
      await this.database.transaction(["operations", "entities", "syncState", "snapshots"], "readwrite", async (tx) => {
        const currentOperation = await tx.get<SyncOperation & { key: string }>("operations", operation.id);
        const key = entityKey(operation.userId, operation.entityType, operation.entityId);
        const entity = await tx.get<LocalEntityRecord>("entities", key);
        await tx.put("operations", { ...currentOperation!, status: "acknowledged", acknowledgedAt: acknowledgment.acknowledgedAt, updatedAt: acknowledgment.acknowledgedAt });
        if (entity?.lastOperationId === operation.id && entity.entityVersion === operation.resultingEntityVersion) {
          await tx.put("entities", { ...entity, syncStatus: "synced", lastRemoteVersion: acknowledgment.entityVersion, lastSyncedAt: acknowledgment.acknowledgedAt });
          await tx.put("snapshots", { key: `${key}:acknowledged`, userId: operation.userId, entityType: operation.entityType, entityId: operation.entityId, kind: "acknowledged", entityVersion: entity.entityVersion, data: entity.data, createdAt: acknowledgment.acknowledgedAt } satisfies RecoverySnapshot);
        }
        await tx.put("syncState", { key: `sync:${operation.userId}`, userId: operation.userId, lastSuccessfulSyncAt: acknowledgment.acknowledgedAt, updatedAt: acknowledgment.acknowledgedAt } satisfies SyncStateRecord);
      });
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "unknown";
      const retryable = isRetryableError(code), attempt = processing.attemptCount;
      await this.database.put("operations", { ...processing, status: retryable ? "retrying" : "failed", nextAttemptAt: retryable ? new Date(Date.parse(now) + retryDelayMs(attempt)).toISOString() : undefined, errorCode: code, errorMessage: error instanceof Error ? error.message : "Remote synchronization failed.", updatedAt: now });
    }
  }
  async retryOperation(operationId: string, now = new Date().toISOString()) { const operation = await this.database.get<SyncOperation & { key: string }>("operations", operationId); if (operation && operation.status !== "acknowledged") await this.database.put("operations", { ...operation, status: "pending", nextAttemptAt: undefined, updatedAt: now }); await this.requestSync("manual", now); }
  async retryAll(now = new Date().toISOString()) { const all = await this.database.getAll<SyncOperation & { key: string }>("operations"); await Promise.all(all.filter((item) => item.userId === this.userId && ["failed", "retrying"].includes(item.status)).map((item) => this.database.put("operations", { ...item, status: "pending", nextAttemptAt: undefined, updatedAt: now }))); await this.requestSync("manual", now); }
  async recoverStuck(now = new Date().toISOString()) { const all = await this.database.getAll<SyncOperation & { key: string }>("operations"); for (const operation of recoverProcessingOperations(all, now)) if (operation !== all.find((item) => item.id === operation.id)) await this.database.put("operations", { ...operation, key: operation.id }); }
  async getStatus(online = true): Promise<SyncCoordinatorStatus> {
    const operations = (await this.database.getAll<SyncOperation>("operations")).filter((item) => item.userId === this.userId);
    const conflicts = (await this.database.getAll<SyncConflict>("conflicts")).filter((item) => item.userId === this.userId && item.status === "unresolved");
    const state = await this.database.get<SyncStateRecord>("syncState", `sync:${this.userId}`);
    const pending = operations.filter((item) => ["pending", "processing", "retrying"].includes(item.status)).length, failed = operations.filter((item) => item.status === "failed").length;
    return { state: !online ? "offline" : conflicts.length || failed ? "action-required" : pending ? "syncing" : state?.lastSuccessfulSyncAt ? "synced" : "saved-local", pending, failed, conflicts: conflicts.length, lastSuccessfulSyncAt: state?.lastSuccessfulSyncAt };
  }
}

export interface SchemaMigration { id: string; fromVersion: number; toVersion: number; description: string; migrateLocal(transaction: LocalDatabaseTransaction, checkpoint: number): Promise<number | void>; migrateEntity?(entityType: PlannerEntityType, value: unknown): unknown }
export async function runMigrations(database: LocalDatabase, migrations: SchemaMigration[], currentVersion: number, targetVersion: number, now: string) {
  let version = currentVersion;
  for (const migration of [...migrations].sort((a, b) => a.fromVersion - b.fromVersion)) {
    if (migration.fromVersion !== version || migration.toVersion > targetVersion) continue;
    await database.transaction(["migrations", "entities"], "readwrite", async (tx) => {
      const key = `migration:${migration.id}`, old = await tx.get<MigrationRecord>("migrations", key);
      if (old?.status === "completed") return;
      await tx.put("migrations", { key, id: migration.id, fromVersion: migration.fromVersion, toVersion: migration.toVersion, status: "processing", checkpoint: old?.checkpoint ?? 0, updatedAt: now } satisfies MigrationRecord);
      const checkpoint = await migration.migrateLocal(tx, old?.checkpoint ?? 0);
      await tx.put("migrations", { key, id: migration.id, fromVersion: migration.fromVersion, toVersion: migration.toVersion, status: "completed", checkpoint: checkpoint ?? old?.checkpoint ?? 0, updatedAt: now } satisfies MigrationRecord);
    });
    version = migration.toVersion;
  }
  if (version !== targetVersion) throw new Error(`No migration path from ${version} to ${targetVersion}.`);
}
export async function importLegacyEntities(database: LocalDatabase, userId: string, entityType: PlannerEntityType, values: Array<{ id: string; createdAt?: string; updatedAt?: string }>, now: string) {
  let imported = 0;
  for (let offset = 0; offset < values.length; offset += 250) {
    const chunk = values.slice(offset, offset + 250);
    const checksummed = await Promise.all(chunk.map(async (value) => ({ value, checksum: await checksum(value) })));
    await database.transaction(["entities"], "readwrite", async (tx) => {
      for (const { value, checksum: valueChecksum } of checksummed) {
        const key = entityKey(userId, entityType, value.id);
        if (await tx.get("entities", key)) continue;
        await tx.put("entities", { key, userId, entityType, entityId: value.id, data: value, schemaVersion: CURRENT_LOCAL_SCHEMA_VERSION, entityVersion: 1, createdAt: value.createdAt ?? now, updatedAt: value.updatedAt ?? value.createdAt ?? now, syncStatus: "local-only", checksum: valueChecksum } satisfies LocalEntityRecord);
        imported++;
      }
    });
  }
  return imported;
}
export async function validateStoredEntity(record: LocalEntityRecord): Promise<{ valid: boolean; reason?: string }> {
  if (!record.key || !record.userId || !record.entityId || record.entityVersion < 1 || record.schemaVersion < 1) return { valid: false, reason: "invalid-metadata" };
  if (record.checksum && record.checksum !== await checksum(record.data)) return { valid: false, reason: "checksum-mismatch" };
  return { valid: true };
}
export async function quarantineEntity(database: LocalDatabase, record: LocalEntityRecord, reason: string, now: string) {
  await database.transaction(["entities", "diagnostics"], "readwrite", async (tx) => {
    await tx.delete("entities", record.key);
    await tx.put("diagnostics", { key: `diagnostic:${crypto.randomUUID()}`, id: crypto.randomUUID(), code: `quarantined:${reason}`, severity: "error", entityType: record.entityType, metadata: { entityVersion: record.entityVersion }, createdAt: now } satisfies SyncDiagnosticEvent & { key: string });
  });
}
export async function compactLocalReliabilityData(database: LocalDatabase, now: string) {
  const operations = await database.getAll<SyncOperation & { key: string }>("operations"); let removedOperations = 0;
  for (const operation of operations) if (operation.status === "acknowledged" && operation.acknowledgedAt && Date.parse(operation.acknowledgedAt) < Date.parse(now) - ACKNOWLEDGED_OPERATION_RETENTION_DAYS * 86_400_000) { await database.delete("operations", operation.id); removedOperations++; }
  const diagnostics = await database.getAll<SyncDiagnosticEvent & { key: string }>("diagnostics"); let removedDiagnostics = 0;
  for (const event of diagnostics) if (Date.parse(event.createdAt) < Date.parse(now) - 30 * 86_400_000) { await database.delete("diagnostics", event.key); removedDiagnostics++; }
  return { removedOperations, removedDiagnostics };
}
export function safeDiagnostic(code: string, severity: SyncDiagnosticEvent["severity"], metadata: Record<string, string | number | boolean> = {}, now = new Date().toISOString()): SyncDiagnosticEvent & { key: string } {
  const safeMetadata = Object.fromEntries(Object.entries(metadata).filter(([key]) => !/(title|description|note|message|calendar|prompt|content)/i.test(key)));
  const id = crypto.randomUUID(); return { key: `diagnostic:${id}`, id, code, severity, metadata: safeMetadata, createdAt: now };
}
