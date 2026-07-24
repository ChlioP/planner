import { useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AvailabilityBlock, AvailabilityOverride, AvailabilityType } from "@/lib/availability";
import {
  applyTemplatePreview,
  createAvailabilityTemplate,
  datesInRange,
  deleteAvailabilityTemplate,
  duplicateAvailabilityTemplate,
  editAvailabilityTemplate,
  previewTemplateAsRecurring,
  previewTemplateForDates,
  validateTemplate,
  type AvailabilityTemplate,
  type AvailabilityTemplateBlock,
  type TemplateApplyPreview,
} from "@/lib/availabilityTemplates";
import { localDateFromDate } from "@/lib/localDateTime";

const TYPES: Array<{ value: AvailabilityType; label: string }> = [
  { value: "available", label: "Available" }, { value: "work", label: "Work" },
  { value: "commute", label: "Commute" }, { value: "meal", label: "Meal" },
  { value: "sleep", label: "Sleep" }, { value: "exercise", label: "Exercise" },
  { value: "appointment", label: "Appointment" }, { value: "unavailable", label: "Unavailable" },
  { value: "other", label: "Other" },
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Props {
  templates: AvailabilityTemplate[];
  setTemplates: Dispatch<SetStateAction<AvailabilityTemplate[]>>;
  availability: AvailabilityBlock[];
  setAvailability: Dispatch<SetStateAction<AvailabilityBlock[]>>;
  overrides: AvailabilityOverride[];
}

interface TemplateDraft { name: string; description: string; blocks: AvailabilityTemplateBlock[] }

const STARTERS: Array<{ name: string; description: string; blocks: Array<Omit<AvailabilityTemplateBlock, "id">> }> = [
  { name: "Workday", description: "Review work hours and add evening availability if wanted.", blocks: [{ name: "Work", startTime: "09:00", endTime: "18:00", type: "work" }] },
  { name: "Weekend", description: "Editable morning and afternoon planning blocks.", blocks: [{ name: "Morning availability", startTime: "09:00", endTime: "12:00", type: "available" }, { name: "Afternoon availability", startTime: "14:00", endTime: "17:00", type: "available" }] },
  { name: "Study Day", description: "Start empty and add the study periods that suit you.", blocks: [] },
  { name: "Rest Day", description: "Start empty; add personal or exercise time only if useful.", blocks: [] },
  { name: "Travel Day", description: "Review before marking the day unavailable.", blocks: [{ name: "Travel day", startTime: "00:00", endTime: "23:59", type: "unavailable" }] },
];

function blankBlock(): AvailabilityTemplateBlock {
  return { id: crypto.randomUUID(), name: "", startTime: "09:00", endTime: "10:00", type: "available" };
}

export function AvailabilityTemplatesSection({ templates, setTemplates, availability, setAvailability, overrides }: Props) {
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [applying, setApplying] = useState<AvailabilityTemplate | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const openNew = (starter?: typeof STARTERS[number]) => {
    setEditingId(null);
    setDraft({
      name: starter?.name ?? "Custom Schedule",
      description: starter?.description ?? "",
      blocks: starter?.blocks.map((block) => ({ ...block, id: crypto.randomUUID() })) ?? [],
    });
  };
  const openEdit = (template: AvailabilityTemplate) => {
    setEditingId(template.id);
    setDraft({ name: template.name, description: template.description ?? "", blocks: template.blocks.map((block) => ({ ...block })) });
  };
  const saveDraft = () => {
    if (!draft) return;
    const validation = validateTemplate(draft);
    if (validation.errors.length) { setMessage(validation.errors.join(" ")); return; }
    if (draft.blocks.length === 0 && !window.confirm("Save this empty template? You can add blocks later.")) return;
    if (validation.warnings.length && !window.confirm(`${validation.warnings.join("\n")}\n\nSave anyway?`)) return;
    try {
      if (editingId) {
        setTemplates((current) => current.map((template) => template.id === editingId
          ? editAvailabilityTemplate(template, { name: draft.name, description: draft.description || undefined, blocks: draft.blocks })
          : template));
      } else {
        setTemplates((current) => [...current, createAvailabilityTemplate({ name: draft.name, description: draft.description || undefined, blocks: draft.blocks })]);
      }
      setDraft(null); setEditingId(null); setMessage("Template saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Template could not be saved."); }
  };
  const duplicate = (template: AvailabilityTemplate) => {
    const copy = duplicateAvailabilityTemplate(template);
    setTemplates((current) => [...current, copy]);
    openEdit(copy);
  };
  const remove = (template: AvailabilityTemplate) => {
    if (!window.confirm(`Delete “${template.name}”? Availability already created from it will remain.`)) return;
    setTemplates((current) => deleteAvailabilityTemplate(current, template.id));
    setMessage("Template deleted. Applied availability was not changed.");
  };

  return <section className="space-y-4" aria-labelledby="availability-templates-heading">
    <Card className="rounded-2xl bg-white/80 p-4">
      <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><CardTitle id="availability-templates-heading" className="text-base text-slate-700">Schedule templates</CardTitle><p className="text-xs text-slate-500">Reusable daily patterns. Applying one creates normal availability blocks.</p></div>
        <Button onClick={() => openNew()}>Create template</Button>
      </CardHeader>
      {message ? <CardContent className="pt-0"><p role="status" className="rounded-xl bg-pink-50 p-2 text-sm">{message}</p></CardContent> : null}
    </Card>

    {templates.length === 0 && !draft ? <Card className="rounded-2xl bg-white/80 p-4"><CardHeader><CardTitle className="text-base">Optional starters</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">{STARTERS.map((starter) => <div key={starter.name} className="rounded-xl border bg-white/70 p-3"><div className="font-semibold text-slate-700">{starter.name}</div><p className="my-2 text-xs text-slate-500">{starter.description}</p><TemplateBlockList blocks={starter.blocks.map((block, index) => ({ ...block, id: String(index) }))}/><Button variant="outline" className="mt-3 w-full text-xs" onClick={() => openNew(starter)}>Review starter</Button></div>)}</CardContent></Card> : null}

    {draft ? <TemplateEditor draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={() => { setDraft(null); setEditingId(null); }} /> : null}

    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{templates.map((template) => <Card key={template.id} className="rounded-2xl bg-white/80 p-4"><CardHeader className="pb-2"><CardTitle className="text-base text-slate-700">{template.name}</CardTitle><p className="text-xs text-slate-500">{template.description || "No description"}</p><p className="text-[11px] text-slate-400">Updated {new Date(template.updatedAt).toLocaleString()}</p></CardHeader><CardContent><TemplateBlockList blocks={template.blocks}/><div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => setApplying(template)}>Apply</Button><Button variant="outline" onClick={() => openEdit(template)}>Edit</Button><Button variant="outline" onClick={() => duplicate(template)}>Duplicate</Button><Button variant="outline" className="text-red-600" onClick={() => remove(template)}>Delete</Button></div></CardContent></Card>)}</div>

    {applying ? <ApplyTemplatePanel template={applying} availability={availability} overrides={overrides} onApply={(preview) => {
      setAvailability((current) => applyTemplatePreview(current, preview));
      setMessage(`Created ${preview.blocksToCreate.length} block(s), skipped ${preview.skippedDuplicates} duplicate(s), failed 0.`);
      setApplying(null);
    }} onCancel={() => setApplying(null)} /> : null}
  </section>;
}

function TemplateBlockList({ blocks }: { blocks: AvailabilityTemplateBlock[] }) {
  const ordered = [...blocks].sort((a, b) => a.startTime.localeCompare(b.startTime));
  return ordered.length === 0 ? <p className="text-xs text-slate-400">No blocks yet</p> : <ol className="space-y-1">{ordered.map((block) => <li key={block.id} className="rounded-lg bg-slate-50 p-2 text-xs"><div>{block.startTime}–{block.endTime}</div><div className="font-medium">{block.name} · {TYPES.find((item) => item.value === block.type)?.label}</div></li>)}</ol>;
}

function TemplateEditor({ draft, setDraft, onSave, onCancel }: { draft: TemplateDraft; setDraft: Dispatch<SetStateAction<TemplateDraft | null>>; onSave: () => void; onCancel: () => void }) {
  const updateBlock = (id: string, changes: Partial<AvailabilityTemplateBlock>) => setDraft((current) => current ? { ...current, blocks: current.blocks.map((block) => block.id === id ? { ...block, ...changes } : block) } : current);
  const move = (index: number, amount: number) => setDraft((current) => {
    if (!current) return current;
    const target = index + amount;
    if (target < 0 || target >= current.blocks.length) return current;
    const blocks = [...current.blocks];
    [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
    return { ...current, blocks };
  });
  return <Card className="rounded-2xl bg-white/90 p-4"><CardHeader><CardTitle className="text-base">Template editor</CardTitle></CardHeader><CardContent className="space-y-3"><div className="grid gap-3 md:grid-cols-2"><label className="text-xs">Template name<Input value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)}/></label><label className="text-xs">Description<Input value={draft.description} onChange={(event) => setDraft((current) => current ? { ...current, description: event.target.value } : current)}/></label></div>{draft.blocks.map((block, index) => <div key={block.id} className="grid gap-2 rounded-xl border p-3 md:grid-cols-[1fr_150px_130px_130px_auto]"><Input aria-label="Block name" value={block.name} onChange={(event) => updateBlock(block.id, { name: event.target.value })}/><select aria-label="Block type" className="h-10 rounded-md border px-2" value={block.type} onChange={(event) => updateBlock(block.id, { type: event.target.value as AvailabilityType })}>{TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><Input aria-label="Start time" type="time" value={block.startTime} onChange={(event) => updateBlock(block.id, { startTime: event.target.value })}/><Input aria-label="End time" type="time" value={block.endTime} onChange={(event) => updateBlock(block.id, { endTime: event.target.value })}/><div className="flex gap-1"><Button variant="outline" aria-label="Move block up" disabled={index === 0} onClick={() => move(index, -1)}>↑</Button><Button variant="outline" aria-label="Move block down" disabled={index === draft.blocks.length - 1} onClick={() => move(index, 1)}>↓</Button><Button variant="outline" className="text-red-600" onClick={() => setDraft((current) => current ? { ...current, blocks: current.blocks.filter((item) => item.id !== block.id) } : current)}>Remove</Button></div></div>)}<div className="flex flex-wrap gap-2"><Button onClick={() => setDraft((current) => current ? { ...current, blocks: [...current.blocks, blankBlock()] } : current)}>Add block</Button><Button onClick={onSave}>Save</Button><Button variant="outline" onClick={onCancel}>Cancel</Button></div></CardContent></Card>;
}

function ApplyTemplatePanel({ template, availability, overrides, onApply, onCancel }: { template: AvailabilityTemplate; availability: AvailabilityBlock[]; overrides: AvailabilityOverride[]; onApply: (preview: TemplateApplyPreview) => void; onCancel: () => void }) {
  const today = localDateFromDate(new Date());
  const [kind, setKind] = useState<"dates" | "range" | "recurring">("dates");
  const [dateInput, setDateInput] = useState(today);
  const [dates, setDates] = useState<string[]>([]);
  const [rangeStart, setRangeStart] = useState(today);
  const [rangeEnd, setRangeEnd] = useState(today);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [mode, setMode] = useState<"missing" | "replace">("missing");
  const [preview, setPreview] = useState<TemplateApplyPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggleDay = (day: number) => { setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day]); setPreview(null); };
  const buildPreview = () => {
    try {
      const next = kind === "recurring"
        ? previewTemplateAsRecurring(template, weekdays, availability)
        : previewTemplateForDates(template, kind === "range" ? datesInRange(rangeStart, rangeEnd, weekdays) : dates, availability, overrides, mode);
      setPreview(next); setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Preview could not be created."); }
  };
  return <Card className="rounded-2xl bg-white/95 p-4 ring-1 ring-pink-200"><CardHeader><CardTitle className="text-base">Apply {template.name}</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2">{(["dates", "range", "recurring"] as const).map((value) => <Button key={value} variant={kind === value ? "default" : "outline"} onClick={() => { setKind(value); setPreview(null); }}>{value === "dates" ? "Specific dates" : value === "range" ? "Date range" : "Repeat weekly"}</Button>)}</div>{kind === "dates" ? <div className="flex flex-wrap items-end gap-2"><label className="text-xs">Destination date<Input type="date" value={dateInput} onChange={(event) => setDateInput(event.target.value)}/></label><Button onClick={() => { setDates((current) => current.includes(dateInput) ? current : [...current, dateInput]); setPreview(null); }}>Add date</Button><div className="text-xs">{dates.map((date) => <Button key={date} variant="outline" className="mr-1" onClick={() => setDates((current) => current.filter((item) => item !== date))}>{date} ×</Button>)}</div></div> : null}{kind === "range" ? <div className="grid gap-2 md:grid-cols-2"><label className="text-xs">Start date<Input type="date" value={rangeStart} onChange={(event) => { setRangeStart(event.target.value); setPreview(null); }}/></label><label className="text-xs">End date<Input type="date" value={rangeEnd} onChange={(event) => { setRangeEnd(event.target.value); setPreview(null); }}/></label></div> : null}{kind !== "dates" ? <fieldset><legend className="text-xs">Weekdays {kind === "range" ? "(leave empty for every day)" : ""}</legend><div className="flex flex-wrap gap-2">{WEEKDAYS.map((label, day) => <label key={label} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={weekdays.includes(day)} onChange={() => toggleDay(day)}/>{label}</label>)}</div></fieldset> : null}{kind !== "recurring" ? <fieldset><legend className="text-xs">Existing date-specific blocks</legend><label className="mr-3 text-sm"><input type="radio" checked={mode === "missing"} onChange={() => { setMode("missing"); setPreview(null); }}/> Add only missing blocks</label><label className="text-sm"><input type="radio" checked={mode === "replace"} onChange={() => { setMode("replace"); setPreview(null); }}/> Replace date-specific blocks</label><p className="text-xs text-slate-500">Recurring blocks are always preserved.</p></fieldset> : null}<div className="flex gap-2"><Button variant="outline" onClick={buildPreview}>Preview</Button><Button variant="outline" onClick={onCancel}>Cancel</Button></div>{error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}{preview ? <div className="rounded-xl bg-pink-50 p-3 text-sm"><p>{preview.affectedDates.length || weekdays.length} destination(s), {preview.blocksToCreate.length} block(s) to create, {preview.skippedDuplicates} duplicate(s) skipped.</p>{preview.dateSpecificBlockIdsToRemove.length ? <p>{preview.dateSpecificBlockIdsToRemove.length} date-specific block(s) will be replaced.</p> : null}{preview.largeRangeWarning ? <p className="font-semibold text-amber-700">{preview.largeRangeWarning}</p> : null}{preview.warnings.map((warning) => <p key={warning} className="text-amber-700">{warning}</p>)}<TemplateBlockList blocks={preview.blocksToCreate.map((block) => ({ id: block.id, name: `${block.date ?? WEEKDAYS[block.dayOfWeek ?? 0]} · ${block.name}`, startTime: block.startTime, endTime: block.endTime, type: block.type }))}/><Button className="mt-3" onClick={() => { if (window.confirm(`Create ${preview.blocksToCreate.length} block(s) and skip ${preview.skippedDuplicates} duplicate(s)?`)) onApply(preview); }}>Confirm and apply</Button></div> : null}</CardContent></Card>;
}
