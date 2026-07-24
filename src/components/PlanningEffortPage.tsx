import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TaskEffortEditor } from "./TaskEffortEditor";
import {
  estimateState,
  formatEffortMinutes,
  needsEstimateForScheduling,
  planningEffortSummary,
  tasksMissingEstimates,
} from "@/lib/taskEffort";
import { completeTask, createTask, type TaskCategory, type TaskRecord } from "@/lib/taskHistory";
import { breakdownState, parentEstimateWarnings, sessionsForParent, type TaskSession } from "@/lib/taskSessions";
import { TaskSessionManager } from "./TaskSessionManager";
import { SchedulingPlanner } from "./SchedulingPlanner";
import type { AvailabilityBlock, AvailabilityOverride } from "@/lib/availability";
import type { ScheduleBlock } from "@/lib/scheduleBlocks";
import { assessActiveTaskRisks, riskLabel } from "@/lib/riskAssessment";
import { localDateFromDate } from "@/lib/localDateTime";
import { PlanningHealth } from "./PlanningHealth";
import { taskActualMinutes, type TimeLog } from "@/lib/timeLogs";

const CATEGORIES: Array<{ value: TaskCategory; label: string }> = [
  { value: "work", label: "Work" }, { value: "school", label: "School" },
  { value: "career", label: "Career" }, { value: "portfolio", label: "Portfolio" },
  { value: "health", label: "Health" }, { value: "personal", label: "Personal" },
  { value: "other", label: "Other" },
];

type EffortPatch = Pick<TaskRecord, "estimatedMinutes" | "actualMinutes" | "isSplittable" | "minimumSessionMinutes" | "maximumSessionMinutes">;

function applyEffort(task: TaskRecord, patch: EffortPatch, complete: boolean): TaskRecord {
  const updated = { ...task, ...patch, updatedAt: new Date().toISOString() };
  return complete ? completeTask(updated) : updated;
}

export function PlanningEffortPage({ tasks, setTasks, sessions, setSessions, availability, overrides, scheduleBlocks, setScheduleBlocks, timeLogs, onStartTimer }: { tasks: TaskRecord[]; setTasks: Dispatch<SetStateAction<TaskRecord[]>>; sessions: TaskSession[]; setSessions: Dispatch<SetStateAction<TaskSession[]>>; availability: AvailabilityBlock[]; overrides: AvailabilityOverride[]; scheduleBlocks: ScheduleBlock[]; setScheduleBlocks: Dispatch<SetStateAction<ScheduleBlock[]>>; timeLogs: TimeLog[]; onStartTimer: (input: { taskId: string; sessionId?: string; scheduleBlockId?: string }) => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState<TaskCategory>("other");
  const [newDueDate, setNewDueDate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [queueIndex, setQueueIndex] = useState(0);
  const [sessionParentId, setSessionParentId] = useState<string | null>(null);
  const [planningDailyCap, setPlanningDailyCap] = useState(180);
  const [calculationNow] = useState(() => new Date());
  const riskAssessments = useMemo(() => assessActiveTaskRisks({
    tasks, sessions, availability, overrides, scheduleBlocks,
    today: localDateFromDate(calculationNow),
    currentTime: `${String(calculationNow.getHours()).padStart(2, "0")}:${String(calculationNow.getMinutes()).padStart(2, "0")}`,
    dailyCapMinutes: planningDailyCap,
    calculatedAt: calculationNow.toISOString(), timeLogs,
  }), [availability, calculationNow, overrides, planningDailyCap, scheduleBlocks, sessions, tasks, timeLogs]);
  const riskByTask = useMemo(() => new Map(riskAssessments.map((assessment) => [assessment.taskId, assessment])), [riskAssessments]);
  const summary = useMemo(() => planningEffortSummary(tasks), [tasks]);
  const missing = useMemo(() => tasksMissingEstimates(tasks), [tasks]);
  const queueTask = missing.length ? missing[queueIndex % missing.length] : undefined;
  const displayed = onlyMissing ? missing : tasks.filter((task) => task.status !== "archived");
  const draftTask = useMemo(() => createTask({
    id: "effort-draft",
    title: newTitle || "New task",
    category: newCategory,
    dueDate: newDueDate || undefined,
    date: "",
    time: "",
    status: newDueDate ? "planned" : "backlog",
  }, "1970-01-01T00:00:00.000Z"), [newCategory, newDueDate, newTitle]);

  const saveExisting = (task: TaskRecord, patch: EffortPatch, complete = false) => {
    const linked = sessionsForParent(sessions, task.id);
    const warnings = parentEstimateWarnings(patch.estimatedMinutes, linked);
    if (task.isSplittable && !patch.isSplittable && linked.length) warnings.push("Existing work sessions will be preserved when splitting is turned off.");
    if (warnings.length && !window.confirm(`${warnings.join("\n")}\n\nSave this effort change?`)) return;
    setTasks((current) => current.map((item) => item.id === task.id ? applyEffort(item, patch, complete) : item));
    setEditingId(null);
  };

  return <div className="space-y-4 p-4 [&_button]:rounded-full">
    <Card className="rounded-2xl bg-white/80 p-4"><CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-lg text-slate-700">Planning effort</CardTitle><p className="text-xs text-slate-500">Estimate how much work tasks require. Scheduling is not enabled yet.</p></div><Button variant="outline" className="self-start rounded-full bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90 sm:ml-auto sm:self-center" onClick={() => setShowCreate(true)}>Create task</Button></CardHeader></Card>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Summary label="Total planned effort" value={formatEffortMinutes(summary.totalMinutes)}/>
      <Summary label="School" value={formatEffortMinutes(summary.categoryMinutes.school)}/>
      <Summary label="Career" value={formatEffortMinutes(summary.categoryMinutes.career)}/>
      <Summary label="Portfolio" value={formatEffortMinutes(summary.categoryMinutes.portfolio)}/>
      <Summary label="Missing estimates" value={`${summary.missingEstimateCount} task${summary.missingEstimateCount === 1 ? "" : "s"}`}/>
    </div>

    {showCreate ? <Card className="rounded-2xl bg-white/90 p-4"><CardHeader><CardTitle className="text-base">Create a task</CardTitle></CardHeader><CardContent className="space-y-3"><div className="grid gap-3 md:grid-cols-3"><label className="text-xs">Task title<Input value={newTitle} onChange={(event) => setNewTitle(event.target.value)}/></label><label className="text-xs">Category<select className="block h-10 w-full rounded-md border px-3" value={newCategory} onChange={(event) => setNewCategory(event.target.value as TaskCategory)}>{CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label><label className="text-xs">Due date, optional<Input type="date" value={newDueDate} onChange={(event) => setNewDueDate(event.target.value)}/></label></div><TaskEffortEditor task={draftTask} onSave={(patch, complete) => {
      if (!newTitle.trim()) return;
      const created = createTask({ title: newTitle.trim(), category: newCategory, dueDate: newDueDate || undefined, date: "", time: "", status: newDueDate ? "planned" : "backlog", ...patch });
      setTasks((current) => [...current, complete ? completeTask(created) : created]);
      setNewTitle(""); setNewDueDate(""); setNewCategory("other"); setShowCreate(false);
    }} onCancel={() => setShowCreate(false)}/>{!newTitle.trim() ? <p className="text-xs text-amber-700">Add a title before saving.</p> : null}</CardContent></Card> : null}

    <Card className="rounded-2xl bg-white/80 p-4"><CardHeader><CardTitle className="text-base">Estimate next task</CardTitle></CardHeader><CardContent>{queueTask ? <div className="space-y-2"><TaskEffortEditor key={queueTask.id} task={queueTask} compact onSave={(patch, complete) => saveExisting(queueTask, patch, Boolean(complete))}/><div className="flex gap-2"><Button variant="outline" onClick={() => setQueueIndex((index) => (index + 1) % missing.length)}>Skip</Button><span className="self-center text-xs text-slate-500">{missing.length} task(s) still need estimates</span></div></div> : <p className="text-sm text-slate-500">Every active task has an estimate.</p>}</CardContent></Card>

    <PlanningHealth tasks={tasks} assessments={riskAssessments}/>
    <div id="planning-actions"><SchedulingPlanner tasks={tasks} setTasks={setTasks} sessions={sessions} setSessions={setSessions} availability={availability} overrides={overrides} scheduleBlocks={scheduleBlocks} setScheduleBlocks={setScheduleBlocks} dailyCap={planningDailyCap} setDailyCap={setPlanningDailyCap} timeLogs={timeLogs} onStartTimer={onStartTimer}/></div>
    <Card className="rounded-2xl bg-white/80 p-4"><CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between"><CardTitle className="text-base">Tasks</CardTitle><Button variant="outline" onClick={() => setOnlyMissing((value) => !value)}>{onlyMissing ? "Show all tasks" : "Show tasks with no estimate"}</Button></CardHeader><CardContent className="space-y-2">{displayed.length === 0 ? <p className="text-sm text-slate-500">No tasks match this filter.</p> : displayed.map((task) => {
      const linked = sessionsForParent(sessions, task.id);
      const assessment = riskByTask.get(task.id);
      return <div key={task.id} className="rounded-xl border bg-white/70 p-3">{editingId === task.id ? <TaskEffortEditor task={task} onSave={(patch, complete) => saveExisting(task, patch, Boolean(complete))} onCancel={() => setEditingId(null)}/> : <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-medium text-slate-700">{task.title}</div>{assessment ? <div className="text-xs font-medium text-slate-600" aria-label={`Planning status: ${riskLabel(assessment)}`}>Planning status: {riskLabel(assessment)}</div> : null}<div className="text-xs text-slate-500">Estimate: {formatEffortMinutes(task.estimatedMinutes)} · {estimateState(task)}</div><div className="text-xs text-slate-500">Total actual: {formatEffortMinutes(taskActualMinutes(task, timeLogs))}{task.actualMinutes ? ` (${formatEffortMinutes(task.actualMinutes)} legacy)` : ""}</div>{task.estimatedMinutes !== undefined ? <div className="text-xs text-slate-500">Remaining estimate: {formatEffortMinutes(Math.max(task.estimatedMinutes - taskActualMinutes(task, timeLogs), 0))}</div> : null}<div className="text-xs text-slate-500">Breakdown: {breakdownState(task, linked)}</div>{needsEstimateForScheduling(task) ? <div className="text-xs text-amber-700">Add an estimate to schedule this task later.</div> : null}</div><div className="flex gap-2"><Button variant="outline" onClick={() => onStartTimer({ taskId: task.id })}>Start timer</Button><Button variant="outline" onClick={() => setEditingId(task.id)}>Edit effort</Button><Button variant="outline" onClick={() => setSessionParentId(sessionParentId === task.id ? null : task.id)}>{linked.length ? "Work sessions" : "Break into sessions"}</Button></div></div>}{sessionParentId === task.id ? <div className="mt-3"><TaskSessionManager parent={task} sessions={sessions} setSessions={setSessions} setTasks={setTasks} onStartTimer={onStartTimer} timeLogs={timeLogs} onClose={() => setSessionParentId(null)}/></div> : null}</div>;
    })}</CardContent></Card>
  </div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <Card className="rounded-2xl bg-white/80"><CardContent className="p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-lg font-semibold text-slate-700">{value}</div></CardContent></Card>;
}
