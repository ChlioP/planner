import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLocalDate, minutesToDuration } from "@/lib/localDateTime";
import {
  filterRiskAssessments,
  sortRiskAssessments,
  summarizeRisks,
  riskLabel,
  type RiskFilter,
  type RiskSort,
  type TaskRiskAssessment,
} from "@/lib/riskAssessment";
import type { TaskRecord } from "@/lib/taskHistory";

const FILTERS: Array<{ value: RiskFilter; label: string }> = [
  { value: "all", label: "All active tasks" }, { value: "at-risk", label: "At risk" },
  { value: "tight", label: "Tight" }, { value: "overdue", label: "Overdue" },
  { value: "on-track", label: "On track" }, { value: "missing-estimate", label: "Missing estimate" },
  { value: "missing-deadline", label: "Missing deadline" }, { value: "schedule-conflict", label: "Schedule conflicts" },
];
const SORTS: Array<{ value: RiskSort; label: string }> = [
  { value: "highest-risk", label: "Highest risk first" }, { value: "earliest-deadline", label: "Earliest deadline" },
  { value: "most-unscheduled", label: "Most unscheduled work" }, { value: "least-buffer", label: "Least buffer" },
  { value: "highest-priority", label: "Highest task priority" }, { value: "recently-updated", label: "Recently updated" },
];

export function PlanningHealth({ tasks, assessments }: { tasks: TaskRecord[]; assessments: TaskRiskAssessment[] }) {
  const [filter, setFilter] = useState<RiskFilter>("all");
  const [sort, setSort] = useState<RiskSort>("highest-risk");
  const [expanded, setExpanded] = useState<string | null>(null);
  const summary = useMemo(() => summarizeRisks(assessments.filter((item) => item.status !== "completed")), [assessments]);
  const displayed = useMemo(() => sortRiskAssessments(filterRiskAssessments(assessments.filter((item) => item.status !== "completed"), filter), tasks, sort), [assessments, filter, sort, tasks]);
  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const summaries: Array<{ label: string; count: number; filter: RiskFilter }> = [
    { label: "On track", count: summary.onTrack, filter: "on-track" },
    { label: "Tight", count: summary.tight, filter: "tight" },
    { label: "At risk", count: summary.atRisk, filter: "at-risk" },
    { label: "Overdue", count: summary.overdue, filter: "overdue" },
    { label: "Need estimates", count: summary.missingEstimates, filter: "missing-estimate" },
    { label: "Need deadlines", count: summary.missingDeadlines, filter: "missing-deadline" },
    { label: "Schedule conflicts", count: summary.scheduleConflicts, filter: "schedule-conflict" },
  ];

  return <Card className="rounded-2xl bg-white/80 p-4"><CardHeader><CardTitle className="text-base">Planning health</CardTitle><p className="text-xs text-slate-500">Feasibility is recalculated from current estimates, availability, deadlines, and scheduled work. It does not change your plan.</p></CardHeader><CardContent className="space-y-4">
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">{summaries.map((item) => <Button key={item.label} variant="outline" className={`h-auto justify-start px-3 py-2 text-left ${filter === item.filter ? "bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90" : "bg-white/80 text-slate-700 ring-1 ring-pink-100 hover:bg-pink-50"}`} onClick={() => setFilter(item.filter)} aria-label={`Show ${item.label.toLowerCase()} tasks`}><span><span className="block text-lg font-semibold">{item.count}</span><span className="text-xs">{item.label}</span></span></Button>)}</div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs">Filter<select className="block h-10 w-full rounded-md border bg-white px-3" value={filter} onChange={(event) => setFilter(event.target.value as RiskFilter)}>{FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="text-xs">Sort<select className="block h-10 w-full rounded-md border bg-white px-3" value={sort} onChange={(event) => setSort(event.target.value as RiskSort)}>{SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    </div>
    <div className="space-y-2">{displayed.length ? displayed.map((assessment) => {
      const task = taskMap.get(assessment.taskId)!;
      const open = expanded === assessment.taskId;
      return <article key={assessment.taskId} className="rounded-xl border bg-white/70 p-3">
        <button className="grid w-full gap-2 text-left sm:grid-cols-[2fr_repeat(5,1fr)]" onClick={() => setExpanded(open ? null : assessment.taskId)} aria-expanded={open}>
          <span><span className="block font-medium text-slate-700">{task.title}</span><span className="text-xs text-slate-500">{task.dueDate ? formatLocalDate(task.dueDate, { month: "short", day: "numeric", year: "numeric" }) : "No deadline"}</span></span>
          <Metric label="Risk" value={riskLabel(assessment)}/>
          <Metric label="Remaining" value={minutesToDuration(assessment.remainingMinutes ?? 0)}/>
          <Metric label="Planned" value={minutesToDuration((assessment.scheduledMinutes ?? 0) + (assessment.proposedScheduledMinutes ?? 0))}/>
          <Metric label="Unscheduled" value={minutesToDuration(assessment.unscheduledMinutes ?? 0)}/>
          <Metric label="Available" value={assessment.availableMinutesBeforeDeadline === undefined ? "Unknown" : minutesToDuration(assessment.availableMinutesBeforeDeadline)}/>
        </button>
        {open ? <div className="mt-3 border-t pt-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2"><div><span className="font-medium">Buffer: </span>{assessment.bufferMinutes === undefined ? "Unknown" : assessment.bufferMinutes < 0 ? `${minutesToDuration(Math.abs(assessment.bufferMinutes))} short` : minutesToDuration(assessment.bufferMinutes)}</div><div><span className="font-medium">Score: </span>{assessment.score === undefined ? "Not calculated" : `${assessment.score}/100`}</div></div>
          <ul className="mt-2 list-disc space-y-1 pl-5">{assessment.reasons.map((item) => <li key={`${item.code}-${item.message}`}>{item.message}</li>)}</ul>
          {assessment.recommendations.length ? <div className="mt-3 flex flex-wrap gap-2">{assessment.recommendations.map((item) => <Button key={item.action} variant="outline" onClick={() => document.getElementById("planning-actions")?.scrollIntoView({ behavior: "smooth" })}>{item.label}</Button>)}</div> : null}
        </div> : null}
      </article>;
    }) : <p className="text-sm text-slate-500">No active tasks match this filter.</p>}</div>
  </CardContent></Card>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <span><span className="block text-[10px] uppercase tracking-wide text-slate-400">{label}</span><span className="text-xs text-slate-700">{value}</span></span>;
}
