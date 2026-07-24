import { useMemo, useState } from "react";
import { Bot, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AI_LIMITS,
  LocalPlanningAssistantProvider,
  applyAssistantProposal,
  buildSanitizedPrompt,
  plannerVersion,
  runDeterministicScheduleProposal,
  trimConversation,
  type AIAssistantActionAudit,
  type AIAssistantSettings,
  type AssistantConversationMessage,
  type AssistantPlannerState,
  type SanitizedAssistantPrompt,
} from "@/lib/planningAssistant";
import type { TaskRecord } from "@/lib/taskHistory";
import type { TaskSession } from "@/lib/taskSessions";
import type { Reminder } from "@/lib/notifications";

const provider = new LocalPlanningAssistantProvider();
const SUGGESTIONS = ["What should I focus on today?", "Review this week", "Explain my highest-risk task", "Which tasks have no estimates?", "Break down a large task"];
const ASSISTANT_DRAFT_KEY = "planner_ai_assistant_draft_v1";

export function PlanningAssistantPage({
  settings, setSettings, messages, setMessages, audits, setAudits, plannerState, setTasks, setSessions, setReminders,
  onOpenPlanning,
}: {
  settings: AIAssistantSettings; setSettings: React.Dispatch<React.SetStateAction<AIAssistantSettings>>;
  messages: AssistantConversationMessage[]; setMessages: React.Dispatch<React.SetStateAction<AssistantConversationMessage[]>>;
  audits: AIAssistantActionAudit[]; setAudits: React.Dispatch<React.SetStateAction<AIAssistantActionAudit[]>>;
  plannerState: AssistantPlannerState; setTasks: React.Dispatch<React.SetStateAction<TaskRecord[]>>;
  setSessions: React.Dispatch<React.SetStateAction<TaskSession[]>>; setReminders: React.Dispatch<React.SetStateAction<Reminder[]>>;
  onOpenPlanning: () => void;
}) {
  const [draft, setDraft] = useState(() => localStorage.getItem(ASSISTANT_DRAFT_KEY) ?? "");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [activePrompt, setActivePrompt] = useState<SanitizedAssistantPrompt | null>(null);
  const [selectedActions, setSelectedActions] = useState<number[]>([]);
  const activeResponse = [...messages].reverse().find((item) => item.response?.proposal)?.response;
  const visibleMessages = useMemo(() => messages.slice(-settings.maximumHistoryMessages), [messages, settings.maximumHistoryMessages]);

  const updateSettings = (patch: Partial<AIAssistantSettings>) => setSettings((current) => ({ ...current, ...patch, confirmationRequiredForAllChanges: true, updatedAt: new Date().toISOString(), createdAt: current.createdAt === "1970-01-01T00:00:00.000Z" ? new Date().toISOString() : current.createdAt }));
  const send = async (text = draft) => {
    if (pending) return;
    setError("");
    if (!navigator.onLine) { setError("AI assistance requires an internet connection. Your draft was not queued."); return; }
    try {
      setPending(true);
      const current = { ...plannerState, selectedTaskId: selectedTaskId || undefined, plannerVersion: plannerVersion(plannerState) };
      const { request, prompt } = buildSanitizedPrompt(text, settings, current);
      setActivePrompt(prompt);
      const userMessage: AssistantConversationMessage = { id: `message-${request.id}`, role: "user", text, request: settings.conversationHistoryEnabled ? request : undefined, createdAt: request.createdAt };
      const result = await provider.generateResponse(prompt);
      const scheduleAction = result.response.proposal?.actions.find((action) => action.type === "create-schedule-preview");
      if (scheduleAction?.type === "create-schedule-preview") {
        const preview = runDeterministicScheduleProposal(prompt, current, scheduleAction);
        const planned = preview.proposedBlocks.reduce((sum, block) => sum + block.durationMinutes, 0);
        const unscheduled = preview.unscheduledWork.reduce((sum, item) => sum + item.remainingMinutes, 0);
        result.response.message += ` Planner-calculated preview: ${preview.proposedBlocks.length} block${preview.proposedBlocks.length === 1 ? "" : "s"}, ${planned} minutes planned, ${unscheduled} minutes unscheduled.`;
        result.response.proposal!.warnings.push(...preview.warnings, ...preview.unscheduledWork.map((item) => item.reason));
      }
      if (result.response.proposal) result.response.proposal.basedOnPlannerVersion = current.plannerVersion;
      const assistantMessage: AssistantConversationMessage = { id: `message-${result.response.id}`, role: "assistant", text: result.response.message, response: result.response, createdAt: result.response.createdAt };
      const next = [...messages, userMessage, assistantMessage];
      setMessages(settings.conversationHistoryEnabled ? trimConversation(next, settings) : [userMessage, assistantMessage]);
      setSelectedActions(result.response.proposal?.actions.map((_, index) => index) ?? []);
      setDraft(""); localStorage.removeItem(ASSISTANT_DRAFT_KEY);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The assistant could not prepare a response."); }
    finally { setPending(false); }
  };
  const applyProposal = () => {
    if (!activeResponse?.proposal || !activePrompt) return;
    if (activeResponse.proposal.actions.some((action, index) => selectedActions.includes(index) && action.type === "create-schedule-preview")) {
      onOpenPlanning();
      return;
    }
    try {
      const result = applyAssistantProposal(activeResponse.proposal, selectedActions, activePrompt.aliasMap, { tasks: plannerState.tasks, sessions: plannerState.sessions, reminders: plannerState.reminders }, plannerVersion(plannerState), activeResponse.requestId, activeResponse.id);
      setTasks(result.state.tasks); setSessions(result.state.sessions); setReminders(result.state.reminders); setAudits((current) => [...current, ...result.audits]);
      setMessages((current) => current.map((item) => item.response?.id === activeResponse.id ? { ...item, response: { ...item.response, proposal: result.proposal }, text: result.proposal.status === "applied" ? "The selected changes were applied through the planner’s existing validation." : "Some selected changes could not be applied. Review the action results." } : item));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The proposal could not be applied."); }
  };

  if (!settings.isEnabled) return <div className="grid gap-5 p-4 lg:grid-cols-[1.2fr_1fr]">
    <Card className="border-pink-100 bg-white/90 p-4"><CardHeader><CardTitle className="flex items-center gap-2"><Bot aria-hidden="true" />Planning assistant</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-slate-600">AI assistance is off. No planner data is shared until you explicitly enable it and choose the data categories below.</p>
      <p className="text-sm text-slate-600">This build uses a local deterministic planning provider. A production language model requires a secure authenticated server endpoint; no provider secret belongs in this browser.</p>
      <Button onClick={() => updateSettings({ isEnabled: true, allowTaskTitles: true, allowDeadlineData: true, allowEstimateData: true, allowAvailabilityData: true, allowRiskSummary: true })}>Enable planning assistant</Button>
    </CardContent></Card>
    <PermissionSettings settings={settings} updateSettings={updateSettings} disabled />
  </div>;

  return <div className="grid gap-5 p-4 xl:grid-cols-[1.5fr_1fr]">
    <Card className="border-pink-100 bg-white/90 p-4"><CardHeader><CardTitle className="flex items-center gap-2"><Bot aria-hidden="true" />Planning assistant <span className="text-xs font-normal text-slate-500">AI-assisted · changes require review</span></CardTitle></CardHeader><CardContent>
      <div className="mb-4 flex flex-wrap gap-2">{SUGGESTIONS.map((item) => <Button key={item} variant="outline" onClick={() => { setDraft(item); localStorage.setItem(ASSISTANT_DRAFT_KEY, item); }}>{item}</Button>)}</div>
      <label className="mb-3 block text-sm">Discuss a specific task<select className="mt-1 w-full rounded-md border p-2" value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)}><option value="">No task selected</option>{plannerState.tasks.filter((task) => task.status !== "archived").map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
      <div className="max-h-[32rem] space-y-3 overflow-auto rounded-xl bg-slate-50 p-3" aria-live="polite">
        {visibleMessages.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">Ask a planning question. Nothing changes unless you review and apply a structured proposal.</p> : visibleMessages.map((item) => <div key={item.id} className={`rounded-xl p-3 text-sm ${item.role === "user" ? "ml-8 bg-pink-50" : "mr-8 border bg-white"}`}>
          <div className="mb-1 text-xs font-semibold text-slate-500">{item.role === "user" ? "You" : "AI-assisted explanation"}</div>
          <p className="whitespace-pre-wrap text-slate-700">{item.text}</p>
          {item.response?.citations.length ? <details className="mt-2"><summary className="cursor-pointer text-xs font-medium">Planner citations ({item.response.citations.length})</summary><ul className="mt-1 space-y-1">{item.response.citations.map((citation, index) => <li key={`${citation.label}-${index}`} className="text-xs text-slate-600"><strong>{citation.label}</strong>{citation.detail ? ` — ${citation.detail}` : ""}</li>)}</ul></details> : null}
          {item.response?.limitations.length ? <p className="mt-2 text-xs text-slate-500">{item.response.limitations.join(" ")}</p> : null}
        </div>)}
      </div>
      <label className="mt-4 block text-sm">Planning question<Input value={draft} maxLength={AI_LIMITS.messageCharacters} onChange={(event) => { setDraft(event.target.value); localStorage.setItem(ASSISTANT_DRAFT_KEY, event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask about today, workload, risk, estimates, or task breakdown…" /></label>
      <div className="mt-1 text-right text-xs text-slate-500">{draft.length}/{AI_LIMITS.messageCharacters}</div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
      <Button className="mt-3" disabled={pending || !draft.trim()} onClick={() => void send()}>{pending ? "Preparing response…" : "Ask assistant"}</Button>

      {activeResponse?.proposal && !["applied", "rejected"].includes(activeResponse.proposal.status) ? <div className="mt-5 rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
        <h3 className="font-semibold">Review proposed changes</h3><p className="mt-1 text-sm">{activeResponse.proposal.summary}</p>
        <div className="mt-3 space-y-2">{activeResponse.proposal.actions.map((action, index) => <label key={index} className="flex items-start gap-2 rounded-lg bg-white p-3 text-sm"><input type="checkbox" checked={selectedActions.includes(index)} onChange={(event) => setSelectedActions((current) => event.target.checked ? [...new Set([...current, index])] : current.filter((item) => item !== index))} /><span><strong>{action.type.replaceAll("-", " ")}</strong><br />{action.type === "create-session" ? `${action.sessions.length} sessions · ${action.totalEstimatedMinutes} min` : action.type === "create-task" ? action.title : "Review this action before applying."}</span></label>)}</div>
        {activeResponse.proposal.assumptions.length ? <p className="mt-2 text-xs text-slate-600">Assumptions: {activeResponse.proposal.assumptions.join(" ")}</p> : null}
        <div className="mt-3 flex gap-2"><Button onClick={applyProposal} disabled={!selectedActions.length}>{activeResponse.proposal.actions.some((action, index) => selectedActions.includes(index) && action.type === "create-schedule-preview") ? "Open scheduling preview" : "Apply selected changes"}</Button><Button variant="outline" onClick={() => setMessages((current) => current.map((item) => item.response?.id === activeResponse.id ? { ...item, response: { ...item.response, proposal: { ...activeResponse.proposal!, status: "rejected", updatedAt: new Date().toISOString() } } } : item))}>Reject proposal</Button></div>
      </div> : null}
    </CardContent></Card>
    <div className="space-y-5">
      <PermissionSettings settings={settings} updateSettings={updateSettings} />
      <Card className="border-pink-100 bg-white/90 p-4"><CardHeader><CardTitle className="text-lg">History and audit</CardTitle></CardHeader><CardContent className="space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm">Save conversation history<input type="checkbox" checked={settings.conversationHistoryEnabled} onChange={(event) => updateSettings({ conversationHistoryEnabled: event.target.checked })} /></label>
        <label className="block text-sm">Maximum messages<Input type="number" min={1} max={50} value={settings.maximumHistoryMessages} onChange={(event) => updateSettings({ maximumHistoryMessages: Math.min(50, Math.max(1, Number(event.target.value) || 20)) })} /></label>
        <Button variant="outline" onClick={() => { if (window.confirm("Delete AI conversation history? Applied planner changes and action audits will remain.")) setMessages([]); }}><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Delete conversation history</Button>
        <div className="text-xs text-slate-500">{audits.length} action audit record{audits.length === 1 ? "" : "s"}. Audits contain concise results, not hidden reasoning.</div>
      </CardContent></Card>
    </div>
  </div>;
}

function PermissionSettings({ settings, updateSettings, disabled = false }: { settings: AIAssistantSettings; updateSettings: (patch: Partial<AIAssistantSettings>) => void; disabled?: boolean }) {
  const options: Array<[keyof AIAssistantSettings, string]> = [
    ["allowTaskTitles", "Task titles"], ["allowTaskDescriptions", "Task descriptions"], ["allowTaskNotes", "Task notes"],
    ["allowCategoryNames", "Category names"], ["allowDeadlineData", "Deadlines"], ["allowEstimateData", "Estimates"],
    ["allowScheduleData", "Schedule"], ["allowAvailabilityData", "Availability"], ["allowTimeTrackingData", "Time tracking"],
    ["allowAnalyticsSummary", "Analytics summaries"], ["allowRiskSummary", "Risk summaries"], ["allowCalendarEventTitles", "Google Calendar titles"],
  ];
  return <Card className="border-pink-100 bg-white/90 p-4"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck aria-hidden="true" />Data permissions</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-xs text-slate-500">Only selected categories enter the minimized assistant context. Calendar descriptions, attendees, tokens, and raw internal IDs are always excluded.</p>
    {options.map(([key, label]) => <label key={key} className="flex items-center justify-between gap-3 text-sm">{label}<input disabled={disabled} type="checkbox" checked={Boolean(settings[key])} onChange={(event) => updateSettings({ [key]: event.target.checked })} /></label>)}
    {!disabled ? <Button variant="outline" onClick={() => updateSettings({ isEnabled: false })}>Disable AI assistance</Button> : null}
  </CardContent></Card>;
}
