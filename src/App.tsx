import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, Dispatch, JSX, KeyboardEvent, ReactNode, SetStateAction } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarDaysIcon,
  CrownIcon,
  ListChecksIcon,
  Music2Icon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { listPrimaryEvents, getEventStartTimeHHMM, toISODate, createPrimaryEvent } from "@/lib/googleCalendar";
import type { GoogleCalendarEvent } from "@/lib/googleCalendar";
import {
  archiveTask,
  completeTask,
  createTask,
  migrateTasks,
  permanentlyDeleteTask,
  restoreTask,
  updateTask,
  type TaskRecord,
} from "@/lib/taskHistory";
import {
  firebaseEnabled,
  observeFirebaseUser,
  signInWithGoogle,
  signOutFirebase,
  type User as FirebaseUser,
} from "@/lib/firebase";
import {
  getUserPreferences,
  loadUserAvailability,
  loadUserAvailabilityTemplates,
  loadUserTaskSessions,
  loadUserScheduleBlocks,
  loadUserTasks,
  loadUserTimeLogs,
  loadUserNotifications,
  loadUserReminders,
  loadUserNotificationSettings,
  loadUserCalendarData,
  loadUserAssistantData,
  loadUserProjectPlanning,
  loadUserRecurrenceData,
  mergeAvailabilityData,
  mergeAvailabilityTemplateData,
  mergeOverrideCopies,
  mergeTaskCopies,
  mergeTaskSessionData,
  mergeTimeLogData,
  mergeScheduleBlockData,
  migrateLocalData,
  syncUserData,
  syncUserAvailability,
  syncUserAvailabilityTemplates,
  syncUserTaskSessions,
  syncUserTimeLogs,
  syncUserScheduleBlocks,
  syncUserNotifications,
  syncUserReminders,
  syncUserNotificationSettings,
  syncUserCalendarData,
  syncUserAssistantData,
  syncUserProjectPlanning,
  syncUserRecurrenceData,
  mergeNotificationData,
  mergeReminderData,
  mergeCalendarSyncRecordData,
  mergeAssistantMessageData,
  mergeAssistantAuditData,
  mergeGoalData,
  mergeProjectData,
  mergeMilestoneData,
  mergeDependencyData,
  mergeRecurrenceDefinitionData,
  mergeRecurrenceOccurrenceData,
  mergeRecurrenceExceptionData,
  mergeRoutineTemplateData,
  type PlannerPreferences,
} from "@/lib/firestoreSync";
import { createPlannerBackup, mergeBackupTasks, parsePlannerBackup } from "@/lib/plannerBackup";
import { AvailabilityPage } from "@/components/AvailabilityPage";
import { PlanningEffortPage } from "@/components/PlanningEffortPage";
import { TaskEffortEditor } from "@/components/TaskEffortEditor";
import { mergeAvailabilityCopies, migrateAvailabilityBlocks, migrateAvailabilityOverrides, type AvailabilityBlock, type AvailabilityOverride } from "@/lib/availability";
import { mergeTemplateCopies, migrateAvailabilityTemplates, type AvailabilityTemplate } from "@/lib/availabilityTemplates";
import { displayedRemainingMinutes, estimateState, formatEffortMinutes } from "@/lib/taskEffort";
import { mergeSessionCopies, migrateTaskSessions, parentEstimateWarnings, sessionTotals, sessionsForParent, type TaskSession } from "@/lib/taskSessions";
import { mergeScheduleBlockCopies, migrateScheduleBlocks, type ScheduleBlock } from "@/lib/scheduleBlocks";
import { completeTimer, createTimerLog, elapsedSeconds, mergeTimeLogCopies, migrateTimeLogs, pauseTimer, runningTimeLogs, taskHasActiveTimer, type TimeLog, type TimerStartInput } from "@/lib/timeLogs";
import { FocusTimerPanel } from "@/components/FocusTimerPanel";
import { AnalyticsPage } from "@/components/AnalyticsPage";
import { NotificationCenter } from "@/components/NotificationCenter";
import { CalendarIntegrationPage, ExternalCalendarSummary } from "@/components/CalendarIntegrationPage";
import { PlanningAssistantPage } from "@/components/PlanningAssistantPage";
import { ProjectsPage } from "@/components/ProjectsPage";
import { RecurrencesPage } from "@/components/RecurrencesPage";
import { SyncReliabilityPage, SyncStatusBadge } from "@/components/SyncReliabilityPage";
import { useOfflineReliability, type OfflineCollection } from "@/lib/useOfflineReliability";
import {
  cleanupNotificationRetention,
  DEFAULT_NOTIFICATION_SETTINGS,
  evaluateNotifications,
  mergeNotificationCopies,
  mergeReminderCopies,
  migrateNotificationSettings,
  migratePlannerNotifications,
  migrateReminders,
  type NotificationSettings,
  type PlannerNotification,
  type Reminder,
} from "@/lib/notifications";
import {
  DEFAULT_CALENDAR_CONNECTION,
  DEFAULT_CALENDAR_SYNC_SETTINGS,
  externalBusyAsAvailability,
  mergeSyncRecords,
  migrateCalendarConnection,
  migrateCalendarSettings,
  migrateExternalEvents,
  migrateSyncRecords,
  type CalendarConnection,
  type CalendarSyncRecord,
  type CalendarSyncSettings,
  type ExternalCalendar,
  type ExternalCalendarEvent,
} from "@/lib/calendarIntegration";
import {
  DEFAULT_AI_SETTINGS,
  migrateAssistantAudits,
  migrateAssistantMessages,
  migrateAISettings,
  type AIAssistantActionAudit,
  type AIAssistantSettings,
  type AssistantConversationMessage,
} from "@/lib/planningAssistant";
import {
  migrateDependencies,
  migrateGoals,
  migrateMilestones,
  migrateProjects,
  type Goal,
  type Milestone,
  type Project,
  type TaskDependency,
} from "@/lib/projectPlanning";
import {
  catchUpStart,
  generateOccurrences,
  materializeOccurrences,
  migrateRecurrenceDefinitions,
  migrateRecurrenceOccurrences,
  migrateRecurrenceExceptions,
  migrateRoutineTemplates,
  nextGenerationEnd,
  reconcileOccurrenceWithTask,
  todayInTimezone,
  type RecurrenceDefinition,
  type RecurrenceOccurrence,
  type RecurrenceException,
  type RoutineTemplate,
} from "@/lib/recurrence";
import bun4 from "../bun4.jpg";
import bun5 from "../bun5.jpg";
import bun6 from "../bun6.jpg";
import bun7 from "../bun7.jpg";
import bun8 from "../bun8.jpg";
import bun9 from "../bun9.jpg";
import bun10 from "../bun10.jpg";
import bun11 from "../bun11.jpg";
import bun12 from "../bun12.jpg";
import bun13 from "../bun13.jpg";
import bun14 from "../bun14.jpg";
import bun15 from "../bun15.jpg";
import bun16 from "../bun16.jpg";
import bun17 from "../bun17.jpg";
import bun18 from "../bun18.jpg";
import bun19 from "../bun19.jpg";
import bun20 from "../bun20.jpg";
import bun0 from "../bun.jpg";
import bun1 from "../bun1.jpg";
import bun2 from "../bun2.jpg";
import bun3 from "../bun3.jpg";
import bgImg from "../bg.jpg";

type Task = TaskRecord;

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient(options: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
          }): GoogleTokenClient;
        };
      };
    };
  }
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
}

interface GoogleTokenClient {
  requestAccessToken(options: { prompt?: string }): void;
}

type View = "monthly" | "weekly" | "daily" | "planning" | "availability" | "projects" | "routines" | "insights" | "assistant" | "notifications" | "google" | "sync" | "checklist" | "archive" | "history";

const BUNDLED_DEMO_TASK_IDS = new Set(
  Array.from({ length: 9 }, (_, index) => `legacy-${index + 1}`),
);
const BUNDLED_DEMO_TASK_TITLES = new Set([
  "nt tax",
  "pacific bay",
  "nt tax and pacific bay",
  "nt tax & pacific bay",
  "waxing",
  "waxing completed",
]);

function withoutBundledDemoTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => {
    const normalizedTitle = task.title.trim().toLocaleLowerCase();
    return !BUNDLED_DEMO_TASK_IDS.has(task.id) && !BUNDLED_DEMO_TASK_TITLES.has(normalizedTitle);
  });
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const TASKS_STORAGE_KEY = "planner_tasks_v1";
const CHECKLIST_STORAGE_KEY = "planner_checklist_by_day_v1";
const PROJECTS_STORAGE_KEY = "planner_projects_v1";
const MUSIC_STORAGE_KEY = "planner_music_query_v1";
const CHECKLIST_NOTE_STORAGE_KEY = "planner_checklist_note_v1";
const AVAILABILITY_STORAGE_KEY = "planner_availability_v1";
const AVAILABILITY_OVERRIDES_STORAGE_KEY = "planner_availability_overrides_v1";
const AVAILABILITY_TEMPLATES_STORAGE_KEY = "planner_availability_templates_v1";
const TASK_SESSIONS_STORAGE_KEY = "planner_task_sessions_v1";
const SCHEDULE_BLOCKS_STORAGE_KEY = "planner_schedule_blocks_v1";
const TIME_LOGS_STORAGE_KEY = "planner_time_logs_v1";
const NOTIFICATIONS_STORAGE_KEY = "planner_notifications_v1";
const REMINDERS_STORAGE_KEY = "planner_reminders_v1";
const NOTIFICATION_SETTINGS_STORAGE_KEY = "planner_notification_settings_v1";
const CALENDAR_CONNECTION_STORAGE_KEY = "planner_calendar_connection_google_v1";
const CALENDAR_SETTINGS_STORAGE_KEY = "planner_calendar_settings_google_v1";
const CALENDAR_SOURCES_STORAGE_KEY = "planner_calendar_sources_google_v1";
const EXTERNAL_EVENTS_STORAGE_KEY = "planner_external_events_google_v1";
const CALENDAR_SYNC_RECORDS_STORAGE_KEY = "planner_calendar_sync_records_v1";
const AI_SETTINGS_STORAGE_KEY = "planner_ai_assistant_settings_v1";
const AI_CONVERSATIONS_STORAGE_KEY = "planner_ai_conversation_v1";
const AI_AUDITS_STORAGE_KEY = "planner_ai_action_audits_v1";
const GOALS_STORAGE_KEY = "planner_goals_v1";
const PLANNING_PROJECTS_STORAGE_KEY = "planner_structured_projects_v1";
const MILESTONES_STORAGE_KEY = "planner_milestones_v1";
const DEPENDENCIES_STORAGE_KEY = "planner_task_dependencies_v1";
const RECURRENCE_DEFINITIONS_STORAGE_KEY = "planner_recurrence_definitions_v1";
const RECURRENCE_OCCURRENCES_STORAGE_KEY = "planner_recurrence_occurrences_v1";
const RECURRENCE_EXCEPTIONS_STORAGE_KEY = "planner_recurrence_exceptions_v1";
const ROUTINE_TEMPLATES_STORAGE_KEY = "planner_routine_templates_v1";
const DEFAULT_MUSIC_QUERY = "lofi hip hop beats to study and relax to";
const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: "1", text: "Chép kinh", done: false },
  { id: "2", text: "Uống đủ 1.5L nước", done: false },
  { id: "3", text: "Skincare đều đặn", done: false },
  { id: "4", text: "Tập thể dục 30ph", done: false },
];

const BUNS_DAILY = [bun4, bun5, bun6, bun7];
const BUNS_GOOGLE = [bun8, bun9, bun10, bun11];
const BUNS_CHECKLIST = [bun12, bun13, bun14, bun15];
const BUNS_WEEKLY = [bun17, bun18, bun19, bun20];
const BUNS_MONTHLY = [bun0, bun1, bun2, bun3];
const DEFAULT_WEATHER_LOCATION = { lat: 16.0544, lon: 108.2022, label: "Da Nang, Vietnam" };

function writeLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.error(`Failed to save local planner data for ${key}`, error);
  }
}

function extractYouTubeVideoId(input: string) {
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      return url.pathname.slice(1);
    }
    if (host.endsWith("youtube.com")) {
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }
      if (url.pathname.startsWith("/shorts/")) {
        return url.pathname.split("/")[2];
      }
      if (url.pathname.startsWith("/embed/")) {
        return url.pathname.split("/")[2];
      }
    }
  } catch {
    // not a URL, fall back to search embed
  }
  return null;
}

function buildYouTubeEmbedUrl(input: string) {
  const trimmed = input.trim() || DEFAULT_MUSIC_QUERY;
  const id = extractYouTubeVideoId(trimmed);
  if (id) {
    return `https://www.youtube.com/embed/${id}`;
  }
  return `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(trimmed)}`;
}

function BunStrip({ imgs }: { imgs: string[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full">
      {imgs.map((src, idx) => (
        <div
          key={src}
          className="overflow-hidden rounded-2xl shadow ring-1 ring-pink-100 bg-white/80"
        >
          <img src={src} alt={`Cute bun ${idx + 1}`} className="w-full h-36 object-cover" />
        </div>
      ))}
    </div>
  );
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function startOfWeek(date: Date, weekStartsOnMonday = true) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun
  const delta = weekStartsOnMonday ? (day === 0 ? -6 : 1 - day) : -day;
  d.setDate(d.getDate() + delta);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function prettyDate(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function percentCompleted(tasks: Task[]) {
  const total = tasks.length;
  if (total === 0) return 0;
  const done = tasks.filter((t) => t.status === "completed").length;
  return Math.round((done / total) * 100);
}

function priorityPill(priority: Task["priority"]) {
  if (priority === "critical") return "bg-red-200 text-red-900";
  if (priority === "high") return "bg-pink-200 text-pink-900";
  if (priority === "medium") return "bg-yellow-200 text-yellow-900";
  return "bg-emerald-200 text-emerald-900";
}

function SoftCard({ title, right, children }: { title: string; right?: JSX.Element; children: ReactNode }) {
  return (
    <Card className="rounded-2xl bg-white/80 backdrop-blur-sm shadow-sm ring-1 ring-pink-100">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-700">{title}</CardTitle>
          {right}
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4 px-4">{children}</CardContent>
    </Card>
  );
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: "pink" | "yellow" | "blue" | "mint" }) {
  const toneClass =
    tone === "pink"
      ? "bg-pink-100 ring-pink-200"
      : tone === "yellow"
      ? "bg-yellow-100 ring-yellow-200"
      : tone === "blue"
      ? "bg-sky-100 ring-sky-200"
      : "bg-emerald-100 ring-emerald-200";
  return (
    <div className={`rounded-xl px-3 py-2 ring-1 ${toneClass}`}>
      <div className="text-[11px] text-slate-600">{label}</div>
      <div className="text-base font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function TaskTable({ tasks, onToggle }: { tasks: Task[]; onToggle: (id: string) => void }) {
  return (
    <ScrollArea className="h-52 pr-2">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left p-2 pl-3">✓</th>
            <th className="text-left p-2">Task</th>
            <th className="text-left p-2">Type</th>
            <th className="text-right p-2 pr-3">Time</th>
          </tr>
        </thead>
        <tbody>
          {tasks
            .slice()
            .sort((a, b) => a.time.localeCompare(b.time))
            .map((t) => (
              <tr key={t.id} className="border-b border-slate-100 hover:bg-pink-50/40 transition-colors">
                <td className="p-2 pl-3 align-top">
                  <Checkbox checked={t.status === "completed"} onCheckedChange={() => onToggle(t.id)} />
                </td>
                <td className="p-2 align-top">
                  <div className="font-medium text-slate-700">{t.title}</div>
                  <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${priorityPill(t.priority)}`}>
                    {t.priority}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">Estimate: {formatEffortMinutes(t.estimatedMinutes)}</div>
                </td>
                <td className="p-2 align-top text-slate-600">{t.category}</td>
                <td className="p-2 pr-3 align-top text-right text-slate-600">{t.time}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

function MonthCalendar({
  year,
  month,
  tasks,
  selectedDate,
  onSelectDate,
}: {
  year: number;
  month: number;
  tasks?: Task[];
  selectedDate?: string;
  onSelectDate?: (iso: string) => void;
}) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const offset = (firstDay + 6) % 7; // Monday = 0
  const grid: number[] = [];
  for (let i = 0; i < offset; i++) grid.push(0);
  for (let d = 1; d <= daysInMonth; d++) grid.push(d);
  while (grid.length % 7 !== 0) grid.push(0);
  const weeks: number[][] = [];
  for (let i = 0; i < grid.length; i += 7) weeks.push(grid.slice(i, i + 7));
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="rounded-xl bg-white/70 ring-1 ring-slate-100 p-2">
      <table className="w-full text-center text-[11px]">
        <thead>
          <tr>
            {weekdays.map((d) => (
              <th key={d} className="py-1 font-semibold text-slate-600">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((day, di) => (
                <td key={di} className="py-1">
                  {day ? (
                    <button
                      className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full ring-1 text-slate-700 transition-colors ${
                        selectedDate === `${year}-${pad2(month + 1)}-${pad2(day)}`
                          ? "bg-pink-100 ring-pink-200"
                          : "bg-white/90 ring-pink-100 hover:bg-pink-50"
                      }`}
                      onClick={() =>
                        onSelectDate?.(`${year}-${pad2(month + 1)}-${pad2(day)}`)
                      }
                    >
                      {day}
                    </button>
                  ) : (
                    <div className="h-7 w-7" />
                  )}
                  {day && tasks?.some((t) => t.date === `${year}-${pad2(month + 1)}-${pad2(day)}`) ? (
                    <div className="mt-0.5 text-pink-400 text-[8px] leading-none">•</div>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** -------------------- DAILY VIEW -------------------- */

type Rank = "A" | "B" | "C" | "D" | "E";

interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}
type ChecklistMap = Record<string, ChecklistItem[]>;

interface WeatherState {
  loading: boolean;
  error: string | null;
  locationLabel: string;
  tempC: number | null;
  tempF: number | null;
  hiC: number | null;
  loC: number | null;
  hiF: number | null;
  loF: number | null;
  description: string;
}

function rankFromPct(pct: number): Rank {
  if (pct >= 90) return "A";
  if (pct >= 70) return "B";
  if (pct >= 50) return "C";
  if (pct >= 20) return "D";
  return "E";
}

function rankBadgeClass(rank: Rank) {
  if (rank === "A") return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  if (rank === "B") return "bg-sky-100 text-sky-800 ring-sky-200";
  if (rank === "C") return "bg-amber-100 text-amber-800 ring-amber-200";
  if (rank === "D") return "bg-orange-100 text-orange-800 ring-orange-200";
  return "bg-rose-100 text-rose-800 ring-rose-200";
}

function toFahrenheit(celsius: number | null) {
  if (celsius === null || Number.isNaN(celsius)) return null;
  return Math.round((celsius * 9) / 5 + 32);
}

function describeWeather(code?: number) {
  const map: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    56: "Freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Light showers",
    81: "Showers",
    82: "Heavy showers",
    85: "Snow showers",
    86: "Snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with hail",
  };
  return map[code ?? -1] ?? "Fetching forecast…";
}

function WeatherPanel() {
  const [weather, setWeather] = useState<WeatherState>({
    loading: true,
    error: null,
    locationLabel: "Fetching location…",
    tempC: null,
    tempF: null,
    hiC: null,
    loC: null,
    hiF: null,
    loF: null,
    description: "Fetching forecast…",
  });

  useEffect(() => {
    let cancelled = false;

    const loadWeather = async (lat: number, lon: number, label: string) => {
      setWeather((prev) => ({ ...prev, loading: true, error: null, locationLabel: label }));
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
        const resp = await fetch(url);
        if (!resp.ok) {
          throw new Error(`Weather fetch failed (${resp.status})`);
        }
        const data = await resp.json();
        if (cancelled) return;
        const tempC =
          typeof data?.current_weather?.temperature === "number" ? data.current_weather.temperature : null;
        const hiCRaw = Array.isArray(data?.daily?.temperature_2m_max) ? data.daily.temperature_2m_max[0] ?? null : null;
        const loCRaw = Array.isArray(data?.daily?.temperature_2m_min) ? data.daily.temperature_2m_min[0] ?? null : null;
        const hiC = typeof hiCRaw === "number" ? hiCRaw : null;
        const loC = typeof loCRaw === "number" ? loCRaw : null;
        setWeather({
          loading: false,
          error: null,
          locationLabel: label || data?.timezone || "Your location",
          tempC,
          tempF: toFahrenheit(tempC),
          hiC,
          loC,
          hiF: toFahrenheit(hiC),
          loF: toFahrenheit(loC),
          description: describeWeather(data?.current_weather?.weathercode),
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Weather unavailable right now.";
        setWeather((prev) => ({ ...prev, loading: false, error: message }));
      }
    };

    const fetchForUser = () => {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => loadWeather(pos.coords.latitude, pos.coords.longitude, "Your location"),
          () => loadWeather(DEFAULT_WEATHER_LOCATION.lat, DEFAULT_WEATHER_LOCATION.lon, DEFAULT_WEATHER_LOCATION.label),
          { timeout: 7000 },
        );
      } else {
        loadWeather(DEFAULT_WEATHER_LOCATION.lat, DEFAULT_WEATHER_LOCATION.lon, DEFAULT_WEATHER_LOCATION.label);
      }
    };

    fetchForUser();
    return () => {
      cancelled = true;
    };
  }, []);

  const formatTempPair = (c: number | null, f: number | null) => {
    if (c === null && f === null) return "--";
    if (c === null) return `${f}°F`;
    if (f === null) return `${Math.round(c)}°C`;
    return `${Math.round(c)}°C / ${f}°F`;
  };

  return (
    <div
      className="relative overflow-hidden rounded-2xl ring-1 ring-pink-100 shadow-sm"
      style={{ backgroundImage: `url(${bun16})`, backgroundSize: "cover", backgroundPosition: "center" }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/90 via-white/70 to-white/55" />
      <div className="relative p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-700">Today’s weather</div>
          <div className="text-[11px] text-slate-600">{weather.locationLabel}</div>
        </div>

        {weather.loading ? (
          <div className="text-sm text-slate-600">Loading forecast…</div>
        ) : weather.error ? (
          <div className="text-sm text-red-600">Weather unavailable. {weather.error}</div>
        ) : (
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <div>
              <div className="text-3xl font-bold text-slate-800">
                {weather.tempC !== null ? `${Math.round(weather.tempC)}°C` : "--"}
              </div>
              <div className="text-sm text-slate-600">
                {weather.tempF !== null ? `${weather.tempF}°F` : ""}
              </div>
              <div className="mt-1 text-sm text-slate-700">{weather.description}</div>
            </div>
            <div className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-pink-100 text-xs text-slate-700">
              <div>High: {formatTempPair(weather.hiC, weather.hiF)}</div>
              <div>Low: {formatTempPair(weather.loC, weather.loF)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DailySidebar({
  monthYear,
  startDayISO,
  setStartDayISO,
  processData,
  checklist,
  setChecklist,
  tasks,
  selectedDay,
  setSelectedDay,
}: {
  monthYear: { year: number; monthIndex: number };
  startDayISO: string;
  setStartDayISO: (v: string) => void;
  processData: Array<{ day: string; pct: number }>;
  checklist: ChecklistItem[];
  setChecklist: (items: ChecklistItem[]) => void;
  tasks: Task[];
  selectedDay: string;
  setSelectedDay: (iso: string) => void;
}) {
  const [newItem, setNewItem] = useState("");
  const selectedDayTasks = tasks.filter((t) => t.date === selectedDay);
  const selectedDayPct = percentCompleted(selectedDayTasks);
  const selectedDayRank = rankFromPct(selectedDayPct);

  const addItem = () => {
    const text = newItem.trim();
    if (!text) return;
    setChecklist([
      ...checklist,
      { id: crypto.randomUUID(), text, done: false },
    ]);
    setNewItem("");
  };

  return (
    <div className="space-y-4">
      <SoftCard
        title="DAILY PLAN"
        right={<SparklesIcon className="h-4 w-4 text-pink-500" />}
      >
        <div className="space-y-3">
          <div className="rounded-xl bg-white/70 ring-1 ring-slate-100 p-4">
            <div className="text-[11px] text-slate-500">Month</div>
            <div className="text-sm font-semibold text-slate-700">
              {pad2(monthYear.monthIndex + 1)}/{monthYear.year}
            </div>
            <div className="mt-2">
              <MonthCalendar
                year={monthYear.year}
                month={monthYear.monthIndex}
                tasks={tasks}
                selectedDate={selectedDay}
                onSelectDate={(iso) => {
                  setSelectedDay(iso);
                  setStartDayISO(iso);
                }}
              />
            </div>
          </div>

          <div className="rounded-xl bg-white/70 ring-1 ring-slate-100 p-4 space-y-3">
            <div className="text-[11px] text-slate-500">Start Day</div>
            <Input
              value={startDayISO}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setStartDayISO(e.target.value)}
              type="date"
              className="mt-2 h-9 rounded-lg"
            />
            <div className="text-[11px] text-slate-600">
              {prettyDate(startDayISO)}
            </div>
            <div className="mt-2 rounded-lg bg-white/80 ring-1 ring-slate-100 px-3 py-2">
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>Selected day rank</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${rankBadgeClass(selectedDayRank)}`}>
                  <CrownIcon className="h-3 w-3" />
                  Rank {selectedDayRank}
                </span>
              </div>
              <div className="text-xs text-slate-600 mt-1">Completed: {selectedDayPct}%</div>
            </div>
          </div>
        </div>
      </SoftCard>

      <WeatherPanel />

      <SoftCard title="Task Process">
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={processData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="pct" radius={[8, 8, 0, 0]}>
                {processData.map((_, i) => (
                  <Cell key={i} fill={["#AED9E0", "#F9E79F", "#FFC5D0", "#C7F9CC", "#CDB4DB", "#FFD6A5", "#BDE0FE"][i % 7]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SoftCard>

      <SoftCard title="Checklist" right={<ListChecksIcon className="h-4 w-4 text-slate-500" />}>
        <div className="flex gap-2">
          <Input
            value={newItem}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewItem(e.target.value)}
            placeholder="Add new checklist item..."
            className="h-9 rounded-xl bg-white/80"
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") addItem();
            }}
          />
          <Button
            onClick={addItem}
            className="rounded-xl bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90"
          >
            Add
          </Button>
          <Button
            onClick={() => {
              setChecklist(checklist.map((item) => ({ ...item, done: false })));
            }}
            className="rounded-xl bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90"
          >
            Uncheck all
          </Button>
        </div>

        <div className="mt-3 space-y-2">
          {checklist.length === 0 ? (
            <div className="text-xs text-slate-500">No items yet. Add one above ✨</div>
          ) : (
            checklist.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-xl bg-white/70 ring-1 ring-slate-100 px-3 py-2">
                <Checkbox
                  checked={item.done}
                  onCheckedChange={() => {
                    setChecklist(
                      checklist.map((x) => (x.id === item.id ? { ...x, done: !x.done } : x)),
                    );
                  }}
                />
                <div className={`flex-1 text-sm ${item.done ? "line-through text-slate-400" : "text-slate-700"}`}>{item.text}</div>
                <button
                  className="rounded-lg p-1 text-slate-400 hover:text-slate-700"
                  onClick={() => setChecklist(checklist.filter((x) => x.id !== item.id))}
                  aria-label="Remove"
                >
                  <Trash2Icon className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </SoftCard>
    </div>
  );
}

function FocusMusicCard({
  musicQuery,
  setMusicQuery,
}: {
  musicQuery: string;
  setMusicQuery: (value: string) => void;
}) {
  const [draft, setDraft] = useState(musicQuery);
  const embedUrl = useMemo(() => buildYouTubeEmbedUrl(musicQuery), [musicQuery]);

  useEffect(() => {
    setDraft(musicQuery);
  }, [musicQuery]);

  const updateSong = () => {
    const next = draft.trim();
    if (!next) return;
    setMusicQuery(next);
  };

  return (
    <SoftCard title="Focus music" right={<Music2Icon className="h-4 w-4 text-pink-500" />}>
        <div className="space-y-3">
          <div className="text-xs text-slate-600">
            Paste a YouTube link to keep playing while plan.
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={draft}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") updateSong();
            }}
            placeholder="e.g. https://youtu.be/abcd"
            className="h-10 rounded-xl bg-white/80"
          />
          <Button
            onClick={updateSong}
            className="rounded-xl bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90"
          >
            Play
          </Button>
        </div>
        <div className="aspect-video overflow-hidden rounded-xl ring-1 ring-slate-100 bg-slate-50">
          <iframe
            key={embedUrl}
            src={`${embedUrl}?modestbranding=1`}
            title="Focus music"
            className="h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      </div>
    </SoftCard>
  );
}

function FloatingMusicPlayer({ musicQuery }: { musicQuery: string }) {
  const [open, setOpen] = useState(true);
  const embedUrl = useMemo(() => buildYouTubeEmbedUrl(musicQuery), [musicQuery]);

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm sm:w-[320px]">
      <div className="rounded-2xl bg-white/90 backdrop-blur-sm ring-1 ring-pink-100 shadow-lg">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Music2Icon className="h-4 w-4 text-pink-500" />
            <span>Focus music</span>
          </div>
          <Button
            variant="outline"
            className="rounded-full h-8 px-3"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide" : "Show"}
          </Button>
        </div>
        <div
          className={`overflow-hidden transition-all duration-200 ${
            open ? "h-48 opacity-100" : "h-0 opacity-0 pointer-events-none"
          }`}
        >
          <iframe
            key={embedUrl}
            src={`${embedUrl}?autoplay=1&modestbranding=1`}
            title="Now playing"
            className="h-48 w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}

function DailySpread({
  weekDates,
  tasks,
  onToggle,
}: {
  weekDates: string[]; // 7 ISO dates
  tasks: Task[];
  onToggle: (id: string) => void;
}) {
  const dayNames = weekDates.map((iso) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" }),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {weekDates.map((iso, idx) => {
        const dayTasks = tasks.filter((t) => t.date === iso);
        const completed = dayTasks.filter((t) => t.status === "completed").length;
        const total = dayTasks.length;
        const inProgress = Math.max(total - completed, 0);
        const pct = percentCompleted(dayTasks);
        const dayRank = rankFromPct(pct);

        return (
          <Card
            key={iso}
            className="rounded-2xl bg-white/80 backdrop-blur-sm shadow-sm ring-1 ring-slate-100"
          >
            <CardHeader className="pb-2 px-4">
              <div className="flex items-center justify-between">
                <div className="pl-1">
                  <div className="text-sm font-semibold text-slate-700">{dayNames[idx]}</div>
                  <div className="text-[11px] text-slate-500">{iso}</div>
                </div>
                <div className="rounded-xl bg-white/70 px-3 py-2 ring-1 ring-slate-100 mt-1">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
                      <span>Progress</span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${rankBadgeClass(dayRank)}`}>
                        Rank {dayRank}
                      </span>
                    </div>
                    <div className="text-base font-semibold text-slate-800">{pct}% 🐰</div>
                    <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full bg-gradient-to-r from-pink-200 via-pink-300 to-pink-400"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {total === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500">No tasks yet 🌸</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 -mt-2 px-2">
                    <SummaryChip label="Completed" value={completed} tone="mint" />
                    <SummaryChip label="In Progress" value={inProgress} tone="yellow" />
                    <SummaryChip label="Total" value={total} tone="blue" />
                  </div>
                  <div className="mt-3">
                    <TaskTable tasks={dayTasks} onToggle={onToggle} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function DailyPlanner({
  tasks,
  onToggle,
  checklistByDate,
  setChecklistByDate,
  musicQuery,
  setMusicQuery,
}: {
  tasks: Task[];
  onToggle: (id: string) => void;
  checklistByDate: ChecklistMap;
  setChecklistByDate: Dispatch<SetStateAction<ChecklistMap>>;
  musicQuery: string;
  setMusicQuery: (value: string) => void;
}) {
  const [startDayISO, setStartDayISO] = useState(toISODate(new Date()));
  const [selectedDay, setSelectedDay] = useState(startDayISO);
  const checklist = checklistByDate[selectedDay] ?? DEFAULT_CHECKLIST;

  const setChecklist = (items: ChecklistItem[]) => {
    setChecklistByDate((prev) => ({ ...prev, [selectedDay]: items }));
  };

  const start = useMemo(() => startOfWeek(new Date(`${startDayISO}T00:00:00`), true), [startDayISO]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => toISODate(addDays(start, i))), [start]);

  const processData = useMemo(() => {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return weekDates.map((iso, i) => ({ day: labels[i], pct: percentCompleted(tasks.filter((t) => t.date === iso)) }));
  }, [tasks, weekDates]);

  const selectedDateObj = useMemo(() => new Date(`${selectedDay}T00:00:00`), [selectedDay]);
  const monthYear = { year: selectedDateObj.getFullYear(), monthIndex: selectedDateObj.getMonth() };

  // Auto-roll to today at midnight so rankings/cards stay aligned with the current date
  useEffect(() => {
    const tick = () => {
      const iso = toISODate(new Date());
      setStartDayISO((prev) => (prev !== iso ? iso : prev));
      setSelectedDay((prev) => (prev !== iso ? iso : prev));
    };
    tick();
    const id = window.setInterval(tick, 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <DailySidebar
        monthYear={monthYear}
        startDayISO={startDayISO}
        setStartDayISO={setStartDayISO}
        processData={processData}
        checklist={checklist}
        setChecklist={setChecklist}
        tasks={tasks}
        selectedDay={selectedDay}
        setSelectedDay={setSelectedDay}
      />
      <div className="space-y-4 px-2">
        <BunStrip imgs={BUNS_DAILY} />
        <div className="rounded-2xl bg-white/70 ring-1 ring-slate-100 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-700">Weekly Spread</div>
              <div className="text-[11px] text-slate-500">Auto shows the week of your Start Day (Monday → Sunday)</div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-xl bg-white/80 px-3 py-2 ring-1 ring-pink-100">
              <CalendarDaysIcon className="h-4 w-4 text-pink-600" />
              <span className="text-xs text-slate-600">{weekDates[0]} → {weekDates[6]}</span>
            </div>
          </div>
        </div>
        <DailySpread weekDates={weekDates} tasks={tasks} onToggle={onToggle} />
        <FocusMusicCard musicQuery={musicQuery} setMusicQuery={setMusicQuery} />
      </div>
    </div>
  );
}

/** -------------------- OTHER VIEWS -------------------- */

function MonthlyPlanner({ tasks }: { tasks: Task[] }) {
  const now = new Date();
  const [selectedDate, setSelectedDate] = useState<string>(toISODate(now));
  const monthPrefix = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const monthTasks = tasks.filter((t) => t.date.startsWith(monthPrefix));
  const completed = monthTasks.filter((t) => t.status === "completed").length;
  const inProgress = Math.max(monthTasks.length - completed, 0);
  const todo = monthTasks.filter((t) => t.status === "planned" || t.status === "backlog").length;
  const dayTasks = tasks.filter((t) => t.date === selectedDate);

  return (
    <div className="space-y-4">
      <BunStrip imgs={BUNS_MONTHLY} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-2">
        <SummaryChip label="Total" value={monthTasks.length} tone="blue" />
        <SummaryChip label="Completed" value={completed} tone="mint" />
        <SummaryChip label="In Progress" value={inProgress} tone="yellow" />
        <SummaryChip label="To Do" value={todo} tone="pink" />
      </div>
      <SoftCard title={`${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`} right={<CalendarDaysIcon className="h-4 w-4 text-pink-600" />}>
        <MonthCalendar
          year={now.getFullYear()}
          month={now.getMonth()}
          tasks={tasks}
          selectedDate={selectedDate}
          onSelectDate={(iso) => setSelectedDate(iso)}
        />
        <div className="mt-3 space-y-2">
          <div className="text-sm font-semibold text-slate-700">Tasks on {selectedDate}</div>
          {dayTasks.length === 0 ? (
            <div className="text-xs text-slate-500">No tasks for this day.</div>
          ) : (
            <TaskTable tasks={dayTasks} onToggle={() => {}} />
          )}
        </div>
      </SoftCard>
    </div>
  );
}


// Weekly view
function WeeklyPlanner({ tasks, setTasks, sessions, timeLogs }: { tasks: Task[]; setTasks: Dispatch<SetStateAction<Task[]>>; sessions: TaskSession[]; timeLogs: TimeLog[] }) {
  const [editingEffortId, setEditingEffortId] = useState<string | null>(null);
  const start = startOfWeek(new Date(), true);
  const weeks = useMemo(
    () =>
      Array.from({ length: 4 }, (_, wi) =>
        Array.from({ length: 7 }, (_, di) => toISODate(addDays(start, wi * 7 + di))),
      ),
    [start],
  );

  const updateWeekItem = <K extends keyof Task>(
    id: string,
    key: K,
    value: Task[K],
  ) => {
    setTasks((prev) =>
      prev
        .map((t) => (t.id === id ? updateTask(t, key, value) : t))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
    );
  };

  const addWeekItem = (weekIndex: number) => {
    const day = weeks[weekIndex]?.[0] ?? toISODate(new Date());
    const newItem = createTask({
      title: "New item",
      category: "Task",
      date: day,
      time: "09:00",
      endTime: "10:00",
      status: "planned",
      priority: "medium",
      note: "",
    });
    setTasks((prev) => [...prev, newItem].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
  };

  return (
    <div className="space-y-4 px-2">
      <BunStrip imgs={BUNS_WEEKLY} />
      <div className="space-y-4">
        {weeks.map((weekDays, weekIndex) => {
          const weekTasks = tasks
            .filter((t) => weekDays.includes(t.date))
            .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
          return (
            <Card
              key={weekIndex}
              className="rounded-2xl bg-white/80 backdrop-blur-sm shadow-sm ring-1 ring-slate-100"
            >
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4">
                <div>
                  <CardTitle className="text-base font-semibold text-slate-700">
                    Week {weekIndex + 1}
                  </CardTitle>
                  <div className="text-[11px] text-slate-500">
                    {new Date(`${weekDays[0]}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" })} - {weekDays[0]}
                    {"  "}→{"  "}
                    {new Date(`${weekDays[6]}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" })} - {weekDays[6]}
                  </div>
                </div>
                <Button
                  className="rounded-full px-4 py-2 text-sm bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90"
                  onClick={() => addWeekItem(weekIndex)}
                >
                  Add row
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 px-4">
                <div className="overflow-auto">
                  <table className="min-w-full text-xs">
                    <thead className="text-slate-600">
                      <tr className="border-b border-slate-200">
                        <th className="py-2 px-2 text-left">Type</th>
                        <th className="py-2 px-2 text-left">Title</th>
                        <th className="py-2 px-2 text-left">Day</th>
                        <th className="py-2 px-2 text-left">Start</th>
                        <th className="py-2 px-2 text-left">End</th>
                        <th className="py-2 px-2 text-left">Note</th>
                        <th className="py-2 px-2 text-left">Priority</th>
                        <th className="py-2 px-2 text-left">Effort</th>
                        <th className="py-2 px-2 text-center">Archive</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekTasks.map((item) => (
                        <Fragment key={item.id}>
                        <tr
                          className="border-b border-slate-100 hover:bg-pink-50/30 transition-colors"
                        >
                          <td className="py-2 px-2">
                            <select
                              className="rounded-md border border-slate-200 px-2 py-1 text-[11px]"
                              value={item.category}
                              onChange={(e) =>
                                updateWeekItem(
                                  item.id,
                                  "category",
                                  e.target.value,
                                )
                              }
                            >
                              <option value="Task">Task</option>
                              <option value="Schedule">Schedule</option>
                              <option value="Appointment">Appointment</option>
                            </select>
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              value={item.title}
                              onChange={(e) => updateWeekItem(item.id, "title", e.target.value)}
                            />
                          </td>
                          <td className="py-2 px-2">
                          <select
                            className="rounded-md border border-slate-200 px-2 py-1 text-[11px]"
                            value={item.date}
                            onChange={(e) => updateWeekItem(item.id, "date", e.target.value)}
                          >
                            {weekDays.map((d) => (
                              <option key={d} value={d}>
                                {`${new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
                                  weekday: "short",
                                })} - ${d}`}
                              </option>
                            ))}
                          </select>
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="time"
                              value={item.time}
                              onChange={(e) => updateWeekItem(item.id, "time", e.target.value)}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="time"
                              value={item.endTime ?? ""}
                              onChange={(e) => updateWeekItem(item.id, "endTime", e.target.value)}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              value={item.note ?? ""}
                              onChange={(e) => updateWeekItem(item.id, "note", e.target.value)}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <select
                              className="rounded-md border border-slate-200 px-2 py-1 text-[11px]"
                              value={item.priority}
                              onChange={(e) =>
                                updateWeekItem(item.id, "priority", e.target.value as Task["priority"])
                              }
                            >
                              <option value="critical">critical</option>
                              <option value="high">high</option>
                              <option value="medium">medium</option>
                              <option value="low">low</option>
                            </select>
                          </td>
                          <td className="py-2 px-2">
                            <div className="text-[11px] text-slate-600">{formatEffortMinutes(item.estimatedMinutes)}</div>
                            <Button variant="outline" className="mt-1 h-7 px-2 text-[10px]" onClick={() => setEditingEffortId(editingEffortId === item.id ? null : item.id)}>Edit effort</Button>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <Button
                              variant="outline"
                              className="h-8 rounded-full px-3 text-xs text-slate-600 hover:text-red-600"
                              onClick={() => {
                                if (taskHasActiveTimer(timeLogs, item.id)) { window.alert("Stop and save or discard this task’s active timer before archiving it."); return; }
                                setTasks((prev) => prev.map((t) => (t.id === item.id ? archiveTask(t) : t)));
                              }}
                            >
                              Archive
                            </Button>
                          </td>
                        </tr>
                        {editingEffortId === item.id ? <tr><td colSpan={9} className="p-3"><TaskEffortEditor task={item} compact onSave={(patch, complete) => {
                          const linked = sessionsForParent(sessions, item.id);
                          const warnings = parentEstimateWarnings(patch.estimatedMinutes, linked);
                          if (item.isSplittable && !patch.isSplittable && linked.length) warnings.push("Existing work sessions will be preserved when splitting is turned off.");
                          if (warnings.length && !window.confirm(`${warnings.join("\n")}\n\nSave this effort change?`)) return;
                          setTasks((current) => current.map((task) => {
                            if (task.id !== item.id) return task;
                            const updated = { ...task, ...patch, updatedAt: new Date().toISOString() };
                            return complete ? completeTask(updated) : updated;
                          }));
                          setEditingEffortId(null);
                        }} onCancel={() => setEditingEffortId(null)}/></td></tr> : null}
                        </Fragment>
                      ))}
                      {weekTasks.length === 0 && (
                        <tr>
                          <td colSpan={9} className="py-3 text-center text-slate-500">
                            No rows yet. Click “Add row” to plan this week.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// Checklist / Projects view
type ProjectStatus = "Planned" | "In Progress" | "Blocked" | "Done";
interface ProjectItem {
  id: string;
  start: string; // ISO
  field: string;
  project: string;
  task: string;
  priority: "high" | "medium" | "low";
  notes: string;
  drop: boolean;
  deadline: string; // ISO end date
  hours: number;
  progress: boolean;
  status: ProjectStatus;
}

const sampleProjects: ProjectItem[] = [
  {
    id: "p1",
    start: "2025-08-05",
    field: "GPA năm 3",
    project: "Kinh tế vi mô",
    task: "Ôn chương 3 + bài tập",
    priority: "high",
    notes: "Slide 45-70 + bài tập nhóm",
    drop: false,
    deadline: "2025-08-20",
    hours: 6,
    progress: false,
    status: "In Progress",
  },
  {
    id: "p2",
    start: "2025-08-10",
    field: "Học ngoại ngữ",
    project: "IELTS",
    task: "Listening test 2",
    priority: "medium",
    notes: "Cam 17 test 2",
    drop: false,
    deadline: "2025-08-22",
    hours: 2,
    progress: true,
    status: "In Progress",
  },
  {
    id: "p3",
    start: "2025-08-01",
    field: "Sức khỏe",
    project: "Yoga",
    task: "20 phút buổi sáng",
    priority: "medium",
    notes: "Flow nhẹ + hít thở",
    drop: false,
    deadline: "2025-08-31",
    hours: 1,
    progress: true,
    status: "Planned",
  },
];

function ChecklistView({
  rows,
  setRows,
  note,
  setNote,
}: {
  rows: ProjectItem[];
  setRows: Dispatch<SetStateAction<ProjectItem[]>>;
  note: string;
  setNote: (value: string) => void;
}) {
  const today = new Date();

  const orderedRows = rows
    .slice()
    .sort((a, b) => {
      const aTime = a.start ? new Date(`${a.start}T00:00:00`).getTime() : 0;
      const bTime = b.start ? new Date(`${b.start}T00:00:00`).getTime() : 0;
      return bTime - aTime; // newer dates on top, older drift down
    });

  const withTimeline = orderedRows.map((p) => {
    const start = p.start ? new Date(`${p.start}T00:00:00`) : null;
    const end = p.deadline ? new Date(`${p.deadline}T00:00:00`) : null;
    const daysWorking =
      start && !Number.isNaN(start.getTime())
        ? Math.max(0, Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;
    const daysLeft =
      end && !Number.isNaN(end.getTime())
        ? Math.max(0, Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;
    return { ...p, daysWorking, daysLeft };
  });

  const updateRow = <K extends keyof ProjectItem>(id: string, key: K, value: ProjectItem[K]) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  };

  const addRow = () => {
    setRows((prev) => [
      {
        id: crypto.randomUUID(),
        start: toISODate(new Date()),
        field: "",
        project: "",
        task: "",
        priority: "medium",
        notes: "",
        drop: false,
        deadline: "",
        hours: 0,
        progress: false,
        status: "Planned",
      },
      ...prev,
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white/80 backdrop-blur-sm ring-1 ring-pink-100 shadow p-4">
        <div className="mb-3">
          <BunStrip imgs={BUNS_CHECKLIST} />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <CardTitle className="text-lg">Checklist / Projects</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="rounded-full bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90"
              onClick={addRow}
            >
              Add row
            </Button>
            <div className="text-xs text-slate-600">Start month, fields, priority, deadline math, status</div>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="py-2 px-2 text-left">Start month</th>
                <th className="py-2 px-2 text-left">Field</th>
                <th className="py-2 px-2 text-left">Project</th>
                <th className="py-2 px-2 text-left">Task / Activity</th>
                <th className="py-2 px-2 text-left">Priority</th>
                <th className="py-2 px-2 text-left">File / Notes</th>
                <th className="py-2 px-2 text-left">Hours</th>
                <th className="py-2 px-2 text-center">Drop?</th>
                <th className="py-2 px-2 text-left">Deadline (start → end)</th>
                <th className="py-2 px-2 text-center">Progress</th>
                <th className="py-2 px-2 text-left">Timeline</th>
                <th className="py-2 px-2 text-left">Status</th>
                <th className="py-2 px-2 text-center">Delete</th>
              </tr>
            </thead>
            <tbody>
              {withTimeline.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-pink-50/30 transition-colors">
                  <td className="py-2 px-2">
                    <Input
                      type="month"
                      value={r.start.slice(0, 7)}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updateRow(r.id, "start", e.target.value ? `${e.target.value}-01` : "")
                      }
                    />
                  </td>
                  <td className="py-2 px-2">
                    <Input value={r.field} onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(r.id, "field", e.target.value)} />
                  </td>
                  <td className="py-2 px-2">
                    <Input value={r.project} onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(r.id, "project", e.target.value)} />
                  </td>
                  <td className="py-2 px-2">
                    <Input value={r.task} onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(r.id, "task", e.target.value)} />
                  </td>
                  <td className="py-2 px-2 capitalize">
                    <select
                      className="rounded-md border border-slate-200 px-2 py-1 text-[11px]"
                      value={r.priority}
                      onChange={(e) => updateRow(r.id, "priority", e.target.value as ProjectItem["priority"])}
                    >
                      <option value="high">high</option>
                      <option value="medium">medium</option>
                      <option value="low">low</option>
                    </select>
                  </td>
                  <td className="py-2 px-2">
                    <Input value={r.notes} onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(r.id, "notes", e.target.value)} />
                  </td>
                  <td className="py-2 px-2">
                    <Input
                      type="number"
                      min={0}
                      value={r.hours}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(r.id, "hours", Number(e.target.value) || 0)}
                    />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <Checkbox checked={r.drop} onCheckedChange={() => updateRow(r.id, "drop", !r.drop)} />
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex flex-col gap-1">
                      <Input
                        type="date"
                        value={r.start}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(r.id, "start", e.target.value)}
                      />
                      <Input
                        type="date"
                        value={r.deadline}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(r.id, "deadline", e.target.value)}
                      />
                    </div>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <Checkbox checked={r.progress} onCheckedChange={() => updateRow(r.id, "progress", !r.progress)} />
                  </td>
                  <td className="py-2 px-2">
                    <div className="text-[11px] text-slate-600">Working: {r.daysWorking}d</div>
                    <div className="text-[11px] text-slate-600">Left: {r.daysLeft}d</div>
                  </td>
                  <td className="py-2 px-2">
                    <select
                      className="rounded-md border border-slate-200 px-2 py-1 text-[11px]"
                      value={r.status}
                      onChange={(e) => updateRow(r.id, "status", e.target.value as ProjectStatus)}
                    >
                      <option value="Planned">Planned</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Blocked">Blocked</option>
                      <option value="Done">Done</option>
                    </select>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <Button
                      variant="outline"
                      className="h-8 w-8 text-slate-500 hover:text-red-600"
                      onClick={() => setRows((prev) => prev.filter((p) => p.id !== r.id))}
                      aria-label="Delete row"
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-2xl bg-white/70 ring-1 ring-slate-100 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-700">Carry-over note</div>
          <div className="text-[11px] text-slate-500">Use this to remember what to check each week</div>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Follow up with recruiter about the interview on Tuesday"
          className="w-full min-h-[100px] rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-pink-200"
        />
      </div>
    </div>
  );
}

// -------------------- GOOGLE CALENDAR VIEW --------------------
function guessCategory(title: string) {
  const t = title.toLowerCase();
  if (t.includes("ielts") || t.includes("hsk") || t.includes("tiếng") || t.includes("listening")) return "Học ngoại ngữ";
  if (t.includes("yoga") || t.includes("gym") || t.includes("tập")) return "Sức khỏe";
  if (t.includes("marketing")) return "Marketing";
  if (t.includes("đầu tư") || t.includes("invest")) return "Đầu tư";
  return "General";
}

function mapEventToTask(e: GoogleCalendarEvent): Task | null {
  const startISO = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00` : null);
  const endISO = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00` : null);
  if (!startISO) return null;

  const d = new Date(startISO);
  const end = endISO ? new Date(endISO) : null;
  const date = toISODate(d);
  const time = getEventStartTimeHHMM(e);
  let durationMins: number | undefined;
  let endTime: string | undefined;
  if (end) {
    const diff = Math.max(0, end.getTime() - d.getTime());
    durationMins = Math.max(15, Math.round(diff / (1000 * 60)));
    const hh = String(end.getHours()).padStart(2, "0");
    const mm = String(end.getMinutes()).padStart(2, "0");
    endTime = `${hh}:${mm}`;
  }

  return createTask({
    title: e.summary ?? "(No title)",
    date,
    time,
    endTime,
    durationMins,
    status: "planned",
    priority: "medium",
    category: guessCategory(e.summary ?? ""),
  });
}

function GoogleCalendarView({
  tasks,
  setTasks,
  accessToken,
  setAccessToken,
  tokenClient,
  setTokenClient,
}: {
  tasks: Task[];
  setTasks: Dispatch<SetStateAction<Task[]>>;
  accessToken: string | null;
  setAccessToken: Dispatch<SetStateAction<string | null>>;
  tokenClient: GoogleTokenClient | null;
  setTokenClient: Dispatch<SetStateAction<GoogleTokenClient | null>>;
}) {
  const [selectedDate, setSelectedDate] = useState<string>(toISODate(new Date()));
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);

  const dayTasks = useMemo(() => tasks.filter((t) => t.date === selectedDate), [tasks, selectedDate]);
  const monthPrefix = selectedDate.slice(0, 7);
  const monthTasks = useMemo(() => tasks.filter((t) => t.date.startsWith(monthPrefix)), [tasks, monthPrefix]);

  const makeKey = (title: string, dateISO: string, timeHHMM: string, endHHMM?: string) =>
    `${dateISO}-${timeHHMM}-${endHHMM ?? ""}-${title}`.toLowerCase();

  const fetchExistingKeys = async (timeMinISO: string, timeMaxISO: string) => {
    const events = await listPrimaryEvents({
      accessToken: accessToken as string,
      timeMinISO,
      timeMaxISO,
    });
    const keys = new Set<string>();
    events.forEach((e) => {
      const startISO = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00` : null);
      const endISO = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00` : null);
      if (!startISO) return;
      const d = new Date(startISO);
      const end = endISO ? new Date(endISO) : null;
      const date = toISODate(d);
      const time = getEventStartTimeHHMM(e);
      const title = e.summary ?? "";
      let endTime: string | undefined;
      if (end) {
        endTime = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
      }
      keys.add(makeKey(title, date, time, endTime));
    });
    return keys;
  };

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const tryInit = () => {
      if (!window.google?.accounts?.oauth2) return false;

      const tc = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "https://www.googleapis.com/auth/calendar.events",
        callback: (resp: GoogleTokenResponse) => {
          if (resp?.access_token) setAccessToken(resp.access_token);
        },
      });

      setTokenClient(tc);
      return true;
    };

    if (tryInit()) return;

    let attempts = 0;
    const id = window.setInterval(() => {
      attempts += 1;
      if (tryInit()) window.clearInterval(id);
      else if (attempts >= 50) {
        window.clearInterval(id);
        setSyncError("Google Identity Services could not be loaded.");
      }
    }, 200);

    return () => window.clearInterval(id);
  }, [setAccessToken, setTokenClient]);

  const connectGoogle = () => {
    if (!tokenClient) return;
    setSyncError(null);
    setSyncInfo(null);
    tokenClient.requestAccessToken({ prompt: "consent" });
  };

  const syncDayFromGoogle = async () => {
    if (!accessToken) return;

    const start = new Date(`${selectedDate}T00:00:00`);
    const end = new Date(`${selectedDate}T23:59:59`);

    try {
      setSyncError(null);
      setSyncInfo(null);
      const events = await listPrimaryEvents({
        accessToken,
        timeMinISO: start.toISOString(),
        timeMaxISO: end.toISOString(),
      });

      const mapped = events
        .map(mapEventToTask)
        .filter(Boolean) as Task[];

      setTasks((prev) => {
        const others = prev.filter((t) => t.date !== selectedDate);
        const existingDay = prev.filter((t) => t.date === selectedDate);
        const mergedMap = new Map<string, Task>();

        const makeKey = (t: Task) =>
          `${t.date}-${t.time}-${t.endTime ?? ""}-${t.title}`.toLowerCase();
        existingDay.forEach((t) => mergedMap.set(makeKey(t), t));
        mapped.forEach((t) => {
          const key = makeKey(t);
          if (!mergedMap.has(key)) mergedMap.set(key, t as Task);
        });

        const mergedDay = Array.from(mergedMap.values()).sort((a, b) =>
          (a.date + a.time).localeCompare(b.date + b.time),
        );
        return [...others, ...mergedDay].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      });
    } catch (err) {
      console.error("Google Calendar sync failed", err);
      const message = err instanceof Error ? err.message : "Unknown Google Calendar error";
      setSyncError(message);
    }
  };

  const pushDayToGoogle = async () => {
    if (!accessToken) return;
    if (dayTasks.length === 0) {
      setSyncError("No tasks for this day to push.");
      return;
    }

    try {
      setSyncError(null);
      setSyncInfo("Pushing tasks to Google Calendar...");
      const start = new Date(`${selectedDate}T00:00:00`);
      const end = new Date(`${selectedDate}T23:59:59`);
      const existing = await fetchExistingKeys(start.toISOString(), end.toISOString());
      let pushed = 0;
      for (const t of dayTasks) {
        const startISO = new Date(`${t.date}T${t.time || "00:00"}:00`).toISOString();
        const durationMs = (t.durationMins ?? 60) * 60 * 1000;
        const endISO = t.endTime
          ? new Date(`${t.date}T${t.endTime}:00`).toISOString()
          : new Date(new Date(startISO).getTime() + durationMs).toISOString();
        const endHHMM = t.endTime ?? endISO.substring(11, 16);
        const key = makeKey(t.title, t.date, t.time || "00:00", endHHMM);
        if (existing.has(key)) continue;
        await createPrimaryEvent({
          accessToken,
          summary: t.title,
          description: `${t.category ?? "Task"} • Priority: ${t.priority}`,
          startISO,
          endISO,
        });
        pushed += 1;
        existing.add(key);
      }
      setSyncInfo(`Pushed ${pushed} task(s) to Google Calendar (skipped duplicates).`);
    } catch (err) {
      console.error("Google Calendar push failed", err);
      const message = err instanceof Error ? err.message : "Unknown Google Calendar push error";
      setSyncError(message);
      setSyncInfo(null);
    }
  };

  const pushMonthToGoogle = async () => {
    if (!accessToken) return;
    if (monthTasks.length === 0) {
      setSyncError("No tasks for this month to push.");
      return;
    }
    try {
      setSyncError(null);
      setSyncInfo("Pushing month tasks to Google Calendar...");
      const monthStart = new Date(`${monthPrefix}-01T00:00:00`);
      const monthEnd = new Date(new Date(`${monthPrefix}-01T00:00:00`).getFullYear(), new Date(`${monthPrefix}-01T00:00:00`).getMonth() + 1, 0, 23, 59, 59);
      const existing = await fetchExistingKeys(monthStart.toISOString(), monthEnd.toISOString());
      let pushed = 0;
      for (const t of monthTasks) {
        const startISO = new Date(`${t.date}T${t.time || "00:00"}:00`).toISOString();
        const durationMs = (t.durationMins ?? 60) * 60 * 1000;
        const endISO = t.endTime
          ? new Date(`${t.date}T${t.endTime}:00`).toISOString()
          : new Date(new Date(startISO).getTime() + durationMs).toISOString();
        const endHHMM = t.endTime ?? endISO.substring(11, 16);
        const key = makeKey(t.title, t.date, t.time || "00:00", endHHMM);
        if (existing.has(key)) continue;
        await createPrimaryEvent({
          accessToken,
          summary: t.title,
          description: `${t.category ?? "Task"} • Priority: ${t.priority}`,
          startISO,
          endISO,
        });
        pushed += 1;
        existing.add(key);
      }
      setSyncInfo(`Pushed ${pushed} task(s) for ${monthPrefix} (skipped duplicates).`);
    } catch (err) {
      console.error("Google Calendar month push failed", err);
      const message = err instanceof Error ? err.message : "Unknown Google Calendar push error";
      setSyncError(message);
      setSyncInfo(null);
    }
  };

  const toggleTaskDone = (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? completeTask(t) : t)));
  };

  const clearDay = () =>
    setTasks((prev) => prev.map((t) => (t.date === selectedDate ? archiveTask(t) : t)));

  const updateTaskPriority = (id: string, priority: Task["priority"]) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? updateTask(t, "priority", priority) : t)));
  };

  const selectedDateObj = new Date(`${selectedDate}T00:00:00`);
  const selectedMonthYear = { year: selectedDateObj.getFullYear(), monthIndex: selectedDateObj.getMonth() };

  return (
    <div className="min-h-screen p-4 sm:p-6 relative">
      <div
        className="absolute inset-0 bg-cover bg-center bg-fixed blur-sm"
        style={{ backgroundImage: `url(${bgImg})` }}
      />
      <div className="absolute inset-0 bg-white/30" />
      <div className="relative">
      <div className="max-w-6xl mx-auto flex flex-col gap-4 px-2 sm:px-4">
        <BunStrip imgs={BUNS_GOOGLE} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="rounded-full bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90 disabled:opacity-60"
              onClick={connectGoogle}
              disabled={!GOOGLE_CLIENT_ID}
            >
              {accessToken ? "Google Connected ✅" : "Connect Google Calendar"}
            </Button>
            <Button
              className="rounded-full bg-white/80 ring-1 ring-pink-100 text-slate-700 hover:bg-pink-50"
              variant="outline"
              onClick={syncDayFromGoogle}
              disabled={!accessToken}
            >
              Sync Selected Day
            </Button>
            <Button
              className="rounded-full bg-white/80 ring-1 ring-pink-100 text-slate-700 hover:bg-pink-50"
              variant="outline"
              onClick={pushDayToGoogle}
              disabled={!accessToken || dayTasks.length === 0}
            >
              Push Day to Google
            </Button>
            <Button
              className="rounded-full bg-white/80 ring-1 ring-pink-100 text-slate-700 hover:bg-pink-50"
              variant="outline"
              onClick={pushMonthToGoogle}
              disabled={!accessToken || monthTasks.length === 0}
            >
              Push Month to Google
            </Button>
            <Button
              className="rounded-full bg-white/80 ring-1 ring-pink-100 text-slate-700 hover:bg-pink-50"
              variant="outline"
              onClick={clearDay}
            >
              Archive Day
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Selected day</span>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSelectedDate(e.target.value)}
              className="w-[170px] rounded-full bg-white/70"
            />
          </div>
        </div>
        {syncError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Sync failed: {syncError}
          </div>
        )}
        {syncInfo && !syncError && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {syncInfo}
          </div>
        )}

        <div className="grid lg:grid-cols-12 gap-4 pt-2 sm:pt-4">
          <div className="lg:col-span-4 space-y-4">
            <Card className="bg-white/80 backdrop-blur-sm rounded-2xl shadow ring-1 ring-pink-100 mt-2">
              <CardHeader className="px-4 pt-3">
                <CardTitle className="text-base">Month Overview</CardTitle>
              </CardHeader>
              <CardContent className="px-3 sm:px-4 py-4 sm:py-5">
                <MonthCalendar
                  year={selectedMonthYear.year}
                  month={selectedMonthYear.monthIndex}
                  tasks={tasks}
                  selectedDate={selectedDate}
                  onSelectDate={(iso) => setSelectedDate(iso)}
                />
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-8">
            <Card className="bg-white/80 backdrop-blur-sm rounded-2xl shadow ring-1 ring-pink-100 mt-2">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 pt-3">
                <CardTitle className="text-base">Daily Plan — {selectedDate}</CardTitle>
                <div className="text-xs text-muted-foreground">Tip: Click the checkbox to mark completed</div>
              </CardHeader>
              <CardContent className="space-y-3 px-4 py-4 sm:py-5">
                {dayTasks.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No tasks yet. Click <b>Sync Selected Day</b> to pull from Google Calendar.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {dayTasks
                      .slice()
                      .sort((a, b) => a.time.localeCompare(b.time))
                      .map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between gap-3 rounded-2xl bg-white/60 px-4 py-3 ring-1 ring-pink-100"
                        >
                          <div className="flex items-center gap-3">
                            <Checkbox checked={t.status === "completed"} onCheckedChange={() => toggleTaskDone(t.id)} />
                            <div>
                              <div className={`text-sm font-medium ${t.status === "completed" ? "line-through text-muted-foreground" : ""}`}>
                                {t.title}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {t.category} • {t.time}
                              </div>
                              <div className="text-xs text-muted-foreground">Estimate: {formatEffortMinutes(t.estimatedMinutes)}</div>
                            </div>
                          </div>

                          <select
                            className="rounded-full border border-slate-200 px-2 py-1 text-xs"
                            value={t.priority}
                            onChange={(e) => updateTaskPriority(t.id, e.target.value as Task["priority"])}
                          >
                            <option value="critical">critical</option>
                            <option value="high">high</option>
                            <option value="medium">medium</option>
                            <option value="low">low</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

// Kept temporarily for rollback compatibility with the pre-Phase-12 local view.
// The navigation now renders CalendarIntegrationPage instead.
void GoogleCalendarView;

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function lifecycleDate(task: Task) {
  const usableTimestamp = (value: string | null | undefined) =>
    value && !value.startsWith("1970-01-01") ? value : undefined;
  const recordedLifecycleDate =
    usableTimestamp(task.completedAt) ?? usableTimestamp(task.archivedAt);
  if (recordedLifecycleDate) return recordedLifecycleDate;

  const plannerDate = task.date || task.dueDate || task.updatedAt.slice(0, 10);
  return `${plannerDate}T${task.time || task.dueTime || "00:00"}`;
}

function TaskDetailsDialog({ task, onClose, sessions = [] }: { task: Task | null; onClose: () => void; sessions?: TaskSession[] }) {
  useEffect(() => {
    if (!task) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, task]);

  if (!task) return null;
  const linkedSessions = sessionsForParent(sessions, task.id);
  const linkedTotals = sessionTotals(task, linkedSessions);
  const details = [
    ["Status", task.status],
    ["Scheduled date", task.date],
    ["Start time", task.time],
    ["End time", task.endTime ?? "—"],
    ["Duration", task.durationMins ? `${task.durationMins} minutes` : "—"],
    ["Estimate", formatEffortMinutes(task.estimatedMinutes)],
    ["Actual", task.actualMinutes === undefined ? "Not entered" : formatEffortMinutes(task.actualMinutes)],
    ["Remaining", displayedRemainingMinutes(task) === undefined ? "Not calculable" : formatEffortMinutes(displayedRemainingMinutes(task))],
    ["Estimate state", estimateState(task)],
    ["Task style", task.isSplittable ? `Splittable · ${formatEffortMinutes(task.minimumSessionMinutes)} minimum · ${formatEffortMinutes(task.maximumSessionMinutes)} maximum` : "Single session"],
    ["Category", task.category],
    ["Priority", task.priority],
    ["Tags", task.tags?.length ? task.tags.join(", ") : "—"],
    ["Description", task.description ?? "—"],
    ["Notes", task.note ?? "—"],
    ["Created", formatTimestamp(task.createdAt)],
    ["Updated", formatTimestamp(task.updatedAt)],
    ["Completed", formatTimestamp(task.completedAt)],
    ["Archived", formatTimestamp(task.archivedAt)],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" role="presentation" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-details-title"
        className="max-h-[85vh] w-full max-w-xl overflow-auto rounded-2xl bg-white/95 p-5 shadow-xl ring-1 ring-pink-100 backdrop-blur-sm"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Task details</div>
            <h2 id="task-details-title" className="text-lg font-semibold text-slate-800">{task.title}</h2>
            {task.recurrence ? <p className="mt-1 text-xs font-medium text-pink-700">Recurring occurrence · {task.recurrence.occurrenceDate} · {task.recurrence.status}</p> : null}
          </div>
          <Button autoFocus variant="outline" className="rounded-full bg-white/80" onClick={onClose}>Close</Button>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-pink-50/40 px-3 py-2 ring-1 ring-pink-100">
              <dt className="text-[11px] text-slate-500">{label}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{value}</dd>
            </div>
          ))}
        </dl>
        <section className="mt-4" aria-labelledby="task-details-sessions">
          <h3 id="task-details-sessions" className="text-sm font-semibold text-slate-700">Work sessions</h3>
          {linkedSessions.length === 0 ? <p className="mt-2 text-sm text-slate-500">No work sessions.</p> : <><p className="mt-1 text-xs text-slate-500">Assigned {formatEffortMinutes(linkedTotals.assignedMinutes)} · Completed {formatEffortMinutes(linkedTotals.completedMinutes)} · Progress {linkedTotals.progressPercent}%</p><ol className="mt-2 space-y-2">{linkedSessions.map((session) => <li key={session.id} className="rounded-xl bg-pink-50/40 px-3 py-2 text-sm ring-1 ring-pink-100"><div className="font-medium text-slate-700">{session.title}</div><div className="text-xs text-slate-500">{formatEffortMinutes(session.estimatedMinutes)} · {session.status} · {session.isGenerated ? "Generated" : "Manual"}</div></li>)}</ol></>}
        </section>
      </div>
    </div>
  );
}

type ArchiveSort = "newest" | "oldest" | "recently-completed" | "recently-archived";

function ArchiveView({ tasks, setTasks, sessions, setSessions, timeLogs, setTimeLogs }: { tasks: Task[]; setTasks: Dispatch<SetStateAction<Task[]>>; sessions: TaskSession[]; setSessions: Dispatch<SetStateAction<TaskSession[]>>; timeLogs: TimeLog[]; setTimeLogs: Dispatch<SetStateAction<TimeLog[]>> }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [archiveDate, setArchiveDate] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [sort, setSort] = useState<ArchiveSort>("recently-archived");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const allArchivedTasks = useMemo(() => tasks.filter((task) => task.status === "archived"), [tasks]);
  const categories = useMemo(
    () => Array.from(new Set(allArchivedTasks.map((task) => task.category))).sort(),
    [allArchivedTasks],
  );
  const archivedTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = allArchivedTasks.filter((task) => {
      const searchable = [task.title, task.description, task.note, ...(task.tags ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return (
        (!normalizedQuery || searchable.includes(normalizedQuery)) &&
        (!category || task.category === category) &&
        (!priority || task.priority === priority) &&
        (!completionDate || task.completedAt?.slice(0, 10) === completionDate) &&
        (!archiveDate || task.archivedAt?.slice(0, 10) === archiveDate) &&
        (!scheduledDate || task.date === scheduledDate)
      );
    });
    const valueForSort = (task: Task) => {
      if (sort === "recently-completed") return task.completedAt ?? "";
      if (sort === "recently-archived") return task.archivedAt ?? "";
      return `${task.date}T${task.time}`;
    };
    return filtered.sort((a, b) =>
      sort === "oldest"
        ? valueForSort(a).localeCompare(valueForSort(b))
        : valueForSort(b).localeCompare(valueForSort(a)),
    );
  }, [allArchivedTasks, archiveDate, category, completionDate, priority, query, scheduledDate, sort]);

  const permanentlyDelete = (task: Task) => {
    if (taskHasActiveTimer(timeLogs, task.id)) { window.alert("Stop and save or discard this task’s active timer before deleting it."); return; }
    const linkedCount = sessions.filter((session) => session.parentTaskId === task.id).length;
    const logCount = timeLogs.filter((log) => log.taskId === task.id).length;
    const confirmed = window.confirm(
      `Permanently delete “${task.title}”? ${linkedCount ? `${linkedCount} linked work session(s) will also be deleted. ` : ""}${logCount ? `${logCount} linked time log(s) will also be deleted. ` : ""}This cannot be undone.`,
    );
    if (!confirmed) return;
    setTasks((prev) => permanentlyDeleteTask(prev, task.id));
    setSessions((current) => current.filter((session) => session.parentTaskId !== task.id));
    setTimeLogs((current) => current.filter((log) => log.taskId !== task.id));
  };

  return (
    <div className="space-y-4 px-2">
      <BunStrip imgs={BUNS_MONTHLY} />
      <SoftCard title="Archived Tasks" right={<Trash2Icon className="h-4 w-4 text-slate-500" />}>
        {allArchivedTasks.length === 0 ? (
          <div className="text-sm text-slate-500">No archived tasks.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
              <Input aria-label="Search archived tasks" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, description, notes, tags" className="rounded-xl bg-white/80 lg:col-span-2" />
              <select aria-label="Filter archived tasks by category" value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700">
                <option value="">All categories</option>
                {categories.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <select aria-label="Filter archived tasks by priority" value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700">
                <option value="">All priorities</option>
                <option value="critical">critical</option><option value="high">high</option><option value="medium">medium</option><option value="low">low</option>
              </select>
              <label className="text-[11px] text-slate-500">Completed<Input type="date" value={completionDate} onChange={(event) => setCompletionDate(event.target.value)} className="mt-1 rounded-xl bg-white/80" /></label>
              <label className="text-[11px] text-slate-500">Archived<Input type="date" value={archiveDate} onChange={(event) => setArchiveDate(event.target.value)} className="mt-1 rounded-xl bg-white/80" /></label>
              <label className="text-[11px] text-slate-500">Originally scheduled<Input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} className="mt-1 rounded-xl bg-white/80" /></label>
              <label className="text-[11px] text-slate-500">Sort<select value={sort} onChange={(event) => setSort(event.target.value as ArchiveSort)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700">
                <option value="newest">Newest scheduled</option><option value="oldest">Oldest scheduled</option><option value="recently-completed">Recently completed</option><option value="recently-archived">Recently archived</option>
              </select></label>
            </div>
            {archivedTasks.length === 0 ? <div className="text-sm text-slate-500">No archived tasks match these filters.</div> : null}
            {archivedTasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-col gap-3 rounded-2xl bg-white/70 px-4 py-3 ring-1 ring-slate-100 sm:flex-row sm:items-center sm:justify-between"
              >
                <button type="button" className="text-left" onClick={() => setSelectedTask(task)}>
                  <div className="text-sm font-medium text-slate-700">{task.title}</div>
                  <div className="text-xs text-slate-500">
                    {task.date} • {task.time} • {task.category}
                  </div>
                  <div className="text-xs text-slate-500">Estimate: {formatEffortMinutes(task.estimatedMinutes)}{task.actualMinutes === undefined ? "" : ` • Actual: ${formatEffortMinutes(task.actualMinutes)}`}</div>
                </button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="rounded-full bg-white/80 text-slate-700"
                    onClick={() =>
                      setTasks((prev) => prev.map((item) => (item.id === task.id ? restoreTask(item) : item)))
                    }
                  >
                    Restore
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-full bg-white/80 text-slate-600 hover:text-red-600"
                    onClick={() => permanentlyDelete(task)}
                  >
                    Delete permanently
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SoftCard>
      <TaskDetailsDialog task={selectedTask} onClose={() => setSelectedTask(null)} sessions={sessions} />
    </div>
  );
}

function HistoryView({ tasks, sessions }: { tasks: Task[]; sessions: TaskSession[] }) {
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const monthKey = `${visibleMonth.getFullYear()}-${pad2(visibleMonth.getMonth() + 1)}`;
  const monthTasks = useMemo(
    () => tasks
      .filter((task) => (task.status === "completed" || task.status === "archived") && lifecycleDate(task).slice(0, 7) === monthKey)
      .slice()
      .sort((a, b) => lifecycleDate(b).localeCompare(lifecycleDate(a))),
    [monthKey, tasks],
  );
  const moveMonth = (amount: number) => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  const moveYear = (amount: number) => setVisibleMonth((current) => new Date(current.getFullYear() + amount, current.getMonth(), 1));

  return (
    <div className="space-y-4 px-2">
      <BunStrip imgs={BUNS_MONTHLY} />
      <SoftCard title="Task History" right={<CalendarDaysIcon className="h-4 w-4 text-pink-600" />}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-full bg-white/80" onClick={() => moveYear(-1)}>Previous year</Button>
            <Button variant="outline" className="rounded-full bg-white/80" onClick={() => moveMonth(-1)}>Previous month</Button>
          </div>
          <div className="rounded-full bg-pink-50 px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-pink-100">
            {visibleMonth.toLocaleString("default", { month: "long", year: "numeric" })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-full bg-white/80" onClick={() => moveMonth(1)}>Next month</Button>
            <Button variant="outline" className="rounded-full bg-white/80" onClick={() => moveYear(1)}>Next year</Button>
          </div>
        </div>
        <section aria-labelledby={`history-${monthKey}`}>
          <h3 id={`history-${monthKey}`} className="mb-2 text-sm font-semibold text-slate-700">
            {visibleMonth.toLocaleString("default", { month: "long", year: "numeric" })}
          </h3>
          {monthTasks.length === 0 ? (
            <div className="text-sm text-slate-500">No completed or archived tasks in this month.</div>
          ) : (
            <div className="space-y-2">
              {monthTasks.map((task) => {
                const historyDate = lifecycleDate(task).slice(0, 10);
                const lifecycleLabel = task.completedAt ? "Completed" : "Archived";
                return (
                  <button
                    type="button"
                    key={task.id}
                    onClick={() => setSelectedTask(task)}
                    className="flex w-full flex-col gap-1 rounded-2xl bg-white/70 px-4 py-3 text-left ring-1 ring-slate-100 transition-colors hover:bg-pink-50/50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-700">{task.title}</span>
                      <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-pink-100">{task.status}</span>
                    </div>
                    <div className="text-xs font-medium text-slate-600">{lifecycleLabel} {historyDate}</div>
                    <div className="text-xs text-slate-500">Estimate: {formatEffortMinutes(task.estimatedMinutes)}{task.actualMinutes === undefined ? "" : ` • Actual: ${formatEffortMinutes(task.actualMinutes)}`}</div>
                    <span className="text-xs text-slate-500">
                      {task.date && task.date !== historyDate ? `Scheduled ${task.date} • ` : ""}{task.category} • {task.priority}
                    </span>
                    {task.note ? <span className="line-clamp-2 text-xs text-slate-600">{task.note}</span> : null}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </SoftCard>
      <TaskDetailsDialog task={selectedTask} onClose={() => setSelectedTask(null)} sessions={sessions} />
    </div>
  );
}

export default function PlannerAppV2() {
  const [view, setView] = useState<View>("daily");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [checklistByDate, setChecklistByDate] = useState<ChecklistMap>({});
  const [checklistHydrated, setChecklistHydrated] = useState(false);
  const [projects, setProjects] = useState<ProjectItem[]>(sampleProjects);
  const [projectsHydrated, setProjectsHydrated] = useState(false);
  const [checklistNote, setChecklistNote] = useState("");
  const [checklistNoteHydrated, setChecklistNoteHydrated] = useState(false);
  const [musicQuery, setMusicQuery] = useState(DEFAULT_MUSIC_QUERY);
  const [musicHydrated, setMusicHydrated] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityBlock[]>([]);
  const [availabilityHydrated, setAvailabilityHydrated] = useState(false);
  const [availabilityOverrides, setAvailabilityOverrides] = useState<AvailabilityOverride[]>([]);
  const [availabilityOverridesHydrated, setAvailabilityOverridesHydrated] = useState(false);
  const [availabilityTemplates, setAvailabilityTemplates] = useState<AvailabilityTemplate[]>([]);
  const [availabilityTemplatesHydrated, setAvailabilityTemplatesHydrated] = useState(false);
  const [taskSessions, setTaskSessions] = useState<TaskSession[]>([]);
  const [taskSessionsHydrated, setTaskSessionsHydrated] = useState(false);
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
  const [scheduleBlocksHydrated, setScheduleBlocksHydrated] = useState(false);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [timeLogsHydrated, setTimeLogsHydrated] = useState(false);
  const [notifications, setNotifications] = useState<PlannerNotification[]>([]);
  const [notificationsHydrated, setNotificationsHydrated] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [remindersHydrated, setRemindersHydrated] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const [notificationSettingsHydrated, setNotificationSettingsHydrated] = useState(false);
  const [notificationMinute, setNotificationMinute] = useState(() => Math.floor(Date.now() / 60_000));
  const [calendarConnection, setCalendarConnection] = useState<CalendarConnection>(DEFAULT_CALENDAR_CONNECTION);
  const [calendarSettings, setCalendarSettings] = useState<CalendarSyncSettings>(DEFAULT_CALENDAR_SYNC_SETTINGS);
  const [externalCalendars, setExternalCalendars] = useState<ExternalCalendar[]>([]);
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>([]);
  const [calendarSyncRecords, setCalendarSyncRecords] = useState<CalendarSyncRecord[]>([]);
  const [calendarHydrated, setCalendarHydrated] = useState(false);
  const [aiSettings, setAISettings] = useState<AIAssistantSettings>(DEFAULT_AI_SETTINGS);
  const [assistantMessages, setAssistantMessages] = useState<AssistantConversationMessage[]>([]);
  const [assistantAudits, setAssistantAudits] = useState<AIAssistantActionAudit[]>([]);
  const [assistantHydrated, setAssistantHydrated] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [planningProjects, setPlanningProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [taskDependencies, setTaskDependencies] = useState<TaskDependency[]>([]);
  const [projectPlanningHydrated, setProjectPlanningHydrated] = useState(false);
  const [recurrenceDefinitions, setRecurrenceDefinitions] = useState<RecurrenceDefinition[]>([]);
  const [recurrenceOccurrences, setRecurrenceOccurrences] = useState<RecurrenceOccurrence[]>([]);
  const [recurrenceExceptions, setRecurrenceExceptions] = useState<RecurrenceException[]>([]);
  const [routineTemplates, setRoutineTemplates] = useState<RoutineTemplate[]>([]);
  const [recurrenceHydrated, setRecurrenceHydrated] = useState(false);
  const [recurrenceGenerationRan, setRecurrenceGenerationRan] = useState(false);
  const [timerRecovered, setTimerRecovered] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [syncInitialized, setSyncInitialized] = useState(false);
  const [syncState, setSyncState] = useState<"loading" | "saved" | "saving" | "offline" | "sync error">(
    firebaseEnabled ? "loading" : navigator.onLine ? "saved" : "offline",
  );
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);
  const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [syncRetry, setSyncRetry] = useState(0);
  const initializingUserRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (!raw) {
      setHydrated(true);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      setTasks(withoutBundledDemoTasks(migrateTasks(parsed)));
      setHydrated(true);
    } catch (err) {
      console.error("Failed to parse or migrate saved tasks; original storage was preserved", err);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks, hydrated]);

  useEffect(() => {
    const raw = localStorage.getItem(MUSIC_STORAGE_KEY);
    if (raw) {
      setMusicQuery(raw);
    }
    setMusicHydrated(true);
  }, []);

  useEffect(() => {
    if (!musicHydrated) return;
    writeLocalStorage(MUSIC_STORAGE_KEY, musicQuery);
  }, [musicQuery, musicHydrated]);

  useEffect(() => {
    const raw = localStorage.getItem(CHECKLIST_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ChecklistMap;
        if (parsed && typeof parsed === "object") {
          setChecklistByDate(parsed);
        }
      } catch (err) {
        console.error("Failed to parse saved checklist map", err);
        return;
      }
    }
    // seed today if empty
    setChecklistByDate((prev) => {
      const today = toISODate(new Date());
      if (prev[today]) return prev;
      return { ...prev, [today]: DEFAULT_CHECKLIST };
    });
    setChecklistHydrated(true);
  }, []);

  useEffect(() => {
    if (!checklistHydrated) return;
    writeLocalStorage(CHECKLIST_STORAGE_KEY, JSON.stringify(checklistByDate));
  }, [checklistByDate, checklistHydrated]);

  useEffect(() => {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ProjectItem[];
        if (Array.isArray(parsed)) {
          setProjects(parsed);
        }
      } catch (err) {
        console.error("Failed to parse saved projects", err);
        return;
      }
    }
    setProjectsHydrated(true);
  }, []);

  useEffect(() => {
    if (!projectsHydrated) return;
    writeLocalStorage(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  }, [projects, projectsHydrated]);

  useEffect(() => {
    const raw = localStorage.getItem(CHECKLIST_NOTE_STORAGE_KEY);
    if (raw) {
      setChecklistNote(raw);
    }
    setChecklistNoteHydrated(true);
  }, []);

  useEffect(() => {
    if (!checklistNoteHydrated) return;
    writeLocalStorage(CHECKLIST_NOTE_STORAGE_KEY, checklistNote);
  }, [checklistNote, checklistNoteHydrated]);

  useEffect(() => {
    const raw = localStorage.getItem(AVAILABILITY_STORAGE_KEY);
    if (raw) {
      try { setAvailability(migrateAvailabilityBlocks(JSON.parse(raw))); }
      catch (error) { console.error("Failed to parse saved availability; original storage was preserved", error); return; }
    }
    setAvailabilityHydrated(true);
  }, []);

  useEffect(() => {
    if (!availabilityHydrated) return;
    writeLocalStorage(AVAILABILITY_STORAGE_KEY, JSON.stringify(availability));
  }, [availability, availabilityHydrated]);

  useEffect(() => {
    const raw = localStorage.getItem(AVAILABILITY_OVERRIDES_STORAGE_KEY);
    if (raw) {
      try { setAvailabilityOverrides(migrateAvailabilityOverrides(JSON.parse(raw))); }
      catch (error) { console.error("Failed to parse saved availability overrides; original storage was preserved", error); return; }
    }
    setAvailabilityOverridesHydrated(true);
  }, []);

  useEffect(() => {
    if (!availabilityOverridesHydrated) return;
    writeLocalStorage(AVAILABILITY_OVERRIDES_STORAGE_KEY, JSON.stringify(availabilityOverrides));
  }, [availabilityOverrides, availabilityOverridesHydrated]);

  useEffect(() => {
    const raw = localStorage.getItem(AVAILABILITY_TEMPLATES_STORAGE_KEY);
    if (raw) {
      try { setAvailabilityTemplates(migrateAvailabilityTemplates(JSON.parse(raw))); }
      catch (error) { console.error("Failed to parse saved availability templates; original storage was preserved", error); return; }
    }
    setAvailabilityTemplatesHydrated(true);
  }, []);

  useEffect(() => {
    if (!availabilityTemplatesHydrated) return;
    writeLocalStorage(AVAILABILITY_TEMPLATES_STORAGE_KEY, JSON.stringify(availabilityTemplates));
  }, [availabilityTemplates, availabilityTemplatesHydrated]);

  useEffect(() => {
    const raw = localStorage.getItem(TASK_SESSIONS_STORAGE_KEY);
    if (raw) {
      try { setTaskSessions(migrateTaskSessions(JSON.parse(raw))); }
      catch (error) { console.error("Failed to parse saved task sessions; original storage was preserved", error); return; }
    }
    setTaskSessionsHydrated(true);
  }, []);

  useEffect(() => {
    if (!taskSessionsHydrated) return;
    writeLocalStorage(TASK_SESSIONS_STORAGE_KEY, JSON.stringify(taskSessions));
  }, [taskSessions, taskSessionsHydrated]);

  useEffect(() => {
    const raw = localStorage.getItem(SCHEDULE_BLOCKS_STORAGE_KEY);
    if (raw) {
      try { setScheduleBlocks(migrateScheduleBlocks(JSON.parse(raw))); }
      catch (error) { console.error("Failed to parse saved schedule blocks; original storage was preserved", error); return; }
    }
    setScheduleBlocksHydrated(true);
  }, []);

  useEffect(() => {
    if (!scheduleBlocksHydrated) return;
    writeLocalStorage(SCHEDULE_BLOCKS_STORAGE_KEY, JSON.stringify(scheduleBlocks));
  }, [scheduleBlocks, scheduleBlocksHydrated]);

  useEffect(() => {
    const raw = localStorage.getItem(TIME_LOGS_STORAGE_KEY);
    if (raw) {
      try {
        const loaded = migrateTimeLogs(JSON.parse(raw));
        setTimeLogs(loaded);
        setTimerRecovered(loaded.some((log) => log.status === "running" || log.status === "paused"));
      } catch (error) { console.error("Failed to parse saved time logs; original storage was preserved", error); return; }
    }
    setTimeLogsHydrated(true);
  }, []);

  useEffect(() => {
    if (!timeLogsHydrated) return;
    writeLocalStorage(TIME_LOGS_STORAGE_KEY, JSON.stringify(timeLogs));
  }, [timeLogs, timeLogsHydrated]);

  useEffect(() => {
    const rawNotifications = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    const rawReminders = localStorage.getItem(REMINDERS_STORAGE_KEY);
    const rawSettings = localStorage.getItem(NOTIFICATION_SETTINGS_STORAGE_KEY);
    try {
      if (rawNotifications) setNotifications(cleanupNotificationRetention(migratePlannerNotifications(JSON.parse(rawNotifications))));
      if (rawReminders) setReminders(migrateReminders(JSON.parse(rawReminders)));
      if (rawSettings) setNotificationSettings(migrateNotificationSettings(JSON.parse(rawSettings)));
    } catch (error) {
      console.error("Failed to load notification data; original storage was preserved", error);
    }
    setNotificationsHydrated(true);
    setRemindersHydrated(true);
    setNotificationSettingsHydrated(true);
  }, []);

  useEffect(() => {
    if (notificationsHydrated) writeLocalStorage(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
  }, [notifications, notificationsHydrated]);
  useEffect(() => {
    if (remindersHydrated) writeLocalStorage(REMINDERS_STORAGE_KEY, JSON.stringify(reminders));
  }, [reminders, remindersHydrated]);
  useEffect(() => {
    if (notificationSettingsHydrated) writeLocalStorage(NOTIFICATION_SETTINGS_STORAGE_KEY, JSON.stringify(notificationSettings));
  }, [notificationSettings, notificationSettingsHydrated]);

  useEffect(() => {
    try {
      const connection = localStorage.getItem(CALENDAR_CONNECTION_STORAGE_KEY);
      const settings = localStorage.getItem(CALENDAR_SETTINGS_STORAGE_KEY);
      const sources = localStorage.getItem(CALENDAR_SOURCES_STORAGE_KEY);
      const events = localStorage.getItem(EXTERNAL_EVENTS_STORAGE_KEY);
      const records = localStorage.getItem(CALENDAR_SYNC_RECORDS_STORAGE_KEY);
      if (connection) setCalendarConnection(migrateCalendarConnection(JSON.parse(connection)));
      if (settings) setCalendarSettings(migrateCalendarSettings(JSON.parse(settings)));
      if (sources) setExternalCalendars(JSON.parse(sources) as ExternalCalendar[]);
      if (events) setExternalEvents(migrateExternalEvents(JSON.parse(events)));
      if (records) setCalendarSyncRecords(migrateSyncRecords(JSON.parse(records)));
    } catch (error) { console.error("Failed to load calendar metadata; original storage was preserved", error); }
    setCalendarHydrated(true);
  }, []);
  useEffect(() => {
    if (!calendarHydrated) return;
    writeLocalStorage(CALENDAR_CONNECTION_STORAGE_KEY, JSON.stringify(calendarConnection));
    writeLocalStorage(CALENDAR_SETTINGS_STORAGE_KEY, JSON.stringify(calendarSettings));
    writeLocalStorage(CALENDAR_SOURCES_STORAGE_KEY, JSON.stringify(externalCalendars));
    writeLocalStorage(EXTERNAL_EVENTS_STORAGE_KEY, JSON.stringify(externalEvents));
    writeLocalStorage(CALENDAR_SYNC_RECORDS_STORAGE_KEY, JSON.stringify(calendarSyncRecords));
  }, [calendarConnection, calendarHydrated, calendarSettings, calendarSyncRecords, externalCalendars, externalEvents]);
  useEffect(() => {
    try {
      const settings = localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
      const messages = localStorage.getItem(AI_CONVERSATIONS_STORAGE_KEY);
      const audits = localStorage.getItem(AI_AUDITS_STORAGE_KEY);
      if (settings) setAISettings(migrateAISettings(JSON.parse(settings)));
      if (messages) setAssistantMessages(migrateAssistantMessages(JSON.parse(messages)));
      if (audits) setAssistantAudits(migrateAssistantAudits(JSON.parse(audits)));
    } catch (error) { console.error("Failed to load AI assistant preferences; original storage was preserved", error); }
    setAssistantHydrated(true);
  }, []);
  useEffect(() => {
    if (!assistantHydrated) return;
    writeLocalStorage(AI_SETTINGS_STORAGE_KEY, JSON.stringify(aiSettings));
    writeLocalStorage(AI_CONVERSATIONS_STORAGE_KEY, JSON.stringify(aiSettings.conversationHistoryEnabled ? assistantMessages.slice(-aiSettings.maximumHistoryMessages) : []));
    writeLocalStorage(AI_AUDITS_STORAGE_KEY, JSON.stringify(assistantAudits));
  }, [aiSettings, assistantAudits, assistantHydrated, assistantMessages]);
  useEffect(() => {
    try {
      const savedGoals = localStorage.getItem(GOALS_STORAGE_KEY);
      const savedProjects = localStorage.getItem(PLANNING_PROJECTS_STORAGE_KEY);
      const savedMilestones = localStorage.getItem(MILESTONES_STORAGE_KEY);
      const savedDependencies = localStorage.getItem(DEPENDENCIES_STORAGE_KEY);
      if (savedGoals) setGoals(migrateGoals(JSON.parse(savedGoals)));
      if (savedProjects) setPlanningProjects(migrateProjects(JSON.parse(savedProjects)));
      if (savedMilestones) setMilestones(migrateMilestones(JSON.parse(savedMilestones)));
      if (savedDependencies) setTaskDependencies(migrateDependencies(JSON.parse(savedDependencies)));
    } catch (error) { console.error("Failed to load projects and goals; ordinary planner data remains available", error); }
    setProjectPlanningHydrated(true);
  }, []);
  useEffect(() => {
    if (!projectPlanningHydrated) return;
    writeLocalStorage(GOALS_STORAGE_KEY, JSON.stringify(goals));
    writeLocalStorage(PLANNING_PROJECTS_STORAGE_KEY, JSON.stringify(planningProjects));
    writeLocalStorage(MILESTONES_STORAGE_KEY, JSON.stringify(milestones));
    writeLocalStorage(DEPENDENCIES_STORAGE_KEY, JSON.stringify(taskDependencies));
  }, [goals, milestones, planningProjects, projectPlanningHydrated, taskDependencies]);
  useEffect(() => {
    try {
      const definitions = localStorage.getItem(RECURRENCE_DEFINITIONS_STORAGE_KEY);
      const occurrences = localStorage.getItem(RECURRENCE_OCCURRENCES_STORAGE_KEY);
      const exceptions = localStorage.getItem(RECURRENCE_EXCEPTIONS_STORAGE_KEY);
      const templates = localStorage.getItem(ROUTINE_TEMPLATES_STORAGE_KEY);
      if (definitions) setRecurrenceDefinitions(migrateRecurrenceDefinitions(JSON.parse(definitions)));
      if (occurrences) setRecurrenceOccurrences(migrateRecurrenceOccurrences(JSON.parse(occurrences)));
      if (exceptions) setRecurrenceExceptions(migrateRecurrenceExceptions(JSON.parse(exceptions)));
      if (templates) setRoutineTemplates(migrateRoutineTemplates(JSON.parse(templates)));
    } catch (error) { console.error("Failed to load recurring work; ordinary tasks remain available", error); }
    setRecurrenceHydrated(true);
  }, []);
  useEffect(() => {
    if (!recurrenceHydrated) return;
    writeLocalStorage(RECURRENCE_DEFINITIONS_STORAGE_KEY, JSON.stringify(recurrenceDefinitions));
    writeLocalStorage(RECURRENCE_OCCURRENCES_STORAGE_KEY, JSON.stringify(recurrenceOccurrences));
    writeLocalStorage(RECURRENCE_EXCEPTIONS_STORAGE_KEY, JSON.stringify(recurrenceExceptions));
    writeLocalStorage(ROUTINE_TEMPLATES_STORAGE_KEY, JSON.stringify(routineTemplates));
  }, [recurrenceDefinitions, recurrenceExceptions, recurrenceHydrated, recurrenceOccurrences, routineTemplates]);
  useEffect(() => {
    if (!recurrenceHydrated || !hydrated || recurrenceGenerationRan) return;
    const now = new Date().toISOString();
    let nextTasks = tasks, nextSessions = taskSessions, nextOccurrences = [...recurrenceOccurrences];
    for (const definition of recurrenceDefinitions.filter((item) => item.status === "active" && item.generationSettings.generationMode === "app-open")) {
      const today = todayInTimezone(definition.timezone, new Date());
      const milestoneIsValid = !definition.taskTemplate.milestoneId || milestones.some((item) => item.id === definition.taskTemplate.milestoneId && item.projectId === definition.taskTemplate.projectId && item.status !== "archived");
      const generationDefinition = milestoneIsValid ? definition : { ...definition, taskTemplate: { ...definition.taskTemplate, milestoneId: undefined } };
      const exceptionKeys = recurrenceExceptions.filter((item) => item.seriesId === definition.id).map((item) => item.occurrenceKey);
      const generated = generateOccurrences(generationDefinition, catchUpStart(today), nextGenerationEnd(generationDefinition, today), nextOccurrences.map((item) => item.occurrenceKey), now, exceptionKeys);
      const materialized = materializeOccurrences(generationDefinition, generated.occurrences, nextTasks, now, nextSessions);
      nextTasks = materialized.tasks;
      nextSessions = materialized.sessions;
      nextOccurrences = [...nextOccurrences, ...materialized.occurrences];
    }
    setTasks(nextTasks);
    setTaskSessions(nextSessions);
    setRecurrenceOccurrences(nextOccurrences);
    setRecurrenceGenerationRan(true);
  }, [hydrated, milestones, recurrenceDefinitions, recurrenceExceptions, recurrenceGenerationRan, recurrenceHydrated, recurrenceOccurrences, taskSessions, tasks]);
  useEffect(() => {
    if (!recurrenceHydrated) return;
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const now = new Date().toISOString();
    setRecurrenceOccurrences((items) => {
      let changed = false;
      const next = items.map((item) => {
        const task = item.taskId ? taskMap.get(item.taskId) : undefined;
        if (!task) return item;
        const reconciled = reconcileOccurrenceWithTask(item, task, now);
        if (reconciled.status !== item.status || reconciled.completedAt !== item.completedAt) changed = true;
        return reconciled;
      });
      return changed ? next : items;
    });
  }, [recurrenceHydrated, tasks]);

  useEffect(() => {
    const updateMinute = () => setNotificationMinute(Math.floor(Date.now() / 60_000));
    const interval = window.setInterval(updateMinute, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => observeFirebaseUser((user) => {
    currentUserIdRef.current = user?.uid ?? null;
    setFirebaseUser(user);
    setSyncInitialized(false);
    initializingUserRef.current = null;
    setAuthReady(true);
  }), []);

  useEffect(() => {
    const updateConnectionState = () => {
      if (!navigator.onLine) setSyncState("offline");
      else if (!firebaseUser) setSyncState("saved");
      setSyncRetry((value) => value + 1);
    };
    window.addEventListener("online", updateConnectionState);
    window.addEventListener("offline", updateConnectionState);
    return () => {
      window.removeEventListener("online", updateConnectionState);
      window.removeEventListener("offline", updateConnectionState);
    };
  }, [firebaseUser]);

  const preferences = useMemo<PlannerPreferences>(() => ({
    musicQuery,
    checklistByDate,
    projects,
    checklistNote,
  }), [checklistByDate, checklistNote, musicQuery, projects]);
  const plannerAvailability = useMemo(() => [
    ...availability,
    ...externalBusyAsAvailability(externalEvents, calendarSettings, calendarSyncRecords, calendarConnection.lastSuccessfulSyncAt ?? new Date().toISOString()),
  ], [availability, calendarConnection.lastSuccessfulSyncAt, calendarSettings, calendarSyncRecords, externalEvents]);

  const allLocalDataHydrated = hydrated && musicHydrated && checklistHydrated && projectsHydrated && checklistNoteHydrated && availabilityHydrated && availabilityOverridesHydrated && availabilityTemplatesHydrated && taskSessionsHydrated && scheduleBlocksHydrated && timeLogsHydrated && notificationsHydrated && remindersHydrated && notificationSettingsHydrated && calendarHydrated && assistantHydrated && projectPlanningHydrated && recurrenceHydrated;
  const offlineCollections = useMemo<OfflineCollection[]>(() => [
    { entityType: "task", records: tasks },
    { entityType: "session", records: taskSessions },
    { entityType: "availability", records: availability },
    { entityType: "availability-override", records: availabilityOverrides },
    { entityType: "availability-template", records: availabilityTemplates },
    { entityType: "schedule-block", records: scheduleBlocks },
    { entityType: "time-log", records: timeLogs },
    { entityType: "reminder", records: reminders },
    { entityType: "notification", records: notifications },
    { entityType: "calendar-sync-record", records: calendarSyncRecords },
    { entityType: "ai-conversation", records: assistantMessages },
    { entityType: "ai-audit", records: assistantAudits },
    { entityType: "goal", records: goals },
    { entityType: "project", records: planningProjects },
    { entityType: "milestone", records: milestones },
    { entityType: "dependency", records: taskDependencies },
    { entityType: "recurrence-series", records: recurrenceDefinitions },
    { entityType: "recurrence-occurrence", records: recurrenceOccurrences },
    { entityType: "recurrence-exception", records: recurrenceExceptions },
    { entityType: "routine-template", records: routineTemplates },
  ], [assistantAudits, assistantMessages, availability, availabilityOverrides, availabilityTemplates, calendarSyncRecords, goals, milestones, notifications, planningProjects, recurrenceDefinitions, recurrenceExceptions, recurrenceOccurrences, reminders, routineTemplates, scheduleBlocks, taskDependencies, taskSessions, tasks, timeLogs]);
  const localPartitionUserId = firebaseUser?.uid ?? "local-device";
  const offlineReliability = useOfflineReliability(localPartitionUserId, offlineCollections, syncState === "saved" ? "synced" : syncState, allLocalDataHydrated);

  useEffect(() => {
    if (!firebaseUser || !allLocalDataHydrated || !navigator.onLine || syncInitialized) return;
    if (initializingUserRef.current === firebaseUser.uid) return;
    initializingUserRef.current = firebaseUser.uid;

    const initializeSync = async () => {
      setSyncState("saving");
      setSyncErrorMessage(null);
      try {
        const remotePreferences = await getUserPreferences(firebaseUser.uid);
        const migrationComplete = remotePreferences?.localMigrationComplete === true;
        if (!migrationComplete) {
          setMigrationMessage(`Found ${tasks.length} local task(s) ready for Firestore migration.`);
          const confirmed = window.confirm(
            `Found ${tasks.length} local planner task(s). Migrate them to your authenticated Firestore account now?`,
          );
          if (!confirmed) {
            setMigrationMessage(`Migration paused: ${tasks.length} local task(s) remain safely stored on this device.`);
            setSyncState("saved");
            return;
          }
          setMigrationMessage(`Migrating ${tasks.length} local task(s) to Firestore…`);
          await migrateLocalData(firebaseUser.uid, tasks, preferences);
          if (currentUserIdRef.current === firebaseUser.uid) {
            setMigrationMessage(`Migration complete: migrated and verified ${tasks.length} local task(s).`);
          }
        } else if (remotePreferences) {
          if (typeof remotePreferences.musicQuery === "string") setMusicQuery(remotePreferences.musicQuery);
          if (remotePreferences.checklistByDate && typeof remotePreferences.checklistByDate === "object") {
            setChecklistByDate(remotePreferences.checklistByDate as ChecklistMap);
          }
          if (Array.isArray(remotePreferences.projects)) setProjects(remotePreferences.projects as ProjectItem[]);
          if (typeof remotePreferences.checklistNote === "string") setChecklistNote(remotePreferences.checklistNote);
        }

        const [remoteTasks, remoteAvailability, remoteTemplates, remoteSessions, remoteScheduleBlocks, remoteTimeLogs, remoteNotifications, remoteReminders, remoteNotificationSettings, remoteCalendar, remoteAssistant, remoteProjectPlanning, remoteRecurrence] = await Promise.all([
          loadUserTasks(firebaseUser.uid),
          loadUserAvailability(firebaseUser.uid),
          loadUserAvailabilityTemplates(firebaseUser.uid),
          loadUserTaskSessions(firebaseUser.uid),
          loadUserScheduleBlocks(firebaseUser.uid),
          loadUserTimeLogs(firebaseUser.uid),
          loadUserNotifications(firebaseUser.uid),
          loadUserReminders(firebaseUser.uid),
          loadUserNotificationSettings(firebaseUser.uid),
          loadUserCalendarData(firebaseUser.uid),
          loadUserAssistantData(firebaseUser.uid),
          loadUserProjectPlanning(firebaseUser.uid),
          loadUserRecurrenceData(firebaseUser.uid),
        ]);
        if (currentUserIdRef.current !== firebaseUser.uid) return;
        setTasks((localTasks) => withoutBundledDemoTasks(mergeTaskCopies(localTasks, remoteTasks)));
        setAvailability((localBlocks) => mergeAvailabilityData(localBlocks, remoteAvailability.blocks));
        setAvailabilityOverrides((localOverrides) => mergeOverrideCopies(localOverrides, remoteAvailability.overrides));
        setAvailabilityTemplates((localTemplates) => mergeAvailabilityTemplateData(localTemplates, remoteTemplates));
        setTaskSessions((localSessions) => mergeTaskSessionData(localSessions, remoteSessions));
        setScheduleBlocks((localBlocks) => mergeScheduleBlockData(localBlocks, remoteScheduleBlocks));
        setTimeLogs((localLogs) => mergeTimeLogData(localLogs, remoteTimeLogs));
        setNotifications((localItems) => mergeNotificationData(localItems, remoteNotifications));
        setReminders((localItems) => mergeReminderData(localItems, remoteReminders));
        if (remoteNotificationSettings) setNotificationSettings((local) =>
          remoteNotificationSettings.updatedAt > local.updatedAt ? remoteNotificationSettings : local);
        if (remoteCalendar.connection) setCalendarConnection((local) => remoteCalendar.connection!.updatedAt > local.updatedAt ? remoteCalendar.connection! : local);
        if (remoteCalendar.settings) setCalendarSettings((local) => remoteCalendar.settings!.updatedAt > local.updatedAt ? remoteCalendar.settings! : local);
        setCalendarSyncRecords((local) => mergeCalendarSyncRecordData(local, remoteCalendar.records));
        if (remoteAssistant.settings) setAISettings((local) => remoteAssistant.settings!.updatedAt > local.updatedAt ? remoteAssistant.settings! : local);
        setAssistantMessages((local) => mergeAssistantMessageData(local, remoteAssistant.messages));
        setAssistantAudits((local) => mergeAssistantAuditData(local, remoteAssistant.audits));
        setGoals((local) => mergeGoalData(local, remoteProjectPlanning.goals));
        setPlanningProjects((local) => mergeProjectData(local, remoteProjectPlanning.projects));
        setMilestones((local) => mergeMilestoneData(local, remoteProjectPlanning.milestones));
        setTaskDependencies((local) => mergeDependencyData(local, remoteProjectPlanning.dependencies));
        setRecurrenceDefinitions((local) => mergeRecurrenceDefinitionData(local, remoteRecurrence.definitions));
        setRecurrenceOccurrences((local) => mergeRecurrenceOccurrenceData(local, remoteRecurrence.occurrences));
        setRecurrenceExceptions((local) => mergeRecurrenceExceptionData(local, remoteRecurrence.exceptions));
        setRoutineTemplates((local) => mergeRoutineTemplateData(local, remoteRecurrence.templates));
        setSyncInitialized(true);
        setSyncState("saved");
        setSyncErrorMessage(null);
      } catch (error) {
        console.error("Firebase initial synchronization failed", error);
        if (currentUserIdRef.current === firebaseUser.uid) {
          initializingUserRef.current = null;
          setSyncState(navigator.onLine ? "sync error" : "offline");
          setSyncErrorMessage(error instanceof Error ? error.message : "Firebase synchronization failed.");
        }
      }
    };

    void initializeSync();
  }, [aiSettings, allLocalDataHydrated, assistantAudits, assistantMessages, availability, availabilityOverrides, availabilityTemplates, calendarConnection, calendarSettings, calendarSyncRecords, firebaseUser, goals, milestones, notificationSettings, notifications, planningProjects, preferences, recurrenceDefinitions, recurrenceExceptions, recurrenceOccurrences, reminders, routineTemplates, scheduleBlocks, syncInitialized, syncRetry, taskDependencies, taskSessions, tasks, timeLogs]);

  useEffect(() => {
    if (!firebaseUser || !syncInitialized) return;
    if (!navigator.onLine) {
      setSyncState("offline");
      return;
    }
    const timeout = window.setTimeout(() => {
      setSyncState("saving");
      setSyncErrorMessage(null);
      syncQueueRef.current = syncQueueRef.current
        .catch(() => undefined)
        .then(() => Promise.all([
          syncUserData(firebaseUser.uid, tasks, preferences),
          syncUserAvailability(firebaseUser.uid, availability, availabilityOverrides),
          syncUserAvailabilityTemplates(firebaseUser.uid, availabilityTemplates),
          syncUserTaskSessions(firebaseUser.uid, taskSessions),
          syncUserScheduleBlocks(firebaseUser.uid, scheduleBlocks),
          syncUserTimeLogs(firebaseUser.uid, timeLogs),
          syncUserNotifications(firebaseUser.uid, notifications),
          syncUserReminders(firebaseUser.uid, reminders),
          syncUserNotificationSettings(firebaseUser.uid, notificationSettings),
          syncUserCalendarData(firebaseUser.uid, calendarConnection, calendarSettings, calendarSyncRecords),
          syncUserAssistantData(firebaseUser.uid, aiSettings, assistantMessages, assistantAudits),
          syncUserProjectPlanning(firebaseUser.uid, goals, planningProjects, milestones, taskDependencies),
          syncUserRecurrenceData(firebaseUser.uid, recurrenceDefinitions, recurrenceOccurrences, recurrenceExceptions, routineTemplates),
        ]))
        .then(() => {
          setSyncState("saved");
          setSyncErrorMessage(null);
        })
        .catch((error) => {
          console.error("Firebase synchronization failed", error);
          setSyncState(navigator.onLine ? "sync error" : "offline");
          setSyncErrorMessage(error instanceof Error ? error.message : "Firebase synchronization failed.");
        });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [aiSettings, assistantAudits, assistantMessages, availability, availabilityOverrides, availabilityTemplates, calendarConnection, calendarSettings, calendarSyncRecords, firebaseUser, goals, milestones, notificationSettings, notifications, planningProjects, preferences, recurrenceDefinitions, recurrenceExceptions, recurrenceOccurrences, reminders, routineTemplates, scheduleBlocks, syncInitialized, syncRetry, taskDependencies, taskSessions, tasks, timeLogs]);

  useEffect(() => {
    if (!allLocalDataHydrated) return;
    const now = new Date().toISOString();
    const result = evaluateNotifications({
      now, tasks, sessions: taskSessions, scheduleBlocks, availability: plannerAvailability,
      overrides: availabilityOverrides, timeLogs, reminders, notifications,
      settings: notificationSettings,
    });
    let nextNotifications = result.notifications;
    if (result.browserDeliveries.length && typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "granted") {
      const delivered = new Set(result.browserDeliveries.map((item) => item.id));
      for (const item of result.browserDeliveries) {
        const browserNotification = new window.Notification(item.title, { body: item.message, tag: item.deduplicationKey });
        browserNotification.onclick = () => { window.focus(); setView(item.action?.type === "open-timer" ? "planning" : item.action?.type === "open-daily-plan" ? "daily" : "planning"); };
      }
      nextNotifications = nextNotifications.map((item) => delivered.has(item.id) ? { ...item, browserDeliveredAt: now, updatedAt: now } : item);
    }
    if (JSON.stringify(nextNotifications) !== JSON.stringify(notifications)) setNotifications(nextNotifications);
    if (JSON.stringify(result.reminders) !== JSON.stringify(reminders)) setReminders(result.reminders);
  }, [allLocalDataHydrated, availabilityOverrides, notificationMinute, notificationSettings, notifications, plannerAvailability, reminders, scheduleBlocks, taskSessions, tasks, timeLogs]);

  const toggleTask = (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? completeTask(t) : t)));
  };

  const activeTasks = tasks.filter((task) => task.status !== "archived");

  const exportBackup = () => {
    const backup = createPlannerBackup(tasks, preferences, undefined, availability, availabilityOverrides, availabilityTemplates, taskSessions, scheduleBlocks, timeLogs, notifications, reminders, notificationSettings, calendarConnection, calendarSettings, calendarSyncRecords, aiSettings, assistantMessages, assistantAudits, goals, planningProjects, milestones, taskDependencies, recurrenceDefinitions, recurrenceOccurrences, recurrenceExceptions, routineTemplates);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bunbun-planner-backup-${toISODate(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupMessage(`Exported ${tasks.length} task(s) to JSON.`);
  };

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const backup = parsePlannerBackup(await file.text());
      const confirmed = window.confirm(
        `Import ${backup.tasks.length} task(s) and ${backup.availability.length} availability block(s) from this backup? Existing records will be preserved and duplicates merged by stable ID.`,
      );
      if (!confirmed) {
        setBackupMessage("Import cancelled. No planner data was changed.");
        return;
      }
      setTasks((current) => mergeBackupTasks(current, backup.tasks));
      setMusicQuery(backup.preferences.musicQuery);
      setChecklistByDate(backup.preferences.checklistByDate as ChecklistMap);
      setProjects(backup.preferences.projects as ProjectItem[]);
      setChecklistNote(backup.preferences.checklistNote);
      setAvailability((current) => mergeAvailabilityCopies(current, backup.availability));
      setAvailabilityOverrides((current) => mergeOverrideCopies(current, backup.availabilityOverrides));
      setAvailabilityTemplates((current) => mergeTemplateCopies(current, backup.availabilityTemplates));
      setTaskSessions((current) => mergeSessionCopies(current, backup.taskSessions));
      setScheduleBlocks((current) => mergeScheduleBlockCopies(current, backup.scheduleBlocks));
      setTimeLogs((current) => mergeTimeLogCopies(current, backup.timeLogs));
      setNotifications((current) => mergeNotificationCopies(current, backup.notifications));
      setReminders((current) => mergeReminderCopies(current, backup.reminders));
      setNotificationSettings((current) => backup.notificationSettings.updatedAt > current.updatedAt ? backup.notificationSettings : current);
      setCalendarConnection((current) => backup.calendarConnection.updatedAt > current.updatedAt ? backup.calendarConnection : current);
      setCalendarSettings((current) => backup.calendarSettings.updatedAt > current.updatedAt ? backup.calendarSettings : current);
      setCalendarSyncRecords((current) => mergeSyncRecords(current, backup.calendarSyncRecords));
      setAISettings((current) => backup.aiSettings.updatedAt > current.updatedAt ? backup.aiSettings : current);
      setAssistantMessages((current) => mergeAssistantMessageData(current, backup.assistantMessages));
      setAssistantAudits((current) => mergeAssistantAuditData(current, backup.assistantActionAudits));
      setGoals((current) => mergeGoalData(current, backup.goals));
      setPlanningProjects((current) => mergeProjectData(current, backup.projects));
      setMilestones((current) => mergeMilestoneData(current, backup.milestones));
      setTaskDependencies((current) => mergeDependencyData(current, backup.taskDependencies));
      setRecurrenceDefinitions((current) => mergeRecurrenceDefinitionData(current, backup.recurrenceDefinitions));
      setRecurrenceOccurrences((current) => mergeRecurrenceOccurrenceData(current, backup.recurrenceOccurrences));
      setRecurrenceExceptions((current) => mergeRecurrenceExceptionData(current, backup.recurrenceExceptions));
      setRoutineTemplates((current) => mergeRoutineTemplateData(current, backup.routineTemplates));
      setBackupMessage(`Imported ${backup.tasks.length} task(s) and ${backup.availability.length} availability block(s); duplicate IDs were merged.`);
    } catch (error) {
      console.error("Planner backup import failed", error);
      setBackupMessage(error instanceof Error ? `Import failed: ${error.message}` : "Import failed: invalid backup file.");
    }
  };

  const requestStartTimer = (input: Omit<TimerStartInput, "id">) => {
    setTimeLogs((current) => {
      const running = runningTimeLogs(current);
      let next = current;
      if (running.length) {
        const currentTask = tasks.find((task) => task.id === running[0]!.taskId);
        const choice = window.prompt(`Another timer is already active for ${currentTask?.title ?? "another task"}. Type "save", "pause", or "keep".`, "keep")?.trim().toLowerCase();
        if (choice === "pause") next = current.map((log) => log.id === running[0]!.id ? pauseTimer(log) : log);
        else if (choice === "save") {
          const seconds = elapsedSeconds(running[0]!, new Date().toISOString());
          if (seconds <= 0) return current;
          next = current.map((log) => log.id === running[0]!.id ? completeTimer(log) : log);
        } else return current;
      }
      return [...next, createTimerLog({ ...input, userId: firebaseUser?.uid })];
    });
    setTimerRecovered(false);
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 relative">
      <div
        className="absolute inset-0 bg-cover bg-center bg-fixed blur-sm"
        style={{ backgroundImage: `url(${bgImg})` }}
      />
      <div className="absolute inset-0 bg-white/30" />
      <div className="relative">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-2xl bg-white/80 px-4 py-3 ring-1 ring-pink-100 shadow-sm">
              <div className="text-[11px] text-slate-500">This month is…</div>
              <div className="text-xl font-bold tracking-tight text-slate-800">
                {new Date().toLocaleString("default", { month: "long", year: "numeric" })}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:max-w-[calc(100%-12rem)] sm:justify-end sm:pl-6 lg:pl-10">
            {(
              [
                { key: "daily", label: "Daily" },
                { key: "weekly", label: "Weekly" },
                { key: "planning", label: "Planning" },
                { key: "availability", label: "Availability" },
                { key: "projects", label: "Projects & Goals" },
                { key: "routines", label: "Routines" },
                { key: "insights", label: "Insights" },
                { key: "assistant", label: "Assistant" },
                { key: "notifications", label: `Notifications${notifications.some((item) => item.status === "delivered") ? ` (${notifications.filter((item) => item.status === "delivered").length})` : ""}` },
                { key: "monthly", label: "Monthly" },
                { key: "google", label: "Google" },
                { key: "sync", label: "Sync & Storage" },
                { key: "checklist", label: "Checklist" },
                { key: "archive", label: "Archive" },
                { key: "history", label: "History" },
              ] as Array<{ key: View; label: string }>
            ).map((b) => (
              <Button
                key={b.key}
                onClick={() => setView(b.key)}
                variant="outline"
                className={`rounded-full shadow-sm ${view === b.key ? "bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 shadow hover:opacity-90" : "bg-white/80 text-slate-700 ring-1 ring-pink-100 hover:bg-pink-50"}`}
              >
                {b.label}
              </Button>
            ))}
            <SyncStatusBadge status={offlineReliability.status} onOpen={() => setView("sync")} />
            <div className="hidden" aria-hidden="true">
              <Button tabIndex={-1} variant="outline" onClick={exportBackup}>Export recovery backup</Button>
              <Button tabIndex={-1} variant="outline" onClick={() => backupInputRef.current?.click()}>Import recovery backup</Button>
              <input ref={backupInputRef} tabIndex={-1} type="file" accept="application/json,.json" onChange={(event) => void importBackup(event)} aria-label="Import planner recovery backup" />
            </div>
            {firebaseEnabled && !authReady ? (
              <span role="status" aria-live="polite" className="rounded-full bg-white/80 px-3 py-2 text-xs text-slate-600 ring-1 ring-pink-100">
                Cloud sync • loading
              </span>
            ) : firebaseEnabled && authReady ? (
              firebaseUser ? (
                <>
                  <span role="status" aria-live="polite" className="rounded-full bg-white/80 px-3 py-2 text-xs text-slate-600 ring-1 ring-pink-100">
                    {firebaseUser.displayName ?? firebaseUser.email ?? "Signed in"} • {syncState}
                  </span>
                  {syncState === "sync error" ? (
                    <Button variant="outline" className="rounded-full bg-white/80" onClick={() => {
                      setSyncErrorMessage(null);
                      setSyncRetry((value) => value + 1);
                    }}>Retry sync</Button>
                  ) : null}
                  <Button variant="outline" className="rounded-full bg-white/80" onClick={() => void signOutFirebase().catch((error) => {
                    console.error("Firebase sign-out failed", error);
                    setSyncState("sync error");
                    setSyncErrorMessage(error instanceof Error ? error.message : "Firebase sign-out failed.");
                  })}>Sign out</Button>
                </>
              ) : (
                <Button variant="outline" className="rounded-full bg-white/80" onClick={() => void signInWithGoogle().catch((error) => {
                  console.error("Google sign-in failed", error);
                  setSyncState("sync error");
                  setSyncErrorMessage(error instanceof Error ? error.message : "Google sign-in failed.");
                })}>Sign in with Google</Button>
              )
            ) : null}
          </div>
        </header>

        {migrationMessage && firebaseUser ? (
          <div role="status" aria-live="polite" className="mb-4 rounded-xl bg-white/80 px-4 py-3 text-sm text-slate-700 ring-1 ring-pink-100">
            {migrationMessage}
          </div>
        ) : null}
        {syncErrorMessage && firebaseEnabled ? (
          <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Sync error: {syncErrorMessage}
          </div>
        ) : null}
        {backupMessage ? (
          <div role="status" aria-live="polite" className="mb-4 rounded-xl bg-white/80 px-4 py-3 text-sm text-slate-700 ring-1 ring-pink-100">
            {backupMessage}
          </div>
        ) : null}

        <main className={(["planning", "availability", "projects", "routines", "insights", "assistant", "notifications", "google", "sync"] as View[]).includes(view) ? "sm:pl-6 lg:pl-10" : ""}>
        {(["daily", "weekly", "availability", "planning"] as View[]).includes(view) ? <ExternalCalendarSummary events={externalEvents} settings={calendarSettings} calendars={externalCalendars} /> : null}

        {view === "daily" && (
          <DailyPlanner
            tasks={activeTasks}
            onToggle={toggleTask}
            checklistByDate={checklistByDate}
            setChecklistByDate={setChecklistByDate}
            musicQuery={musicQuery}
            setMusicQuery={setMusicQuery}
          />
        )}
        {view === "weekly" && <WeeklyPlanner tasks={activeTasks} setTasks={setTasks} sessions={taskSessions} timeLogs={timeLogs} />}
        {view === "planning" && <PlanningEffortPage tasks={tasks} setTasks={setTasks} sessions={taskSessions} setSessions={setTaskSessions} availability={plannerAvailability} overrides={availabilityOverrides} scheduleBlocks={scheduleBlocks} setScheduleBlocks={setScheduleBlocks} timeLogs={timeLogs} onStartTimer={requestStartTimer} />}
        {view === "availability" && <AvailabilityPage blocks={availability} setBlocks={setAvailability} overrides={availabilityOverrides} setOverrides={setAvailabilityOverrides} templates={availabilityTemplates} setTemplates={setAvailabilityTemplates} />}
        {view === "projects" && <ProjectsPage
          goals={goals}
          setGoals={setGoals}
          projects={planningProjects}
          setProjects={setPlanningProjects}
          milestones={milestones}
          setMilestones={setMilestones}
          dependencies={taskDependencies}
          setDependencies={setTaskDependencies}
          tasks={tasks}
          setTasks={setTasks}
          sessions={taskSessions}
          availability={plannerAvailability}
          overrides={availabilityOverrides}
          scheduleBlocks={scheduleBlocks}
          timeLogs={timeLogs}
        />}
        {view === "routines" && <RecurrencesPage definitions={recurrenceDefinitions} setDefinitions={setRecurrenceDefinitions} occurrences={recurrenceOccurrences} setOccurrences={setRecurrenceOccurrences} exceptions={recurrenceExceptions} setExceptions={setRecurrenceExceptions} templates={routineTemplates} setTemplates={setRoutineTemplates} tasks={tasks} setTasks={setTasks} sessions={taskSessions} setSessions={setTaskSessions} scheduleBlocks={scheduleBlocks} setScheduleBlocks={setScheduleBlocks} timeLogs={timeLogs} reminders={reminders} setReminders={setReminders} projects={planningProjects} milestones={milestones} today={toISODate(new Date())} />}
        {view === "insights" && <AnalyticsPage tasks={tasks} sessions={taskSessions} timeLogs={timeLogs} scheduleBlocks={scheduleBlocks} />}
        {view === "assistant" && <PlanningAssistantPage
          settings={aiSettings}
          setSettings={setAISettings}
          messages={assistantMessages}
          setMessages={setAssistantMessages}
          audits={assistantAudits}
          setAudits={setAssistantAudits}
          plannerState={{
            tasks,
            sessions: taskSessions,
            availability: plannerAvailability,
            overrides: availabilityOverrides,
            scheduleBlocks,
            timeLogs,
            reminders,
            externalEvents,
            currentRoute: view,
            today: toISODate(new Date()),
            currentTime: `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`,
            plannerVersion: "",
          }}
          setTasks={setTasks}
          setSessions={setTaskSessions}
          setReminders={setReminders}
          onOpenPlanning={() => setView("planning")}
        />}
        {view === "notifications" && <NotificationCenter
          notifications={notifications}
          setNotifications={setNotifications}
          reminders={reminders}
          setReminders={setReminders}
          settings={notificationSettings}
          setSettings={setNotificationSettings}
          tasks={tasks}
          scheduleBlocks={scheduleBlocks}
          onOpen={(item) => setView(item.action?.type === "open-timer" || item.action?.type === "open-planning-health" || item.action?.type === "replan-work" ? "planning" : "daily")}
        />}
        {view === "monthly" && <MonthlyPlanner tasks={activeTasks} />}
        {view === "google" && <CalendarIntegrationPage
          clientId={GOOGLE_CLIENT_ID}
          connection={calendarConnection}
          setConnection={setCalendarConnection}
          calendars={externalCalendars}
          setCalendars={setExternalCalendars}
          events={externalEvents}
          setEvents={setExternalEvents}
          settings={calendarSettings}
          setSettings={setCalendarSettings}
          records={calendarSyncRecords}
          setRecords={setCalendarSyncRecords}
          scheduleBlocks={scheduleBlocks}
          tasks={tasks}
          online={navigator.onLine}
        />}
        {view === "sync" && <SyncReliabilityPage database={offlineReliability.database} status={offlineReliability.status} userId={localPartitionUserId} onRefresh={offlineReliability.refresh} />}
        {view === "checklist" && (
          <ChecklistView
            rows={projects}
            setRows={setProjects}
            note={checklistNote}
            setNote={setChecklistNote}
          />
        )}
        {view === "archive" && <ArchiveView tasks={tasks} setTasks={setTasks} sessions={taskSessions} setSessions={setTaskSessions} timeLogs={timeLogs} setTimeLogs={setTimeLogs} />}
        {view === "history" && <HistoryView tasks={tasks} sessions={taskSessions} />}
        <FocusTimerPanel tasks={tasks} setTasks={setTasks} sessions={taskSessions} setSessions={setTaskSessions} scheduleBlocks={scheduleBlocks} setScheduleBlocks={setScheduleBlocks} logs={timeLogs} setLogs={setTimeLogs} onStart={requestStartTimer} recovered={timerRecovered} showPanel={view === "planning"} />
        </main>
      </div>
      </div>
      <FloatingMusicPlayer musicQuery={musicQuery} />
    </div>
  );
}
