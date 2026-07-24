import { useMemo, useState } from "react";
import { Bell, BellOff, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createReminder,
  dismissNotification,
  editReminder,
  markNotificationRead,
  snoozeNotification,
  type NotificationSettings,
  type PlannerNotification,
  type Reminder,
} from "@/lib/notifications";
import type { ScheduleBlock } from "@/lib/scheduleBlocks";
import type { TaskRecord } from "@/lib/taskHistory";

type Filter = "all" | "unread" | "schedule" | "deadlines" | "conflicts" | "reminders" | "timer";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" }, { key: "unread", label: "Unread" },
  { key: "schedule", label: "Schedule" }, { key: "deadlines", label: "Deadlines" },
  { key: "conflicts", label: "Conflicts" }, { key: "reminders", label: "Reminders" },
  { key: "timer", label: "Timer" },
];

function browserPermission(): NotificationPermission | "unsupported" {
  return typeof window === "undefined" || !("Notification" in window) ? "unsupported" : window.Notification.permission;
}
function exactTime(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
function relativeTime(value: string) {
  const minutes = Math.round((Date.parse(value) - Date.now()) / 60_000);
  if (Math.abs(minutes) < 1) return "now";
  if (minutes > 0) return `in ${minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} hr`}`;
  return `${Math.abs(minutes) < 60 ? `${Math.abs(minutes)} min` : `${Math.round(Math.abs(minutes) / 60)} hr`} ago`;
}

export function NotificationCenter({
  notifications, setNotifications, reminders, setReminders, settings, setSettings, tasks, scheduleBlocks, onOpen,
}: {
  notifications: PlannerNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<PlannerNotification[]>>;
  reminders: Reminder[];
  setReminders: React.Dispatch<React.SetStateAction<Reminder[]>>;
  settings: NotificationSettings;
  setSettings: React.Dispatch<React.SetStateAction<NotificationSettings>>;
  tasks: TaskRecord[];
  scheduleBlocks: ScheduleBlock[];
  onOpen: (item: PlannerNotification) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showHistory, setShowHistory] = useState(false);
  const [permission, setPermission] = useState(browserPermission);
  const [form, setForm] = useState({ title: "", note: "", triggerType: "absolute", dateTime: "", dailyTime: "09:00" });
  const [formError, setFormError] = useState("");
  const now = new Date().toISOString();
  const unread = notifications.filter((item) => item.status === "delivered").length;
  const visible = useMemo(() => notifications
    .filter((item) => showHistory || !["dismissed", "cancelled", "expired"].includes(item.status))
    .filter((item) => filter === "all"
      || (filter === "unread" && item.status === "delivered")
      || (filter === "schedule" && ["schedule-upcoming", "schedule-missed", "replan-recommended"].includes(item.type))
      || (filter === "deadlines" && ["deadline-upcoming", "deadline-overdue", "risk-unscheduled"].includes(item.type))
      || (filter === "conflicts" && item.type === "schedule-conflict")
      || (filter === "reminders" && item.type === "manual-reminder")
      || (filter === "timer" && item.type === "timer-running"))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, 100), [filter, notifications, showHistory]);

  const updateSettings = (changes: Partial<NotificationSettings>) => setSettings((current) => ({
    ...current, ...changes, updatedAt: new Date().toISOString(),
  }));
  const requestBrowserPermission = async () => {
    if (permission === "unsupported" || permission === "denied") return;
    const result = await window.Notification.requestPermission();
    setPermission(result);
    updateSettings({ browserEnabled: result === "granted" });
  };
  const addReminder = () => {
    setFormError("");
    try {
      const trigger = form.triggerType === "daily"
        ? { type: "daily" as const, localTime: form.dailyTime }
        : { type: "absolute" as const, dateTime: new Date(form.dateTime).toISOString() };
      const reminder = createReminder({
        targetType: "custom", title: form.title, note: form.note || undefined, trigger,
        channels: ["in-app", ...(settings.browserEnabled ? ["browser" as const] : [])],
        isEnabled: true, userId: settings.userId,
      }, reminders, tasks, scheduleBlocks, now);
      setReminders((current) => [...current, reminder]);
      setForm({ title: "", note: "", triggerType: "absolute", dateTime: "", dailyTime: "09:00" });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Reminder could not be saved.");
    }
  };

  return <div className="grid gap-5 p-4 lg:grid-cols-[1.45fr_1fr]">
    <Card className="border-pink-100 bg-white/90 p-4 shadow-sm">
      <CardHeader><CardTitle className="flex items-center gap-2"><Bell aria-hidden="true" />Notifications <span className="text-sm font-normal text-slate-500">{unread} unread</span></CardTitle></CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Notification filters">
          {FILTERS.map((item) => <Button key={item.key} variant={filter === item.key ? "default" : "outline"} onClick={() => setFilter(item.key)}>{item.label}</Button>)}
          <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} />Show history</label>
        </div>
        {visible.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No notifications in this view.</div> :
          <ul className="space-y-3" aria-live="polite">
            {visible.map((item) => <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div><div className="font-semibold text-slate-800">{item.title}</div><p className="mt-1 text-sm text-slate-600">{item.message}</p></div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs capitalize text-slate-600">{item.status}</span>
              </div>
              <div className="mt-2 text-xs text-slate-500" title={exactTime(item.generatedAt)}>{relativeTime(item.generatedAt)} · {exactTime(item.generatedAt)}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.action ? <Button onClick={() => onOpen(item)}>{item.action.label}</Button> : null}
                <Button variant="outline" onClick={() => setNotifications((current) => current.map((value) => value.id === item.id ? markNotificationRead(value, item.status !== "delivered") : value))}>{item.status === "delivered" ? "Mark read" : "Mark unread"}</Button>
                {!["cancelled", "expired", "dismissed"].includes(item.status) ? <Button variant="outline" onClick={() => setNotifications((current) => current.map((value) => value.id === item.id ? snoozeNotification(value, 30) : value))}>Snooze 30 min</Button> : null}
                {!["dismissed", "cancelled", "expired"].includes(item.status) ? <Button variant="outline" onClick={() => setNotifications((current) => current.map((value) => value.id === item.id ? dismissNotification(value) : value))}>Dismiss</Button> : null}
              </div>
            </li>)}
          </ul>}
        <Button className="mt-4" variant="outline" onClick={() => setNotifications((current) => current.map((item) => item.status === "read" ? dismissNotification(item) : item))}>Dismiss all read</Button>
      </CardContent>
    </Card>

    <div className="space-y-5">
      <Card className="border-pink-100 bg-white/90 p-4 shadow-sm">
        <CardHeader><CardTitle className="text-lg">Notification settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between gap-3 text-sm">Pause all delivery<input type="checkbox" checked={settings.allPaused} onChange={(event) => updateSettings({ allPaused: event.target.checked })} /></label>
          <label className="flex items-center justify-between gap-3 text-sm">In-app notifications<input type="checkbox" checked={settings.inAppEnabled} onChange={(event) => updateSettings({ inAppEnabled: event.target.checked })} /></label>
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between gap-3"><span>Browser notifications</span><span className="capitalize">{permission}</span></div>
            <p className="mt-2 text-xs text-slate-600">Browser reminders are delivered while the planner is open. Delivery while the browser is closed is not supported yet.</p>
            {permission === "default" ? <Button className="mt-3" onClick={() => void requestBrowserPermission()}>Enable browser notifications</Button> : null}
            {permission === "granted" ? <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={settings.browserEnabled} onChange={(event) => updateSettings({ browserEnabled: event.target.checked })} />Deliver in this browser</label> : null}
            {permission === "denied" ? <p className="mt-2 text-xs">Permission is blocked. You can change it in your browser’s site settings; the planner will not prompt again.</p> : null}
            {permission === "unsupported" ? <p className="mt-2 text-xs">This browser does not support browser notifications. In-app notifications remain available.</p> : null}
          </div>
          {([
            ["upcomingScheduleEnabled", "Upcoming work sessions"], ["deadlineReminderEnabled", "Deadline reminders"],
            ["overdueReminderEnabled", "Overdue reminders"], ["conflictReminderEnabled", "Schedule conflicts"],
            ["missedBlockReminderEnabled", "Past sessions to review"], ["riskReminderEnabled", "At-risk unscheduled work"],
            ["timerReminderEnabled", "Long-running timers"], ["dailySummaryEnabled", "Daily summary"],
          ] as Array<[keyof NotificationSettings, string]>).map(([key, label]) =>
            <label key={key} className="flex items-center justify-between gap-3 text-sm">{label}<input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => updateSettings({ [key]: event.target.checked })} /></label>)}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Daily summary time<Input type="time" value={settings.dailySummaryTime} onChange={(event) => updateSettings({ dailySummaryTime: event.target.value })} /></label>
            <label className="text-sm">Daily maximum<Input type="number" min={1} max={50} value={settings.maximumNotificationsPerDay} onChange={(event) => updateSettings({ maximumNotificationsPerDay: Math.max(1, Number(event.target.value) || 1) })} /></label>
            <label className="text-sm">Quiet hours start<Input type="time" value={settings.quietHoursStart} onChange={(event) => updateSettings({ quietHoursStart: event.target.value })} /></label>
            <label className="text-sm">Quiet hours end<Input type="time" value={settings.quietHoursEnd} onChange={(event) => updateSettings({ quietHoursEnd: event.target.value })} /></label>
          </div>
        </CardContent>
      </Card>
      <Card className="border-pink-100 bg-white/90 p-4 shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Clock3 aria-hidden="true" />Create a reminder</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="block text-sm">Title<Input value={form.title} onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))} /></label>
          <label className="block text-sm">Note<Input value={form.note} onChange={(event) => setForm((value) => ({ ...value, note: event.target.value }))} /></label>
          <label className="block text-sm">Reminder type<select className="mt-1 w-full rounded-md border p-2" value={form.triggerType} onChange={(event) => setForm((value) => ({ ...value, triggerType: event.target.value }))}><option value="absolute">One date and time</option><option value="daily">Daily</option></select></label>
          {form.triggerType === "daily"
            ? <label className="block text-sm">Daily time<Input type="time" value={form.dailyTime} onChange={(event) => setForm((value) => ({ ...value, dailyTime: event.target.value }))} /></label>
            : <label className="block text-sm">Date and time<Input type="datetime-local" value={form.dateTime} onChange={(event) => setForm((value) => ({ ...value, dateTime: event.target.value }))} /></label>}
          {formError ? <p role="alert" className="text-sm text-red-700">{formError}</p> : null}
          <Button onClick={addReminder}>Save reminder</Button>
          <div className="border-t pt-3">
            <div className="mb-2 text-sm font-medium">Saved reminders</div>
            {reminders.length === 0 ? <p className="text-sm text-slate-500">No manual reminders yet.</p> :
              reminders.map((reminder) => <div key={reminder.id} className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-sm">
                <div><div>{reminder.title}</div><div className="text-xs text-slate-500">{reminder.nextTriggerAt ? exactTime(reminder.nextTriggerAt) : reminder.disabledReason}</div></div>
                <div className="flex gap-1">
                  <Button variant="outline" onClick={() => setReminders((current) => current.map((item) => item.id === reminder.id ? editReminder(item, { isEnabled: !item.isEnabled }, tasks, scheduleBlocks) : item))}>{reminder.isEnabled ? "Disable" : "Enable"}</Button>
                  <Button variant="outline" onClick={() => { if (window.confirm(`Delete reminder “${reminder.title}”?`)) setReminders((current) => current.filter((item) => item.id !== reminder.id)); }}><BellOff className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Delete reminder</span></Button>
                </div>
              </div>)}
          </div>
        </CardContent>
      </Card>
    </div>
  </div>;
}
