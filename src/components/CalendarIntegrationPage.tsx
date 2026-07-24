import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  GOOGLE_READ_SCOPE,
  GOOGLE_WRITE_SCOPE,
  calendarFetchRange,
  deletePublishedEvent,
  detachSyncRecord,
  eventDisplayTitle,
  fetchGoogleCalendars,
  fetchGoogleEvents,
  publishScheduleBlock,
  reconcileSyncRecords,
  updatePublishedEvent,
  type CalendarConnection,
  type CalendarSyncRecord,
  type CalendarSyncSettings,
  type ExternalCalendar,
  type ExternalCalendarEvent,
} from "@/lib/calendarIntegration";
import { localDateFromDate, localDateToDate } from "@/lib/localDateTime";
import type { ScheduleBlock } from "@/lib/scheduleBlocks";
import type { TaskRecord } from "@/lib/taskHistory";

interface TokenResponse { access_token?: string; error?: string; scope?: string }
interface TokenClient { requestAccessToken(options?: { prompt?: string }): void }

export function ExternalCalendarSummary({ events, settings, calendars }: {
  events: ExternalCalendarEvent[]; settings: CalendarSyncSettings; calendars: ExternalCalendar[];
}) {
  const today = localDateFromDate(new Date());
  const end = new Date(); end.setDate(end.getDate() + 6);
  const endDate = localDateFromDate(end);
  const visible = events.filter((event) => {
    const date = event.startDate ?? (event.startDateTime ? localDateFromDate(new Date(event.startDateTime)) : "");
    return date >= today && date <= endDate && event.status !== "cancelled";
  }).slice(0, 8);
  if (!settings.showExternalEventsInPlanner || !visible.length) return null;
  return <Card className="mb-4 border-blue-100 bg-white/85 p-4">
    <CardContent className="pt-4">
      <div className="mb-2 flex items-center justify-between gap-2"><div className="text-sm font-semibold text-slate-700">Google Calendar · next 7 days</div><div className="text-xs text-slate-500">External events are read-only</div></div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {visible.map((event) => <li key={event.id} className="rounded-lg border border-blue-100 bg-blue-50/60 p-2 text-xs">
          <div className="font-medium text-slate-700">{eventDisplayTitle(event, settings, calendars)}</div>
          <div className="text-slate-500">{event.isAllDay ? `${event.startDate} · All-day` : event.startDateTime ? new Date(event.startDateTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}</div>
        </li>)}
      </ul>
    </CardContent>
  </Card>;
}

export function CalendarIntegrationPage({
  clientId, connection, setConnection, calendars, setCalendars, events, setEvents, settings, setSettings,
  records, setRecords, scheduleBlocks, tasks, online,
}: {
  clientId: string; connection: CalendarConnection; setConnection: React.Dispatch<React.SetStateAction<CalendarConnection>>;
  calendars: ExternalCalendar[]; setCalendars: React.Dispatch<React.SetStateAction<ExternalCalendar[]>>;
  events: ExternalCalendarEvent[]; setEvents: React.Dispatch<React.SetStateAction<ExternalCalendarEvent[]>>;
  settings: CalendarSyncSettings; setSettings: React.Dispatch<React.SetStateAction<CalendarSyncSettings>>;
  records: CalendarSyncRecord[]; setRecords: React.Dispatch<React.SetStateAction<CalendarSyncRecord[]>>;
  scheduleBlocks: ScheduleBlock[]; tasks: TaskRecord[]; online: boolean;
}) {
  const [readToken, setReadToken] = useState<string | null>(null);
  const [writeToken, setWriteToken] = useState<string | null>(null);
  const [readClient, setReadClient] = useState<TokenClient | null>(null);
  const [writeClient, setWriteClient] = useState<TokenClient | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const syncPromise = useRef<Promise<void> | null>(null);
  const activeBlocks = useMemo(() => {
    const today = localDateFromDate(new Date());
    return scheduleBlocks.filter((block) => block.status === "confirmed" && block.date >= today);
  }, [scheduleBlocks]);
  const linkedIds = useMemo(() => new Set(records.filter((item) => item.status !== "detached").map((item) => item.scheduleBlockId)), [records]);

  useEffect(() => {
    if (!clientId) return;
    let attempts = 0;
    const initialize = () => {
      const oauth = window.google?.accounts?.oauth2;
      if (!oauth) return false;
      setReadClient(oauth.initTokenClient({ client_id: clientId, scope: GOOGLE_READ_SCOPE, callback: (response: TokenResponse) => {
        if (!response.access_token) { setConnection((current) => ({ ...current, status: "error", syncErrorMessage: "Google authorization was cancelled.", updatedAt: new Date().toISOString() })); return; }
        setReadToken(response.access_token);
        const now = new Date().toISOString();
        setConnection((current) => ({ ...current, status: "connected-readonly", grantedScopes: [GOOGLE_READ_SCOPE], syncErrorMessage: undefined, updatedAt: now, createdAt: current.createdAt === "1970-01-01T00:00:00.000Z" ? now : current.createdAt }));
      } }));
      setWriteClient(oauth.initTokenClient({ client_id: clientId, scope: `${GOOGLE_READ_SCOPE} ${GOOGLE_WRITE_SCOPE}`, callback: (response: TokenResponse) => {
        if (!response.access_token) { setMessage("Write permission was not granted. Read-only calendar access remains available."); return; }
        setReadToken(response.access_token); setWriteToken(response.access_token);
        setConnection((current) => ({ ...current, status: "connected-write", grantedScopes: [GOOGLE_READ_SCOPE, GOOGLE_WRITE_SCOPE], updatedAt: new Date().toISOString() }));
        setSettings((current) => ({ ...current, publishPlannerBlocks: true, updatedAt: new Date().toISOString() }));
      } }));
      return true;
    };
    if (initialize()) return;
    const timer = window.setInterval(() => { attempts += 1; if (initialize() || attempts >= 50) window.clearInterval(timer); }, 200);
    return () => window.clearInterval(timer);
  }, [clientId, setConnection, setSettings]);

  const refresh = async () => {
    if (!readToken || !online) { setMessage(online ? "Reconnect Google Calendar before refreshing." : "You are offline. Cached calendar events remain visible."); return; }
    if (syncPromise.current) return syncPromise.current;
    const operation = (async () => {
      setBusy(true); setMessage("");
      const attemptedAt = new Date().toISOString();
      setConnection((current) => ({ ...current, lastAttemptedSyncAt: attemptedAt, updatedAt: attemptedAt }));
      try {
        const loadedCalendars = await fetchGoogleCalendars(readToken);
        const selected = settings.selectedCalendarIds.length
          ? settings.selectedCalendarIds.filter((id) => loadedCalendars.some((item) => item.id === id))
          : loadedCalendars.filter((item) => item.isPrimary).map((item) => item.id);
        const range = calendarFetchRange(localDateFromDate(new Date()));
        const rangeStart = localDateToDate(range.startDate); rangeStart.setHours(0, 0, 0, 0);
        const rangeEnd = localDateToDate(range.endDate); rangeEnd.setHours(23, 59, 59, 999);
        const loadedEvents = selected.length ? await fetchGoogleEvents(readToken, selected, rangeStart.toISOString(), rangeEnd.toISOString(), attemptedAt) : [];
        setCalendars(loadedCalendars.map((item) => ({ ...item, isSelected: selected.includes(item.id) })));
        setEvents(loadedEvents.filter((item) => item.status !== "cancelled"));
        setSettings((current) => ({ ...current, selectedCalendarIds: selected, updatedAt: attemptedAt }));
        setConnection((current) => ({ ...current, googleAccountEmail: loadedCalendars.find((item) => item.isPrimary)?.id, selectedCalendarIds: selected, lastSuccessfulSyncAt: attemptedAt, syncErrorCode: undefined, syncErrorMessage: undefined, updatedAt: attemptedAt }));
        setRecords((current) => reconcileSyncRecords(current, scheduleBlocks, loadedEvents, attemptedAt));
        setMessage(`Synced ${loadedEvents.length} event${loadedEvents.length === 1 ? "" : "s"} from ${selected.length} calendar${selected.length === 1 ? "" : "s"}.`);
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String(error.code) : "calendar-sync";
        const text = error instanceof Error ? error.message : "Google Calendar could not be refreshed.";
        setConnection((current) => ({ ...current, status: code === "401" ? "reauthorization-required" : "error", lastAttemptedSyncAt: attemptedAt, syncErrorCode: code, syncErrorMessage: text, updatedAt: attemptedAt }));
        setMessage(text);
      } finally { setBusy(false); syncPromise.current = null; }
    })();
    syncPromise.current = operation;
    return operation;
  };

  useEffect(() => {
    if (readToken && settings.syncOnAppOpen && !connection.lastSuccessfulSyncAt) void refresh();
    // Refresh is intentionally event-driven; it is not tied to timer ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readToken]);

  const updateSettings = (patch: Partial<CalendarSyncSettings>) => setSettings((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));
  const selectCalendar = (calendar: ExternalCalendar, selected: boolean) => {
    const ids = selected ? [...new Set([...settings.selectedCalendarIds, calendar.id])] : settings.selectedCalendarIds.filter((id) => id !== calendar.id);
    updateSettings({ selectedCalendarIds: ids });
    setCalendars((current) => current.map((item) => item.id === calendar.id ? { ...item, isSelected: selected } : item));
  };
  const publish = async (block: ScheduleBlock) => {
    if (!writeToken || !settings.publishCalendarId || !online) { setMessage(!online ? "Publishing is unavailable offline." : "Enable write access and choose a writable calendar first."); return; }
    if (!window.confirm(`Add “${block.title}” on ${block.date}, ${block.startTime}–${block.endTime} to ${calendars.find((item) => item.id === settings.publishCalendarId)?.name ?? "Google Calendar"}?`)) return;
    setBusy(true);
    try {
      const parent = tasks.find((item) => item.id === block.taskId);
      const result = await publishScheduleBlock(writeToken, settings.publishCalendarId, block, records, new Date().toISOString(), parent?.title);
      setRecords((current) => result.created ? [...current.filter((item) => item.id !== result.record.id), result.record] : current);
      setMessage(result.created ? "The confirmed session was added to Google Calendar." : "This session is already linked to Google Calendar.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The event could not be published."); }
    finally { setBusy(false); }
  };
  const updateLink = async (record: CalendarSyncRecord) => {
    const linkedBlock = scheduleBlocks.find((item) => item.id === record.scheduleBlockId);
    if (!linkedBlock || !writeToken) { setMessage("Reconnect with write access before updating this event."); return; }
    if (!window.confirm(`Update the linked Google event to ${linkedBlock.date}, ${linkedBlock.startTime}–${linkedBlock.endTime}?`)) return;
    try {
      const updated = await updatePublishedEvent(writeToken, linkedBlock, record, new Date().toISOString(), tasks.find((item) => item.id === linkedBlock.taskId)?.title);
      setRecords((current) => current.map((item) => item.id === record.id ? updated : item)); setMessage("Google Calendar was updated after confirmation.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The linked event could not be updated."); }
  };
  const deleteLink = async (record: CalendarSyncRecord) => {
    if (!writeToken) { setMessage("Reconnect with write access before removing the Google event."); return; }
    if (!window.confirm("Delete only this planner-created event from Google Calendar? The planner schedule block will remain.")) return;
    try { const updated = await deletePublishedEvent(writeToken, record, new Date().toISOString()); setRecords((current) => current.map((item) => item.id === record.id ? updated : item)); setMessage("Google event removed; planner schedule preserved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The linked event could not be removed."); }
  };
  const disconnect = () => {
    if (!window.confirm("Disconnect Google Calendar and keep planner-created Google events? Planner tasks and schedule blocks will remain.")) return;
    const now = new Date().toISOString();
    setReadToken(null); setWriteToken(null); setEvents([]); setCalendars([]);
    setRecords((current) => current.map((item) => ({ ...item, status: "detached", updatedAt: now })));
    setConnection({ schemaVersion: 1, provider: "google", status: "disconnected", grantedScopes: [], selectedCalendarIds: [], createdAt: connection.createdAt, updatedAt: now });
    setSettings((current) => ({ ...current, publishPlannerBlocks: false, updatedAt: now }));
    setMessage("Google Calendar disconnected. Existing Google events were kept.");
  };

  if (connection.status === "disconnected" || connection.status === "connecting" || connection.status === "error" || connection.status === "reauthorization-required") return <Card className="border-pink-100 bg-white/90 p-4">
    <CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays aria-hidden="true" />Google Calendar</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-slate-600">Connect with read-only permission to view selected calendars and treat busy events as unavailable time. No planner events will be created or changed.</p>
      <p className="text-xs text-slate-500">Access tokens remain in memory and are not written to local storage, Firestore, backups, logs, or the interface. Reauthorization is required after a refresh or token expiry.</p>
      {!clientId ? <p role="alert" className="text-sm text-red-700">Google Calendar is not configured. Add VITE_GOOGLE_CLIENT_ID to enable connection.</p> :
        <Button disabled={!readClient || connection.status === "connecting"} onClick={() => { setConnection((current) => ({ ...current, status: "connecting", updatedAt: new Date().toISOString() })); readClient?.requestAccessToken({ prompt: "consent" }); }}>{connection.status === "connecting" ? "Connecting…" : "Connect Google Calendar read-only"}</Button>}
      {connection.syncErrorMessage ? <p role="alert" className="text-sm text-red-700">{connection.syncErrorMessage}</p> : null}
    </CardContent>
  </Card>;

  return <div className="space-y-5 p-4">
    <Card className="border-pink-100 bg-white/90 p-4">
      <CardHeader><CardTitle>Google Calendar connection</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">{connection.status === "connected-write" ? "Connected · publishing enabled" : "Connected · read-only"}</span><span>{connection.googleAccountEmail}</span></div>
        <p className="text-xs text-slate-500">Events are cached from 30 days ago through 90 days ahead. Sync occurs on connection and manual refresh; calendar data may be outdated while offline or after access expires.</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !online} onClick={() => void refresh()}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />{busy ? "Syncing" : "Refresh"}</Button><Button variant="outline" onClick={disconnect}>Disconnect and keep Google events</Button></div>
        <div role="status" aria-live="polite" className="text-sm text-slate-600">{message || (connection.lastSuccessfulSyncAt ? `Last synced ${new Date(connection.lastSuccessfulSyncAt).toLocaleString()}` : "Not synced yet")}</div>
      </CardContent>
    </Card>

    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="border-pink-100 bg-white/90 p-4"><CardHeader><CardTitle className="text-lg">Visible calendars</CardTitle></CardHeader><CardContent className="space-y-3">
        {calendars.map((calendar) => <div key={calendar.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.selectedCalendarIds.includes(calendar.id)} onChange={(event) => selectCalendar(calendar, event.target.checked)} /><span>{calendar.name}{calendar.isPrimary ? " · Primary" : ""}</span></label>
          <span className="text-xs text-slate-500">{calendar.isReadOnly ? "Read-only" : "Writable"}</span>
        </div>)}
        <label className="flex items-center justify-between gap-3 text-sm">Use selected events as busy time<input type="checkbox" checked={settings.useExternalEventsAsBusyTime} onChange={(event) => updateSettings({ useExternalEventsAsBusyTime: event.target.checked })} /></label>
        <label className="flex items-center justify-between gap-3 text-sm">Tentative events are busy<input type="checkbox" checked={settings.includeTentativeEventsAsBusy} onChange={(event) => updateSettings({ includeTentativeEventsAsBusy: event.target.checked })} /></label>
        <label className="flex items-center justify-between gap-3 text-sm">All-day events are busy<input type="checkbox" checked={settings.includeAllDayEventsAsBusy} onChange={(event) => updateSettings({ includeAllDayEventsAsBusy: event.target.checked })} /></label>
        <label className="flex items-center justify-between gap-3 text-sm">Transparent/free events are busy<input type="checkbox" checked={settings.includeTransparentEventsAsBusy} onChange={(event) => updateSettings({ includeTransparentEventsAsBusy: event.target.checked })} /></label>
        <label className="block text-sm">Event title privacy<select className="mt-1 w-full rounded-md border p-2" value={settings.eventTitleVisibility} onChange={(event) => updateSettings({ eventTitleVisibility: event.target.value as CalendarSyncSettings["eventTitleVisibility"] })}><option value="busy-only">Show “Busy” only</option><option value="busy-with-calendar">Show calendar name and “Busy”</option><option value="full">Show full event titles</option></select></label>
      </CardContent></Card>

      <Card className="border-pink-100 bg-white/90 p-4"><CardHeader><CardTitle className="text-lg">Planner publishing</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-sm text-slate-600">Publishing is off by default. Write permission is requested only from this button, and applies only to events explicitly published by you.</p>
        {connection.status !== "connected-write" ? <Button disabled={!writeClient} onClick={() => writeClient?.requestAccessToken({ prompt: "consent" })}>Enable planner publishing</Button> : <>
          <label className="block text-sm">Publish calendar<select className="mt-1 w-full rounded-md border p-2" value={settings.publishCalendarId ?? ""} onChange={(event) => updateSettings({ publishCalendarId: event.target.value || undefined })}><option value="">Choose a writable calendar</option>{calendars.filter((item) => !item.isReadOnly).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="max-h-72 space-y-2 overflow-auto">{activeBlocks.map((block) => <div key={block.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"><div><div className="font-medium">{block.title}</div><div className="text-slate-500">{block.date} · {block.startTime}–{block.endTime}</div></div>{linkedIds.has(block.id) ? <span className="text-emerald-700">Linked</span> : <Button disabled={busy} onClick={() => void publish(block)}>Add to Google Calendar</Button>}</div>)}</div>
          {records.filter((item) => item.status !== "detached").length ? <div className="border-t pt-3"><div className="mb-2 text-sm font-medium">Calendar links</div>{records.filter((item) => item.status !== "detached").map((record) => {
            const linkedBlock = scheduleBlocks.find((item) => item.id === record.scheduleBlockId);
            return <div key={record.id} className="mb-2 rounded-lg bg-slate-50 p-2 text-sm"><div className="flex items-center justify-between gap-2"><span>{linkedBlock?.title ?? "Removed planner block"} · {record.status}</span><div className="flex flex-wrap gap-1">{record.status === "pending-update" || record.status === "conflict" ? <Button variant="outline" onClick={() => void updateLink(record)}>Update Google</Button> : null}<Button variant="outline" onClick={() => setRecords((current) => current.map((item) => item.id === record.id ? detachSyncRecord(item) : item))}>Detach</Button><Button variant="outline" onClick={() => void deleteLink(record)}>Delete Google event</Button></div></div>{record.errorMessage ? <p className="mt-1 text-xs text-amber-700">{record.errorMessage}</p> : null}</div>;
          })}</div> : null}
        </>}
      </CardContent></Card>
    </div>

    <Card className="border-pink-100 bg-white/90 p-4"><CardHeader><CardTitle className="text-lg">External events</CardTitle></CardHeader><CardContent>
      {events.length === 0 ? <p className="text-sm text-slate-500">No cached events in the selected range.</p> : <div className="max-h-96 space-y-2 overflow-auto">
        {events.slice().sort((a, b) => (a.startDateTime ?? a.startDate ?? "").localeCompare(b.startDateTime ?? b.startDate ?? "")).slice(0, 250).map((event) => <div key={event.id} className="rounded-lg border p-3 text-sm">
          <div className="font-medium">{eventDisplayTitle(event, settings, calendars)}</div>
          <div className="text-slate-500">{event.isAllDay ? `${event.startDate} · All-day` : `${event.startDateTime ? new Date(event.startDateTime).toLocaleString() : ""}–${event.endDateTime ? new Date(event.endDateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}`} · Google Calendar{event.status === "tentative" ? " · Tentative" : ""}</div>
          {event.htmlLink ? <a className="mt-1 inline-flex items-center gap-1 text-pink-700 underline" href={event.htmlLink} target="_blank" rel="noreferrer">Open in Google Calendar <ExternalLink className="h-3 w-3" aria-hidden="true" /></a> : null}
        </div>)}
      </div>}
    </CardContent></Card>
  </div>;
}
