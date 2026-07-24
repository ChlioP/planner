import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CloudOffIcon,
  DatabaseIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import {
  resolveConflictDurably,
  stableLocalId,
  type LocalDatabase,
  type SyncConflict,
  type SyncDiagnosticEvent,
  type SyncOperation,
} from "@/lib/offlineSync";
import type { OfflineReliabilityStatus } from "@/lib/useOfflineReliability";

type Props = {
  database: LocalDatabase;
  status: OfflineReliabilityStatus;
  userId: string;
  onRefresh: () => Promise<void>;
};
type DetailTab = "overview" | "changes" | "conflicts" | "storage";

const stateLabel = {
  offline: "Offline",
  "saved-local": "Saved on this device",
  syncing: "Syncing",
  synced: "All changes synced",
  "action-required": "Action required",
} as const;
const stateTone = {
  offline: "warning",
  "saved-local": "info",
  syncing: "info",
  synced: "success",
  "action-required": "danger",
} as const;

function exactTime(value?: string) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Not confirmed yet";
}
function friendlyEntity(type: string) {
  return type.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function SyncStatusBadge({ status, onOpen }: { status: OfflineReliabilityStatus; onOpen: () => void }) {
  return (
    <Button variant="outline" className="rounded-full bg-white/80 shadow-sm ring-1 ring-pink-100" onClick={onOpen} aria-label={`${stateLabel[status.state]}. View sync details.`}>
      {status.state === "offline" ? <CloudOffIcon className="mr-2 h-4 w-4" aria-hidden="true" /> : status.state === "action-required" ? <AlertTriangleIcon className="mr-2 h-4 w-4" aria-hidden="true" /> : <DatabaseIcon className="mr-2 h-4 w-4" aria-hidden="true" />}
      {stateLabel[status.state]}{status.pending ? ` · ${status.pending}` : ""}
    </Button>
  );
}

export function SyncReliabilityPage({ database, status, userId, onRefresh }: Props) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const [operations, setOperations] = useState<SyncOperation[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [diagnostics, setDiagnostics] = useState<SyncDiagnosticEvent[]>([]);
  const [message, setMessage] = useState("");
  const [resolving, setResolving] = useState<string>();
  const deviceId = useMemo(() => stableLocalId(localStorage, "bunbun-device-id"), []);
  const clientInstanceId = useMemo(() => crypto.randomUUID(), []);

  const load = useCallback(async () => {
    if (status.durability !== "durable") return;
    const [nextOperations, nextConflicts, nextDiagnostics] = await Promise.all([
      database.getAll<SyncOperation>("operations"),
      database.getAll<SyncConflict>("conflicts"),
      database.getAll<SyncDiagnosticEvent>("diagnostics"),
    ]);
    setOperations(nextOperations.filter((item) => item.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50));
    setConflicts(nextConflicts.filter((item) => item.userId === userId && item.status === "unresolved"));
    setDiagnostics(nextDiagnostics.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25));
  }, [database, status.durability, userId]);
  useEffect(() => { void load(); }, [load, status.pending, status.failed, status.conflicts]);

  const pending = operations.filter((item) => ["pending", "processing", "retrying"].includes(item.status));
  const failed = operations.filter((item) => item.status === "failed");
  const recent = operations.filter((item) => item.status === "acknowledged").slice(0, 20);

  const copyDiagnostics = async () => {
    const summary = JSON.stringify({
      status: status.state,
      durability: status.durability,
      pending: status.pending,
      failed: status.failed,
      conflicts: status.conflicts,
      diagnosticCodes: diagnostics.map(({ code, severity, createdAt }) => ({ code, severity, createdAt })),
    }, null, 2);
    await navigator.clipboard.writeText(summary);
    setMessage("Privacy-safe diagnostics copied. Planner content was not included.");
  };
  const resolve = async (conflict: SyncConflict, choice: "local" | "remote") => {
    const wording = choice === "local" ? "Keep the version saved on this device?" : "Replace this device’s version with the other version?";
    if (!window.confirm(`${wording} The item will be validated and saved as a new version.`)) return;
    setResolving(conflict.id);
    try {
      await resolveConflictDurably(database, conflict.id, choice, { deviceId, clientInstanceId }, new Date().toISOString());
      setMessage(choice === "local" ? "This device’s version was saved. It is waiting to sync." : "The other version was saved. It is waiting to sync.");
      await onRefresh();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The conflict could not be resolved.");
    } finally {
      setResolving(undefined);
    }
  };

  const tabs: Array<{ key: DetailTab; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "changes", label: `Changes${pending.length + failed.length ? ` (${pending.length + failed.length})` : ""}` },
    { key: "conflicts", label: `Conflicts${conflicts.length ? ` (${conflicts.length})` : ""}` },
    { key: "storage", label: "Storage" },
  ];

  return (
    <div className="space-y-4">
      <div className="p-4">
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="mb-1 text-[11px] text-slate-500">Planner settings</p>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800"><DatabaseIcon className="h-5 w-5 text-pink-500" aria-hidden="true" />Sync & storage</h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">Your planner saves changes on this device first, then synchronizes them when your account and connection are available.</p>
            </div>
            <StatusChip tone={stateTone[status.state]} className="self-start" role="status" aria-live="polite">{stateLabel[status.state]}</StatusChip>
          </div>

          {status.warning ? <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">{status.warning}</div> : null}

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Sync details">
            {tabs.map((item) => <Button
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              variant="outline"
              className={`rounded-full shadow-sm ${tab === item.key ? "bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90" : "bg-white/80 text-slate-700 ring-1 ring-pink-100 hover:bg-pink-50"}`}
              onClick={() => setTab(item.key)}
            >{item.label}</Button>)}
          </div>

          <div>
            {tab === "overview" ? <Overview status={status} pending={pending} failed={failed} conflicts={conflicts} recent={recent} onRefresh={async () => { await onRefresh(); await load(); }} /> : null}
            {tab === "changes" ? <ChangesList pending={pending} failed={failed} /> : null}
            {tab === "conflicts" ? <ConflictList conflicts={conflicts} resolving={resolving} onResolve={resolve} /> : null}
            {tab === "storage" ? <StoragePanel status={status} diagnostics={diagnostics} onCopy={() => void copyDiagnostics()} /> : null}
          </div>

          {message ? <p role="status" aria-live="polite" className="rounded-xl bg-pink-50 p-3 text-sm text-slate-700">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}

function Overview({ status, pending, failed, conflicts, recent, onRefresh }: {
  status: OfflineReliabilityStatus;
  pending: SyncOperation[];
  failed: SyncOperation[];
  conflicts: SyncConflict[];
  recent: SyncOperation[];
  onRefresh: () => Promise<void>;
}) {
  return <div className="space-y-6">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard label="Waiting to sync" value={String(pending.length)} helper={pending.length ? "Saved safely on this device" : "No pending changes"} />
      <SummaryCard label="Needs review" value={String(failed.length + conflicts.length)} helper={conflicts.length ? "Review both versions" : failed.length ? "A change needs attention" : "Nothing needs attention"} />
      <SummaryCard label="Local storage" value={status.durability === "durable" ? "Available" : status.durability === "opening" ? "Opening" : "Limited"} helper={status.durability === "durable" ? "Available after refresh" : "Review the storage message"} />
      <SummaryCard label="Last cloud sync" value={status.lastSuccessfulSyncAt ? new Date(status.lastSuccessfulSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Not yet"} helper={exactTime(status.lastSuccessfulSyncAt)} />
    </div>
    <div className="rounded-2xl bg-white/70 p-4 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-base font-semibold text-slate-700">Recent activity</h3><p className="mt-1 text-xs text-slate-500">A short history of confirmed synchronization activity.</p></div><Button className="self-start rounded-full bg-white/80 text-slate-700 shadow-sm ring-1 ring-pink-100 hover:bg-pink-50 sm:self-auto" variant="outline" onClick={() => void onRefresh()}><RefreshCwIcon className="mr-2 h-4 w-4" aria-hidden="true" />Refresh</Button></div>
      {recent.length ? <ul className="space-y-2">{recent.slice(0, 6).map((operation) => <li key={operation.id} className="flex flex-col gap-1 rounded-2xl bg-white/60 px-4 py-3 text-sm ring-1 ring-pink-100 sm:flex-row sm:items-center sm:justify-between"><span>{friendlyEntity(operation.entityType)} {operation.operationType === "create" ? "created" : operation.operationType === "delete" ? "removed" : "updated"}</span><span className="text-xs text-slate-500">{exactTime(operation.acknowledgedAt ?? operation.updatedAt)}</span></li>)}</ul> : <EmptyState title="No recent sync activity" description="Confirmed changes will appear here." />}
    </div>
  </div>;
}

function SummaryCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return <div className="min-h-28 rounded-2xl bg-white/60 p-4 shadow-sm ring-1 ring-pink-100"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-lg font-semibold text-slate-700">{value}</div><p className="mt-1 text-xs text-slate-500">{helper}</p></div>;
}

function ChangesList({ pending, failed }: { pending: SyncOperation[]; failed: SyncOperation[] }) {
  return <div className="grid gap-5 lg:grid-cols-2">
    <OperationCard title="Pending changes" helper="These changes are saved on this device and will retry safely." operations={pending} empty="No changes are waiting to sync." />
    <OperationCard title="Failed changes" helper="Permanent errors pause instead of retrying forever." operations={failed} empty="No failed changes." failed />
  </div>;
}
function OperationCard({ title, helper, operations, empty, failed = false }: { title: string; helper: string; operations: SyncOperation[]; empty: string; failed?: boolean }) {
  return <Card className={`rounded-2xl bg-white/60 p-4 shadow-sm ring-1 ${failed && operations.length ? "border-transparent ring-amber-200" : "border-transparent ring-pink-100"}`}><CardHeader><CardTitle className="text-base text-slate-700">{title}</CardTitle><p className="text-xs text-slate-500">{helper}</p></CardHeader><CardContent>{operations.length ? <ul className="space-y-2">{operations.map((operation) => <li key={operation.id} className="rounded-2xl bg-white/60 px-4 py-3 ring-1 ring-pink-100"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-medium text-slate-700">{friendlyEntity(operation.entityType)} {operation.operationType}</p><p className="text-xs text-slate-500">{exactTime(operation.createdAt)}</p></div><StatusChip tone={failed ? "warning" : "info"}>{operation.status.replaceAll("-", " ")}</StatusChip></div>{operation.errorMessage ? <p className="mt-2 text-sm text-amber-800">{operation.errorMessage}</p> : null}</li>)}</ul> : <EmptyState title={empty} description={failed ? "The planner will show an actionable message if a change cannot synchronize." : "New offline changes will appear here."} />}</CardContent></Card>;
}

function ConflictList({ conflicts, resolving, onResolve }: { conflicts: SyncConflict[]; resolving?: string; onResolve: (conflict: SyncConflict, choice: "local" | "remote") => Promise<void> }) {
  return <Card className="rounded-2xl border-transparent bg-white/60 p-4 shadow-sm ring-1 ring-pink-100"><CardHeader><CardTitle className="text-base text-slate-700">Conflict review</CardTitle><p className="text-xs text-slate-500">Both versions remain preserved until you choose. Nothing is changed by opening this view.</p></CardHeader><CardContent>
    {conflicts.length ? <div className="space-y-4">{conflicts.map((conflict) => <article key={conflict.id} className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold text-slate-800">{friendlyEntity(conflict.entityType)} changed elsewhere</h4><p className="mt-1 text-sm text-slate-600">Review the fields below before choosing a version.</p></div><StatusChip tone="warning">Conflict</StatusChip></div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-white/80 p-3 ring-1 ring-pink-100"><dt className="text-xs font-semibold text-slate-500">This device</dt><dd className="mt-2 space-y-2">{conflict.conflictingFields.map((field) => <ConflictValue key={field} field={field} value={valueAt(conflict.localVersion, field)} />)}</dd></div>
        <div className="rounded-xl bg-white/80 p-3 ring-1 ring-pink-100"><dt className="text-xs font-semibold text-slate-500">Other version</dt><dd className="mt-2 space-y-2">{conflict.conflictingFields.map((field) => <ConflictValue key={field} field={field} value={valueAt(conflict.remoteVersion, field)} />)}</dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2"><Button disabled={resolving === conflict.id} onClick={() => void onResolve(conflict, "local")}>Keep this device</Button><Button disabled={resolving === conflict.id || conflict.remoteVersion === undefined} variant="outline" onClick={() => void onResolve(conflict, "remote")}>Keep other version</Button><Button variant="outline" onClick={() => window.alert("Open the affected item to enter a reviewed merged value. The planner will validate it before saving.")}>Merge manually</Button></div>
    </article>)}</div> : <EmptyState title="No conflicts to review" description="If the same field changes on two devices, both versions will be preserved here." />}
  </CardContent></Card>;
}
function valueAt(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value === undefined ? "Deleted" : "Unavailable";
  const fieldValue = (value as Record<string, unknown>)[field];
  return fieldValue === undefined ? "Not set" : typeof fieldValue === "string" || typeof fieldValue === "number" || typeof fieldValue === "boolean" ? String(fieldValue) : "Changed structured value";
}
function ConflictValue({ field, value }: { field: string; value: string }) {
  return <div><div className="text-xs capitalize text-slate-500">{field.replaceAll("-", " ")}</div><div className="break-words text-sm text-slate-700">{value}</div></div>;
}

function StoragePanel({ status, diagnostics, onCopy }: { status: OfflineReliabilityStatus; diagnostics: SyncDiagnosticEvent[]; onCopy: () => void }) {
  return <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
    <Card className="rounded-2xl border-transparent bg-white/60 p-4 shadow-sm ring-1 ring-pink-100"><CardHeader><CardTitle className="flex items-center gap-2 text-base text-slate-700"><ShieldCheckIcon className="h-4 w-4 text-pink-500" aria-hidden="true" />Storage health</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-slate-600">
      <p>{status.durability === "durable" ? "Durable local storage is available. Your saved changes can survive refreshes and browser restarts." : "Durable local storage is not confirmed. Changes may not survive browser closure."}</p>
      <p>Closing the browser may pause synchronization. Changes resume when the planner opens again under this account.</p>
      <p>Google Calendar publishing has its own status and is not implied by planner synchronization.</p>
    </CardContent></Card>
    <Card className="rounded-2xl border-transparent bg-white/60 p-4 shadow-sm ring-1 ring-pink-100"><CardHeader><CardTitle className="text-base text-slate-700">Migration & recovery</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-slate-600"><p>Existing planner IDs and legacy storage remain preserved during this reliability rollout.</p><p>Interrupted local operations are recovered automatically without deleting planner content.</p></CardContent></Card>
    <Card className="rounded-2xl border-transparent bg-white/60 shadow-sm ring-1 ring-pink-100 lg:col-span-2"><CardContent className="p-4">
      <details className="group"><summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-700">Technical details <ChevronDownIcon className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary>
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4"><p className="text-xs text-slate-500">Diagnostics contain status codes and counts only. Task titles, notes, calendar titles, and AI messages are excluded.</p>{diagnostics.length ? <ul className="space-y-1 text-xs text-slate-500">{diagnostics.slice(0, 10).map((item) => <li key={item.id}>{item.severity} · {item.code} · {exactTime(item.createdAt)}</li>)}</ul> : <p className="text-sm text-slate-500">No diagnostic issues recorded.</p>}<Button variant="outline" onClick={onCopy}>Copy privacy-safe diagnostics</Button></div>
      </details>
    </CardContent></Card>
  </div>;
}
function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="rounded-2xl bg-white/60 px-4 py-10 text-center ring-1 ring-pink-100"><CheckCircle2Icon className="mx-auto mb-2 h-5 w-5 text-pink-400" aria-hidden="true" /><p className="text-sm font-medium text-slate-700">{title}</p><p className="mt-1 text-xs text-slate-500">{description}</p></div>;
}
