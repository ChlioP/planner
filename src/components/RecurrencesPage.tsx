import { useMemo, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import {
  consistencySummary,
  createRecurrenceDefinition,
  createRecurrenceException,
  createRoutineTemplate,
  detachOccurrenceTask,
  generateOccurrences,
  humanRecurrenceSummary,
  materializeOccurrences,
  markOccurrenceModified,
  restoreOccurrence,
  seriesHealthSummary,
  splitRecurrenceSeries,
  skipOccurrence,
  type RecurrenceDefinition,
  type RecurrenceOccurrence,
  type RecurrenceException,
  type RoutineTemplate,
  type Weekday,
} from "@/lib/recurrence";
import type { TaskRecord } from "@/lib/taskHistory";
import type { TaskSession } from "@/lib/taskSessions";
import type { ScheduleBlock } from "@/lib/scheduleBlocks";
import type { TimeLog } from "@/lib/timeLogs";
import type { Reminder } from "@/lib/notifications";
import type { Project, Milestone } from "@/lib/projectPlanning";
import { addLocalDays, formatLocalDate, startOfLocalWeek } from "@/lib/localDateTime";

interface Props {
  definitions: RecurrenceDefinition[];
  setDefinitions: Dispatch<SetStateAction<RecurrenceDefinition[]>>;
  occurrences: RecurrenceOccurrence[];
  setOccurrences: Dispatch<SetStateAction<RecurrenceOccurrence[]>>;
  exceptions: RecurrenceException[];
  setExceptions: Dispatch<SetStateAction<RecurrenceException[]>>;
  templates: RoutineTemplate[];
  setTemplates: Dispatch<SetStateAction<RoutineTemplate[]>>;
  tasks: TaskRecord[];
  setTasks: Dispatch<SetStateAction<TaskRecord[]>>;
  sessions: TaskSession[];
  setSessions: Dispatch<SetStateAction<TaskSession[]>>;
  scheduleBlocks: ScheduleBlock[];
  setScheduleBlocks: Dispatch<SetStateAction<ScheduleBlock[]>>;
  timeLogs: TimeLog[];
  reminders: Reminder[];
  setReminders: Dispatch<SetStateAction<Reminder[]>>;
  projects: Project[];
  milestones: Milestone[];
  today: string;
}
const ALL_WEEKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const SoftCard = ({ children }: { children: ReactNode }) => <div className="rounded-3xl bg-white/80 p-5 shadow-sm ring-1 ring-pink-100">{children}</div>;

export function RecurrencesPage({ definitions, setDefinitions, occurrences, setOccurrences, setExceptions, templates, setTemplates, tasks, setTasks, sessions, setSessions, scheduleBlocks, setScheduleBlocks, timeLogs, reminders, setReminders, projects, milestones, today }: Props) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endType, setEndType] = useState<"never" | "until-date" | "after-occurrences">("never");
  const [endValue, setEndValue] = useState("");
  const [type, setType] = useState<"task" | "routine">("task");
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "times-per-week" | "monthly-date" | "monthly-weekday">("weekly");
  const [interval, setInterval] = useState("1");
  const [weekdays, setWeekdays] = useState<Weekday[]>(["MO"]);
  const [monthDay, setMonthDay] = useState("1");
  const [invalidDateBehavior, setInvalidDateBehavior] = useState<"skip" | "last-day">("last-day");
  const [monthlyOrdinal, setMonthlyOrdinal] = useState<1 | 2 | 3 | 4 | -1>(1);
  const [estimate, setEstimate] = useState("30");
  const [dueTime, setDueTime] = useState("");
  const [projectId, setProjectId] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [templateName, setTemplateName] = useState("");
  const schedule = useMemo(() => {
    const every = Number(interval);
    if (frequency === "daily") return { frequency: "daily" as const, interval: every };
    if (frequency === "weekly") return { frequency: "weekly" as const, interval: every, weekdays };
    if (frequency === "times-per-week") return { frequency: "times-per-week" as const, targetCount: Math.min(weekdays.length, 3), eligibleWeekdays: weekdays };
    if (frequency === "monthly-date") return { frequency: "monthly" as const, interval: every, monthlyRule: { type: "day-of-month" as const, day: Number(monthDay), invalidDateBehavior } };
    return { frequency: "monthly" as const, interval: every, monthlyRule: { type: "weekday-position" as const, weekday: weekdays[0] ?? "MO", position: monthlyOrdinal } };
  }, [frequency, interval, invalidDateBehavior, monthDay, monthlyOrdinal, weekdays]);
  const nextDates = useMemo(() => {
    if (!title.trim()) return [];
    try {
      const draft = createRecurrenceDefinition({
        id: "preview", title, type, startDate,
        endCondition: endType === "until-date" ? { type: "until-date", endDate: endValue } : endType === "after-occurrences" ? { type: "after-occurrences", occurrenceCount: Number(endValue) } : { type: "never" },
        schedule,
        taskTemplate: { title, priority: "medium", projectId: projectId || undefined, milestoneId: milestoneId || undefined, estimatedMinutes: Number(estimate) || undefined, dueRule: type === "routine" ? { type: "no-deadline" } : { type: "same-day", dueTime: dueTime || undefined } },
      });
      return generateOccurrences(draft, startDate, addLocalDays(startDate, 90), [], new Date().toISOString()).eligibleDates.slice(0, 5);
    } catch { return []; }
  }, [dueTime, endType, endValue, estimate, milestoneId, projectId, schedule, startDate, title, type]);

  const create = (event: FormEvent) => {
    event.preventDefault(); setError(""); setMessage("");
    try {
      const definition = createRecurrenceDefinition({
        title, type, startDate,
        endCondition: endType === "until-date" ? { type: "until-date", endDate: endValue } : endType === "after-occurrences" ? { type: "after-occurrences", occurrenceCount: Number(endValue) } : { type: "never" },
        schedule,
        taskTemplate: { title, priority: "medium", projectId: projectId || undefined, milestoneId: milestoneId || undefined, estimatedMinutes: Number(estimate) || undefined, dueRule: type === "routine" ? { type: "no-deadline" } : { type: "same-day", dueTime: dueTime || undefined } },
        routineSettings: type === "routine" ? { completionMode: "check-off", schedulingMode: "manual", carryForwardBehavior: "do-not-carry", allowSkip: true, countSkippedAsEligible: true } : undefined,
      });
      const generated = generateOccurrences(definition, today, addLocalDays(today, definition.generationSettings.generateAheadDays), [], new Date().toISOString());
      const materialized = materializeOccurrences(definition, generated.occurrences, tasks, new Date().toISOString(), sessions);
      setDefinitions((items) => [...items, definition]); setOccurrences((items) => [...items, ...materialized.occurrences]); setTasks(materialized.tasks); setSessions(materialized.sessions);
      setTitle(""); setMessage(`Created ${materialized.occurrences.length} bounded occurrence${materialized.occurrences.length === 1 ? "" : "s"}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create recurrence."); }
  };
  const toggleWeekday = (day: Weekday) => setWeekdays((items) => items.includes(day) ? items.filter((item) => item !== day) : [...items, day]);
  const changeStatus = (definition: RecurrenceDefinition, status: RecurrenceDefinition["status"]) => {
    const now = new Date().toISOString();
    setDefinitions((items) => items.map((item) => item.id === definition.id ? { ...item, status, updatedAt: now, pausedAt: status === "paused" ? now : item.pausedAt, completedAt: status === "completed" ? now : undefined, archivedAt: status === "archived" ? now : undefined } : item));
  };
  const skip = (occurrence: RecurrenceOccurrence) => {
    const logs = occurrence.taskId ? timeLogs.filter((item) => item.taskId === occurrence.taskId && item.status !== "discarded") : [];
    const confirmed = occurrence.taskId ? scheduleBlocks.filter((item) => item.taskId === occurrence.taskId && item.status === "confirmed") : [];
    const activeReminders = occurrence.taskId ? reminders.filter((item) => item.taskId === occurrence.taskId && item.isEnabled) : [];
    if (!window.confirm(`Skip the ${occurrence.occurrenceDate} occurrence? It will remain in history.${logs.length ? ` ${logs.length} time log(s) will be preserved.` : ""}${confirmed.length ? ` ${confirmed.length} confirmed schedule block(s) will be cancelled.` : ""}${activeReminders.length ? ` ${activeReminders.length} reminder(s) will be disabled.` : ""}`)) return;
    const now = new Date().toISOString();
    setOccurrences((items) => items.map((item) => item.id === occurrence.id ? skipOccurrence(item, now) : item));
    setTasks((items) => items.map((task) => task.id === occurrence.taskId ? { ...task, status: "archived", statusBeforeArchive: task.status === "archived" ? "planned" : task.status, archivedAt: now, recurrence: task.recurrence ? { ...task.recurrence, status: "skipped" } : task.recurrence, updatedAt: now } : task));
    setScheduleBlocks((items) => items.map((item) => item.taskId === occurrence.taskId && (item.status === "proposed" || item.status === "confirmed") ? { ...item, status: "cancelled", updatedAt: now } : item));
    setReminders((items) => items.map((item) => item.taskId === occurrence.taskId && item.isEnabled ? { ...item, isEnabled: false, disabledReason: "The recurring occurrence was skipped.", updatedAt: now } : item));
  };
  const restore = (occurrence: RecurrenceOccurrence) => {
    const now = new Date().toISOString();
    setOccurrences((items) => items.map((item) => item.id === occurrence.id ? restoreOccurrence(item, now) : item));
    setTasks((items) => items.map((task) => task.id === occurrence.taskId ? { ...task, status: task.statusBeforeArchive ?? "planned", statusBeforeArchive: undefined, archivedAt: null, recurrence: task.recurrence ? { ...task.recurrence, status: "generated" } : task.recurrence, updatedAt: now } : task));
  };
  const detach = (occurrence: RecurrenceOccurrence) => {
    if (!occurrence.taskId || !window.confirm(`Detach the ${occurrence.occurrenceDate} occurrence and keep it as a one-time task?`)) return;
    const now = new Date().toISOString();
    setTasks((items) => items.map((task) => task.id === occurrence.taskId ? detachOccurrenceTask(task, now) : task));
    setExceptions((items) => [...items, createRecurrenceException({ seriesId: occurrence.recurrenceDefinitionId, occurrenceKey: occurrence.occurrenceKey, occurrenceDate: occurrence.occurrenceDate, type: "detached", replacementTaskId: occurrence.taskId }, items, now)]);
    setOccurrences((items) => items.map((item) => item.id === occurrence.id ? { ...item, status: "superseded", updatedAt: now } : item));
  };
  const removeOccurrence = (occurrence: RecurrenceOccurrence) => {
    const logs = occurrence.taskId ? timeLogs.filter((item) => item.taskId === occurrence.taskId && item.status !== "discarded") : [];
    const blocks = occurrence.taskId ? scheduleBlocks.filter((item) => item.taskId === occurrence.taskId) : [];
    if ((logs.length || blocks.length) && !window.confirm(`This occurrence has ${logs.length} time log(s) and ${blocks.length} schedule record(s). Deleting it removes the task but preserves the recurrence tombstone. Continue?`)) return;
    if (!logs.length && !blocks.length && !window.confirm(`Delete only the ${occurrence.occurrenceDate} occurrence? It will not be generated again.`)) return;
    const now = new Date().toISOString();
    setExceptions((items) => [...items, createRecurrenceException({ seriesId: occurrence.recurrenceDefinitionId, occurrenceKey: occurrence.occurrenceKey, occurrenceDate: occurrence.occurrenceDate, type: "deleted" }, items, now)]);
    setOccurrences((items) => items.map((item) => item.id === occurrence.id ? { ...item, status: "cancelled", cancelledAt: now, updatedAt: now } : item));
    if (occurrence.taskId) setTasks((items) => items.filter((task) => task.id !== occurrence.taskId));
    if (occurrence.taskId) setReminders((items) => items.map((item) => item.taskId === occurrence.taskId ? { ...item, isEnabled: false, disabledReason: "The recurring occurrence was deleted.", updatedAt: now } : item));
  };
  const saveTemplate = () => {
    try {
      const template = createRoutineTemplate({ name: templateName, taskDefaults: { title: title.trim() || templateName, estimatedMinutes: Number(estimate) || undefined, priority: "medium" }, recurrenceRule: schedule, sessionBlueprints: [] }, templates);
      setTemplates((items) => [...items, template]); setTemplateName(""); setMessage("Routine template saved. It does not generate tasks by itself.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save template."); }
  };
  const editOccurrence = (occurrence: RecurrenceOccurrence) => {
    if (!occurrence.taskId) return;
    const task = tasks.find((item) => item.id === occurrence.taskId);
    if (!task) return;
    const title = window.prompt("Edit this occurrence only. Future occurrences remain unchanged.", task.title);
    if (!title?.trim() || title.trim() === task.title) return;
    const now = new Date().toISOString();
    setTasks((items) => items.map((item) => item.id === task.id ? markOccurrenceModified({ ...item, title: title.trim() }, now) : item));
  };
  const editSeriesDefaults = (definition: RecurrenceDefinition) => {
    const affected = occurrences.filter((item) => item.recurrenceDefinitionId === definition.id && item.occurrenceDate >= today && item.status === "generated").filter((item) => {
      const task = item.taskId ? tasks.find((candidate) => candidate.id === item.taskId) : undefined;
      return task?.recurrence?.status === "generated";
    });
    const title = window.prompt(`Edit the entire series title. ${affected.length} untouched future occurrence(s) can receive this default after confirmation.`, definition.title);
    if (!title?.trim() || title.trim() === definition.title) return;
    if (!window.confirm(`Update the series and ${affected.length} untouched future occurrence(s)? Completed, skipped, modified, detached, and past occurrences will remain unchanged.`)) return;
    const now = new Date().toISOString(), affectedTaskIds = new Set(affected.map((item) => item.taskId).filter(Boolean));
    setDefinitions((items) => items.map((item) => item.id === definition.id ? { ...item, title: title.trim(), taskTemplate: { ...item.taskTemplate, title: title.trim() }, updatedAt: now } : item));
    setTasks((items) => items.map((task) => affectedTaskIds.has(task.id) ? { ...task, title: title.trim(), updatedAt: now } : task));
  };
  const splitSeries = (definition: RecurrenceDefinition) => {
    const boundary = window.prompt("Start the changed future series on which local date? Use YYYY-MM-DD.", today);
    if (!boundary) return;
    const movable = occurrences.filter((item) => item.recurrenceDefinitionId === definition.id && item.occurrenceDate >= boundary && item.status === "generated").filter((item) => {
      const task = item.taskId ? tasks.find((candidate) => candidate.id === item.taskId) : undefined;
      return task?.recurrence?.status !== "modified" && task?.recurrence?.status !== "detached";
    });
    const previewCount = movable.length;
    if (!window.confirm(`Split this series at ${boundary}? ${previewCount} existing future occurrence(s) will be retained for review; no tasks will be deleted.`)) return;
    try {
      const now = new Date().toISOString(), split = splitRecurrenceSeries(definition, boundary, {}, now);
      setDefinitions((items) => [...items.filter((item) => item.id !== definition.id), split.original, split.future]);
      setExceptions((items) => {
        let next = items;
        for (const occurrence of movable) {
          next = [...next, createRecurrenceException({ seriesId: definition.id, occurrenceKey: occurrence.occurrenceKey, occurrenceDate: occurrence.occurrenceDate, type: "moved-to-series", replacementSeriesId: split.future.id, replacementTaskId: occurrence.taskId }, next, now)];
        }
        return next;
      });
      const moved = movable;
      const movedOccurrenceIds = new Set(moved.map((item) => item.id));
      setOccurrences((items) => items.map((item) => movedOccurrenceIds.has(item.id) ? { ...item, recurrenceDefinitionId: split.future.id, occurrenceKey: item.occurrenceKey.replace(`${definition.id}:`, `${split.future.id}:`), updatedAt: now } : item));
      setTasks((items) => items.map((task) => task.recurrenceOccurrenceId && movedOccurrenceIds.has(task.recurrenceOccurrenceId) ? { ...task, recurrenceDefinitionId: split.future.id, recurrence: task.recurrence ? { ...task.recurrence, seriesId: split.future.id, occurrenceKey: task.recurrence.occurrenceKey.replace(`${definition.id}:`, `${split.future.id}:`) } : task.recurrence, updatedAt: now } : task));
      setMessage("The original series now ends before the boundary. Untouched future tasks moved to the new series without changing their task IDs.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not split the series."); }
  };

  return <div className="space-y-5 p-4">
    <SoftCard>
      <h2 className="text-xl font-semibold text-slate-800">Recurring work and routines</h2>
      <p className="mt-1 text-sm text-slate-600">Definitions describe future work. Generated occurrences are ordinary planner tasks. The planner generates a bounded horizon while the app is open—there is no background generation while it is closed.</p>
      <form onSubmit={create} className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">Title<input value={title} onChange={(event) => setTitle(event.target.value)} required className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2" /></label>
        <label className="text-sm font-medium text-slate-700">Kind<select value={type} onChange={(event) => setType(event.target.value as "task" | "routine")} className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2"><option value="task">Recurring task</option><option value="routine">Flexible routine</option></select></label>
        <label className="text-sm font-medium text-slate-700">Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2" /></label>
        <label className="text-sm font-medium text-slate-700">Ends<select value={endType} onChange={(event) => { setEndType(event.target.value as typeof endType); setEndValue(""); }} className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2"><option value="never">No planned end</option><option value="until-date">On a date</option><option value="after-occurrences">After a count</option></select></label>
        {endType !== "never" ? <label className="text-sm font-medium text-slate-700">{endType === "until-date" ? "End date" : "Occurrence count"}<input type={endType === "until-date" ? "date" : "number"} min={endType === "after-occurrences" ? 1 : undefined} value={endValue} onChange={(event) => setEndValue(event.target.value)} required className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2" /></label> : null}
        <label className="text-sm font-medium text-slate-700">Frequency<select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)} className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2"><option value="daily">Daily</option><option value="weekly">Selected weekdays</option><option value="times-per-week">Times per week</option><option value="monthly-date">Monthly date</option><option value="monthly-weekday">Monthly weekday position</option></select></label>
        <label className="text-sm font-medium text-slate-700">Estimate in minutes<input type="number" min="1" value={estimate} onChange={(event) => setEstimate(event.target.value)} className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2" /></label>
        {type === "task" ? <label className="text-sm font-medium text-slate-700">Default due time<input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2" /></label> : null}
        <label className="text-sm font-medium text-slate-700">Default project<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setMilestoneId(""); }} className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2"><option value="">No project</option>{projects.filter((item) => item.status !== "archived").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Default milestone<select value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)} disabled={!projectId} className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2 disabled:opacity-50"><option value="">No milestone</option>{milestones.filter((item) => item.projectId === projectId && item.status !== "archived").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        {frequency !== "times-per-week" ? <label className="text-sm font-medium text-slate-700">Repeat interval<input type="number" min="1" value={interval} onChange={(event) => setInterval(event.target.value)} className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2" /></label> : null}
        {frequency === "weekly" || frequency === "times-per-week" || frequency === "monthly-weekday" ? <fieldset className="md:col-span-2"><legend className="text-sm font-medium text-slate-700">{frequency === "monthly-weekday" ? "Weekday" : "Eligible weekdays"}</legend><div className="mt-2 flex flex-wrap gap-2">{ALL_WEEKDAYS.map((day) => <button type="button" key={day} aria-pressed={weekdays.includes(day)} onClick={() => frequency === "monthly-weekday" ? setWeekdays([day]) : toggleWeekday(day)} className={`rounded-full px-3 py-1 text-sm ring-1 ${weekdays.includes(day) ? "bg-pink-100 ring-pink-300" : "bg-white ring-slate-200"}`}>{day}</button>)}</div></fieldset> : null}
        {frequency === "monthly-date" ? <><label className="text-sm font-medium text-slate-700">Day of month<input type="number" min="1" max="31" value={monthDay} onChange={(event) => setMonthDay(event.target.value)} className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2" /></label><label className="text-sm font-medium text-slate-700">When the date does not exist<select value={invalidDateBehavior} onChange={(event) => setInvalidDateBehavior(event.target.value as typeof invalidDateBehavior)} className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2"><option value="last-day">Use the last day</option><option value="skip">Skip that month</option></select></label></> : null}
        {frequency === "monthly-weekday" ? <label className="text-sm font-medium text-slate-700">Position<select value={monthlyOrdinal} onChange={(event) => setMonthlyOrdinal(Number(event.target.value) as typeof monthlyOrdinal)} className="mt-1 w-full rounded-xl border border-pink-100 bg-white px-3 py-2"><option value={1}>First</option><option value={2}>Second</option><option value={3}>Third</option><option value={4}>Fourth</option><option value={-1}>Last</option></select></label> : null}
        <div className="md:col-span-2 rounded-xl bg-white/70 p-3 text-sm text-slate-600"><strong>Next dates:</strong> {nextDates.length ? nextDates.join(", ") : "Complete the rule to preview dates."}</div>
        {error ? <p role="alert" className="md:col-span-2 text-sm text-red-700">{error}</p> : null}
        {message ? <p role="status" className="md:col-span-2 text-sm text-emerald-700">{message}</p> : null}
        <Button type="submit" className="md:col-span-2">Create recurring definition</Button>
      </form>
    </SoftCard>
    <section aria-labelledby="recurrence-list" className="space-y-3">
      <h2 id="recurrence-list" className="text-lg font-semibold text-slate-800">Definitions</h2>
      {definitions.length === 0 ? <SoftCard><p className="text-sm text-slate-600">No recurring work yet. Existing tasks remain one-time tasks.</p></SoftCard> : definitions.map((definition) => {
        const linked = occurrences.filter((item) => item.recurrenceDefinitionId === definition.id);
        const summary = consistencySummary(definition, linked, startOfLocalWeek(today), addLocalDays(startOfLocalWeek(today), 6));
        const next = linked.filter((item) => (item.status === "generated" || item.status === "pending") && item.occurrenceDate >= today).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate))[0];
        const health = seriesHealthSummary(definition, linked, tasks, today);
        return <SoftCard key={definition.id}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-800">{definition.title}</h3><p className="text-sm text-slate-600">{humanRecurrenceSummary(definition)}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-semibold ring-1 ring-pink-100">{definition.status}</span></div>
          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3"><span>Next: {next ? formatLocalDate(next.occurrenceDate) : "No future occurrence"}</span><span>{health.activeOccurrenceCount} active · {health.overdueOccurrenceCount} overdue</span><span>{health.scheduledOccurrenceCount} scheduled · {health.unscheduledOccurrenceCount} unscheduled</span></div>
          <p className="mt-2 text-sm text-slate-600">This week: {summary.completed} completed, {summary.skipped} skipped, {summary.open} open. Generation horizon: {definition.generationSettings.generateAheadDays} days.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {definition.status === "active" ? <Button variant="outline" onClick={() => changeStatus(definition, "paused")}>Pause future generation</Button> : definition.status === "paused" ? <Button variant="outline" onClick={() => changeStatus(definition, "active")}>Resume</Button> : null}
            {definition.status !== "completed" ? <Button variant="outline" onClick={() => window.confirm("Complete this series? Existing occurrences will remain unchanged.") && changeStatus(definition, "completed")}>Complete series</Button> : <Button variant="outline" onClick={() => changeStatus(definition, "active")}>Reopen series</Button>}
            <Button variant="outline" onClick={() => changeStatus(definition, "archived")}>Archive definition</Button>
            <Button variant="outline" onClick={() => editSeriesDefaults(definition)}>Edit entire series</Button>
            <Button variant="outline" onClick={() => splitSeries(definition)}>Edit this and future</Button>
          </div>
          <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">Occurrence history</summary><ul className="mt-2 space-y-2">{linked.sort((a, b) => b.occurrenceDate.localeCompare(a.occurrenceDate)).slice(0, 20).map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm"><span>{item.occurrenceDate} — {item.status}</span><span className="flex flex-wrap gap-2">{item.taskId && item.status === "generated" ? <button type="button" className="text-slate-700 underline" onClick={() => editOccurrence(item)}>Edit this occurrence</button> : null}{item.status === "generated" && definition.routineSettings?.allowSkip !== false ? <button type="button" className="text-slate-700 underline" onClick={() => skip(item)}>Skip</button> : null}{item.status === "skipped" ? <button type="button" className="text-slate-700 underline" onClick={() => restore(item)}>Restore</button> : null}{item.taskId && item.status !== "completed" ? <button type="button" className="text-slate-700 underline" onClick={() => detach(item)}>Detach</button> : null}{item.status !== "completed" ? <button type="button" className="text-red-700 underline" onClick={() => removeOccurrence(item)}>Delete occurrence</button> : null}</span></li>)}</ul></details>
        </SoftCard>;
      })}
    </section>
    <SoftCard>
      <h2 className="text-lg font-semibold text-slate-800">Reusable routine templates</h2>
      <p className="mt-1 text-sm text-slate-600">Routine templates are separate from availability templates and never generate tasks until applied.</p>
      <div className="mt-3 flex flex-wrap gap-2"><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Template name" aria-label="Routine template name" className="min-w-56 flex-1 rounded-xl border border-pink-100 bg-white px-3 py-2" /><Button type="button" onClick={saveTemplate}>Save current form as template</Button></div>
      <ul className="mt-3 space-y-2">{templates.map((template) => <li key={template.id} className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2 text-sm"><span><strong>{template.name}</strong> — {template.taskDefaults.title}</span><button type="button" className="text-red-700 underline" onClick={() => window.confirm(`Delete template “${template.name}”?`) && setTemplates((items) => items.filter((item) => item.id !== template.id))}>Delete</button></li>)}</ul>
    </SoftCard>
  </div>;
}
