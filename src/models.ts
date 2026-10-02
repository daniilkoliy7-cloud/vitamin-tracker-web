export interface Course {
  id: string;
  name: string;
  dosage?: string;
  startDate: string; // YYYY-MM-DD
  durationDays: number;
  status: "active" | "paused" | "archived";
  archivedAt?: string;
}

export interface Intake {
  id: string;
  courseId: string;
  hour: number;
  minute: number;
  sortOrder: number;
}

export interface IntakeRecord {
  id: string;
  intakeId: string;
  courseId: string;
  day: string; // YYYY-MM-DD
  status: "pending" | "taken" | "missed" | "skipped";
  markedAt?: string;
}

export function uid(): string {
  return crypto.randomUUID();
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function startOfDay(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / 86400000);
}

export function endDate(course: Course): Date {
  const d = new Date(course.startDate + "T00:00:00");
  d.setDate(d.getDate() + course.durationDays - 1);
  return d;
}

export function isExpired(course: Course): boolean {
  if (course.status !== "active") return false;
  return new Date() > endDate(course);
}

export function daysRemaining(course: Course): number {
  const e = endDate(course);
  const today = new Date();
  return Math.max(0, Math.round((e.getTime() - today.getTime()) / 86400000));
}

export function intakeTime(intake: Intake): string {
  return `${intake.hour.toString().padStart(2, "0")}:${intake.minute.toString().padStart(2, "0")}`;
}