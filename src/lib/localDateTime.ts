export function parseLocalDate(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day);
  if (candidate.getFullYear() !== year || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return null;
  return { year, month, day };
}

export function localDateFromParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function localDateFromDate(date: Date): string {
  return localDateFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function localDateToDate(date: string): Date {
  const parsed = parseLocalDate(date);
  if (!parsed) throw new Error("Date must use YYYY-MM-DD.");
  return new Date(parsed.year, parsed.month - 1, parsed.day);
}

export function addLocalDays(date: string, days: number): string {
  const value = localDateToDate(date);
  value.setDate(value.getDate() + days);
  return localDateFromDate(value);
}

export function startOfLocalWeek(date: string): string {
  const value = localDateToDate(date);
  const day = value.getDay();
  return addLocalDays(date, day === 0 ? -6 : 1 - day);
}

export function dayOfWeekForLocalDate(date: string): number {
  return localDateToDate(date).getDay();
}

export function formatLocalDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  return localDateToDate(date).toLocaleDateString("en-US", options);
}

export function isValidTime(time: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

export function timeToMinutes(time: string): number {
  if (!isValidTime(time)) throw new Error("Time must use HH:mm.");
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToDuration(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} hr${hours === 1 ? "" : "s"}`;
  return `${hours} hr ${remainder} min`;
}
