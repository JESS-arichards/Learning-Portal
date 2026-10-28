import { describe, expect, it } from 'vitest';
import { academicCalendarSchema, addDays, dayStatus, previewSchedule, type AcademicCalendar } from './calendar';
import { validateSchedule, DEFAULT_PERIOD_TYPES, type DaySlot, type Snapshot } from './learning';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const calendar: AcademicCalendar = {
  years: [{ id: uuid(1), name: '2026/27', start: '2026-09-01', end: '2027-07-01' }],
  terms: [{ id: uuid(2), yearId: uuid(1), name: 'Autumn', start: '2026-09-01', end: '2026-12-11' }],
  holidays: [{ id: uuid(3), yearId: uuid(1), name: 'Half term', start: '2026-10-27', end: '2026-10-28' }],
};
const slots: DaySlot[] = Array.from({ length: 5 }, (_, day) => ({ id: uuid(10 + day), day, name: 'P1', typeId: 'lesson', kind: 'lesson', start: '08:00', end: '09:00' }));
describe('academic calendar', () => {
  it('validates inclusive single and multi-day holidays', () => {
    expect(academicCalendarSchema.parse(calendar)).toEqual(calendar);
    expect(dayStatus(calendar, '2026-10-27').teaching).toBe(false);
    expect(dayStatus(calendar, '2026-10-28').teaching).toBe(false);
    expect(dayStatus(calendar, '2026-10-29').teaching).toBe(true);
    expect(dayStatus(calendar, '2026-10-31').teaching).toBe(false);
    expect(dayStatus(calendar, '2026-12-14').teaching).toBe(false);
  });
  it('rejects invalid dates, reversed ranges, overlap and out-of-year terms', () => {
    expect(academicCalendarSchema.safeParse({ ...calendar, years: [{ ...calendar.years[0], start: '2026-02-30' }] }).success).toBe(false);
    expect(academicCalendarSchema.safeParse({ ...calendar, terms: [{ ...calendar.terms[0], end: '2026-08-01' }] }).success).toBe(false);
    expect(academicCalendarSchema.safeParse({ ...calendar, terms: [...calendar.terms, { ...calendar.terms[0], id: uuid(4) }] }).success).toBe(false);
    expect(academicCalendarSchema.safeParse({ ...calendar, terms: [{ ...calendar.terms[0], end: '2028-01-01' }] }).success).toBe(false);
  });
  it('generates one-off lessons only on teaching days', () => {
    const result = previewSchedule(calendar, slots, [slots[0].id], { startDate: '2026-10-26', frequency: 'once', count: 1 });
    expect(result.occurrences).toEqual([{ date: '2026-10-26', slotId: slots[0].id }]);
    expect(() => previewSchedule(calendar, slots, [slots[1].id], { startDate: '2026-10-27', frequency: 'once', count: 1 })).toThrow('teaching date');
    expect(() => previewSchedule(calendar, slots, [slots[0].id], { startDate: '2026-12-14', frequency: 'once', count: 1 })).toThrow();
  });
  it('counts calendar days and skips holidays/weekends without extending', () => {
    const result = previewSchedule(calendar, slots, [slots[0].id], { startDate: '2026-10-26', frequency: 'daily', count: 7 });
    expect(result.occurrences.map((item) => item.date)).toEqual(['2026-10-26', '2026-10-29', '2026-10-30']);
    expect(result.occurrences.map((item) => item.slotId)).toEqual([slots[0].id, slots[3].id, slots[4].id]);
    expect(result.requestedEnd).toBe('2026-11-01');
    expect(result.actualEnd).toBe('2026-10-30');
    expect(result.skipped).toHaveLength(4);
  });
  it('stops weekly repeats at term end and reports actual end', () => {
    const result = previewSchedule(calendar, slots, [slots[0].id], { startDate: '2026-12-07', frequency: 'weekly', count: 5 });
    expect(result.occurrences).toHaveLength(1);
    expect(result.requestedEnd).toBe('2027-01-04');
    expect(result.actualEnd).toBe('2026-12-07');
    expect(result.termEnd).toBe('2026-12-11');
    expect(result.truncated).toBe(true);
  });
  it('skips holiday weeks without adding replacements', () => {
    const result = previewSchedule({ ...calendar, holidays: [{ ...calendar.holidays[0], start: '2026-11-02', end: '2026-11-06' }] },
      slots, [slots[0].id], { startDate: '2026-10-26', frequency: 'weekly', count: 3 });
    expect(result.occurrences.map((item) => item.date)).toEqual(['2026-10-26', '2026-11-09']);
  });
  it('rejects missing daily templates, wrong day, duplicate periods and excessive counts', () => {
    expect(() => previewSchedule(calendar, [slots[0]], [slots[0].id], { startDate: '2026-10-26', frequency: 'daily', count: 5 })).toThrow('No matching');
    expect(() => previewSchedule(calendar, slots, [slots[1].id], { startDate: '2026-10-26', frequency: 'once', count: 1 })).toThrow('start date');
    expect(() => previewSchedule(calendar, slots, [slots[0].id, slots[0].id], { startDate: '2026-10-26', frequency: 'once', count: 1 })).toThrow('Duplicate');
    expect(() => previewSchedule(calendar, slots, [slots[0].id], { startDate: '2026-10-26', frequency: 'weekly', count: 54 })).toThrow();
  });
  it('handles leap days in UTC date arithmetic', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-28', 2)).toBe('2028-03-01');
  });
});
it('allows the same period on different dates, but rejects same-date shared-person clashes', () => {
  const classroom = { id: uuid(30), name: 'Maths', yearGroup: '7', division: 'Secondary', teachers: [{ id: 1, email: 'teacher@test.school', displayName: 'Teacher' }], students: [{ email: 'student@test.school', displayName: 'Student' }] };
  const lesson = { id: uuid(31), classId: classroom.id, name: 'Lesson', description: '', links: [], files: [], updatedAt: '', slotIds: [slots[0].id], occurrences: [{ id: uuid(32), date: '2026-10-26', slotId: slots[0].id }] };
  const snapshot: Snapshot = { slots, periodTypes: DEFAULT_PERIOD_TYPES, classes: [classroom], lessons: [lesson] };
  expect(() => validateSchedule({ ...lesson, occurrences: [{ ...lesson.occurrences[0], date: '2026-11-02' }] }, snapshot.lessons, snapshot.classes, slots)).not.toThrow();
  expect(() => validateSchedule(lesson, snapshot.lessons, snapshot.classes, slots)).toThrow('clash');
});
