export type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export function toISODate(d: Date) {
  // YYYY-MM-DD in local time to avoid timezone shifts
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getEventStartISO(e: GoogleCalendarEvent): string | null {
  return e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00` : null);
}

export function getEventStartTimeHHMM(e: GoogleCalendarEvent): string {
  const iso = getEventStartISO(e);
  if (!iso) return "00:00";
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// List events from primary calendar in a time range.
// timeMin/timeMax must be ISO strings. :contentReference[oaicite:3]{index=3}
export async function listPrimaryEvents(params: {
  accessToken: string;
  timeMinISO: string;
  timeMaxISO: string;
  maxResults?: number;
}) {
  const { accessToken, timeMinISO, timeMaxISO, maxResults = 250 } = params;

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", timeMinISO);
  url.searchParams.set("timeMax", timeMaxISO);
  url.searchParams.set("maxResults", String(maxResults));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { items?: GoogleCalendarEvent[] };
  return json.items ?? [];
}

export async function createPrimaryEvent(params: {
  accessToken: string;
  summary: string;
  description?: string;
  startISO: string; // date-time ISO
  endISO?: string; // date-time ISO
}) {
  const { accessToken, summary, description, startISO, endISO } = params;

  const body = {
    summary,
    description,
    start: { dateTime: startISO },
    end: { dateTime: endISO ?? new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString() },
  };

  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar create error ${res.status}: ${text}`);
  }

  return (await res.json()) as GoogleCalendarEvent;
}
