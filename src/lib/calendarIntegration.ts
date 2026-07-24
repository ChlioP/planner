import { addLocalDays, localDateFromDate, localDateToDate, timeToMinutes } from "./localDateTime";
import type { AvailabilityBlock } from "./availability";
import type { ScheduleBlock } from "./scheduleBlocks";

export const GOOGLE_READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_SCHEMA_VERSION = 1 as const;

export interface CalendarConnection {
  schemaVersion: 1; provider: "google"; userId?: string;
  status: "disconnected" | "connecting" | "connected-readonly" | "connected-write" | "reauthorization-required" | "error";
  googleAccountEmail?: string; grantedScopes: string[]; selectedCalendarIds: string[]; publishCalendarId?: string;
  lastSuccessfulSyncAt?: string; lastAttemptedSyncAt?: string; syncErrorCode?: string; syncErrorMessage?: string;
  createdAt: string; updatedAt: string;
}
export interface ExternalCalendar {
  id: string; provider: "google"; name: string; description?: string; isPrimary: boolean; isSelected: boolean;
  isReadOnly: boolean; backgroundColor?: string; foregroundColor?: string; accessRole?: string; timezone?: string;
}
export interface ExternalCalendarEvent {
  id: string; provider: "google"; calendarId: string; providerEventId: string; title: string; description?: string; location?: string;
  startDateTime?: string; endDateTime?: string; startDate?: string; endDate?: string; isAllDay: boolean;
  status: "confirmed" | "tentative" | "cancelled"; transparency: "opaque" | "transparent"; visibility?: string;
  recurrenceId?: string; recurringEventId?: string; organizerEmail?: string; isOrganizer?: boolean;
  updatedAtProvider?: string; etag?: string; htmlLink?: string;
  plannerLink?: { scheduleBlockId?: string; syncRecordId?: string }; fetchedAt: string;
}
export interface CalendarSyncSettings {
  schemaVersion: 1; id: "google"; userId?: string; readExternalEvents: boolean; useExternalEventsAsBusyTime: boolean;
  selectedCalendarIds: string[]; showExternalEventsInPlanner: boolean;
  eventTitleVisibility: "full" | "busy-with-calendar" | "busy-only";
  includeTentativeEventsAsBusy: boolean; includeAllDayEventsAsBusy: boolean; includeTransparentEventsAsBusy: boolean;
  publishPlannerBlocks: boolean; publishCalendarId?: string; defaultPublishMode: "manual" | "ask-after-confirmation";
  syncOnAppOpen: boolean; syncIntervalMinutes: number; conflictBehavior: "warn-only" | "block-new-scheduling";
  timezone?: string; createdAt: string; updatedAt: string;
}
export interface CalendarSyncRecord {
  schemaVersion: 1; id: string; userId?: string; provider: "google"; scheduleBlockId: string; calendarId: string;
  providerEventId: string; direction: "planner-to-google";
  status: "synced" | "pending-create" | "pending-update" | "pending-delete" | "conflict" | "error" | "detached";
  plannerVersion?: string; providerEtag?: string; lastPlannerUpdatedAt?: string; lastProviderUpdatedAt?: string;
  lastSyncedAt?: string; errorCode?: string; errorMessage?: string; createdAt: string; updatedAt: string;
}

export const DEFAULT_CALENDAR_CONNECTION: CalendarConnection = {
  schemaVersion: 1, provider: "google", status: "disconnected", grantedScopes: [], selectedCalendarIds: [],
  createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
};
export const DEFAULT_CALENDAR_SYNC_SETTINGS: CalendarSyncSettings = {
  schemaVersion: 1, id: "google", readExternalEvents: true, useExternalEventsAsBusyTime: true, selectedCalendarIds: [],
  showExternalEventsInPlanner: true, eventTitleVisibility: "busy-only", includeTentativeEventsAsBusy: true,
  includeAllDayEventsAsBusy: false, includeTransparentEventsAsBusy: false, publishPlannerBlocks: false,
  defaultPublishMode: "manual", syncOnAppOpen: true, syncIntervalMinutes: 15, conflictBehavior: "warn-only",
  timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
  createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
};

const validIso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
export function migrateCalendarConnection(value: unknown): CalendarConnection {
  if (!value || typeof value !== "object") return { ...DEFAULT_CALENDAR_CONNECTION };
  const item = value as Partial<CalendarConnection>;
  return { ...DEFAULT_CALENDAR_CONNECTION, ...item, schemaVersion: 1, provider: "google", grantedScopes: Array.isArray(item.grantedScopes) ? item.grantedScopes.filter((v): v is string => typeof v === "string") : [], selectedCalendarIds: Array.isArray(item.selectedCalendarIds) ? item.selectedCalendarIds.filter((v): v is string => typeof v === "string") : [], createdAt: validIso(item.createdAt) ? item.createdAt : DEFAULT_CALENDAR_CONNECTION.createdAt, updatedAt: validIso(item.updatedAt) ? item.updatedAt : DEFAULT_CALENDAR_CONNECTION.updatedAt };
}
export function migrateCalendarSettings(value: unknown): CalendarSyncSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_CALENDAR_SYNC_SETTINGS };
  const item = value as Partial<CalendarSyncSettings>;
  return { ...DEFAULT_CALENDAR_SYNC_SETTINGS, ...item, schemaVersion: 1, id: "google", publishPlannerBlocks: item.publishPlannerBlocks === true, selectedCalendarIds: Array.isArray(item.selectedCalendarIds) ? item.selectedCalendarIds.filter((v): v is string => typeof v === "string") : [], syncIntervalMinutes: Math.max(15, Number(item.syncIntervalMinutes) || 15), createdAt: validIso(item.createdAt) ? item.createdAt : DEFAULT_CALENDAR_SYNC_SETTINGS.createdAt, updatedAt: validIso(item.updatedAt) ? item.updatedAt : DEFAULT_CALENDAR_SYNC_SETTINGS.updatedAt };
}
export function migrateExternalEvents(value: unknown): ExternalCalendarEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ExternalCalendarEvent => Boolean(item && typeof item === "object" && typeof (item as ExternalCalendarEvent).id === "string" && typeof (item as ExternalCalendarEvent).calendarId === "string"));
}
export function migrateSyncRecords(value: unknown): CalendarSyncRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CalendarSyncRecord => Boolean(item && typeof item === "object" && typeof (item as CalendarSyncRecord).id === "string" && typeof (item as CalendarSyncRecord).scheduleBlockId === "string"));
}
export function mergeSyncRecords(a: CalendarSyncRecord[], b: CalendarSyncRecord[]) {
  const map = new Map(a.map((item) => [item.id, item]));
  for (const item of b) { const old = map.get(item.id); if (!old || item.updatedAt > old.updatedAt) map.set(item.id, item); }
  return [...map.values()];
}

interface GoogleEventWire {
  id?: string; summary?: string; description?: string; location?: string; status?: string; transparency?: string; visibility?: string;
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; recurringEventId?: string;
  originalStartTime?: { dateTime?: string; date?: string }; organizer?: { email?: string; self?: boolean };
  updated?: string; etag?: string; htmlLink?: string; extendedProperties?: { private?: Record<string, string> };
}
export function normalizeGoogleEvent(event: GoogleEventWire, calendarId: string, fetchedAt: string): ExternalCalendarEvent {
  if (!event.id || (!event.start?.dateTime && !event.start?.date) || (!event.end?.dateTime && !event.end?.date)) throw new Error("Google Calendar returned an event with invalid dates.");
  const privateEvent = event.visibility === "private";
  return {
    id: `google:${calendarId}:${event.id}`, provider: "google", calendarId, providerEventId: event.id,
    title: privateEvent ? "Private event" : event.summary || "Busy",
    description: undefined, location: undefined,
    startDateTime: event.start.dateTime, endDateTime: event.end.dateTime, startDate: event.start.date, endDate: event.end.date,
    isAllDay: Boolean(event.start.date), status: event.status === "cancelled" ? "cancelled" : event.status === "tentative" ? "tentative" : "confirmed",
    transparency: event.transparency === "transparent" ? "transparent" : "opaque", visibility: event.visibility,
    recurrenceId: event.originalStartTime?.dateTime ?? event.originalStartTime?.date, recurringEventId: event.recurringEventId,
    organizerEmail: event.organizer?.email, isOrganizer: event.organizer?.self, updatedAtProvider: event.updated, etag: event.etag,
    htmlLink: event.htmlLink, plannerLink: event.extendedProperties?.private?.plannerScheduleBlockId ? { scheduleBlockId: event.extendedProperties.private.plannerScheduleBlockId } : undefined,
    fetchedAt,
  };
}

export function eventDisplayTitle(event: ExternalCalendarEvent, settings: CalendarSyncSettings, calendars: ExternalCalendar[]) {
  if (event.visibility === "private") return "Private event";
  if (settings.eventTitleVisibility === "full") return event.title;
  if (settings.eventTitleVisibility === "busy-with-calendar") return `${calendars.find((item) => item.id === event.calendarId)?.name ?? "Google Calendar"} · Busy`;
  return "Busy";
}
function eventIsBusy(event: ExternalCalendarEvent, settings: CalendarSyncSettings) {
  if (!settings.useExternalEventsAsBusyTime || !settings.selectedCalendarIds.includes(event.calendarId) || event.status === "cancelled") return false;
  if (event.status === "tentative" && !settings.includeTentativeEventsAsBusy) return false;
  if (event.transparency === "transparent" && !settings.includeTransparentEventsAsBusy) return false;
  return !event.isAllDay || settings.includeAllDayEventsAsBusy;
}
export interface ExternalBusyInterval { date: string; startTime: string; endTime: string; eventIds: string[] }
export function externalBusyIntervals(events: ExternalCalendarEvent[], settings: CalendarSyncSettings, linkedScheduleBlockIds = new Set<string>()): ExternalBusyInterval[] {
  const raw: ExternalBusyInterval[] = [];
  for (const event of events) {
    if (!eventIsBusy(event, settings) || (event.plannerLink?.scheduleBlockId && linkedScheduleBlockIds.has(event.plannerLink.scheduleBlockId))) continue;
    if (event.isAllDay && event.startDate && event.endDate) {
      const inclusiveEnd = addLocalDays(event.endDate, -1);
      for (let date = event.startDate; date <= inclusiveEnd; date = addLocalDays(date, 1)) raw.push({ date, startTime: "00:00", endTime: "23:59", eventIds: [event.id] });
    } else if (event.startDateTime && event.endDateTime) {
      const start = new Date(event.startDateTime), end = new Date(event.endDateTime);
      const date = localDateFromDate(start);
      if (localDateFromDate(end) !== date) continue;
      raw.push({ date, startTime: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`, endTime: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`, eventIds: [event.id] });
    }
  }
  const grouped = new Map<string, ExternalBusyInterval[]>();
  for (const item of raw) grouped.set(item.date, [...(grouped.get(item.date) ?? []), item]);
  const merged: ExternalBusyInterval[] = [];
  for (const [date, items] of grouped) {
    items.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    for (const item of items) {
      const last = merged[merged.length - 1];
      if (last?.date === date && timeToMinutes(item.startTime) <= timeToMinutes(last.endTime)) {
        if (timeToMinutes(item.endTime) > timeToMinutes(last.endTime)) last.endTime = item.endTime;
        last.eventIds.push(...item.eventIds);
      } else merged.push({ ...item, eventIds: [...item.eventIds] });
    }
  }
  return merged;
}
export function externalBusyAsAvailability(events: ExternalCalendarEvent[], settings: CalendarSyncSettings, records: CalendarSyncRecord[], now: string): AvailabilityBlock[] {
  const linked = new Set(records.filter((item) => item.status === "synced").map((item) => item.scheduleBlockId));
  return externalBusyIntervals(events, settings, linked).map((item) => ({
    schemaVersion: 1, id: `external-busy:${item.date}:${item.startTime}:${item.endTime}`, name: "Google Calendar busy time",
    date: item.date, startTime: item.startTime, endTime: item.endTime, type: "appointment", isRecurring: false, createdAt: now, updatedAt: now,
  }));
}

export function calendarFetchRange(today: string) { return { startDate: addLocalDays(today, -30), endDate: addLocalDays(today, 90) }; }
function safeError(status: number) { return status === 401 ? "Google Calendar authorization expired." : status === 403 ? "Google Calendar access was denied." : status === 404 ? "The selected calendar was not found." : status === 429 ? "Google Calendar is temporarily rate limited." : `Google Calendar request failed (${status}).`; }
async function googleRequest<T>(url: URL | string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw Object.assign(new Error(safeError(response.status)), { code: String(response.status) });
  return response.json() as Promise<T>;
}
export async function fetchGoogleCalendars(token: string): Promise<ExternalCalendar[]> {
  const output: ExternalCalendar[] = []; let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList"); if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await googleRequest<{ items?: Array<{ id: string; summary?: string; description?: string; primary?: boolean; accessRole?: string; backgroundColor?: string; foregroundColor?: string; timeZone?: string }>; nextPageToken?: string }>(url, token);
    for (const item of result.items ?? []) output.push({ id: item.id, provider: "google", name: item.summary || "Calendar", description: item.description, isPrimary: item.primary === true, isSelected: item.primary === true, isReadOnly: !["owner", "writer"].includes(item.accessRole ?? ""), backgroundColor: item.backgroundColor, foregroundColor: item.foregroundColor, accessRole: item.accessRole, timezone: item.timeZone });
    pageToken = result.nextPageToken;
  } while (pageToken);
  return output;
}
export async function fetchGoogleEvents(token: string, calendarIds: string[], timeMin: string, timeMax: string, fetchedAt: string): Promise<ExternalCalendarEvent[]> {
  const output: ExternalCalendarEvent[] = [];
  for (const calendarId of calendarIds) {
    let pageToken: string | undefined;
    do {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set("singleEvents", "true"); url.searchParams.set("showDeleted", "true"); url.searchParams.set("timeMin", timeMin); url.searchParams.set("timeMax", timeMax); url.searchParams.set("maxResults", "2500");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const result = await googleRequest<{ items?: GoogleEventWire[]; nextPageToken?: string }>(url, token);
      for (const event of result.items ?? []) output.push(normalizeGoogleEvent(event, calendarId, fetchedAt));
      pageToken = result.nextPageToken;
    } while (pageToken);
  }
  return output;
}

export function scheduleBlockVersion(block: ScheduleBlock) { return `${block.updatedAt}:${block.date}:${block.startTime}:${block.endTime}:${block.title}`; }
export function syncRecordId(blockId: string) { return `google-${blockId}`; }
export function buildPublishedEvent(block: ScheduleBlock, parentTitle?: string) {
  const start = localDateToDate(block.date); const [sh, sm] = block.startTime.split(":").map(Number); start.setHours(sh, sm, 0, 0);
  const end = localDateToDate(block.date); const [eh, em] = block.endTime.split(":").map(Number); end.setHours(eh, em, 0, 0);
  return {
    summary: block.title, description: `Created by BunBun Planner.\n${parentTitle ? `Task: ${parentTitle}\n` : ""}Planned duration: ${block.durationMinutes} minutes\nPlanner status: Confirmed`,
    start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, transparency: "opaque",
    extendedProperties: { private: { plannerScheduleBlockId: block.id, plannerSource: "bunbun-planner" } },
  };
}
export async function publishScheduleBlock(token: string, calendarId: string, block: ScheduleBlock, records: CalendarSyncRecord[], now: string, parentTitle?: string) {
  if (block.status !== "confirmed") throw new Error("Only confirmed future schedule blocks can be published.");
  const existing = records.find((item) => item.scheduleBlockId === block.id && item.status !== "detached");
  if (existing?.providerEventId) return { record: existing, created: false };
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  const result = await googleRequest<{ id: string; etag?: string; updated?: string }>(url, token, { method: "POST", body: JSON.stringify(buildPublishedEvent(block, parentTitle)) });
  const record: CalendarSyncRecord = { schemaVersion: 1, id: syncRecordId(block.id), provider: "google", scheduleBlockId: block.id, calendarId, providerEventId: result.id, direction: "planner-to-google", status: "synced", plannerVersion: scheduleBlockVersion(block), providerEtag: result.etag, lastPlannerUpdatedAt: block.updatedAt, lastProviderUpdatedAt: result.updated, lastSyncedAt: now, createdAt: now, updatedAt: now };
  return { record, created: true };
}
export async function updatePublishedEvent(token: string, block: ScheduleBlock, record: CalendarSyncRecord, now: string, parentTitle?: string) {
  if (!record.providerEventId || record.status === "detached") throw new Error("This calendar link is no longer active.");
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(record.calendarId)}/events/${encodeURIComponent(record.providerEventId)}`);
  const result = await googleRequest<{ id: string; etag?: string; updated?: string }>(url, token, {
    method: "PATCH", body: JSON.stringify(buildPublishedEvent(block, parentTitle)),
    headers: record.providerEtag ? { "If-Match": record.providerEtag } : undefined,
  });
  return { ...record, status: "synced" as const, plannerVersion: scheduleBlockVersion(block), providerEtag: result.etag, lastPlannerUpdatedAt: block.updatedAt, lastProviderUpdatedAt: result.updated, lastSyncedAt: now, errorCode: undefined, errorMessage: undefined, updatedAt: now };
}
export async function deletePublishedEvent(token: string, record: CalendarSyncRecord, now: string) {
  if (!record.providerEventId || record.status === "detached") return { ...record, status: "detached" as const, updatedAt: now };
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(record.calendarId)}/events/${encodeURIComponent(record.providerEventId)}`);
  const response = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}`, ...(record.providerEtag ? { "If-Match": record.providerEtag } : {}) } });
  if (!response.ok && response.status !== 404) throw Object.assign(new Error(safeError(response.status)), { code: String(response.status) });
  return { ...record, status: "detached" as const, errorMessage: "The linked Google event was removed.", updatedAt: now };
}
export function detachSyncRecord(record: CalendarSyncRecord, now = new Date().toISOString()): CalendarSyncRecord {
  return { ...record, status: "detached", errorCode: undefined, errorMessage: "Calendar link detached; the Google event was kept.", updatedAt: now };
}
export function reconcileSyncRecords(records: CalendarSyncRecord[], blocks: ScheduleBlock[], events: ExternalCalendarEvent[], now: string) {
  const blockMap = new Map(blocks.map((item) => [item.id, item])); const eventMap = new Map(events.map((item) => [item.providerEventId, item]));
  return records.map((record) => {
    const block = blockMap.get(record.scheduleBlockId), event = eventMap.get(record.providerEventId);
    if (!block) return record.status === "detached" ? record : { ...record, status: "conflict" as const, errorMessage: "The planner block was removed. The Google event was not deleted.", updatedAt: now };
    if (!event || event.status === "cancelled") return { ...record, status: "detached" as const, errorMessage: "The linked Google event was removed.", updatedAt: now };
    if (record.plannerVersion && record.plannerVersion !== scheduleBlockVersion(block)) return { ...record, status: "pending-update" as const, errorMessage: "The planner schedule changed. Google Calendar was not updated.", updatedAt: now };
    if (record.providerEtag && event.etag && record.providerEtag !== event.etag) return { ...record, status: "conflict" as const, errorMessage: "The Google Calendar event changed.", updatedAt: now };
    return record;
  });
}
