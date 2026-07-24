import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_MAXIMUM_SESSION_MINUTES,
  DEFAULT_MINIMUM_SESSION_MINUTES,
  MAX_ESTIMATE_MINUTES,
  QUICK_EFFORT_MINUTES,
  effortPatch,
  estimateState,
  formatEffortMinutes,
  validateTaskEffort,
  type TaskEffort,
} from "@/lib/taskEffort";
import type { TaskRecord } from "@/lib/taskHistory";

type EffortPatch = ReturnType<typeof effortPatch>;

function durationParts(minutes: number | undefined): { hours: string; minutes: string } {
  if (minutes === undefined) return { hours: "", minutes: "" };
  return { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) };
}

function parseNonNegativeInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a whole number.`);
  return Number(value);
}

function parseOptionalDuration(hours: string, minutes: string, label: string, allowZero: boolean): number | undefined {
  if (!hours.trim() && !minutes.trim()) return undefined;
  const parsedHours = parseNonNegativeInteger(hours || "0", `${label} hours`);
  const parsedMinutes = parseNonNegativeInteger(minutes || "0", `${label} minutes`);
  if (parsedMinutes > 59) throw new Error(`${label} minutes must be from 0 to 59.`);
  const total = parsedHours * 60 + parsedMinutes;
  if (!allowZero && total === 0) throw new Error(`${label} must be greater than zero.`);
  if (total > MAX_ESTIMATE_MINUTES) throw new Error(`${label} is above the supported limit of 10 weeks.`);
  return total;
}

export function TaskEffortEditor({
  task,
  onSave,
  onCancel,
  compact = false,
}: {
  task: TaskRecord;
  onSave: (patch: EffortPatch, completeAfterSave?: boolean) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const estimateInitial = durationParts(task.estimatedMinutes);
  const actualInitial = durationParts(task.actualMinutes);
  const [estimateHours, setEstimateHours] = useState(estimateInitial.hours);
  const [estimateMinutes, setEstimateMinutes] = useState(estimateInitial.minutes);
  const [actualHours, setActualHours] = useState(actualInitial.hours);
  const [actualMinutes, setActualMinutes] = useState(actualInitial.minutes);
  const [isSplittable, setIsSplittable] = useState(task.isSplittable);
  const [minimumSession, setMinimumSession] = useState(String(task.minimumSessionMinutes ?? DEFAULT_MINIMUM_SESSION_MINUTES));
  const [maximumSession, setMaximumSession] = useState(String(task.maximumSessionMinutes ?? DEFAULT_MAXIMUM_SESSION_MINUTES));
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const estimateHoursRef = useRef<HTMLInputElement | null>(null);

  const chooseEstimate = (minutes: number) => {
    const parts = durationParts(minutes);
    setEstimateHours(parts.hours);
    setEstimateMinutes(parts.minutes);
    setError(null);
  };

  const buildPatch = (): EffortPatch | null => {
    try {
      const estimated = parseOptionalDuration(estimateHours, estimateMinutes, "Estimate", false);
      const actual = parseOptionalDuration(actualHours, actualMinutes, "Actual time", true);
      const effort: TaskEffort = {
        estimatedMinutes: estimated,
        actualMinutes: actual,
        isSplittable,
        minimumSessionMinutes: isSplittable ? parseNonNegativeInteger(minimumSession, "Minimum session") : undefined,
        maximumSessionMinutes: isSplittable ? parseNonNegativeInteger(maximumSession, "Maximum session") : undefined,
      };
      const validation = validateTaskEffort(effort);
      if (validation.errors.length) throw new Error(validation.errors.join(" "));
      setWarning(validation.warnings[0] ?? null);
      if (validation.warnings.length && !window.confirm(`${validation.warnings.join("\n")}\n\nSave this estimate?`)) return null;
      setError(null);
      return effortPatch(effort);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Effort could not be saved.");
      return null;
    }
  };

  const save = (completeAfterSave = false) => {
    const patch = buildPatch();
    if (patch) onSave(patch, completeAfterSave);
  };

  return <div className={`space-y-3 rounded-xl border border-pink-100 bg-white/80 ${compact ? "p-3" : "p-4"}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><div className="text-sm font-semibold text-slate-700">Effort for {task.title}</div><div className="text-xs text-slate-500">{estimateState(task)}</div></div>
      <Button variant="outline" className="text-xs" onClick={() => { setEstimateHours(""); setEstimateMinutes(""); }}>Remove estimate</Button>
    </div>
    <fieldset>
      <legend className="text-xs font-medium text-slate-600">Estimate quick options</legend>
      <div className="mt-1 flex flex-wrap gap-1">{QUICK_EFFORT_MINUTES.map((minutes) => <Button key={minutes} variant="outline" className="h-8 text-xs" onClick={() => chooseEstimate(minutes)}>{formatEffortMinutes(minutes)}</Button>)}<Button variant="outline" className="h-8 text-xs" onClick={() => estimateHoursRef.current?.focus()}>Custom</Button></div>
    </fieldset>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-xs text-slate-600">Estimate hours<Input ref={estimateHoursRef} inputMode="numeric" type="number" min="0" step="1" value={estimateHours} onChange={(event) => setEstimateHours(event.target.value)} /></label>
      <label className="text-xs text-slate-600">Estimate minutes<Input inputMode="numeric" type="number" min="0" max="59" step="1" value={estimateMinutes} onChange={(event) => setEstimateMinutes(event.target.value)} /></label>
    </div>
    <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={isSplittable} onChange={(event) => setIsSplittable(event.target.checked)}/>Can be divided into smaller sessions</label>
    {isSplittable ? <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-xs text-slate-600">Minimum session minutes<Input inputMode="numeric" type="number" min="1" step="1" value={minimumSession} onChange={(event) => setMinimumSession(event.target.value)} /></label>
      <label className="text-xs text-slate-600">Maximum session minutes<Input inputMode="numeric" type="number" min="1" step="1" value={maximumSession} onChange={(event) => setMaximumSession(event.target.value)} /></label>
    </div> : null}
    <div>
      <div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-600">Actual time, entered manually</span><Button variant="outline" className="h-7 text-xs" onClick={() => { setActualHours(""); setActualMinutes(""); }}>Remove actual time</Button></div>
      <div className="mt-1 flex flex-wrap gap-1">{[30, 60, 80, 120].map((minutes) => <Button key={minutes} variant="outline" className="h-8 text-xs" onClick={() => { const parts = durationParts(minutes); setActualHours(parts.hours); setActualMinutes(parts.minutes); }}>{formatEffortMinutes(minutes)}</Button>)}</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-600">Actual hours<Input inputMode="numeric" type="number" min="0" step="1" value={actualHours} onChange={(event) => setActualHours(event.target.value)} /></label>
        <label className="text-xs text-slate-600">Actual minutes<Input inputMode="numeric" type="number" min="0" max="59" step="1" value={actualMinutes} onChange={(event) => setActualMinutes(event.target.value)} /></label>
      </div>
    </div>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    {warning ? <p role="status" className="text-sm text-amber-700">{warning}</p> : null}
    <div className="flex flex-wrap gap-2"><Button variant="outline" className="bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90" onClick={() => save(false)}>Save effort</Button>{task.status !== "completed" && task.status !== "archived" ? <Button variant="outline" onClick={() => save(true)}>Save and mark complete</Button> : null}{onCancel ? <Button variant="outline" onClick={onCancel}>Cancel</Button> : null}</div>
  </div>;
}
