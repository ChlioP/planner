import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CALENDAR_CONNECTION,
  DEFAULT_CALENDAR_SYNC_SETTINGS,
  buildPublishedEvent,
  calendarFetchRange,
  eventDisplayTitle,
  externalBusyAsAvailability,
  externalBusyIntervals,
  fetchGoogleCalendars,
  fetchGoogleEvents,
  migrateCalendarConnection,
  normalizeGoogleEvent,
  publishScheduleBlock,
  reconcileSyncRecords,
  scheduleBlockVersion,
  type CalendarSyncRecord,
  type ExternalCalendarEvent,
} from "./calendarIntegration";
import { migrateScheduleBlock, type ScheduleBlock } from "./scheduleBlocks";

const NOW = "2026-07-23T19:00:00.000Z";
const event = (patch: Partial<ExternalCalendarEvent> = {}): ExternalCalendarEvent => ({
  id: "google:primary:event", provider: "google", calendarId: "primary", providerEventId: "event",
  title: "Appointment", startDateTime: "2026-07-27T19:00:00-07:00", endDateTime: "2026-07-27T20:00:00-07:00",
  isAllDay: false, status: "confirmed", transparency: "opaque", fetchedAt: NOW, ...patch,
});
const block = (patch: Partial<ScheduleBlock> = {}) => migrateScheduleBlock({
  id: "block", taskId: "task", title: "Essay Research", date: "2026-07-27", startTime: "19:00", endTime: "20:00",
  durationMinutes: 60, source: "automatic", status: "confirmed", isLocked: false, createdAt: NOW, updatedAt: NOW, ...patch,
});
const settings = (patch = {}) => ({ ...DEFAULT_CALENDAR_SYNC_SETTINGS, selectedCalendarIds: ["primary"], ...patch });
afterEach(() => vi.restoreAllMocks());

describe("calendar metadata and normalization", () => {
  it("defaults to disconnected, read-only visibility, private titles, and publishing off", () => {
    expect(migrateCalendarConnection(undefined)).toEqual(DEFAULT_CALENDAR_CONNECTION);
    expect(DEFAULT_CALENDAR_SYNC_SETTINGS).toMatchObject({ readExternalEvents: true, eventTitleVisibility: "busy-only", publishPlannerBlocks: false });
    expect("accessToken" in DEFAULT_CALENDAR_CONNECTION).toBe(false);
  });

  it("normalizes timed, private, cancelled, tentative, and recurring instances", () => {
    const normalized = normalizeGoogleEvent({
      id: "e", summary: "Secret", visibility: "private", status: "tentative", transparency: "transparent",
      start: { dateTime: "2026-07-27T19:00:00-07:00" }, end: { dateTime: "2026-07-27T20:00:00-07:00" },
      recurringEventId: "series", originalStartTime: { dateTime: "2026-07-27T19:00:00-07:00" },
    }, "primary", NOW);
    expect(normalized).toMatchObject({ id: "google:primary:e", title: "Private event", status: "tentative", transparency: "transparent", recurringEventId: "series" });
    expect(normalized.description).toBeUndefined();
  });

  it("handles all-day exclusive end dates without shifting local dates", () => {
    const allDay = normalizeGoogleEvent({ id: "a", summary: "Travel", start: { date: "2026-08-10" }, end: { date: "2026-08-11" } }, "primary", NOW);
    expect(allDay).toMatchObject({ startDate: "2026-08-10", endDate: "2026-08-11", isAllDay: true });
    expect(externalBusyIntervals([allDay], settings({ includeAllDayEventsAsBusy: true }))).toMatchObject([{ date: "2026-08-10" }]);
  });

  it("expands multi-day all-day events through the day before the exclusive end", () => {
    const allDay = event({ isAllDay: true, startDate: "2026-08-10", endDate: "2026-08-13", startDateTime: undefined, endDateTime: undefined });
    expect(externalBusyIntervals([allDay], settings({ includeAllDayEventsAsBusy: true })).map((item) => item.date)).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
  });

  it("applies privacy display settings and always protects private events", () => {
    const calendars = [{ id: "primary", provider: "google" as const, name: "Work", isPrimary: true, isSelected: true, isReadOnly: false }];
    expect(eventDisplayTitle(event(), settings(), calendars)).toBe("Busy");
    expect(eventDisplayTitle(event(), settings({ eventTitleVisibility: "busy-with-calendar" }), calendars)).toBe("Work · Busy");
    expect(eventDisplayTitle(event(), settings({ eventTitleVisibility: "full" }), calendars)).toBe("Appointment");
    expect(eventDisplayTitle(event({ visibility: "private" }), settings({ eventTitleVisibility: "full" }), calendars)).toBe("Private event");
  });
});

describe("external busy time", () => {
  it("ignores unselected, cancelled, transparent, and all-day events by default", () => {
    expect(externalBusyIntervals([event({ calendarId: "other" })], settings())).toEqual([]);
    expect(externalBusyIntervals([event({ status: "cancelled" })], settings())).toEqual([]);
    expect(externalBusyIntervals([event({ transparency: "transparent" })], settings())).toEqual([]);
    expect(externalBusyIntervals([event({ isAllDay: true, startDate: "2026-08-10", endDate: "2026-08-11", startDateTime: undefined, endDateTime: undefined })], settings())).toEqual([]);
  });

  it("includes transparent events when enabled and tentative events by default", () => {
    expect(externalBusyIntervals([event({ transparency: "transparent" })], settings({ includeTransparentEventsAsBusy: true }))).toHaveLength(1);
    expect(externalBusyIntervals([event({ status: "tentative" })], settings())).toHaveLength(1);
    expect(externalBusyIntervals([event({ status: "tentative" })], settings({ includeTentativeEventsAsBusy: false }))).toHaveLength(0);
  });

  it("merges overlapping external events and retains source references", () => {
    const merged = externalBusyIntervals([event(), event({ id: "second", providerEventId: "second", startDateTime: "2026-07-27T19:30:00-07:00", endDateTime: "2026-07-27T21:00:00-07:00" })], settings());
    expect(merged).toEqual([{ date: "2026-07-27", startTime: "19:00", endTime: "21:00", eventIds: ["google:primary:event", "second"] }]);
  });

  it("does not double-block an event linked to a synced planner block", () => {
    const linked = event({ plannerLink: { scheduleBlockId: "block" } });
    const record: CalendarSyncRecord = { schemaVersion: 1, id: "r", provider: "google", scheduleBlockId: "block", calendarId: "primary", providerEventId: "event", direction: "planner-to-google", status: "synced", createdAt: NOW, updatedAt: NOW };
    expect(externalBusyAsAvailability([linked], settings(), [record], NOW)).toEqual([]);
  });

  it("converts busy events into immutable appointment availability layers", () => {
    expect(externalBusyAsAvailability([event()], settings(), [], NOW)[0]).toMatchObject({ date: "2026-07-27", startTime: "19:00", endTime: "20:00", type: "appointment" });
  });
});

describe("provider fetching and publishing", () => {
  it("uses a bounded 30-day past and 90-day future fetch range", () => {
    expect(calendarFetchRange("2026-07-23")).toEqual({ startDate: "2026-06-23", endDate: "2026-10-21" });
  });

  it("paginates calendar lists and event instances", async () => {
    const mock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "primary", summary: "Primary", primary: true, accessRole: "owner" }], nextPageToken: "next" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "shared", summary: "Shared", accessRole: "reader" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "e1", start: { dateTime: "2026-07-27T19:00:00-07:00" }, end: { dateTime: "2026-07-27T20:00:00-07:00" } }], nextPageToken: "next" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "e2", start: { dateTime: "2026-07-28T19:00:00-07:00" }, end: { dateTime: "2026-07-28T20:00:00-07:00" } }] }), { status: 200 }));
    expect(await fetchGoogleCalendars("token")).toHaveLength(2);
    expect(await fetchGoogleEvents("token", ["primary"], NOW, "2026-08-01T00:00:00.000Z", NOW)).toHaveLength(2);
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it("publishes only confirmed blocks with safe content and strong markers", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "provider", etag: "v1", updated: NOW }), { status: 200 }));
    const result = await publishScheduleBlock("token", "primary", block(), [], NOW, "Write essay");
    expect(result.created).toBe(true);
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body.extendedProperties.private.plannerScheduleBlockId).toBe("block");
    expect(body.description).not.toContain("userId");
    expect(body.attendees).toBeUndefined();
    await expect(publishScheduleBlock("token", "primary", block({ status: "proposed" }), [], NOW)).rejects.toThrow("confirmed");
  });

  it("returns an existing sync record instead of publishing twice", async () => {
    const existing: CalendarSyncRecord = { schemaVersion: 1, id: "google-block", provider: "google", scheduleBlockId: "block", calendarId: "primary", providerEventId: "provider", direction: "planner-to-google", status: "synced", createdAt: NOW, updatedAt: NOW };
    const request = vi.spyOn(globalThis, "fetch");
    expect((await publishScheduleBlock("token", "primary", block(), [existing], NOW)).created).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("uses exact local block times and no recurring or attendee fields", () => {
    const value = buildPublishedEvent(block());
    expect(new Date(value.start.dateTime).getHours()).toBe(19);
    expect(new Date(value.end.dateTime).getHours()).toBe(20);
    expect("recurrence" in value).toBe(false);
    expect("attendees" in value).toBe(false);
  });
});

describe("sync conflict behavior", () => {
  const record = (patch: Partial<CalendarSyncRecord> = {}): CalendarSyncRecord => ({
    schemaVersion: 1, id: "google-block", provider: "google", scheduleBlockId: "block", calendarId: "primary",
    providerEventId: "event", direction: "planner-to-google", status: "synced", plannerVersion: scheduleBlockVersion(block()),
    providerEtag: "v1", createdAt: NOW, updatedAt: NOW, ...patch,
  });

  it("marks planner changes pending without modifying Google", () => {
    expect(reconcileSyncRecords([record()], [block({ startTime: "20:00", endTime: "21:00" })], [event({ etag: "v1" })], "2026-07-24T00:00:00.000Z")[0]?.status).toBe("pending-update");
  });

  it("detects provider edits and deletion without deleting the planner block", () => {
    expect(reconcileSyncRecords([record()], [block()], [event({ etag: "v2" })], NOW)[0]?.status).toBe("conflict");
    expect(reconcileSyncRecords([record()], [block()], [], NOW)[0]?.status).toBe("detached");
    expect(block().status).toBe("confirmed");
  });

  it("flags a removed planner block instead of silently deleting the provider event", () => {
    expect(reconcileSyncRecords([record()], [], [event({ etag: "v1" })], NOW)[0]).toMatchObject({ status: "conflict", providerEventId: "event" });
  });
});
