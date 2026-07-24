import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { blocksForDate, type AvailabilityBlock, type AvailabilityOverride } from "@/lib/availability";
import { localDateFromDate, minutesToDuration, timeToMinutes } from "@/lib/localDateTime";
import {
  confirmSchedulePreview,
  detectScheduleConflicts,
  scheduleWork,
  schedulingState,
  updateScheduleBlock,
  validateScheduleMovement,
  type ScheduleBlock,
  type SchedulingOptions,
  type SchedulingResult,
} from "@/lib/scheduleBlocks";
import { completeTask, type TaskRecord } from "@/lib/taskHistory";
import { completeTaskSession, type TaskSession } from "@/lib/taskSessions";
import { assessActiveTaskRisks, riskLabel } from "@/lib/riskAssessment";
import type { TimeLog } from "@/lib/timeLogs";

interface Props {
  tasks: TaskRecord[];
  setTasks: Dispatch<SetStateAction<TaskRecord[]>>;
  sessions: TaskSession[];
  setSessions: Dispatch<SetStateAction<TaskSession[]>>;
  availability: AvailabilityBlock[];
  overrides: AvailabilityOverride[];
  scheduleBlocks: ScheduleBlock[];
  setScheduleBlocks: Dispatch<SetStateAction<ScheduleBlock[]>>;
  dailyCap: number;
  setDailyCap: (minutes: number) => void;
  timeLogs: TimeLog[];
  onStartTimer: (input: { taskId: string; sessionId?: string; scheduleBlockId?: string }) => void;
}

function addMinutes(time: string, duration: number): string {
  const total = timeToMinutes(time) + duration;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function displayTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function SchedulingPlanner(props: Props) {
  const today = localDateFromDate(new Date());
  const eligibleTasks = props.tasks.filter((task) => task.status !== "archived" && task.status !== "completed");
  const latestDue = eligibleTasks.map((task) => task.dueDate).filter((date): date is string => Boolean(date)).sort().at(-1) ?? today;
  const [selectedTaskIds, setSelectedTaskIds] = useState(() => eligibleTasks.map((task) => task.id));
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(latestDue);
  const { dailyCap, setDailyCap } = props;
  const [minimumBreak, setMinimumBreak] = useState(10);
  const [includeWeekends, setIncludeWeekends] = useState(true);
  const [includeUndated, setIncludeUndated] = useState(false);
  const [includeOverdue, setIncludeOverdue] = useState(false);
  const [replaceProposed, setReplaceProposed] = useState(false);
  const [allowSameTask, setAllowSameTask] = useState(true);
  const [directSplitting, setDirectSplitting] = useState(false);
  const [flexibleOrder, setFlexibleOrder] = useState(false);
  const [preview, setPreview] = useState<SchedulingResult | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [dailyDate, setDailyDate] = useState(today);
  const conflicts = useMemo(() => detectScheduleConflicts(props.scheduleBlocks, props.tasks, props.availability, props.overrides, dailyCap), [dailyCap, props.availability, props.overrides, props.scheduleBlocks, props.tasks]);
  const currentRiskByTask = useMemo(() => {
    const now = new Date();
    return new Map(assessActiveTaskRisks({
      tasks: props.tasks, sessions: props.sessions, availability: props.availability, overrides: props.overrides,
      scheduleBlocks: props.scheduleBlocks, today,
      currentTime: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      dailyCapMinutes: dailyCap, calculatedAt: now.toISOString(), timeLogs: props.timeLogs,
    }).map((item) => [item.taskId, item]));
  }, [dailyCap, props.availability, props.overrides, props.scheduleBlocks, props.sessions, props.tasks, props.timeLogs, today]);
  const riskComparison = useMemo(() => {
    if (!preview) return new Map<string, { before: string; after: string; unscheduledAfter: number }>();
    const now = new Date();
    const context = {
      tasks: props.tasks, sessions: props.sessions, availability: props.availability, overrides: props.overrides,
      scheduleBlocks: props.scheduleBlocks, today,
      currentTime: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      dailyCapMinutes: dailyCap, calculatedAt: now.toISOString(), timeLogs: props.timeLogs,
    };
    const selectedProposals = preview.proposedBlocks.filter((block) => selectedBlockIds.includes(block.id));
    const after = assessActiveTaskRisks({ ...context, proposedBlocks: selectedProposals });
    return new Map(after.map((item) => [item.taskId, { before: riskLabel(currentRiskByTask.get(item.taskId)!), after: riskLabel(item), unscheduledAfter: item.unscheduledMinutes ?? 0 }]));
  }, [currentRiskByTask, dailyCap, preview, props.availability, props.overrides, props.scheduleBlocks, props.sessions, props.tasks, props.timeLogs, selectedBlockIds, today]);

  const options = (runId: string, replan = false): SchedulingOptions => ({
    startDate, endDate, today, selectedTaskIds, includeUndated, includeWeekends, includeOverdue,
    allowLateScheduling: false, allowDirectSplittable: directSplitting, allowFlexibleSessionOrder: flexibleOrder,
    allowSameTaskPerDay: allowSameTask, replaceUnlockedProposed: replaceProposed,
    replaceUnlockedAutomatic: replan,
    dailyCapMinutes: dailyCap, minimumBreakMinutes: minimumBreak, runId, now: new Date().toISOString(),
  });

  const plan = (replan = false) => {
    if (endDate < startDate) { setMessage("End date must be on or after the start date."); return; }
    if (!selectedTaskIds.length) { setMessage("Select at least one task to plan."); return; }
    const runId = `run-${startDate}-${endDate}-${selectedTaskIds.slice().sort().join("-")}`;
    const result = scheduleWork(props.tasks, props.sessions, props.availability, props.overrides, props.scheduleBlocks, options(runId, replan));
    setPreview(result);
    setSelectedBlockIds(result.proposedBlocks.map((block) => block.id));
    setMessage("");
  };

  const confirm = (ids = selectedBlockIds) => {
    if (!preview) return;
    props.setScheduleBlocks((current) => confirmSchedulePreview(current, preview.proposedBlocks, ids, preview.replaceBlockIds));
    const selected = preview.proposedBlocks.filter((block) => ids.includes(block.id));
    setMessage(`${selected.length} work block${selected.length === 1 ? "" : "s"} scheduled · ${minutesToDuration(selected.reduce((sum, block) => sum + block.durationMinutes, 0))} planned.`);
    setPreview(null);
  };

  const movePreview = (block: ScheduleBlock) => {
    const date = window.prompt("Move to date (YYYY-MM-DD)", block.date);
    if (!date) return;
    const startTime = window.prompt("Move to start time (HH:mm)", block.startTime);
    if (!startTime) return;
    let moved: ScheduleBlock;
    try { moved = updateScheduleBlock(block, { date, startTime, endTime: addMinutes(startTime, block.durationMinutes) }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "That time is invalid."); return; }
    const task = props.tasks.find((item) => item.id === block.taskId);
    const errors = validateScheduleMovement(moved, props.availability, props.overrides, [...props.scheduleBlocks, ...(preview?.proposedBlocks ?? [])], { startDate, endDate, dailyCapMinutes: dailyCap, allowLateScheduling: false }, task?.dueDate);
    if (errors.length) { setMessage(errors.join(" ")); return; }
    setPreview((current) => current ? { ...current, proposedBlocks: current.proposedBlocks.map((item) => item.id === block.id ? moved : item) } : current);
  };

  const updateSaved = (block: ScheduleBlock, changes: Partial<ScheduleBlock>) => {
    props.setScheduleBlocks((current) => current.map((item) => item.id === block.id ? updateScheduleBlock(item, changes) : item));
  };

  const moveSaved = (block: ScheduleBlock) => {
    const date = window.prompt("Move to date (YYYY-MM-DD)", block.date);
    if (!date) return;
    const startTime = window.prompt("Move to start time (HH:mm)", block.startTime);
    if (!startTime) return;
    try {
      const moved = updateScheduleBlock(block, { date, startTime, endTime: addMinutes(startTime, block.durationMinutes), source: "manual", isLocked: true });
      const task = props.tasks.find((item) => item.id === block.taskId);
      const errors = validateScheduleMovement(moved, props.availability, props.overrides, props.scheduleBlocks, { startDate: today, endDate: "9999-12-31", dailyCapMinutes: dailyCap, allowLateScheduling: false }, task?.dueDate);
      if (errors.length) { setMessage(errors.join(" ")); return; }
      updateSaved(block, moved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That time is invalid.");
    }
  };

  const completeBlock = (block: ScheduleBlock) => {
    if (!window.confirm(`Mark ${block.title} work block complete?`)) return;
    const rawActual = window.prompt("Actual minutes (optional)", String(block.durationMinutes));
    const actual = rawActual === null || rawActual === "" ? undefined : Number(rawActual);
    updateSaved(block, { status: "completed" });
    if (block.sessionId) {
      if (window.confirm("Mark the linked work session complete too?")) props.setSessions((current) => current.map((session) => session.id === block.sessionId ? completeTaskSession({ ...session, actualMinutes: Number.isFinite(actual) ? actual : session.actualMinutes }) : session));
    } else if (window.confirm("Mark the linked task complete too?")) {
      props.setTasks((current) => current.map((task) => task.id === block.taskId ? completeTask({ ...task, actualMinutes: Number.isFinite(actual) ? actual : task.actualMinutes }) : task));
    }
  };

  const confirmedForDay = props.scheduleBlocks.filter((block) => block.date === dailyDate && block.status !== "cancelled");
  const commitments = blocksForDate(props.availability, props.overrides, dailyDate);
  const plannedMinutes = confirmedForDay.filter((block) => block.status === "confirmed").reduce((sum, block) => sum + block.durationMinutes, 0);

  return <div className="space-y-4">
    <Card className="rounded-2xl bg-white/80 p-4"><CardHeader><CardTitle className="text-base">Plan my work</CardTitle><p className="text-xs text-slate-500">Choose the work and limits for this planning run. Nothing is saved until you confirm.</p></CardHeader><CardContent className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs">Start date<Input type="date" value={startDate} min={today} onChange={(event) => setStartDate(event.target.value)}/></label>
        <label className="text-xs">End date<Input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)}/></label>
        <label className="text-xs">Maximum planned minutes per day<Input type="number" min={1} value={dailyCap} onChange={(event) => setDailyCap(Math.max(1, Number(event.target.value)))}/></label>
        <label className="text-xs">Minimum break in minutes<Input type="number" min={0} value={minimumBreak} onChange={(event) => setMinimumBreak(Math.max(0, Number(event.target.value)))}/></label>
      </div>
      <fieldset className="rounded-xl border p-3"><legend className="px-1 text-xs font-medium">Tasks to include</legend><div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{eligibleTasks.map((task) => <label key={task.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => setSelectedTaskIds((ids) => ids.includes(task.id) ? ids.filter((id) => id !== task.id) : [...ids, task.id])}/><span>{task.title}</span><span className="text-xs text-slate-500">{schedulingState(task, props.sessions.filter((session) => session.parentTaskId === task.id), props.scheduleBlocks.filter((block) => block.taskId === task.id), conflicts.some((conflict) => conflict.taskId === task.id))}</span></label>)}</div></fieldset>
      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Check label="Include weekends" checked={includeWeekends} onChange={setIncludeWeekends}/>
        <Check label="Include selected tasks without due dates" checked={includeUndated} onChange={setIncludeUndated}/>
        <Check label="Include overdue work" checked={includeOverdue} onChange={setIncludeOverdue}/>
        <Check label="Allow the same task more than once per day" checked={allowSameTask} onChange={setAllowSameTask}/>
        <Check label="Allow direct splitting when no sessions exist" checked={directSplitting} onChange={setDirectSplitting}/>
        <Check label="Allow flexible session order" checked={flexibleOrder} onChange={setFlexibleOrder}/>
        <Check label="Replace unlocked suggested blocks" checked={replaceProposed} onChange={setReplaceProposed}/>
        <label className="flex items-center gap-2"><input type="checkbox" checked readOnly/>Preserve confirmed and manual blocks</label>
      </div>
      <Button variant="outline" className="bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90" onClick={() => plan()}>Plan my work</Button>
      {message ? <p role="status" aria-live="polite" className="text-sm text-slate-700">{message}</p> : null}
    </CardContent></Card>

    {preview ? <Card className="rounded-2xl bg-white/90 p-4"><CardHeader><CardTitle className="text-base">Suggested schedule</CardTitle><p className="text-xs text-slate-500">{minutesToDuration(preview.proposedBlocks.reduce((sum, block) => sum + block.durationMinutes, 0))} suggested · {minutesToDuration(preview.unscheduledWork.reduce((sum, item) => sum + item.remainingMinutes, 0))} unscheduled</p></CardHeader><CardContent className="space-y-3">
      {preview.proposedBlocks.length ? preview.proposedBlocks.map((block) => <div key={block.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <input aria-label={`Confirm ${block.title}`} type="checkbox" checked={selectedBlockIds.includes(block.id)} onChange={() => setSelectedBlockIds((ids) => ids.includes(block.id) ? ids.filter((id) => id !== block.id) : [...ids, block.id])}/>
        <div className="min-w-48 flex-1"><div className="font-medium">{block.title}</div><div className="text-xs text-slate-500">{block.date} · {displayTime(block.startTime)}–{displayTime(block.endTime)} · {minutesToDuration(block.durationMinutes)} · Suggested{block.isLocked ? " · Locked" : ""}</div></div>
        <Button variant="outline" onClick={() => movePreview(block)}>Move</Button>
        <Button variant="outline" onClick={() => setPreview((current) => current ? { ...current, proposedBlocks: current.proposedBlocks.map((item) => item.id === block.id ? updateScheduleBlock(item, { isLocked: !item.isLocked }) : item) } : current)}>{block.isLocked ? "Unlock" : "Lock"}</Button>
        <Button variant="outline" onClick={() => { setSelectedBlockIds((ids) => ids.filter((id) => id !== block.id)); setPreview((current) => current ? { ...current, proposedBlocks: current.proposedBlocks.filter((item) => item.id !== block.id) } : current); }}>Keep unscheduled</Button>
      </div>) : <p className="text-sm text-slate-500">No work could be placed.</p>}
      {preview.unscheduledWork.map((item) => <p key={`${item.taskId}-${item.sessionId ?? "task"}`} className="text-sm text-amber-700">{minutesToDuration(item.remainingMinutes)} remain for {item.title}. {item.reason}</p>)}
      {preview.warnings.map((warning) => <p key={warning} className="text-sm text-amber-700">{warning}</p>)}
      {Array.from(riskComparison.entries()).filter(([taskId]) => preview.proposedBlocks.some((block) => block.taskId === taskId)).map(([taskId, comparison]) => <p key={taskId} className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700"><span className="font-medium">Projected:</span> {comparison.before} → {comparison.after} · {minutesToDuration(comparison.unscheduledAfter)} remain unscheduled</p>)}
      <div className="flex flex-wrap gap-2"><Button variant="outline" className="bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90" onClick={() => confirm()} disabled={!selectedBlockIds.length}>Confirm selected blocks</Button><Button variant="outline" onClick={() => confirm(preview.proposedBlocks.map((block) => block.id))}>Confirm all</Button><Button variant="outline" onClick={() => setPreview(null)}>Cancel</Button><Button variant="outline" onClick={() => setPreview(null)}>Return to options</Button></div>
    </CardContent></Card> : null}

    {conflicts.length ? <Card className="rounded-2xl border-amber-200 bg-amber-50/90 p-4"><CardHeader><CardTitle className="text-base">Scheduling conflicts</CardTitle></CardHeader><CardContent className="space-y-2">{conflicts.map((conflict) => {
      const block = props.scheduleBlocks.find((item) => item.id === conflict.blockId)!;
      return <div key={`${conflict.blockId}-${conflict.reason}`} className="rounded-xl border border-amber-200 p-3 text-sm"><div className="font-medium">{block.title} · {conflict.date}</div><p>{conflict.reason}</p><div className="mt-2 flex gap-2"><Button variant="outline" onClick={() => updateSaved(block, { isLocked: false })}>Unlock and replan</Button><Button variant="outline" onClick={() => { if (window.confirm("Cancel this work block?")) updateSaved(block, { status: "cancelled" }); }}>Cancel block</Button></div></div>;
    })}<Button variant="outline" onClick={() => plan(true)}>Replan remaining work</Button></CardContent></Card> : null}

    <Card className="rounded-2xl bg-white/80 p-4"><CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-base">Daily plan</CardTitle><p className="text-xs text-slate-500">{minutesToDuration(plannedMinutes)} planned work</p></div><Input className="w-auto" aria-label="Daily plan date" type="date" value={dailyDate} onChange={(event) => setDailyDate(event.target.value)}/></CardHeader><CardContent className="space-y-3">
      {commitments.length ? <div><div className="mb-1 text-xs font-medium text-slate-600">Availability and commitments</div>{commitments.map((block) => <div key={block.id} className="text-sm text-slate-600">{displayTime(block.startTime)}–{displayTime(block.endTime)} · {block.name} ({block.type === "available" ? "Available" : "Unavailable"})</div>)}</div> : <p className="text-sm text-slate-500">No availability is configured for this date.</p>}
      {confirmedForDay.length ? confirmedForDay.map((block) => <div key={block.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3"><div className="flex-1"><div className="font-medium">{block.title}</div><div className="text-xs text-slate-500">{displayTime(block.startTime)}–{displayTime(block.endTime)} · {block.status}{block.isLocked ? " · Locked" : ""}</div>{currentRiskByTask.get(block.taskId) ? <div className="text-xs font-medium text-slate-600">Planning status: {riskLabel(currentRiskByTask.get(block.taskId)!)}</div> : null}</div>{block.status === "confirmed" ? <><Button variant="outline" onClick={() => props.onStartTimer({ taskId: block.taskId, sessionId: block.sessionId, scheduleBlockId: block.id })}>Start timer</Button><Button variant="outline" onClick={() => moveSaved(block)}>Move</Button><Button variant="outline" onClick={() => updateSaved(block, { isLocked: !block.isLocked })}>{block.isLocked ? "Unlock" : "Lock"}</Button><Button variant="outline" onClick={() => completeBlock(block)}>Complete</Button><Button variant="outline" onClick={() => updateSaved(block, { status: "missed" })}>Missed</Button><Button variant="outline" onClick={() => { if (window.confirm("Cancel this work block?")) updateSaved(block, { status: "cancelled" }); }}>Cancel</Button></> : <Button variant="outline" onClick={() => { setSelectedTaskIds([block.taskId]); setStartDate(today); setPreview(null); setMessage("Task selected. Choose Plan my work to plan it again."); }}>Plan again</Button>}</div>) : <p className="text-sm text-slate-500">No scheduled work for this date.</p>}
    </CardContent></Card>
  </div>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/>{label}</label>;
}
