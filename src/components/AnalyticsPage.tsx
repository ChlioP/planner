import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  analyticsCsv,
  analyticsCsvFilename,
  analyticsRangeForPreset,
  buildAnalyticsSummary,
  validateAnalyticsRange,
  type AnalyticsRangePreset,
} from "@/lib/analytics";
import { formatLocalDate, localDateFromDate, minutesToDuration } from "@/lib/localDateTime";
import type { ScheduleBlock } from "@/lib/scheduleBlocks";
import type { TaskRecord } from "@/lib/taskHistory";
import type { TaskSession } from "@/lib/taskSessions";
import type { TimeLog } from "@/lib/timeLogs";

const PRESETS: Array<{ value: AnalyticsRangePreset; label: string }> = [
  { value: "this-week", label: "This week" }, { value: "last-week", label: "Last week" },
  { value: "last-7-days", label: "Last 7 days" }, { value: "last-30-days", label: "Last 30 days" },
  { value: "this-month", label: "This month" }, { value: "last-month", label: "Last month" },
  { value: "custom", label: "Custom" },
];

export function AnalyticsPage({ tasks, sessions, timeLogs, scheduleBlocks }: { tasks: TaskRecord[]; sessions: TaskSession[]; timeLogs: TimeLog[]; scheduleBlocks: ScheduleBlock[] }) {
  const [clock] = useState(() => new Date());
  const today = localDateFromDate(clock);
  const initial = analyticsRangeForPreset("this-week", today);
  const [preset, setPreset] = useState<AnalyticsRangePreset>("this-week");
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [category, setCategory] = useState("");
  const [recordSort, setRecordSort] = useState<"newest" | "tracked" | "variance">("newest");
  const [message, setMessage] = useState("");
  const range = { start, end };
  const rangeValid = end >= start;
  const summary = useMemo(() => rangeValid ? buildAnalyticsSummary(tasks, sessions, timeLogs, scheduleBlocks, { start, end }, today, `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`) : null, [clock, end, rangeValid, scheduleBlocks, sessions, start, tasks, timeLogs, today]);
  const records = useMemo(() => {
    if (!summary) return [];
    const filtered = category ? summary.records.filter((record) => record.category === category) : summary.records;
    return filtered.slice().sort((a, b) => recordSort === "tracked" ? b.trackedMinutes - a.trackedMinutes || b.date.localeCompare(a.date) : recordSort === "variance" ? Math.abs(b.estimateVarianceMinutes ?? 0) - Math.abs(a.estimateVarianceMinutes ?? 0) || b.date.localeCompare(a.date) : b.date.localeCompare(a.date) || a.taskTitle.localeCompare(b.taskTitle)).slice(0, 100);
  }, [category, recordSort, summary]);

  const choosePreset = (value: AnalyticsRangePreset) => {
    setPreset(value);
    if (value !== "custom") {
      const next = analyticsRangeForPreset(value, today);
      setStart(next.start); setEnd(next.end); setMessage("");
    }
  };
  const exportCsv = () => {
    try { validateAnalyticsRange(range); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid range."); return; }
    const blob = new Blob([analyticsCsv(records)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = analyticsCsvFilename(range); link.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${records.length} analytics record(s) for the selected range.`);
  };

  if (!summary) return <div className="space-y-4 p-4"><RangeControls preset={preset} start={start} end={end} onPreset={choosePreset} onStart={setStart} onEnd={setEnd}/><p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Range start must be on or before range end.</p></div>;
  const maxDaily = Math.max(1, ...summary.dailyBreakdown.flatMap((day) => [day.trackedMinutes, day.plannedMinutes]));
  const maxCategory = Math.max(1, ...summary.categoryBreakdown.map((item) => item.trackedMinutes));

  return <div className="space-y-4 p-4">
    <RangeControls preset={preset} start={start} end={end} onPreset={choosePreset} onStart={setStart} onEnd={setEnd}/>
    <p className="text-sm text-slate-600">Showing {formatLocalDate(start, { month: "short", day: "numeric", year: "numeric" })} through {formatLocalDate(end, { month: "short", day: "numeric", year: "numeric" })}. Time logs use their local start date, schedules use their planned date, and completions use their completion date.</p>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <SummaryCard label="Tracked time" value={summary.trackedMinutes ? minutesToDuration(summary.trackedMinutes) : "No tracked time"}/>
      <SummaryCard label="Planned time completed" value={summary.scheduleCompletionRate === undefined ? "Not enough data" : `${Math.round(summary.scheduleCompletionRate * 100)}%`}/>
      <SummaryCard label="Tasks completed" value={String(summary.completedTaskCount)}/>
      <SummaryCard label="Sessions completed" value={String(summary.completedSessionCount)}/>
      <SummaryCard label="Completed on time" value={summary.onTimeCompletedCount + summary.lateCompletedCount ? `${summary.onTimeCompletedCount} of ${summary.onTimeCompletedCount + summary.lateCompletedCount}` : "No deadline data"}/>
      <SummaryCard label="Estimate comparison" value={summary.comparableEstimateCount >= 3 && summary.medianEstimateRatio !== undefined ? `${Math.round(summary.medianEstimateRatio * 100)}% of estimate` : "More data needed"}/>
    </div>

    <Card className="rounded-2xl bg-white/80 p-4"><CardHeader><CardTitle className="text-base">Insights</CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-3">{summary.insights.map((insight) => <article key={insight.id} className="rounded-xl border bg-white/70 p-3"><div className="font-medium text-slate-700">{insight.title}</div><p className="mt-1 text-sm text-slate-600">{insight.message}</p>{insight.supportingMetric ? <p className="mt-1 text-xs text-slate-500">{insight.supportingMetric}</p> : null}</article>)}</CardContent></Card>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="rounded-2xl bg-white/80 p-4"><CardHeader><CardTitle className="text-base">Time by category</CardTitle><p className="text-xs text-slate-500">Session time uses its parent task’s category.</p></CardHeader><CardContent>{summary.categoryBreakdown.length ? <div className="space-y-3">{summary.categoryBreakdown.map((item) => <button key={item.categoryName} className="block w-full text-left" onClick={() => setCategory(category === item.categoryName ? "" : item.categoryName)} aria-label={`Filter details to ${item.categoryName}`}><div className="flex justify-between text-sm"><span>{item.categoryName}</span><span>{minutesToDuration(item.trackedMinutes)} · {Math.round(item.percentageOfTrackedTime * 100)}%</span></div><div className="mt-1 h-3 rounded-full bg-slate-100" aria-hidden="true"><div className="h-3 rounded-full bg-pink-300 motion-reduce:transition-none" style={{ width: `${(item.trackedMinutes / maxCategory) * 100}%` }}/></div></button>)}</div> : <p className="text-sm text-slate-500">Track time on a task to see category totals.</p>}</CardContent></Card>
      <Card className="rounded-2xl bg-white/80 p-4"><CardHeader><CardTitle className="text-base">Planned time</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><Row label="Total planned" value={minutesToDuration(summary.plannedMinutes)}/><Row label="Completed" value={minutesToDuration(summary.completedPlannedMinutes)}/><Row label="Missed" value={minutesToDuration(summary.missedPlannedMinutes)}/><Row label="Cancelled, excluded from rate" value={minutesToDuration(summary.cancelledPlannedMinutes)}/><Row label="Future confirmed" value={minutesToDuration(summary.futurePlannedMinutes)}/><p className="pt-2 text-xs text-slate-500">The completion rate is duration-weighted: completed minutes divided by eligible past completed, missed, and incomplete confirmed minutes.</p></CardContent></Card>
    </div>

    <Card className="rounded-2xl bg-white/80 p-4"><CardHeader><CardTitle className="text-base">Daily planned versus tracked</CardTitle><p className="sr-only">Each row compares planned and tracked minutes for one local calendar date.</p></CardHeader><CardContent><div className="space-y-3">{summary.dailyBreakdown.map((day) => <div key={day.date} className="grid gap-1 sm:grid-cols-[120px_1fr]"><div className="text-xs text-slate-600">{day.date}{day.date === today ? " · Today" : ""}</div><div><LabeledBar label={`Planned ${minutesToDuration(day.plannedMinutes)}`} width={(day.plannedMinutes / maxDaily) * 100} className="bg-amber-300"/><LabeledBar label={`Tracked ${minutesToDuration(day.trackedMinutes)}`} width={(day.trackedMinutes / maxDaily) * 100} className="bg-pink-300"/></div></div>)}</div></CardContent></Card>

    <Card className="rounded-2xl bg-white/80 p-4"><CardHeader><CardTitle className="text-base">Estimate comparison</CardTitle></CardHeader><CardContent>{summary.estimateComparisons.length ? <div className="space-y-2">{summary.estimateComparisons.map((item) => <div key={`${item.taskId}-${item.sessionId ?? "task"}`} className="flex justify-between rounded-xl border p-3 text-sm"><span>{item.title}</span><span>Estimate {minutesToDuration(item.estimateMinutes)} · Tracked {minutesToDuration(item.actualMinutes)} · {item.varianceMinutes >= 0 ? `${minutesToDuration(item.varianceMinutes)} over` : `${minutesToDuration(Math.abs(item.varianceMinutes))} under`}</span></div>)}</div> : <p className="text-sm text-slate-500">Complete estimated work with tracked time to compare estimates. At least three comparable items are needed for a broad pattern.</p>}</CardContent></Card>

    <Card className="rounded-2xl bg-white/80 p-4"><CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-base">Detailed records</CardTitle><p className="text-xs text-slate-500">Showing up to 100 records. No internal or user IDs are displayed.</p></div><Button variant="outline" onClick={exportCsv}>Export selected range as CSV</Button></CardHeader><CardContent className="space-y-3"><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">Category<select className="block h-10 w-full rounded-md border px-3" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{summary.categoryBreakdown.map((item) => <option key={item.categoryName} value={item.categoryName}>{item.categoryName}</option>)}</select></label><label className="text-xs">Sort<select className="block h-10 w-full rounded-md border px-3" value={recordSort} onChange={(event) => setRecordSort(event.target.value as typeof recordSort)}><option value="newest">Newest first</option><option value="tracked">Most tracked time</option><option value="variance">Largest estimate difference</option></select></label></div><div className="overflow-auto"><table className="min-w-full text-xs"><thead><tr className="border-b"><th className="p-2 text-left">Date</th><th className="p-2 text-left">Task</th><th className="p-2 text-left">Category</th><th className="p-2 text-left">Estimated</th><th className="p-2 text-left">Tracked</th><th className="p-2 text-left">Planned</th><th className="p-2 text-left">Status</th></tr></thead><tbody>{records.map((record, index) => <tr key={`${record.date}-${record.taskTitle}-${record.sessionTitle ?? ""}-${index}`} className="border-b"><td className="p-2">{record.date}</td><td className="p-2">{record.taskTitle}{record.sessionTitle ? <span className="block text-slate-500">{record.sessionTitle}</span> : null}</td><td className="p-2">{record.category}</td><td className="p-2">{record.estimatedMinutes === undefined ? "—" : minutesToDuration(record.estimatedMinutes)}</td><td className="p-2">{minutesToDuration(record.trackedMinutes)}</td><td className="p-2">{minutesToDuration(record.plannedMinutes)}</td><td className="p-2">{record.completionStatus}</td></tr>)}</tbody></table>{!records.length ? <p className="p-3 text-sm text-slate-500">No detailed records match this range and filter.</p> : null}</div>{message ? <p role="status" className="text-sm text-slate-600">{message}</p> : null}</CardContent></Card>
  </div>;
}

function RangeControls({ preset, start, end, onPreset, onStart, onEnd }: { preset: AnalyticsRangePreset; start: string; end: string; onPreset: (value: AnalyticsRangePreset) => void; onStart: (value: string) => void; onEnd: (value: string) => void }) {
  return <Card className="rounded-2xl bg-white/80 p-4"><CardHeader><CardTitle className="text-lg">Productivity insights</CardTitle><p className="text-xs text-slate-500">Neutral summaries derived locally from your planner records. No data is sent to an analytics service.</p></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3"><label className="text-xs">Date range<select className="block h-10 w-full rounded-md border px-3" value={preset} onChange={(event) => onPreset(event.target.value as AnalyticsRangePreset)}>{PRESETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="text-xs">Start date<Input type="date" value={start} disabled={preset !== "custom"} onChange={(event) => onStart(event.target.value)}/></label><label className="text-xs">End date<Input type="date" value={end} disabled={preset !== "custom"} onChange={(event) => onEnd(event.target.value)}/></label></CardContent></Card>;
}
function SummaryCard({ label, value }: { label: string; value: string }) { return <Card className="rounded-2xl bg-white/80"><CardContent className="p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-semibold text-slate-700">{value}</div></CardContent></Card>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3"><span>{label}</span><span>{value}</span></div>; }
function LabeledBar({ label, width, className }: { label: string; width: number; className: string }) { return <div className="mb-1 flex items-center gap-2"><span className="w-28 text-[11px] text-slate-500">{label}</span><div className="h-3 flex-1 rounded-full bg-slate-100"><div className={`h-3 rounded-full ${className}`} style={{ width: `${width}%` }}/></div></div>; }
