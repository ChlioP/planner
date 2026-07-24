import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  blocksForDate,
  copyDateBlocks,
  createAvailabilityBlock,
  createOverride,
  createRecurringBlocks,
  deleteAvailabilityBlock,
  editAvailabilityBlock,
  totalAvailableMinutesForDate,
  totalAvailableMinutesForWeek,
  validateAvailabilityBlock,
  type AvailabilityBlock,
  type AvailabilityOverride,
  type AvailabilityType,
} from "@/lib/availability";
import { addLocalDays, formatLocalDate, localDateFromDate, minutesToDuration, startOfLocalWeek } from "@/lib/localDateTime";
import { AvailabilityTemplatesSection } from "./AvailabilityTemplatesSection";
import type { AvailabilityTemplate } from "@/lib/availabilityTemplates";

const TYPE_OPTIONS: Array<{ value: AvailabilityType; label: string }> = [
  { value: "available", label: "Available" }, { value: "work", label: "Work" },
  { value: "commute", label: "Commute" }, { value: "meal", label: "Meal" },
  { value: "sleep", label: "Sleep" }, { value: "exercise", label: "Exercise" },
  { value: "appointment", label: "Appointment" }, { value: "unavailable", label: "Unavailable" },
  { value: "other", label: "Other" },
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Props {
  blocks: AvailabilityBlock[];
  setBlocks: Dispatch<SetStateAction<AvailabilityBlock[]>>;
  overrides: AvailabilityOverride[];
  setOverrides: Dispatch<SetStateAction<AvailabilityOverride[]>>;
  templates: AvailabilityTemplate[];
  setTemplates: Dispatch<SetStateAction<AvailabilityTemplate[]>>;
}

interface FormState {
  name: string; type: AvailabilityType; date: string; startTime: string; endTime: string;
  isRecurring: boolean; weekdays: number[];
}

const EMPTY_FORM = (): FormState => ({
  name: "", type: "available", date: localDateFromDate(new Date()), startTime: "18:00", endTime: "19:00", isRecurring: false, weekdays: [],
});

export function AvailabilityPage({ blocks, setBlocks, overrides, setOverrides, templates, setTemplates }: Props) {
  const [weekStart, setWeekStart] = useState(() => startOfLocalWeek(localDateFromDate(new Date())));
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<{ block: AvailabilityBlock; date: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copySource, setCopySource] = useState(weekStart);
  const [copyDestinations, setCopyDestinations] = useState<string[]>([]);
  const [copyPreview, setCopyPreview] = useState<{ blocks: AvailabilityBlock[]; skipped: number } | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState({ workStart: "09:00", workEnd: "18:00", eveningStart: "", eveningEnd: "", commuteStart: "", commuteEnd: "", mealStart: "", mealEnd: "" });
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addLocalDays(weekStart, index)), [weekStart]);
  const weeklyMinutes = useMemo(() => totalAvailableMinutesForWeek(blocks, overrides, weekStart), [blocks, overrides, weekStart]);

  const openAdd = (date = weekStart) => { setEditingId(null); setOverrideTarget(null); setForm({ ...EMPTY_FORM(), date }); setMessage(null); };
  const openEdit = (block: AvailabilityBlock) => {
    setEditingId(block.id); setOverrideTarget(null);
    setForm({ name: block.name, type: block.type, date: block.date ?? weekStart, startTime: block.startTime, endTime: block.endTime, isRecurring: block.isRecurring, weekdays: block.dayOfWeek === undefined ? [] : [block.dayOfWeek] });
  };
  const openOverride = (block: AvailabilityBlock, date: string) => {
    setEditingId(null); setOverrideTarget({ block, date });
    setForm({ name: block.name, type: block.type, date, startTime: block.startTime, endTime: block.endTime, isRecurring: false, weekdays: [] });
  };

  const saveForm = () => {
    if (!form) return;
    try {
      if (form.isRecurring && form.weekdays.length === 0) throw new Error("Choose at least one weekday.");
      const now = new Date().toISOString();
      if (overrideTarget) {
        const replacement = createAvailabilityBlock({ name: form.name, type: form.type, date: overrideTarget.date, startTime: form.startTime, endTime: form.endTime, isRecurring: false }, now);
        const validation = validateAvailabilityBlock(replacement, blocksForDate(blocks, overrides, overrideTarget.date).filter((block) => block.id !== overrideTarget.block.id));
        if (validation.errors.length) throw new Error(validation.errors.join(" "));
        if (validation.warnings.length && !window.confirm(`${validation.warnings.join("\n")}\n\nSave anyway?`)) return;
        const next = createOverride(overrideTarget.block, overrideTarget.date, "replace", replacement, now);
        setOverrides((current) => [...current.filter((item) => !(item.recurringBlockId === next.recurringBlockId && item.date === next.date)), next]);
      } else if (editingId) {
        const current = blocks.find((block) => block.id === editingId);
        if (!current) throw new Error("This block no longer exists.");
        const updated = editAvailabilityBlock(current, { name: form.name, type: form.type, date: form.isRecurring ? undefined : form.date, dayOfWeek: form.isRecurring ? form.weekdays[0] : undefined, startTime: form.startTime, endTime: form.endTime, isRecurring: form.isRecurring }, now);
        const validation = validateAvailabilityBlock(updated, blocks);
        if (validation.errors.length) throw new Error(validation.errors.join(" "));
        if (validation.warnings.length && !window.confirm(`${validation.warnings.join("\n")}\n\nSave anyway?`)) return;
        setBlocks((currentBlocks) => currentBlocks.map((block) => block.id === editingId ? updated : block));
      } else {
        const additions = form.isRecurring
          ? createRecurringBlocks({ name: form.name, type: form.type, startTime: form.startTime, endTime: form.endTime }, form.weekdays, now)
          : [createAvailabilityBlock({ name: form.name, type: form.type, date: form.date, startTime: form.startTime, endTime: form.endTime, isRecurring: false }, now)];
        const validations = additions.map((block) => validateAvailabilityBlock(block, [...blocks, ...additions]));
        const errors = validations.flatMap((item) => item.errors);
        const warnings = Array.from(new Set(validations.flatMap((item) => item.warnings)));
        if (errors.length) throw new Error(Array.from(new Set(errors)).join(" "));
        if (warnings.length && !window.confirm(`${warnings.join("\n")}\n\nSave anyway?`)) return;
        setBlocks((current) => [...current, ...additions]);
      }
      setForm(null); setMessage("Availability saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Availability could not be saved."); }
  };

  const removeBlock = (block: AvailabilityBlock) => {
    if (!window.confirm(`Delete “${block.name}”?`)) return;
    setBlocks((current) => deleteAvailabilityBlock(current, block.id));
    setOverrides((current) => current.filter((item) => item.recurringBlockId !== block.id));
  };

  const skipDate = (block: AvailabilityBlock, date: string) => {
    if (!window.confirm(`Skip “${block.name}” on ${date}? The weekly block will remain unchanged.`)) return;
    const next = createOverride(block, date, "remove");
    setOverrides((current) => [...current.filter((item) => !(item.recurringBlockId === block.id && item.date === date)), next]);
  };

  const confirmCopy = () => {
    if (!copyPreview) return;
    setBlocks((current) => [...current, ...copyPreview.blocks]);
    setMessage(`Copied ${copyPreview.blocks.length} block(s); skipped ${copyPreview.skipped} duplicate(s).`);
    setCopyPreview(null); setCopyDestinations([]);
  };

  const confirmSetup = () => {
    try {
      const optionalPairs = [[setup.eveningStart, setup.eveningEnd], [setup.commuteStart, setup.commuteEnd], [setup.mealStart, setup.mealEnd]];
      if (optionalPairs.some(([start, end]) => Boolean(start) !== Boolean(end))) throw new Error("Enter both a start and end time for each optional row, or leave both empty.");
      const inputs = [
        { name: "Work", type: "work" as const, startTime: setup.workStart, endTime: setup.workEnd },
        ...(setup.eveningStart && setup.eveningEnd ? [{ name: "Evening availability", type: "available" as const, startTime: setup.eveningStart, endTime: setup.eveningEnd }] : []),
        ...(setup.commuteStart && setup.commuteEnd ? [{ name: "Commute", type: "commute" as const, startTime: setup.commuteStart, endTime: setup.commuteEnd }] : []),
        ...(setup.mealStart && setup.mealEnd ? [{ name: "Meal", type: "meal" as const, startTime: setup.mealStart, endTime: setup.mealEnd }] : []),
      ];
      const additions = inputs.flatMap((input) => createRecurringBlocks(input, [1, 2, 3, 4, 5]));
      const validations = additions.map((block) => validateAvailabilityBlock(block, [...blocks, ...additions]));
      const errors = Array.from(new Set(validations.flatMap((item) => item.errors)));
      const warnings = Array.from(new Set(validations.flatMap((item) => item.warnings)));
      if (errors.length) throw new Error(errors.join(" "));
      if (warnings.length && !window.confirm(`${warnings.join("\n")}\n\nSave this reviewed setup anyway?`)) return;
      setBlocks((current) => [...current, ...additions]); setSetupOpen(false); setMessage(`Saved ${additions.length} reviewed workweek block(s).`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Workweek setup could not be saved."); }
  };

  return <div className="space-y-4 p-4">
    <Card className="rounded-2xl bg-white/80 shadow-sm ring-1 ring-pink-100 backdrop-blur-sm">
      <CardHeader className="gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
        <div><CardTitle className="text-lg text-slate-700">Availability</CardTitle><p className="text-xs text-slate-500">Only blocks marked Available count as planning time.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setWeekStart(addLocalDays(weekStart, -7))}>Previous week</Button><Button variant="outline" onClick={() => setWeekStart(startOfLocalWeek(localDateFromDate(new Date())))}>Current week</Button><Button variant="outline" onClick={() => setWeekStart(addLocalDays(weekStart, 7))}>Next week</Button><Button onClick={() => openAdd()}>Add block</Button></div>
      </CardHeader>
      <CardContent className="px-4"><div className="text-sm font-medium text-slate-700">Week of {formatLocalDate(weekStart, { month: "long", day: "numeric", year: "numeric" })} · {minutesToDuration(weeklyMinutes)} available</div>{message ? <p role="status" className="mt-2 rounded-xl bg-pink-50 p-2 text-sm text-slate-700">{message}</p> : null}</CardContent>
    </Card>

    {blocks.length === 0 ? <Card className="rounded-2xl bg-white/80"><CardContent className="space-y-3 p-6 text-center"><p className="text-slate-700">No availability yet. Add the time you can use for focused work, plus commitments that reduce it.</p><div className="flex justify-center gap-2"><Button onClick={() => openAdd()}>Add my first block</Button><Button variant="outline" onClick={() => setSetupOpen(true)}>Set up my workweek</Button></div></CardContent></Card> : null}

    {setupOpen ? <Card className="rounded-2xl bg-white/90 p-4"><CardHeader><CardTitle>Review your workweek</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-slate-600">Nothing is saved until you confirm. Leave optional rows empty.</p><SetupRow label="Work (Monday–Friday)" start={setup.workStart} end={setup.workEnd} onChange={(start, end) => setSetup((value) => ({ ...value, workStart: start, workEnd: end }))}/><SetupRow label="Evening availability (optional)" start={setup.eveningStart} end={setup.eveningEnd} onChange={(start, end) => setSetup((value) => ({ ...value, eveningStart: start, eveningEnd: end }))}/><SetupRow label="Commute (optional)" start={setup.commuteStart} end={setup.commuteEnd} onChange={(start, end) => setSetup((value) => ({ ...value, commuteStart: start, commuteEnd: end }))}/><SetupRow label="Meal (optional)" start={setup.mealStart} end={setup.mealEnd} onChange={(start, end) => setSetup((value) => ({ ...value, mealStart: start, mealEnd: end }))}/><div className="flex gap-2"><Button onClick={confirmSetup}>Confirm setup</Button><Button variant="outline" onClick={() => setSetupOpen(false)}>Cancel</Button></div></CardContent></Card> : null}

    {form ? <AvailabilityForm form={form} setForm={setForm} onSave={saveForm} onCancel={() => setForm(null)} /> : null}

    <div className="grid gap-3 lg:grid-cols-7">{weekDates.map((date) => {
      const effective = blocksForDate(blocks, overrides, date).sort((a, b) => a.startTime.localeCompare(b.startTime));
      const removedOverrides = overrides.filter((item) => item.date === date && item.action === "remove");
      return <Card key={date} className="rounded-2xl bg-white/80"><CardHeader className="p-4"><CardTitle className="text-sm text-slate-700">{formatLocalDate(date, { weekday: "short", month: "short", day: "numeric" })}</CardTitle><div className="text-xs text-emerald-700">{minutesToDuration(totalAvailableMinutesForDate(blocks, overrides, date))} available</div></CardHeader><CardContent className="space-y-2 p-4 pt-0">{effective.length === 0 ? <p className="text-xs text-slate-400">No blocks</p> : effective.map((block) => {
        const replacementOverride = overrides.find((item) => item.date === date && item.action === "replace" && item.replacementBlock?.id === block.id);
        const recurringSource = replacementOverride ? blocks.find((item) => item.id === replacementOverride.recurringBlockId) : undefined;
        return <div key={`${block.id}-${date}`} className={`rounded-xl border p-2 text-xs ${block.type === "available" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-100"}`}><div className="font-semibold text-slate-700">{block.name}</div><div>{block.startTime}–{block.endTime} · {TYPE_OPTIONS.find((item) => item.value === block.type)?.label}</div>{replacementOverride ? <div className="mt-1 text-[10px] text-slate-500">Changed for this date</div> : null}<div className="mt-2 flex flex-wrap gap-1">{replacementOverride && recurringSource ? <><Button variant="outline" className="h-7 px-2 text-[10px]" onClick={() => openOverride(recurringSource, date)}>Edit change</Button><Button variant="outline" className="h-7 px-2 text-[10px]" onClick={() => setOverrides((current) => current.filter((item) => item.id !== replacementOverride.id))}>Restore weekly</Button></> : block.isRecurring ? <><Button variant="outline" className="h-7 px-2 text-[10px]" onClick={() => openEdit(block)}>Edit weekly</Button><Button variant="outline" className="h-7 px-2 text-[10px]" onClick={() => openOverride(block, date)}>Change date</Button><Button variant="outline" className="h-7 px-2 text-[10px]" onClick={() => skipDate(block, date)}>Skip date</Button></> : <><Button variant="outline" className="h-7 px-2 text-[10px]" onClick={() => openEdit(block)}>Edit</Button><Button variant="outline" className="h-7 px-2 text-[10px] text-red-600" onClick={() => removeBlock(block)}>Delete</Button></>}</div></div>;
      })}{removedOverrides.map((override) => <div key={override.id} className="rounded-xl border border-dashed border-slate-300 p-2 text-xs text-slate-500"><div>Weekly block skipped</div><Button variant="outline" className="mt-1 h-7 px-2 text-[10px]" onClick={() => setOverrides((current) => current.filter((item) => item.id !== override.id))}>Restore weekly</Button></div>)}<Button className="h-8 w-full text-xs" onClick={() => openAdd(date)}>Add</Button></CardContent></Card>;
    })}</div>

    <Card className="rounded-2xl bg-white/80 p-4"><CardHeader><CardTitle className="text-base text-slate-700">Copy Day</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap items-end gap-3"><label className="text-xs text-slate-600">Source date<Input type="date" value={copySource} onChange={(event) => { setCopySource(event.target.value); setCopyPreview(null); }} /></label><div className="flex flex-wrap gap-2">{weekDates.map((date) => <label key={date} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={copyDestinations.includes(date)} onChange={() => { setCopyDestinations((current) => current.includes(date) ? current.filter((item) => item !== date) : [...current, date]); setCopyPreview(null); }}/>{formatLocalDate(date, { weekday: "short", day: "numeric" })}</label>)}</div><Button variant="outline" disabled={copyDestinations.length === 0} onClick={() => setCopyPreview(copyDateBlocks(blocks, overrides, copySource, copyDestinations))}>Preview copy</Button></div>{copyPreview ? <div className="rounded-xl bg-pink-50 p-3 text-sm"><p>Copy {copyPreview.blocks.length} block(s). {copyPreview.skipped} exact duplicate(s) will be skipped.</p><ul className="mt-2 list-disc pl-5 text-xs text-slate-600">{copyPreview.blocks.map((block) => <li key={block.id}>{block.date}: {block.name}, {block.startTime}–{block.endTime}</li>)}</ul><div className="mt-2 flex gap-2"><Button onClick={confirmCopy}>Confirm copy</Button><Button variant="outline" onClick={() => setCopyPreview(null)}>Cancel</Button></div></div> : null}</CardContent></Card>
    <AvailabilityTemplatesSection templates={templates} setTemplates={setTemplates} availability={blocks} setAvailability={setBlocks} overrides={overrides}/>
  </div>;
}

function AvailabilityForm({ form, setForm, onSave, onCancel }: { form: FormState; setForm: Dispatch<SetStateAction<FormState | null>>; onSave: () => void; onCancel: () => void }) {
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => current ? { ...current, [key]: value } : current);
  return <Card className="rounded-2xl bg-white/90 p-4"><CardHeader><CardTitle className="text-base">Availability block</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"><label className="text-xs">Block name<Input value={form.name} onChange={(event) => update("name", event.target.value)} /></label><label className="text-xs">Type<select className="block h-10 w-full rounded-md border px-3" value={form.type} onChange={(event) => update("type", event.target.value as AvailabilityType)}>{TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isRecurring} onChange={(event) => update("isRecurring", event.target.checked)}/>Repeat weekly</label>{form.isRecurring ? <fieldset className="md:col-span-2"><legend className="text-xs">Weekdays</legend><div className="flex flex-wrap gap-2">{WEEKDAYS.map((label, day) => <label key={label} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={form.weekdays.includes(day)} onChange={() => update("weekdays", form.weekdays.includes(day) ? form.weekdays.filter((value) => value !== day) : [...form.weekdays, day])}/>{label}</label>)}</div></fieldset> : <label className="text-xs">Specific date<Input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} /></label>}<label className="text-xs">Start time<Input type="time" value={form.startTime} onChange={(event) => update("startTime", event.target.value)} /></label><label className="text-xs">End time<Input type="time" value={form.endTime} onChange={(event) => update("endTime", event.target.value)} /></label><div className="flex items-end gap-2"><Button onClick={onSave}>Save</Button><Button variant="outline" onClick={onCancel}>Cancel</Button></div></CardContent></Card>;
}

function SetupRow({ label, start, end, onChange }: { label: string; start: string; end: string; onChange: (start: string, end: string) => void }) {
  return <div className="grid gap-2 sm:grid-cols-[1fr_150px_150px]"><span className="text-sm text-slate-700">{label}</span><Input aria-label={`${label} start`} type="time" value={start} onChange={(event) => onChange(event.target.value, end)}/><Input aria-label={`${label} end`} type="time" value={end} onChange={(event) => onChange(start, event.target.value)}/></div>;
}
