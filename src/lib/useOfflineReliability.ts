import { useEffect, useMemo, useRef, useState } from "react";
import {
  IndexedDbLocalDatabase,
  compactLocalReliabilityData,
  durableMutation,
  importLegacyEntities,
  stableLocalId,
  type LocalEntityRecord,
  type PlannerEntityType,
  type SyncConflict,
  type SyncOperation,
} from "./offlineSync";

export type OfflineCollection = {
  entityType: PlannerEntityType;
  records: Array<{ id: string; createdAt?: string; updatedAt?: string }>;
};
export type OfflineReliabilityStatus = {
  durability: "opening" | "durable" | "limited";
  state: "offline" | "saved-local" | "syncing" | "synced" | "action-required";
  pending: number;
  failed: number;
  conflicts: number;
  lastSuccessfulSyncAt?: string;
  warning?: string;
};

function fingerprint(collections: OfflineCollection[]) {
  return collections.map(({ entityType, records }) => `${entityType}:${records.map((record) => `${record.id}:${record.updatedAt ?? record.createdAt ?? ""}`).sort().join("|")}`).join(";");
}

export function useOfflineReliability(userId: string, collections: OfflineCollection[], cloudState: string, enabled = true) {
  const database = useMemo(() => new IndexedDbLocalDatabase(), []);
  const deviceId = useMemo(() => stableLocalId(typeof localStorage === "undefined" ? undefined : localStorage, "bunbun-device-id"), []);
  const clientInstanceId = useMemo(() => crypto.randomUUID(), []);
  const baseline = useRef<Map<string, string> | undefined>(undefined);
  const previousIds = useRef<Map<PlannerEntityType, Set<string>>>(new Map());
  const activeUser = useRef(userId);
  const [status, setStatus] = useState<OfflineReliabilityStatus>({ durability: "opening", state: navigator.onLine ? "saved-local" : "offline", pending: 0, failed: 0, conflicts: 0 });
  const collectionFingerprint = fingerprint(collections);

  useEffect(() => {
    activeUser.current = userId;
    baseline.current = undefined;
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        await database.open();
        for (const collection of collections) await importLegacyEntities(database, userId, collection.entityType, collection.records, new Date().toISOString());
        if (cancelled || activeUser.current !== userId) return;
        baseline.current = new Map(collections.flatMap(({ entityType, records }) => records.map((record) => [`${entityType}:${record.id}`, record.updatedAt ?? record.createdAt ?? ""])));
        previousIds.current = new Map(collections.map(({ entityType, records }) => [entityType, new Set(records.map((record) => record.id))]));
        setStatus((current) => ({ ...current, durability: "durable", warning: undefined }));
      } catch (error) {
        if (!cancelled) setStatus((current) => ({ ...current, durability: "limited", warning: error instanceof Error ? error.message : "Durable local storage is unavailable. Changes may not survive browser closure." }));
      }
    })();
    return () => { cancelled = true; };
    // Re-open only for an account partition change. Collection changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database, enabled, userId]);

  useEffect(() => {
    if (!baseline.current || status.durability !== "durable") return;
    let cancelled = false;
    (async () => {
      const now = new Date().toISOString();
      for (const { entityType, records } of collections) {
        const currentIds = new Set(records.map((record) => record.id));
        for (const record of records) {
          const key = `${entityType}:${record.id}`;
          const revision = record.updatedAt ?? record.createdAt ?? "";
          if (baseline.current?.get(key) === revision) continue;
          await durableMutation(database, { userId, entityType, entityId: record.id, operationType: baseline.current?.has(key) ? "update" : "create", nextData: record, deviceId, clientInstanceId, now });
          baseline.current?.set(key, revision);
        }
        for (const oldId of previousIds.current.get(entityType) ?? []) {
          if (currentIds.has(oldId)) continue;
          await durableMutation(database, { userId, entityType, entityId: oldId, operationType: "delete", deviceId, clientInstanceId, now });
          baseline.current?.delete(`${entityType}:${oldId}`);
        }
        previousIds.current.set(entityType, currentIds);
      }
      if (!cancelled) await refresh();
    })().catch((error) => {
      if (!cancelled) setStatus((current) => ({ ...current, state: "action-required", warning: error instanceof Error ? error.message : "A local update could not be saved." }));
    });
    return () => { cancelled = true; };
    // Fingerprint is the bounded mutation trigger; object identity changes alone do not write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionFingerprint, database, status.durability, userId]);

  useEffect(() => {
    const updateConnectivity = () => void refresh();
    window.addEventListener("online", updateConnectivity);
    window.addEventListener("offline", updateConnectivity);
    return () => { window.removeEventListener("online", updateConnectivity); window.removeEventListener("offline", updateConnectivity); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database, userId]);

  useEffect(() => {
    if (status.durability !== "durable" || cloudState !== "synced") return;
    (async () => {
      const now = new Date().toISOString();
      await database.transaction(["operations", "entities", "syncState"], "readwrite", async (tx) => {
        const operations = await tx.getAll<SyncOperation & { key: string }>("operations");
        for (const operation of operations.filter((item) => item.userId === userId && ["pending", "processing", "retrying"].includes(item.status))) {
          await tx.put("operations", { ...operation, status: "acknowledged", acknowledgedAt: now, updatedAt: now });
        }
        const entities = await tx.getAll<LocalEntityRecord>("entities");
        for (const entity of entities.filter((item) => item.userId === userId && item.syncStatus !== "synced")) {
          await tx.put("entities", { ...entity, syncStatus: "synced", lastRemoteVersion: entity.entityVersion, lastSyncedAt: now });
        }
        await tx.put("syncState", { key: `sync:${userId}`, userId, lastSuccessfulSyncAt: now, updatedAt: now });
      });
      await compactLocalReliabilityData(database, now);
      await refresh();
    })().catch(() => setStatus((current) => ({ ...current, state: "action-required" })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudState, database, status.durability, userId]);

  async function refresh() {
    if (status.durability === "limited") return;
    const [operations, conflicts, syncState] = await Promise.all([
      database.getAll<SyncOperation>("operations"),
      database.getAll<SyncConflict>("conflicts"),
      database.get<{ lastSuccessfulSyncAt?: string }>("syncState", `sync:${userId}`),
    ]);
    const own = operations.filter((item) => item.userId === userId);
    const pending = own.filter((item) => ["pending", "processing", "retrying"].includes(item.status)).length;
    const failed = own.filter((item) => item.status === "failed").length;
    const unresolved = conflicts.filter((item) => item.userId === userId && item.status === "unresolved").length;
    setStatus((current) => ({
      ...current,
      state: !navigator.onLine ? "offline" : failed || unresolved ? "action-required" : pending ? "syncing" : syncState?.lastSuccessfulSyncAt ? "synced" : "saved-local",
      pending, failed, conflicts: unresolved, lastSuccessfulSyncAt: syncState?.lastSuccessfulSyncAt,
    }));
  }

  return { database, status, refresh };
}
