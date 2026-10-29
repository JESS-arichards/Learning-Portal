import { describe, expect, it } from 'vitest';
import { addPeriods, dayStructureSchema, DEFAULT_PERIOD_TYPES, periodTypesSchema, canManage, classKey, classSchema, isAdmin, lessonInputSchema, lessonSchema, lessonTypeInputSchema, LESSON_TYPE_ICONS, linkSchema, structureSchema, validateSchedule, type DaySlot, type LearningClass, type Lesson } from './learning.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const teacher = { id: 1, displayName: 'Teacher', email: 'teacher@school.test' };
const student = { id: 2, displayName: 'Student', email: 'student@school.test' };
const classroom: LearningClass = { id: uuid(1), name: 'Maths', yearGroup: '7', division: 'Secondary', teachers: [teacher], students: [student] };
const slots: DaySlot[] = [
  { id: uuid(2), name: 'Period 1', day: 0, kind: 'lesson', start: '08:00', end: '09:00' },
  { id: uuid(3), name: 'Break', day: 0, kind: 'break', start: '09:00', end: '09:20' },
  { id: uuid(4), name: 'Period 1', day: 1, kind: 'lesson', start: '08:00', end: '09:00' },
];
const lesson: Lesson = { id: uuid(5), classId: classroom.id, name: 'Fractions', description: '', links: [], files: [], slotIds: [slots[0].id], updatedAt: new Date().toISOString() };

describe('weekly structure', () => {
  it('adds one day, selected days or exactly Monday-Friday with independent period IDs', () => {
    for (const days of [[3], [0, 2, 6], [0, 1, 2, 3, 4]]) {
      let nextId = 20;
      const result = addPeriods([], { name: 'Assembly', kind: 'break', typeId: 'break', start: '10:00', end: '10:30' }, days, () => uuid(nextId++));
      expect(result.map((slot) => slot.day)).toEqual(days);
      expect(new Set(result.map((slot) => slot.id)).size).toBe(days.length);
      expect(result.every((slot) => slot.name === 'Assembly' && slot.start === '10:00' && slot.end === '10:30')).toBe(true);
    }
  });
  it('rejects a multi-day add atomically if any selected day overlaps, is invalid or exceeds the limit', () => {
    const period = { name: 'New', kind: 'lesson' as const, start: '08:30', end: '09:30' };
    const original = structuredClone(slots);
    let nextId = 20;
    expect(() => addPeriods(slots, period, [2, 0], () => uuid(nextId++))).toThrow('overlap');
    expect(slots).toEqual(original);
    expect(() => addPeriods([], period, [], () => uuid(30))).toThrow('Select at least one day');
    expect(() => addPeriods([], period, [7], () => uuid(30))).toThrow();
    const maximum = Array.from({ length: 140 }, (_, i) => ({ ...slots[0], id: uuid(i + 100) }));
    expect(() => addPeriods(maximum, period, [2], () => uuid(30))).toThrow();
  });
  it('validates configurable types and refuses missing, duplicate or inconsistent types', () => {
    const custom = { id: uuid(30), name: 'Assembly', kind: 'break' as const };
    const periodTypes = [...DEFAULT_PERIOD_TYPES, custom];
    expect(dayStructureSchema.parse({ slots: [{ ...slots[1], typeId: custom.id }], periodTypes }).periodTypes).toEqual(periodTypes);
    for (const types of [[], [custom, custom], [custom, { ...custom, id: uuid(31), name: ' assembly ' }]]) {
      expect(periodTypesSchema.safeParse(types).success).toBe(false);
    }
    expect(dayStructureSchema.safeParse({ slots: [{ ...slots[0], typeId: custom.id }], periodTypes }).success).toBe(false);
    expect(dayStructureSchema.safeParse({ slots: [{ ...slots[0], typeId: uuid(99) }], periodTypes }).success).toBe(false);
    expect(dayStructureSchema.safeParse({ slots, periodTypes: [custom] }).success).toBe(false);
  });
  it('accepts multiple days, adjacent lessons and breaks', () => expect(structureSchema.parse(slots)).toEqual(slots));
  it.each([
    [...slots, { ...slots[0], id: uuid(7), start: '08:30', end: '09:30' }],
    [...slots, { ...slots[0], id: slots[1].id, day: 3 }],
    [{ ...slots[0], start: '25:00' }],
    [{ ...slots[0], start: '09:00', end: '08:00' }],
    [{ ...slots[0], day: 7 }],
    [{ ...slots[0], start: '08:00', end: '08:00' }],
  ].map((invalid) => ({ invalid })))('rejects invalid/overlapping structures %#', ({ invalid }) => expect(structureSchema.safeParse(invalid).success).toBe(false));
});
describe('lesson validation and scheduling', () => {
  it('requires an explicit type on lesson writes while retaining untyped legacy reads', () => {
    const { id: _id, files: _files, updatedAt: _updated, ...input } = lesson;
    expect(lessonSchema.parse(lesson).lessonTypeId).toBeUndefined();
    expect(lessonSchema.parse({ ...lesson, lessonTypeId: null }).lessonTypeId).toBeNull();
    for (const lessonTypeId of [undefined, null, '', 'not-a-type']) {
      expect(lessonInputSchema.safeParse({ ...input, lessonTypeId }).success).toBe(false);
    }
    expect(lessonInputSchema.parse({ ...input, lessonTypeId: uuid(90) }).lessonTypeId).toBe(uuid(90));
  });
  it('validates lesson type names, colours and optional supported icons', () => {
    expect(lessonTypeInputSchema.parse({ name: ' Seesaw ', colour: '#FFC83D' })).toEqual({ name: 'Seesaw', colour: '#FFC83D', icon: null });
    for (const icon of [null, ...LESSON_TYPE_ICONS]) {
      expect(lessonTypeInputSchema.safeParse({ name: 'Type', colour: '#aabbcc', icon }).success).toBe(true);
    }
    for (const input of [{ name: '' }, { name: 'x'.repeat(101) }, { colour: 'red' }, { colour: '#fff' }, { colour: '#GG0000' }, { icon: 'unknown' }]) {
      expect(lessonTypeInputSchema.safeParse({ name: 'Type', colour: '#FFC83D', icon: null, ...input }).success).toBe(false);
    }
  });
  it('supports a lesson repeated on different days', () => {
    const draft = { ...lesson, slotIds: [slots[0].id, slots[2].id] };
    expect(() => validateSchedule(draft, [], [classroom], slots)).not.toThrow();
  });
  it('rejects breaks and deleted slots', () => {
    for (const slotId of [slots[1].id, uuid(99)]) expect(() => validateSchedule({ ...lesson, slotIds: [slotId] }, [], [classroom], slots)).toThrow('lesson periods');
  });
  it('rejects clashes for same class, shared teacher or shared student', () => {
    const sameTeacher = { ...classroom, id: uuid(8), students: [{ ...student, id: 3 }] };
    const sameStudent = { ...classroom, id: uuid(9), teachers: [{ ...teacher, id: 4 }] };
    for (const c of [classroom, sameTeacher, sameStudent]) {
      expect(() => validateSchedule({ ...lesson, classId: c.id }, [lesson], [classroom, c], slots)).toThrow('Timetable clash');
    }
  });
  it('allows independent classes at same time', () => {
    const independent = { ...classroom, id: uuid(10), teachers: [{ ...teacher, id: 9 }], students: [{ ...student, id: 8, email: 'other@school.test' }] };
    expect(() => validateSchedule({ ...lesson, classId: independent.id }, [lesson], [classroom, independent], slots)).not.toThrow();
  });
  it('allows editing a lesson without clashing with itself', () => expect(() => validateSchedule(lesson, [lesson], [classroom], slots, lesson.id)).not.toThrow());
  it('detects shared student clashes by normalized email without requiring IDs', () => {
    const pending = { ...classroom, students: [{ email: student.email, displayName: 'Pending' }] };
    const other = { ...classroom, id: uuid(9), teachers: [{ ...teacher, id: 4 }], students: [{ email: ' STUDENT@school.test ', displayName: 'Pending' }] };
    expect(() => validateSchedule({ ...lesson, classId: other.id }, [lesson], [pending, other], slots)).toThrow('Timetable clash');
  });
  it('requires at least one unique period', () => {
    const { id: _id, files: _files, updatedAt: _updated, ...details } = lesson;
    const input = { ...details, lessonTypeId: uuid(90) };
    expect(lessonInputSchema.safeParse({ ...input, slotIds: [] }).success).toBe(false);
    expect(lessonInputSchema.safeParse({ ...input, slotIds: [slots[0].id, slots[0].id] }).success).toBe(false);
    expect(lessonInputSchema.safeParse({ ...input, files: [] }).success).toBe(false);
  });
});
describe('resource links', () => {
  it.each(['javascript:alert(1)', 'http://example.test', 'https://user:pass@example.test'])('rejects unsafe link %s', (url) => {
    expect(linkSchema.safeParse({ id: uuid(1), name: 'Resource', kind: 'link', url }).success).toBe(false);
  });
  it('limits Teams links to actual Microsoft Teams hosts', () => {
    for (const host of ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft']) {
      expect(linkSchema.safeParse({ id: uuid(1), name: 'Meeting', kind: 'teams', url: `https://${host}/meet/123` }).success).toBe(true);
    }
    expect(linkSchema.safeParse({ id: uuid(1), name: 'Meeting', kind: 'teams', url: 'https://teams.microsoft.com.evil.test' }).success).toBe(false);
  });
});
describe('class identity and permissions', () => {
  it('reads legacy student IDs without requiring or retaining them', () => {
    const result = classSchema.parse(classroom);
    expect(result.students).toEqual([{ email: student.email, displayName: student.displayName }]);
    expect(result.teachers[0].id).toBe(teacher.id);
    expect(classSchema.parse({ ...classroom, students: [{ email: ' STUDENT@school.test ', displayName: 'Pending' }] }).students[0].email).toBe(student.email);
  });
  it('matches class identity case-insensitively without delimiter collisions', () => {
    expect(classKey({ ...classroom, name: ' MATHS ' })).toBe(classKey(classroom));
    expect(classKey({ name: 'a|b', yearGroup: 'c', division: 'd' })).not.toBe(classKey({ name: 'a', yearGroup: 'b|c', division: 'd' }));
  });
  it('grants management only to learning admins or assigned teachers', () => {
    const user = { ...student, roles: ['Student'] };
    expect(canManage(user, classroom)).toBe(false);
    expect(canManage({ ...teacher, roles: ['Staff'] }, classroom)).toBe(true);
    expect(canManage({ ...user, roles: ['Learn Admin'] }, classroom)).toBe(true);
    expect(isAdmin({ roles: ['Admissions Admin', 'Staff'] })).toBe(false);
  });
});
