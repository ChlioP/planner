import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { localDateFromDate, minutesToDuration } from "@/lib/localDateTime";
import {
  activeTimeLogs,
  activeTimerConflicts,
  completeTimer,
  createManualTimeLog,
  discardTimer,
  editCompletedTimeLog,
  elapsedSeconds,
  formatElapsedSeconds,
  pauseTimer,
  remainingTrackedEstimate,
  resumeTimer,
  runningTimeLogs,
  roundTrackedSecondsToMinutes,
  sessionActualMinutes,
  taskActualMinutes,
  timerWarnings,
  type TimeLog,
} from "@/lib/timeLogs";
import { completeTask, type TaskRecord } from "@/lib/taskHistory";
import { completeTaskSession, type TaskSession } from "@/lib/taskSessions";
import { updateScheduleBlock, type ScheduleBlock } from "@/lib/scheduleBlocks";

interface Props {
  tasks: TaskRecord[];
  setTasks: Dispatch<SetStateAction<TaskRecord[]>>;
  sessions: TaskSession[];
  setSessions: Dispatch<SetStateAction<TaskSession[]>>;
  scheduleBlocks: ScheduleBlock[];
  setScheduleBlocks: Dispatch<SetStateAction<ScheduleBlock[]>>;
  logs: TimeLog[];
  setLogs: Dispatch<SetStateAction<TimeLog[]>>;
  onStart: (input: { taskId: string; sessionId?: string; scheduleBlockId?: string }) => void;
  recovered: boolean;
  showPanel: boolean;
}

export function FocusTimerPanel(props: Props) {
  const [now, setNow] = useState(() => new Date().toISOString());
  const [open, setOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(() => props.tasks.find((task) => task.status !== "archived" && task.status !== "completed")?.id ?? "");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [manualDate, setManualDate] = useState(() => localDateFromDate(new Date()));
  const [manualMinutes, setManualMinutes] = useState("");
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [message, setMessage] = useState("");
  const active = runningTimeLogs(props.logs)[0] ?? activeTimeLogs(props.logs)[0];
  const conflicts = activeTimerConflicts(props.logs);
  const task = active ? props.tasks.find((item) => item.id === active.taskId) : undefined;
  const session = active?.sessionId ? props.sessions.find((item) => item.id === active.sessionId) : undefined;
  const schedule = active?.scheduleBlockId ? props.scheduleBlocks.find((item) => item.id === active.scheduleBlockId) : undefined;
  const seconds = active ? elapsedSeconds(active, now) : 0;

  useEffect(() => {
    if (active?.status !== "running") return;
    const interval = window.setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => window.clearInterval(interval);
  }, [active?.id, active?.status]);

  const updateLog = (log: TimeLog) => props.setLogs((current) => current.map((item) => item.id === log.id ? log : item));
  const stopAndSave = () => {
    if (!active) return;
    const currentNow = new Date().toISOString();
    const currentSeconds = elapsedSeconds(active, currentNow);
    const rounded = roundTrackedSecondsToMinutes(currentSeconds);
    const edited = window.prompt(`Save ${formatElapsedSeconds(currentSeconds)} as tracked time? Rounded total: ${rounded} minute${rounded === 1 ? "" : "s"}. Edit minutes if needed.`, String(rounded));
    if (edited === null) { setMessage("Timer remains active."); return; }
    const minutes = Number(edited);
    if (!Number.isInteger(minutes) || minutes <= 0) { setMessage("Enter a whole number of minutes greater than zero."); return; }
    const note = window.prompt("Optional note", active.note ?? "") ?? active.note;
    const completed = completeTimer(active, currentNow, minutes * 60, note);
    updateLog(completed);
    if (session && window.confirm("Save and mark this work session complete?")) {
      props.setSessions((current) => current.map((item) => item.id === session.id ? completeTaskSession(item) : item));
    } else if (!session && task && window.confirm("Save and mark this task complete?")) {
      props.setTasks((current) => current.map((item) => item.id === task.id ? completeTask(item) : item));
    }
    if (schedule && window.confirm("Mark the linked schedule block complete?")) {
      props.setScheduleBlocks((current) => current.map((item) => item.id === schedule.id ? updateScheduleBlock(item, { status: "completed" }) : item));
    }
    setMessage(`Saved ${minutesToDuration(minutes)}. Work completion remains separate unless you confirmed it.`);
  };

  const addManual = () => {
    if (!selectedTaskId) { setMessage("Choose a task."); return; }
    try {
      const result = createManualTimeLog({
        taskId: selectedTaskId, sessionId: selectedSessionId || undefined, date: manualDate,
        durationMinutes: manualStart || manualEnd ? undefined : Number(manualMinutes),
        startTime: manualStart || undefined, endTime: manualEnd || undefined, note: manualNote || undefined,
      }, props.logs);
      if (result.warnings.length && !window.confirm(`${result.warnings.join("\n")}\n\nSave this time anyway?`)) return;
      props.setLogs((current) => [...current, result.log]);
      setManualMinutes(""); setManualStart(""); setManualEnd(""); setManualNote("");
      setMessage("Manual time saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Time could not be saved."); }
  };

  const linkedSessions = props.sessions.filter((item) => item.parentTaskId === selectedTaskId && item.status !== "archived");
  const history = useMemo(() => props.logs.filter((log) => log.status === "completed").slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [props.logs]);
  const tracked = task ? taskActualMinutes(task, props.logs) : 0;
  const activeWarnings = active ? timerWarnings(active, now) : [];

  return <>
    {active ? <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-2xl border border-pink-200 bg-white/95 p-4 shadow-lg backdrop-blur" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3"><button className="min-w-40 flex-1 text-left" onClick={() => setOpen(true)}><span className="block font-medium text-slate-700">{session?.title ?? task?.title ?? "Active timer"}</span><span className="text-xs text-slate-500">{active.status === "running" ? "Running" : "Paused"} · {formatElapsedSeconds(seconds)}</span></button>
      {active.status === "running" ? <Button variant="outline" onClick={() => updateLog(pauseTimer(active))}>Pause</Button> : <Button variant="outline" onClick={() => updateLog(resumeTimer(active))}>Resume</Button>}
      <Button onClick={stopAndSave}>Stop and save</Button></div>
    </div> : null}
    {props.showPanel ? <Card className="rounded-2xl bg-white/80 p-4"><CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-base">Focus timer</CardTitle><p className="text-xs text-slate-500">Timer state is saved from timestamps and continues across navigation or refresh.</p></div><Button variant="outline" onClick={() => setOpen((value) => !value)}>{open ? "Close focus view" : "Open focus view"}</Button></CardHeader>
      {open ? <CardContent className="space-y-4">
        {props.recovered && active ? <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">A timer for {session?.title ?? task?.title ?? "this work"} is still {active.status}. You can continue, pause, save, or discard it.</div> : null}
        {conflicts.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><div className="font-medium">Multiple active timers were found after synchronization.</div><p>Choose which timer should keep running. The others will remain safely paused.</p><div className="mt-2 flex flex-wrap gap-2">{conflicts.map((conflict) => <Button key={conflict.id} variant="outline" onClick={() => {
          const timestamp = new Date().toISOString();
          props.setLogs((current) => current.map((log) => log.status === "running" && log.id !== conflict.id ? pauseTimer(log, timestamp) : log));
          setMessage("Timer conflict resolved. Other timers remain paused.");
        }}>Keep {props.tasks.find((item) => item.id === conflict.taskId)?.title ?? "this timer"}</Button>)}</div></div> : null}
        {active ? <div className="space-y-3 rounded-xl border bg-white p-4">
          <div><div className="text-sm text-slate-500">{session ? `${task?.title} · ${session.title}` : task?.title}</div><div className="text-4xl font-semibold tabular-nums text-slate-800">{formatElapsedSeconds(seconds)}</div></div>
          <div className="grid gap-2 text-sm sm:grid-cols-3"><div>Estimate: {minutesToDuration(session?.estimatedMinutes ?? task?.estimatedMinutes ?? 0)}</div><div>Tracked: {minutesToDuration(tracked)}</div><div>Remaining estimate: {minutesToDuration(remainingTrackedEstimate(session?.estimatedMinutes ?? task?.estimatedMinutes, session ? sessionActualMinutes(session, props.logs) : tracked) ?? 0)}</div></div>
          {schedule ? <p className="text-sm text-slate-600">Scheduled: {schedule.date}, {schedule.startTime}–{schedule.endTime} · elapsed versus scheduled: {formatElapsedSeconds(seconds)} / {minutesToDuration(schedule.durationMinutes)}</p> : null}
          {activeWarnings.map((warning) => <p key={warning} className="text-sm text-amber-700">{warning}</p>)}
          <label className="text-xs">Timer note<Input value={active.note ?? ""} onChange={(event) => updateLog({ ...active, note: event.target.value, updatedAt: new Date().toISOString() })}/></label>
          <div className="flex flex-wrap gap-2">{active.status === "running" ? <Button variant="outline" onClick={() => updateLog(pauseTimer(active))}>Pause</Button> : <Button variant="outline" onClick={() => updateLog(resumeTimer(active))}>Resume</Button>}<Button onClick={stopAndSave}>Stop and save</Button><Button variant="outline" onClick={() => { if (seconds > 0 && !window.confirm(`Discard ${formatElapsedSeconds(seconds)} without adding it to actual time?`)) return; updateLog(discardTimer(active)); setMessage("Timer discarded."); }}>Discard</Button></div>
        </div> : <div className="grid gap-3 sm:grid-cols-[2fr_2fr_auto]"><label className="text-xs">Task<select className="block h-10 w-full rounded-md border px-3" value={selectedTaskId} onChange={(event) => { setSelectedTaskId(event.target.value); setSelectedSessionId(""); }}>{props.tasks.filter((item) => item.status !== "archived" && item.status !== "completed").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label className="text-xs">Work session, optional<select className="block h-10 w-full rounded-md border px-3" value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}><option value="">Whole task</option>{linkedSessions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><Button className="self-end" onClick={() => props.onStart({ taskId: selectedTaskId, sessionId: selectedSessionId || undefined })}>Start</Button></div>}

        <div className="rounded-xl border p-3"><h3 className="font-medium text-slate-700">Add time manually</h3><div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs">Date<Input type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)}/></label><label className="text-xs">Duration in minutes<Input type="number" min={1} value={manualMinutes} disabled={Boolean(manualStart || manualEnd)} onChange={(event) => setManualMinutes(event.target.value)}/></label><label className="text-xs">Start time, optional<Input type="time" value={manualStart} onChange={(event) => setManualStart(event.target.value)}/></label><label className="text-xs">End time, optional<Input type="time" value={manualEnd} onChange={(event) => setManualEnd(event.target.value)}/></label></div><label className="mt-2 block text-xs">Note<Input value={manualNote} onChange={(event) => setManualNote(event.target.value)}/></label><Button className="mt-2" onClick={addManual}>Save manual time</Button></div>

        <div><h3 className="font-medium text-slate-700">Time-log history</h3>{history.length ? <div className="mt-2 space-y-2">{history.map((log) => {
          const logTask = props.tasks.find((item) => item.id === log.taskId);
          const logSession = log.sessionId ? props.sessions.find((item) => item.id === log.sessionId) : undefined;
          return <div key={log.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm"><div className="min-w-52 flex-1"><div className="font-medium">{logSession?.title ?? logTask?.title ?? "Historical task"}</div><div className="text-xs text-slate-500">{new Date(log.startedAt).toLocaleString()} · {minutesToDuration(roundTrackedSecondsToMinutes(log.accumulatedSeconds))} · {log.source}{log.note ? ` · ${log.note}` : ""}</div></div><Button variant="outline" onClick={() => { const value = window.prompt("Edit saved minutes", String(roundTrackedSecondsToMinutes(log.accumulatedSeconds))); if (value === null) return; try { updateLog(editCompletedTimeLog(log, { durationMinutes: Number(value) })); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid duration."); } }}>Edit</Button><Button variant="outline" onClick={() => { if (window.confirm("Delete this time log? Actual time will be recalculated.")) props.setLogs((current) => current.filter((item) => item.id !== log.id)); }}>Delete</Button></div>;
        })}</div> : <p className="mt-2 text-sm text-slate-500">No saved time logs yet.</p>}</div>
        {message ? <p role="status" aria-live="polite" className="text-sm text-slate-700">{message}</p> : null}
      </CardContent> : null}
    </Card> : null}
  </>;
}
