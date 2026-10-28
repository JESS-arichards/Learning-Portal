import { z } from 'zod';
import type { DaySlot } from './learning.js';
import { formatDate } from './dateFormatting.js';
import { uuidSchema } from './identifiers.js';

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Choose a valid date.');
const range = z.object({
  id: uuidSchema, name: z.string().trim().min(1).max(100),
  start: dateSchema, end: dateSchema,
}).refine((value) => value.start <= value.end, 'End date must be on or after start date.');
export const teachingWeekSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1, 'Include at least one teaching day.').max(7)
    .refine((days) => new Set(days).size === days.length, 'Teaching days must be unique.'),
  startsOn: z.number().int().min(0).max(6),
}).strict();
export type TeachingWeek = z.infer<typeof teachingWeekSchema>;
export const DEFAULT_TEACHING_WEEK: TeachingWeek = { days: [0, 1, 2, 3, 4], startsOn: 0 };
export const SUNDAY_TEACHING_WEEK: TeachingWeek = { days: [6, 0, 1, 2, 3], startsOn: 6 };
export const academicCalendarSchema = z.object({
  years: z.array(range.safeExtend({ week: teachingWeekSchema.optional() })).max(20),
  terms: z.array(range.safeExtend({ yearId: uuidSchema, week: teachingWeekSchema.optional() })).max(100),
  holidays: z.array(range.safeExtend({ yearId: uuidSchema })).max(500),
}).strict().superRefine((calendar, ctx) => {
  for (const [kind, ranges] of Object.entries(calendar)) {
    if (new Set(ranges.map((item) => item.id)).size !== ranges.length)
      ctx.addIssue({ code: 'custom', message: `Duplicate ${kind} IDs.` });
    if (kind !== 'holidays' && ranges.some((item, index) => ranges.slice(0, index).some((other) => item.start <= other.end && other.start <= item.end)))
      ctx.addIssue({ code: 'custom', message: `${kind} must not overlap.` });
  }
  for (const item of [...calendar.terms, ...calendar.holidays]) {
    const year = calendar.years.find((year) => year.id === item.yearId);
    if (!year || item.start < year.start || item.end > year.end)
      ctx.addIssue({ code: 'custom', message: `${item.name} must be inside its academic year.` });
  }
});
export type AcademicCalendar = z.infer<typeof academicCalendarSchema>;
export const EMPTY_CALENDAR: AcademicCalendar = { years: [], terms: [], holidays: [] };
export const recurrenceSchema = z.object({
  startDate: dateSchema,
  frequency: z.enum(['once', 'daily', 'weekly']),
  count: z.number().int().min(1).max(366),
}).strict().superRefine((value, ctx) => {
  if (value.frequency === 'once' && value.count !== 1)
    ctx.addIssue({ code: 'custom', path: ['count'], message: 'A one-off lesson has one occurrence date.' });
  if (value.frequency === 'weekly' && value.count > 53)
    ctx.addIssue({ code: 'custom', path: ['count'], message: 'Choose up to 53 weeks.' });
});
export type Recurrence = z.infer<typeof recurrenceSchema>;
export const occurrenceSchema = z.object({ id: uuidSchema, date: dateSchema, slotId: uuidSchema });
export type Occurrence = z.infer<typeof occurrenceSchema>;
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function weekday(date: string) { return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; }
export function schoolDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function teachingWeek(calendar: AcademicCalendar, date: string): TeachingWeek {
  const term = calendar.terms.find((term) => term.start <= date && date <= term.end);
  const year = term ? calendar.years.find((year) => year.id === term.yearId)
    : calendar.years.find((year) => year.start <= date && date <= year.end);
  return term?.week ?? year?.week ?? DEFAULT_TEACHING_WEEK;
}
export function timetableWeek(calendar: AcademicCalendar, date: string) {
  const week = teachingWeek(calendar, date);
  const start = addDays(date, -((weekday(date) - week.startsOn + 7) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
    .filter((day) => teachingWeek(calendar, day).days.includes(weekday(day)));
}
export function dayStatus(calendar: AcademicCalendar, date: string) {
  const term = calendar.terms.find((term) => term.start <= date && date <= term.end);
  const holiday = calendar.holidays.find((holiday) => holiday.start <= date && date <= holiday.end);
  const included = teachingWeek(calendar, date).days.includes(weekday(date));
  return { term, holiday, included, teaching: Boolean(term && !holiday && included) };
}
export interface SchedulePreview {
  occurrences: Omit<Occurrence, 'id'>[];
  requestedEnd: string;
  actualEnd: string;
  termEnd: string;
  truncated: boolean;
  skipped: { date: string; reason: string }[];
}
export function previewSchedule(calendar: AcademicCalendar, slots: DaySlot[], slotIds: string[], input: Recurrence): SchedulePreview {
  const schedule = recurrenceSchema.parse(input);
  const initial = dayStatus(calendar, schedule.startDate);
  if (!initial.teaching || !initial.term) throw new Error('Start on an included teaching day inside a term, excluding holidays.');
  const chosen = slotIds.map((id) => slots.find((slot) => slot.id === id));
  if (!chosen.length || chosen.some((slot) => !slot || slot.kind !== 'lesson' || slot.day !== weekday(schedule.startDate)))
    throw new Error('Choose schedulable periods on the start date.');
  if (new Set(slotIds).size !== slotIds.length) throw new Error('Duplicate lesson periods.');
  const step = schedule.frequency === 'weekly' ? 7 : 1;
  const count = schedule.frequency === 'once' ? 1 : schedule.count;
  const requestedEnd = addDays(schedule.startDate, (count - 1) * step);
  const occurrences: SchedulePreview['occurrences'] = [];
  const skipped: SchedulePreview['skipped'] = [];
  for (let index = 0; index < count; index++) {
    const date = addDays(schedule.startDate, index * step);
    if (date > initial.term.end) break;
    const status = dayStatus(calendar, date);
    if (!status.teaching) {
      skipped.push({ date, reason: status.holiday?.name ?? 'Excluded day / no teaching' });
      continue;
    }
    for (const selected of chosen) {
      if (!selected) throw new Error('Unknown period.');
      const slot = schedule.frequency === 'daily'
        ? slots.find((slot) => slot.day === weekday(date) && slot.start === selected.start && slot.end === selected.end
          && (slot.typeId ?? slot.kind) === (selected.typeId ?? selected.kind) && slot.kind === 'lesson')
        : selected;
      if (!slot) throw new Error(`No matching ${selected.start}-${selected.end} period on ${formatDate(date)}. Configure that day's period template first.`);
      occurrences.push({ date, slotId: slot.id });
    }
  }
  if (occurrences.length > 500) throw new Error('Limit this series to 500 period occurrences.');
  return { occurrences, requestedEnd, actualEnd: occurrences[occurrences.length - 1].date, termEnd: initial.term.end,
    truncated: requestedEnd > initial.term.end, skipped };
}
