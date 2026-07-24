import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  archiveTaskSession,
  breakdownState,
  completeTaskSession,
  confirmGeneratedSessionPreview,
  createTaskSession,
  editTaskSession,
  manualBreakdownWarnings,
  reorderTaskSessions,
  restoreTaskSession,
  sessionTotals,
  sessionsForParent,
  splitTaskEffort,
  type TaskSession,
} from "@/lib/taskSessions";
import { formatEffortMinutes } from "@/lib/taskEffort";
import { completeTask, type TaskRecord } from "@/lib/taskHistory";
import { taskHasActiveTimer, type TimeLog } from "@/lib/timeLogs";

interface PreviewSession { id: string; title: string; estimatedMinutes: number }

export function TaskSessionManager({
  parent,
  sessions,
  setSessions,
  setTasks,
  onClose,
  onStartTimer,
  timeLogs,
}: {
  parent: TaskRecord;
  sessions: TaskSession[];
  setSessions: Dispatch<SetStateAction<TaskSession[]>>;
  setTasks: Dispatch<SetStateAction<TaskRecord[]>>;
  onClose: () => void;
  onStartTimer: (input: { taskId: string; sessionId?: string }) => void;
  timeLogs: TimeLog[];
}) {
  const linked = useMemo(() => sessionsForParent(sessions, parent.id), [parent.id, sessions]);
  const totals = useMemo(() => sessionTotals(parent, linked), [linked, parent]);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [preferred, setPreferred] = useState(String(parent.maximumSessionMinutes ? Math.min(60, parent.maximumSessionMinutes) : 60));
  const [minimum, setMinimum] = useState(String(parent.minimumSessionMinutes ?? 25));
  const [maximum, setMaximum] = useState(String(parent.maximumSessionMinutes ?? 90));
  const [sessionCount, setSessionCount] = useState("");
  const [naming, setNaming] = useState<"generic" | "numbered" | "custom">("generic");
  const [preview, setPreview] = useState<PreviewSession[] | null>(null);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [manualTitle, setManualTitle] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualMinutes, setManualMinutes] = useState("60");
  const [message, setMessage] = useState<string | null>(null);

  const generatePreview = () => {
    if (parent.estimatedMinutes === undefined) { setMessage("Add an estimate before creating work sessions."); return; }
    if (!parent.isSplittable) { setMessage("Mark this task as splittable before automatic generation. Manual breakdown is still available."); return; }
    if (parent.status === "completed" || parent.status === "archived") { setMessage("Reopen this task before generating new sessions."); return; }
    try {
      const result = splitTaskEffort({
        remainingTaskMinutes: totals.unassignedMinutes,
        preferredSessionMinutes: Number(preferred),
        minimumSessionMinutes: Number(minimum),
        maximumSessionMinutes: Number(maximum),
        numberOfSessions: sessionCount ? Number(sessionCount) : undefined,
      });
      const proposed = result.durations.map((estimatedMinutes, index) => ({
        id: `preview-${index}`,
        title: naming === "numbered" ? `Part ${index + 1}` : naming === "custom" ? "" : `${parent.title} Session ${linked.length + index + 1}`,
        estimatedMinutes,
      }));
      setPreview(proposed);
      setPreviewWarnings(result.warnings);
      setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sessions could not be proposed."); }
  };

  const confirmPreview = () => {
    if (!preview) return;
    if (preview.some((session) => !session.title.trim() || !Number.isInteger(session.estimatedMinutes) || session.estimatedMinutes <= 0)) { setMessage("Every proposed session needs a title and positive duration."); return; }
    const proposedTotal = preview.reduce((sum, session) => sum + session.estimatedMinutes, 0);
    const warnings = proposedTotal === totals.unassignedMinutes ? previewWarnings : [...previewWarnings, `Proposed time differs from unassigned time by ${Math.abs(proposedTotal - totals.unassignedMinutes)} minutes.`];
    if (warnings.length && !window.confirm(`${warnings.join("\n")}\n\nSave these sessions?`)) return;
    const result = confirmGeneratedSessionPreview(sessions, parent, preview);
    setSessions(result.sessions);
    setPreview(null);
    setMessage(`Saved ${result.created.length} work session(s); skipped ${result.skippedDuplicates} duplicate(s).`);
  };

  const addManual = () => {
    if (parent.estimatedMinutes === undefined) { setMessage("Add an estimate before creating work sessions."); return; }
    if (parent.status === "completed" || parent.status === "archived") { setMessage("Reopen this task before adding sessions."); return; }
    const duration = Number(manualMinutes);
    if (!manualTitle.trim()) { setMessage("Session title is required."); return; }
    if (!Number.isInteger(duration) || duration <= 0) { setMessage("Session duration must be greater than zero."); return; }
    const proposed = createTaskSession({ parentTaskId: parent.id, title: manualTitle.trim(), description: manualDescription.trim() || undefined, estimatedMinutes: duration, status: "backlog", order: linked.length, isGenerated: false });
    const warnings = manualBreakdownWarnings(parent.estimatedMinutes, totals.assignedMinutes, [proposed]);
    if (warnings.length && !window.confirm(`${warnings.join("\n")}\n\nAdd this session anyway?`)) return;
    setSessions((current) => [...current, proposed]);
    setManualTitle(""); setManualDescription(""); setMessage("Manual work session added.");
  };

  const updateSession = (session: TaskSession, changes: Partial<TaskSession>) => {
    try {
      const updated = editTaskSession(session, changes);
      setSessions((current) => current.map((item) => item.id === session.id ? updated : item));
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Session could not be updated."); }
  };

  const toggleComplete = (session: TaskSession) => {
    const updated = completeTaskSession(session);
    const next = sessions.map((item) => item.id === session.id ? updated : item);
    setSessions(next);
    const nextTotals = sessionTotals(parent, sessionsForParent(next, parent.id));
    if (updated.status === "completed" && nextTotals.allActiveSessionsComplete && parent.status !== "completed") {
      if (window.confirm("All work sessions are complete. Mark parent task complete?")) {
        setTasks((current) => current.map((task) => task.id === parent.id ? completeTask(task) : task));
      }
    }
  };

  const move = (session: TaskSession, amount: number) => {
    const activeOrder = linked.map((item) => item.id);
    const index = activeOrder.indexOf(session.id);
    const target = index + amount;
    if (target < 0 || target >= activeOrder.length) return;
    [activeOrder[index], activeOrder[target]] = [activeOrder[target]!, activeOrder[index]!];
    setSessions((current) => reorderTaskSessions(current, parent.id, activeOrder));
  };

  return <div className="space-y-4 rounded-2xl border border-pink-200 bg-white/90 p-4">
    <div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-700">Work sessions · {parent.title}</h3><p className="text-xs text-slate-500">{breakdownState(parent, linked)}</p></div><Button variant="outline" onClick={onClose}>Close</Button></div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Total estimate" value={formatEffortMinutes(parent.estimatedMinutes)}/><Stat label="Assigned" value={formatEffortMinutes(totals.assignedMinutes)}/><Stat label="Completed through sessions" value={formatEffortMinutes(totals.completedMinutes)}/><Stat label="Unassigned time" value={formatEffortMinutes(totals.unassignedMinutes)}/>
      <Stat label="Remaining incomplete" value={formatEffortMinutes(totals.incompleteMinutes)}/><Stat label="Progress" value={`${totals.progressPercent}%`}/><Stat label="Sessions" value={`${totals.completedSessionCount} of ${totals.activeSessionCount} complete`}/><Stat label="Session actual time" value={formatEffortMinutes(totals.sessionActualMinutes)}/>
    </div>
    {parent.actualMinutes !== undefined ? <p className="text-xs text-slate-500">Legacy parent actual time: {formatEffortMinutes(parent.actualMinutes)}. It is shown separately and is not added to session actual time.</p> : null}
    {message ? <p role="status" className="rounded-xl bg-pink-50 p-2 text-sm">{message}</p> : null}

    {parent.estimatedMinutes === undefined ? <p className="text-sm text-amber-700">Add an estimate before creating work sessions.</p> : parent.status === "completed" || parent.status === "archived" ? <p className="text-sm text-slate-500">Existing sessions remain visible. Reopen the parent to add more.</p> : <div className="space-y-3">
      <div className="flex gap-2"><Button variant="outline" className={mode === "auto" ? "bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90" : "bg-white/80 text-slate-700 ring-1 ring-pink-100 hover:bg-pink-50"} onClick={() => setMode("auto")}>Generate sessions</Button><Button variant="outline" className={mode === "manual" ? "bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90" : "bg-white/80 text-slate-700 ring-1 ring-pink-100 hover:bg-pink-50"} onClick={() => setMode("manual")}>Add session manually</Button></div>
      {mode === "auto" ? <div className="space-y-3"><div className="grid gap-2 md:grid-cols-5"><label className="text-xs">Preferred minutes<Input type="number" min="1" value={preferred} onChange={(event) => setPreferred(event.target.value)}/></label><label className="text-xs">Minimum minutes<Input type="number" min="1" value={minimum} onChange={(event) => setMinimum(event.target.value)}/></label><label className="text-xs">Maximum minutes<Input type="number" min="1" value={maximum} onChange={(event) => setMaximum(event.target.value)}/></label><label className="text-xs">Number of sessions, optional<Input type="number" min="1" value={sessionCount} onChange={(event) => setSessionCount(event.target.value)}/></label><label className="text-xs">Naming style<select className="block h-10 w-full rounded-md border px-2" value={naming} onChange={(event) => setNaming(event.target.value as typeof naming)}><option value="generic">Generic</option><option value="numbered">Numbered</option><option value="custom">Custom names</option></select></label></div><div className="flex flex-wrap gap-1">{[25, 30, 45, 60, 90].map((minutes) => <Button key={minutes} variant="outline" className="text-xs" onClick={() => setPreferred(String(minutes))}>{minutes} min</Button>)}<Button variant="outline" onClick={generatePreview}>Preview breakdown</Button></div></div> : <div className="grid gap-2 md:grid-cols-[1fr_130px_1fr_auto]"><label className="text-xs">Session title<Input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)}/></label><label className="text-xs">Minutes<Input type="number" min="1" value={manualMinutes} onChange={(event) => setManualMinutes(event.target.value)}/></label><label className="text-xs">Description, optional<Input value={manualDescription} onChange={(event) => setManualDescription(event.target.value)}/></label><Button variant="outline" className="self-end bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90" onClick={addManual}>Add session</Button></div>}
    </div>}

    {preview ? <div className="space-y-2 rounded-xl bg-pink-50 p-3"><div className="text-sm font-semibold">Breakdown preview</div><p className="text-xs">Parent estimate: {formatEffortMinutes(parent.estimatedMinutes)} · Completed effort: {formatEffortMinutes(totals.completedMinutes)} · Remaining unassigned: {formatEffortMinutes(totals.unassignedMinutes)} · Proposed: {formatEffortMinutes(preview.reduce((sum, item) => sum + item.estimatedMinutes, 0))}</p>{previewWarnings.map((warning) => <p key={warning} className="text-xs text-amber-700">{warning}</p>)}{preview.map((session, index) => <div key={session.id} className="grid gap-2 md:grid-cols-[1fr_130px_auto]"><Input aria-label={`Session ${index + 1} title`} value={session.title} onChange={(event) => setPreview((current) => current?.map((item) => item.id === session.id ? { ...item, title: event.target.value } : item) ?? null)}/><Input aria-label={`Session ${index + 1} minutes`} type="number" min="1" value={session.estimatedMinutes} onChange={(event) => setPreview((current) => current?.map((item) => item.id === session.id ? { ...item, estimatedMinutes: Number(event.target.value) } : item) ?? null)}/><div className="flex gap-1"><Button variant="outline" disabled={index === 0} onClick={() => setPreview((current) => movePreview(current, index, -1))}>↑</Button><Button variant="outline" disabled={index === preview.length - 1} onClick={() => setPreview((current) => movePreview(current, index, 1))}>↓</Button><Button variant="outline" className="text-red-600" onClick={() => setPreview((current) => current?.filter((item) => item.id !== session.id) ?? null)}>Remove</Button></div></div>)}<div className="flex gap-2"><Button variant="outline" onClick={() => setPreview((current) => [...(current ?? []), { id: crypto.randomUUID(), title: `${parent.title} Session ${(current?.length ?? 0) + 1}`, estimatedMinutes: Number(preferred) || 60 }])}>Add session</Button><Button variant="outline" className="bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90" onClick={confirmPreview}>Confirm sessions</Button><Button variant="outline" onClick={() => setPreview(null)}>Cancel</Button></div></div> : null}

    <div className="space-y-2"><h4 className="text-sm font-semibold text-slate-700">Saved work sessions</h4>{linked.length === 0 ? <p className="text-sm text-slate-500">No work sessions yet.</p> : linked.map((session, index) => <SessionRow key={session.id} session={session} index={index} count={linked.length} onStart={() => onStartTimer({ taskId: parent.id, sessionId: session.id })} onUpdate={(changes) => updateSession(session, changes)} onMove={(amount) => move(session, amount)} onComplete={() => toggleComplete(session)} onArchive={() => {
      if (timeLogs.some((log) => log.sessionId === session.id && (log.status === "running" || log.status === "paused"))) { setMessage("Stop and save or discard this session’s active timer before archiving it."); return; }
      setSessions((current) => current.map((item) => item.id === session.id ? archiveTaskSession(item) : item));
    }} onRestore={() => setSessions((current) => current.map((item) => item.id === session.id ? restoreTaskSession(item) : item))} onDelete={() => {
      if (taskHasActiveTimer(timeLogs.filter((log) => log.sessionId === session.id), parent.id)) { setMessage("Stop and save or discard this session’s active timer before deleting it."); return; }
      if (window.confirm(`Delete “${session.title}”? Historical time logs will remain linked to the parent task.`)) setSessions((current) => current.filter((item) => item.id !== session.id));
    }}/>)}</div>
  </div>;
}

function movePreview(current: PreviewSession[] | null, index: number, amount: number): PreviewSession[] | null {
  if (!current) return current;
  const target = index + amount;
  if (target < 0 || target >= current.length) return current;
  const next = [...current];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function SessionRow({ session, index, count, onStart, onUpdate, onMove, onComplete, onArchive, onRestore, onDelete }: { session: TaskSession; index: number; count: number; onStart: () => void; onUpdate: (changes: Partial<TaskSession>) => void; onMove: (amount: number) => void; onComplete: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void }) {
  const [title, setTitle] = useState(session.title);
  const [description, setDescription] = useState(session.description ?? "");
  const [minutes, setMinutes] = useState(String(session.estimatedMinutes));
  const [actual, setActual] = useState(session.actualMinutes === undefined ? "" : String(session.actualMinutes));
  const save = () => onUpdate({ title, description: description || undefined, estimatedMinutes: Number(minutes), actualMinutes: actual === "" ? undefined : Number(actual) });
  return <div className={`rounded-xl border p-3 ${session.status === "archived" ? "bg-slate-100 opacity-75" : "bg-white/70"}`}><div className="grid gap-2 md:grid-cols-[1fr_120px_120px_auto]"><label className="text-xs">Title<Input value={title} onChange={(event) => setTitle(event.target.value)}/></label><label className="text-xs">Estimate minutes<Input type="number" min="1" value={minutes} onChange={(event) => setMinutes(event.target.value)}/></label><label className="text-xs">Actual minutes<Input type="number" min="0" value={actual} onChange={(event) => setActual(event.target.value)}/></label><div className="flex items-end gap-1"><Button variant="outline" disabled={index === 0} onClick={() => onMove(-1)}>↑</Button><Button variant="outline" disabled={index === count - 1} onClick={() => onMove(1)}>↓</Button><Button variant="outline" onClick={save}>Save</Button></div></div><label className="mt-2 block text-xs">Description<Input value={description} onChange={(event) => setDescription(event.target.value)}/></label><div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-xs text-slate-500">{session.isGenerated ? "Generated session" : "Manual session"} · {session.status}</span>{session.status !== "archived" ? <><Button variant="outline" onClick={onStart}>Start timer</Button><Button variant="outline" onClick={onComplete}>{session.status === "completed" ? "Reopen" : "Complete"}</Button><Button variant="outline" onClick={onArchive}>Archive</Button></> : <Button variant="outline" onClick={onRestore}>Restore</Button>}<Button variant="outline" className="text-red-600" onClick={onDelete}>Delete</Button></div></div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-pink-50 p-2"><div className="text-[11px] text-slate-500">{label}</div><div className="font-semibold text-slate-700">{value}</div></div>;
}
