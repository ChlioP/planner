import { describe, expect, it } from "vitest";
import { createTask, completeTask, type TaskRecord } from "./taskHistory";
import { migrateScheduleBlock, type ScheduleBlock } from "./scheduleBlocks";
import {
  createReminder,
  DEFAULT_NOTIFICATION_SETTINGS,
  dismissNotification,
  editReminder,
  evaluateNotifications,
  isQuietTime,
  markNotificationRead,
  mergeNotificationCopies,
  migrateNotificationSettings,
  snoozeNotification,
  type NotificationEngineInput,
} from "./notifications";
import { createTimerLog } from "./timeLogs";

const localIso = (day: number, hour: number, minute = 0) => new Date(2026, 6, day, hour, minute).toISOString();
const NOW = localIso(23, 12);
const task = (patch: Partial<TaskRecord> = {}) => createTask({
  id: "task", title: "Write essay", date: "", time: "", status: "planned",
  estimatedMinutes: 120, dueDate: "2026-07-24", ...patch,
}, NOW);
const block = (patch: Partial<ScheduleBlock> = {}) => migrateScheduleBlock({
  id: "block", taskId: "task", title: "Essay Research", date: "2026-07-23",
  startTime: "12:15", endTime: "13:15", durationMinutes: 60,
  source: "automatic", status: "confirmed", isLocked: false,
  createdAt: NOW, updatedAt: NOW, ...patch,
});
const input = (patch: Partial<NotificationEngineInput> = {}): NotificationEngineInput => ({
  now: NOW, tasks: [task()], sessions: [], scheduleBlocks: [], availability: [],
  overrides: [], timeLogs: [], reminders: [], notifications: [],
  settings: migrateNotificationSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, createdAt: NOW, updatedAt: NOW }),
  ...patch,
});
const run = (patch: Partial<NotificationEngineInput> = {}) => evaluateNotifications(input(patch));

describe("notification defaults and deterministic generation", () => {
  it("keeps browser delivery disabled for existing users", () => {
    expect(migrateNotificationSettings(undefined)).toMatchObject({ inAppEnabled: true, browserEnabled: false });
  });

  it("creates one upcoming notification only for confirmed active blocks", () => {
    expect(run({ scheduleBlocks: [block()] }).created.map((item) => item.type)).toContain("schedule-upcoming");
    expect(run({ scheduleBlocks: [block({ status: "proposed" })] }).created.some((item) => item.type === "schedule-upcoming")).toBe(false);
    expect(run({ scheduleBlocks: [block({ status: "cancelled" })] }).created.some((item) => item.type === "schedule-upcoming")).toBe(false);
    expect(run({ scheduleBlocks: [block({ status: "completed" })] }).created.some((item) => item.type === "schedule-upcoming")).toBe(false);
  });

  it("is idempotent across repeated evaluation and refresh merging", () => {
    const first = run({ scheduleBlocks: [block()] });
    const second = run({ scheduleBlocks: [block()], notifications: first.notifications });
    expect(second.created).toHaveLength(0);
    expect(mergeNotificationCopies(first.notifications, second.notifications)).toHaveLength(first.notifications.length);
  });

  it("cancels an old pending reminder when a block moves and creates a new key", () => {
    const first = run({ now: localIso(23, 10), scheduleBlocks: [block({ startTime: "13:00", endTime: "14:00" })] });
    const second = run({ now: localIso(23, 10), scheduleBlocks: [block({ startTime: "14:00", endTime: "15:00" })], notifications: first.notifications });
    expect(second.notifications.some((item) => item.status === "cancelled")).toBe(true);
    expect(second.created.some((item) => item.deduplicationKey.includes("14:00") === false)).toBe(true);
  });

  it("creates deadline reminders, cancels pending ones after completion, and deduplicates overdue state", () => {
    const due = run({ now: localIso(23, 22, 59), settings: { ...input().settings, deadlineReminderOffsets: [60] } });
    expect(due.created.some((item) => item.type === "deadline-upcoming")).toBe(true);
    const completed = run({ now: localIso(23, 23), tasks: [completeTask(task(), localIso(23, 23))], notifications: due.notifications });
    expect(completed.notifications.find((item) => item.type === "deadline-upcoming")?.status).toBe("cancelled");
    const overdue = run({ now: localIso(25, 9), tasks: [task()] });
    const repeated = run({ now: localIso(25, 9, 1), tasks: [task()], notifications: overdue.notifications });
    expect(overdue.created.filter((item) => item.type === "deadline-overdue")).toHaveLength(1);
    expect(repeated.created).toHaveLength(0);
  });

  it("asks for review without automatically marking a past block missed", () => {
    const past = block({ startTime: "09:00", endTime: "10:00" });
    const result = run({ scheduleBlocks: [past] });
    expect(result.created.some((item) => item.type === "schedule-missed")).toBe(true);
    expect(past.status).toBe("confirmed");
  });

  it("creates and resolves conflict notifications without modifying schedule data", () => {
    const scheduled = block();
    const available = { schemaVersion: 1 as const, id: "a", name: "Available", date: "2026-07-23", startTime: "12:00", endTime: "14:00", type: "available" as const, isRecurring: false, createdAt: NOW, updatedAt: NOW };
    const appointment = { ...available, id: "u", name: "Appointment", startTime: "12:30", endTime: "13:00", type: "appointment" as const };
    const conflicted = run({ scheduleBlocks: [scheduled], availability: [available, appointment] });
    expect(conflicted.created.some((item) => item.type === "schedule-conflict")).toBe(true);
    expect(scheduled.startTime).toBe("12:15");
    const resolved = run({ scheduleBlocks: [scheduled], availability: [available], notifications: conflicted.notifications });
    expect(resolved.notifications.find((item) => item.type === "schedule-conflict")?.status).toBe("cancelled");
  });
});

describe("timer, reminders, settings, and lifecycle", () => {
  it("notifies once at a running timer threshold and ignores paused timers", () => {
    const running = createTimerLog({ id: "log", taskId: "task" }, localIso(23, 8));
    const first = run({ timeLogs: [running] });
    expect(first.created.some((item) => item.type === "timer-running")).toBe(true);
    expect(run({ timeLogs: [{ ...running, status: "paused", lastResumedAt: undefined }] }).created.some((item) => item.type === "timer-running")).toBe(false);
  });

  it("supports cross-midnight quiet hours and suppresses browser delivery but keeps in-app history", () => {
    const settings = { ...input().settings, browserEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00" };
    expect(isQuietTime("23:00", settings)).toBe(true);
    expect(isQuietTime("07:59", settings)).toBe(true);
    expect(isQuietTime("08:00", settings)).toBe(false);
    const result = run({ now: localIso(23, 23), tasks: [task({ dueDate: "2026-07-23" })], settings });
    expect(result.notifications.some((item) => item.deliveryChannels.includes("in-app"))).toBe(true);
    expect(result.browserDeliveries).toHaveLength(0);
  });

  it("respects the browser daily limit while retaining critical timer delivery", () => {
    const settings = { ...input().settings, browserEnabled: true, maximumNotificationsPerDay: 1 };
    const existing = run({ settings, now: localIso(25, 9) }).notifications.map((item) => ({ ...item, browserDeliveredAt: localIso(25, 8) }));
    const running = createTimerLog({ id: "log", taskId: "task" }, localIso(25, 4));
    const result = run({ settings, now: localIso(25, 9), timeLogs: [running], notifications: existing });
    expect(result.browserDeliveries.some((item) => item.type === "timer-running")).toBe(true);
  });

  it("creates, edits, disables, deduplicates, and validates manual reminders", () => {
    const reminder = createReminder({ targetType: "custom", title: "Review notes", trigger: { type: "absolute", dateTime: localIso(24, 9) }, channels: ["in-app"], isEnabled: true }, [], [task()], [], NOW);
    expect(reminder.nextTriggerAt).toBe(localIso(24, 9));
    expect(() => createReminder({ ...reminder, id: undefined }, [reminder], [task()], [], NOW)).toThrow("already exists");
    expect(() => createReminder({ targetType: "custom", title: "Past", trigger: { type: "absolute", dateTime: localIso(22, 9) }, channels: ["in-app"], isEnabled: true }, [], [task()], [], NOW)).toThrow("future");
    const disabled = editReminder(reminder, { isEnabled: false }, [task()], [], NOW);
    expect(disabled.id).toBe(reminder.id);
    expect(disabled.isEnabled).toBe(false);
  });

  it("recalculates relative deadline and schedule reminder triggers", () => {
    const deadline = createReminder({ targetType: "task", taskId: "task", title: "Deadline", trigger: { type: "before-deadline", offsetMinutes: 60 }, channels: ["in-app"], isEnabled: true }, [], [task()], [], NOW);
    const changed = editReminder(deadline, {}, [task({ dueDate: "2026-07-26" })], [], NOW);
    expect(changed.nextTriggerAt).not.toBe(deadline.nextTriggerAt);
    const schedule = createReminder({ targetType: "schedule-block", taskId: "task", scheduleBlockId: "block", title: "Session", trigger: { type: "before-schedule", offsetMinutes: 15 }, channels: ["in-app"], isEnabled: true }, [], [task()], [block({ date: "2026-07-24" })], NOW);
    const moved = editReminder(schedule, {}, [task()], [block({ date: "2026-07-25" })], NOW);
    expect(moved.nextTriggerAt).not.toBe(schedule.nextTriggerAt);
  });

  it("snoozes without duplication and keeps read distinct from dismissed", () => {
    const item = run({ now: localIso(25, 9) }).notifications[0]!;
    const snoozed = snoozeNotification(item, 30, NOW);
    expect(snoozed.id).toBe(item.id);
    expect(snoozed.status).toBe("scheduled");
    const read = markNotificationRead(item, true, NOW);
    expect(read.status).toBe("read");
    expect(dismissNotification(read, NOW).status).toBe("dismissed");
  });

  it("pausing all delivery preserves notification history", () => {
    const previous = run({ now: localIso(25, 9) }).notifications;
    const paused = run({ now: localIso(25, 10), notifications: previous, settings: { ...input().settings, allPaused: true } });
    expect(paused.notifications).toEqual(previous);
    expect(paused.created).toHaveLength(0);
  });
});
