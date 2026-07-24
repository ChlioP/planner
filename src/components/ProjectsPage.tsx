import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  assignTask,
  createDependency,
  createGoal,
  createMilestone,
  createProject,
  dateAlignmentWarnings,
  dependencyExplanation,
  goalSummary,
  projectHealth,
  projectProgress,
  reorderMilestone,
  type Goal,
  type Milestone,
  type Project,
  type TaskDependency,
} from "@/lib/projectPlanning";
import type { TaskRecord } from "@/lib/taskHistory";
import type { TaskSession } from "@/lib/taskSessions";
import type { AvailabilityBlock, AvailabilityOverride } from "@/lib/availability";
import type { ScheduleBlock } from "@/lib/scheduleBlocks";
import type { TimeLog } from "@/lib/timeLogs";
import { localDateFromDate } from "@/lib/localDateTime";

export function ProjectsPage({
  goals, setGoals, projects, setProjects, milestones, setMilestones, dependencies, setDependencies,
  tasks, setTasks, sessions, availability, overrides, scheduleBlocks, timeLogs,
}: {
  goals: Goal[]; setGoals: React.Dispatch<React.SetStateAction<Goal[]>>;
  projects: Project[]; setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  milestones: Milestone[]; setMilestones: React.Dispatch<React.SetStateAction<Milestone[]>>;
  dependencies: TaskDependency[]; setDependencies: React.Dispatch<React.SetStateAction<TaskDependency[]>>;
  tasks: TaskRecord[]; setTasks: React.Dispatch<React.SetStateAction<TaskRecord[]>>; sessions: TaskSession[];
  availability: AvailabilityBlock[]; overrides: AvailabilityOverride[]; scheduleBlocks: ScheduleBlock[]; timeLogs: TimeLog[];
}) {
  const [tab, setTab] = useState<"projects" | "goals">("projects");
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [projectDraft, setProjectDraft] = useState({ title: "", description: "", goalId: "", startDate: "", targetDate: "", priority: "medium", progressMode: "task-completion" });
  const [goalDraft, setGoalDraft] = useState({ title: "", description: "", targetDate: "", progressMode: "project-completion" });
  const [milestoneDraft, setMilestoneDraft] = useState({ title: "", targetDate: "", progressMode: "task-completion" });
  const [dependencyDraft, setDependencyDraft] = useState({ predecessor: "", successor: "" });
  const [error, setError] = useState("");
  const today = localDateFromDate(new Date());
  const riskContext = useMemo(() => ({ availability, overrides, scheduleBlocks, timeLogs, today, currentTime: `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`, dailyCapMinutes: 180, calculatedAt: new Date().toISOString() }), [availability, overrides, scheduleBlocks, timeLogs, today]);
  const health = useMemo(() => projects.map((project) => projectHealth(project, milestones, tasks, sessions, riskContext)), [milestones, projects, riskContext, sessions, tasks]);
  const createProjectFromDraft = () => {
    setError("");
    try {
      const duplicate = projects.some((item) => item.title.trim().toLowerCase() === projectDraft.title.trim().toLowerCase() && item.goalId === (projectDraft.goalId || undefined) && item.startDate === (projectDraft.startDate || undefined) && item.targetDate === (projectDraft.targetDate || undefined));
      if (duplicate) throw new Error("An identical project already exists.");
      const project = createProject({ title: projectDraft.title, description: projectDraft.description || undefined, goalId: projectDraft.goalId || undefined, status: "active", startDate: projectDraft.startDate || undefined, targetDate: projectDraft.targetDate || undefined, priority: projectDraft.priority as Project["priority"], progressMode: projectDraft.progressMode as Project["progressMode"] });
      setProjects((current) => [...current, project]); setSelectedProjectId(project.id); setProjectDraft({ title: "", description: "", goalId: "", startDate: "", targetDate: "", priority: "medium", progressMode: "task-completion" });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Project could not be created."); }
  };
  const createGoalFromDraft = () => {
    setError("");
    try {
      if (goals.some((item) => item.title.trim().toLowerCase() === goalDraft.title.trim().toLowerCase() && item.targetDate === (goalDraft.targetDate || undefined))) throw new Error("An identical goal already exists.");
      setGoals((current) => [...current, createGoal({ title: goalDraft.title, description: goalDraft.description || undefined, status: "active", targetDate: goalDraft.targetDate || undefined, timeframe: goalDraft.targetDate ? "target-date" : "no-deadline", progressMode: goalDraft.progressMode as Goal["progressMode"] })]);
      setGoalDraft({ title: "", description: "", targetDate: "", progressMode: "project-completion" });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Goal could not be created."); }
  };

  return <div className="space-y-5 p-4">
    <div className="flex flex-wrap gap-2"><Button variant={tab === "projects" ? "default" : "outline"} onClick={() => setTab("projects")}>Projects</Button><Button variant={tab === "goals" ? "default" : "outline"} onClick={() => setTab("goals")}>Goals</Button></div>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {tab === "goals" ? <div className="grid gap-5 lg:grid-cols-[1fr_1.6fr]">
      <Card className="border-pink-100 bg-white/90 p-4"><CardHeader><CardTitle>Create goal</CardTitle></CardHeader><CardContent className="space-y-3">
        <label className="block text-sm">Title<Input value={goalDraft.title} onChange={(event) => setGoalDraft((value) => ({ ...value, title: event.target.value }))} /></label>
        <label className="block text-sm">Description<Input value={goalDraft.description} onChange={(event) => setGoalDraft((value) => ({ ...value, description: event.target.value }))} /></label>
        <label className="block text-sm">Target date<Input type="date" value={goalDraft.targetDate} onChange={(event) => setGoalDraft((value) => ({ ...value, targetDate: event.target.value }))} /></label>
        <label className="block text-sm">Progress source<select className="mt-1 w-full rounded-md border p-2" value={goalDraft.progressMode} onChange={(event) => setGoalDraft((value) => ({ ...value, progressMode: event.target.value }))}><option value="project-completion">Completed projects</option><option value="milestone-completion">Completed milestones</option><option value="manual">Manual</option></select></label>
        <Button onClick={createGoalFromDraft}>Create goal</Button>
      </CardContent></Card>
      <div className="space-y-3">{goals.filter((goal) => goal.status !== "archived").length === 0 ? <Card><CardContent className="p-8 text-center text-sm text-slate-500">No goals yet. Goals can group related projects but are optional.</CardContent></Card> : goals.filter((goal) => goal.status !== "archived").map((goal) => {
        const summary = goalSummary(goal, projects, milestones, health, tasks);
        return <Card key={goal.id} className="border-pink-100 bg-white/90 p-4"><CardContent><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{goal.title}</h3><p className="text-sm text-slate-500">{goal.description}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs capitalize">{goal.status}</span></div>
          <div className="mt-3 text-sm">{summary.progress.label}: {Math.round(summary.progress.percent)}%</div><div role="progressbar" aria-label={`${goal.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(summary.progress.percent)} className="mt-1 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-pink-300" style={{ width: `${summary.progress.percent}%` }} /></div>
          <p className="mt-2 text-xs text-slate-500">{summary.activeProjects} active · {summary.completedProjects} completed · {summary.atRiskProjects} need review{goal.targetDate ? ` · Target ${goal.targetDate}` : ""}</p>
        </CardContent></Card>;
      })}</div>
    </div> : <div className="grid gap-5 lg:grid-cols-[1fr_1.7fr]">
      <div className="space-y-5"><Card className="border-pink-100 bg-white/90 p-4"><CardHeader><CardTitle>Create project</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-xs text-slate-500">Category describes the type of work. A project describes the larger outcome; tasks may use both.</p>
        <label className="block text-sm">Title<Input value={projectDraft.title} onChange={(event) => setProjectDraft((value) => ({ ...value, title: event.target.value }))} /></label>
        <label className="block text-sm">Description<Input value={projectDraft.description} onChange={(event) => setProjectDraft((value) => ({ ...value, description: event.target.value }))} /></label>
        <label className="block text-sm">Goal<select className="mt-1 w-full rounded-md border p-2" value={projectDraft.goalId} onChange={(event) => setProjectDraft((value) => ({ ...value, goalId: event.target.value }))}><option value="">No goal</option>{goals.filter((item) => item.status !== "archived").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2"><label className="text-sm">Start<Input type="date" value={projectDraft.startDate} onChange={(event) => setProjectDraft((value) => ({ ...value, startDate: event.target.value }))} /></label><label className="text-sm">Target<Input type="date" value={projectDraft.targetDate} onChange={(event) => setProjectDraft((value) => ({ ...value, targetDate: event.target.value }))} /></label></div>
        <label className="block text-sm">Priority<select className="mt-1 w-full rounded-md border p-2" value={projectDraft.priority} onChange={(event) => setProjectDraft((value) => ({ ...value, priority: event.target.value }))}>{["low", "medium", "high", "critical"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="block text-sm">Progress source<select className="mt-1 w-full rounded-md border p-2" value={projectDraft.progressMode} onChange={(event) => setProjectDraft((value) => ({ ...value, progressMode: event.target.value }))}><option value="task-completion">Task completion</option><option value="effort-weighted">Estimated effort</option><option value="milestone-completion">Milestones</option><option value="manual">Manual</option></select></label>
        <Button onClick={createProjectFromDraft}>Create project</Button>
      </CardContent></Card>
      <Card className="border-pink-100 bg-white/90 p-4"><CardHeader><CardTitle>Project portfolio</CardTitle></CardHeader><CardContent className="text-sm text-slate-600">{projects.filter((item) => item.status === "active").length} active · {health.filter((item) => ["needs-attention", "at-risk", "overdue"].includes(item.status)).length} need review · {tasks.filter((item) => !item.projectId && item.status !== "archived").length} unassigned tasks</CardContent></Card></div>
      <div className="space-y-3">{projects.filter((item) => item.status !== "archived").length === 0 ? <Card><CardContent className="p-8 text-center text-sm text-slate-500">No projects yet. Existing tasks remain available without a project.</CardContent></Card> : projects.filter((item) => item.status !== "archived").map((project) => {
        const progress = projectProgress(project, milestones, tasks, sessions), assessment = health.find((item) => item.projectId === project.id)!;
        return <Card key={project.id} className="border-pink-100 bg-white/90 p-4"><CardContent><button className="w-full text-left" onClick={() => setSelectedProjectId(selectedProjectId === project.id ? undefined : project.id)} aria-expanded={selectedProjectId === project.id}><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{project.title}</h3><p className="text-sm text-slate-500">{project.description}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{assessment.status}</span></div><div className="mt-3 text-sm">{progress.label}: {Math.round(progress.percent)}%</div><div role="progressbar" aria-label={`${project.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.percent)} className="mt-1 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-amber-300" style={{ width: `${progress.percent}%` }} /></div><p className="mt-2 text-xs text-slate-500">{assessment.remainingTaskCount} incomplete tasks{project.targetDate ? ` · Target ${project.targetDate}` : ""} · {assessment.reasons[0]}</p></button>
          {selectedProjectId === project.id ? <ProjectDetails project={project} goal={goals.find((item) => item.id === project.goalId)} milestones={milestones} setMilestones={setMilestones} dependencies={dependencies} setDependencies={setDependencies} tasks={tasks} setTasks={setTasks} milestoneDraft={milestoneDraft} setMilestoneDraft={setMilestoneDraft} dependencyDraft={dependencyDraft} setDependencyDraft={setDependencyDraft} setError={setError} scheduleBlocks={scheduleBlocks} timeLogs={timeLogs} setProjects={setProjects} /> : null}
        </CardContent></Card>;
      })}</div>
    </div>}
  </div>;
}

function ProjectDetails({ project, goal, milestones, setMilestones, dependencies, setDependencies, tasks, setTasks, milestoneDraft, setMilestoneDraft, dependencyDraft, setDependencyDraft, setError, scheduleBlocks, timeLogs, setProjects }: {
  project: Project; goal?: Goal; milestones: Milestone[]; setMilestones: React.Dispatch<React.SetStateAction<Milestone[]>>;
  dependencies: TaskDependency[]; setDependencies: React.Dispatch<React.SetStateAction<TaskDependency[]>>;
  tasks: TaskRecord[]; setTasks: React.Dispatch<React.SetStateAction<TaskRecord[]>>;
  milestoneDraft: { title: string; targetDate: string; progressMode: string }; setMilestoneDraft: React.Dispatch<React.SetStateAction<{ title: string; targetDate: string; progressMode: string }>>;
  dependencyDraft: { predecessor: string; successor: string }; setDependencyDraft: React.Dispatch<React.SetStateAction<{ predecessor: string; successor: string }>>;
  setError: (value: string) => void; scheduleBlocks: ScheduleBlock[]; timeLogs: TimeLog[]; setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
}) {
  const projectMilestones = milestones.filter((item) => item.projectId === project.id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const projectTasks = tasks.filter((item) => item.projectId === project.id);
  const warnings = dateAlignmentWarnings(project, goal, milestones, tasks);
  const archiveProject = () => {
    const activeTimer = timeLogs.some((log) => projectTasks.some((task) => task.id === log.taskId) && (log.status === "running" || log.status === "paused"));
    const futureBlocks = scheduleBlocks.filter((block) => projectTasks.some((task) => task.id === block.taskId) && block.status === "confirmed").length;
    if (!window.confirm(`Archive project only? ${activeTimer ? "A project task has an active timer. " : ""}${futureBlocks} confirmed schedule block(s) will remain.`)) return;
    setProjects((current) => current.map((item) => item.id === project.id ? { ...item, status: "archived", archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item));
  };
  return <div className="mt-5 space-y-5 border-t pt-5">
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => {
      const incomplete = projectTasks.filter((task) => task.status !== "completed").length, future = scheduleBlocks.filter((block) => projectTasks.some((task) => task.id === block.taskId) && block.status === "confirmed").length;
      if (window.confirm(`Complete project only? ${incomplete} tasks remain incomplete and ${future} confirmed schedule blocks will remain unchanged.`)) setProjects((current) => current.map((item) => item.id === project.id ? { ...item, status: "completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item));
    }}>Complete project</Button><Button variant="outline" onClick={archiveProject}>Archive project only</Button></div>
    {warnings.length ? <div className="rounded-xl bg-amber-50 p-3"><h4 className="text-sm font-semibold">Date review</h4>{warnings.map((warning) => <p key={warning.id} className="mt-1 text-xs text-amber-800">{warning.message}</p>)}</div> : null}
    <section><h4 className="mb-2 font-semibold">Milestones</h4><div className="grid gap-2 sm:grid-cols-3"><Input placeholder="Milestone title" value={milestoneDraft.title} onChange={(event) => setMilestoneDraft((value) => ({ ...value, title: event.target.value }))} /><Input type="date" value={milestoneDraft.targetDate} onChange={(event) => setMilestoneDraft((value) => ({ ...value, targetDate: event.target.value }))} /><Button onClick={() => { try { setMilestones((current) => [...current, createMilestone({ projectId: project.id, title: milestoneDraft.title, targetDate: milestoneDraft.targetDate || undefined, order: projectMilestones.length, progressMode: milestoneDraft.progressMode as Milestone["progressMode"] })]); setMilestoneDraft({ title: "", targetDate: "", progressMode: "task-completion" }); } catch (error) { setError(error instanceof Error ? error.message : "Milestone could not be created."); } }}>Add milestone</Button></div>
      {projectMilestones.length === 0 ? <p className="mt-2 text-sm text-slate-500">No milestones yet.</p> : projectMilestones.map((item, index) => <div key={item.id} className="mt-2 flex items-center justify-between rounded-lg bg-slate-50 p-2 text-sm"><span>{item.title}{item.targetDate ? ` · ${item.targetDate}` : ""} · {item.status}</span><div className="flex gap-1"><Button variant="outline" aria-label={`Move ${item.title} up`} disabled={index === 0} onClick={() => setMilestones((current) => reorderMilestone(current, item.id, -1))}><ChevronUp className="h-4 w-4" /></Button><Button variant="outline" aria-label={`Move ${item.title} down`} disabled={index === projectMilestones.length - 1} onClick={() => setMilestones((current) => reorderMilestone(current, item.id, 1))}><ChevronDown className="h-4 w-4" /></Button><Button variant="outline" onClick={() => { const incomplete = projectTasks.filter((task) => task.milestoneId === item.id && task.status !== "completed").length; if (!incomplete || window.confirm(`${incomplete} linked tasks are incomplete. Complete the milestone only?`)) setMilestones((current) => current.map((value) => value.id === item.id ? { ...value, status: "completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : value)); }}>Complete</Button></div></div>)}
    </section>
    <section><h4 className="mb-2 font-semibold">Tasks</h4><p className="mb-2 text-xs text-slate-500">Project assignment is separate from category. Dates, estimates, sessions, schedules, reminders, and logs remain unchanged.</p>
      {tasks.filter((item) => item.status !== "archived").map((task) => <div key={task.id} className="mb-2 grid items-center gap-2 rounded-lg border p-2 text-sm sm:grid-cols-[1fr_12rem_12rem]"><div><strong>{task.title}</strong><div className="text-xs text-slate-500">Category: {task.category}</div></div><select className="rounded-md border p-2" value={task.projectId ?? ""} onChange={(event) => { try { setTasks((current) => current.map((value) => value.id === task.id ? assignTask(value, event.target.value || undefined, undefined, milestones) : value)); } catch (error) { setError(error instanceof Error ? error.message : "Task could not be assigned."); } }}><option value="">No project</option><option value={project.id}>{project.title}</option></select><select disabled={task.projectId !== project.id} className="rounded-md border p-2" value={task.milestoneId ?? ""} onChange={(event) => { try { setTasks((current) => current.map((value) => value.id === task.id ? assignTask(value, project.id, event.target.value || undefined, milestones) : value)); } catch (error) { setError(error instanceof Error ? error.message : "Task could not be assigned."); } }}><option value="">No milestone</option>{projectMilestones.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>)}
    </section>
    <section><h4 className="mb-2 font-semibold">Dependencies</h4><p className="mb-2 text-xs text-slate-500">Dependencies are warnings by default and never reschedule work automatically.</p><div className="grid gap-2 sm:grid-cols-3"><select className="rounded-md border p-2" value={dependencyDraft.predecessor} onChange={(event) => setDependencyDraft((value) => ({ ...value, predecessor: event.target.value }))}><option value="">Predecessor</option>{projectTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select><select className="rounded-md border p-2" value={dependencyDraft.successor} onChange={(event) => setDependencyDraft((value) => ({ ...value, successor: event.target.value }))}><option value="">Successor</option>{projectTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select><Button onClick={() => { try { setDependencies((current) => [...current, createDependency({ id: crypto.randomUUID(), projectId: project.id, predecessorTaskId: dependencyDraft.predecessor, successorTaskId: dependencyDraft.successor, type: "finish-to-start" }, tasks, current)]); setDependencyDraft({ predecessor: "", successor: "" }); } catch (error) { setError(error instanceof Error ? error.message : "Dependency could not be created."); } }}>Add dependency</Button></div>
      {dependencies.filter((item) => item.projectId === project.id).map((item) => <div key={item.id} className="mt-2 flex justify-between rounded-lg bg-slate-50 p-2 text-sm"><span>{tasks.find((task) => task.id === item.successorTaskId)?.title}: {dependencyExplanation(item.successorTaskId, tasks, dependencies)}</span><Button variant="outline" onClick={() => setDependencies((current) => current.filter((value) => value.id !== item.id))}>Remove</Button></div>)}
    </section>
    <section><h4 className="mb-2 font-semibold">Timeline</h4><ul className="space-y-1 text-sm">{project.startDate ? <li>Project starts · {project.startDate}</li> : null}{projectMilestones.filter((item) => item.targetDate).map((item) => <li key={item.id}>Milestone · {item.targetDate} · {item.title}</li>)}{projectTasks.filter((item) => item.dueDate).slice(0, 100).map((task) => <li key={task.id}>Task due · {task.dueDate} · {task.title}</li>)}{project.targetDate ? <li>Project target · {project.targetDate}</li> : null}</ul></section>
  </div>;
}
