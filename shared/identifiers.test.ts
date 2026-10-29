import { expect, it } from 'vitest';
import { uuidSchema } from './identifiers';
import { classSchema, lessonSchema } from './learning';
import { academicCalendarSchema } from './calendar';

const id = 'abcdef01-abcd-4abc-8def-abcdef012345';
it('normalises SQL and browser UUIDs without accepting invalid identifiers', () => {
  expect(uuidSchema.parse(id.toUpperCase())).toBe(id);
  expect(uuidSchema.parse(id)).toBe(id);
  expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
});
it('normalises lesson and resource identities and detects duplicate periods with mixed casing', () => {
  const lesson = { id: id.toUpperCase(), classId: id.toUpperCase(), name: 'Lesson', description: '',
    slotIds: [id.toUpperCase()], links: [{ id: id.toUpperCase(), kind: 'link', name: 'Reading', url: 'https://school.test/' }],
    files: [{ id: id.toUpperCase(), kind: 'file', name: 'Worksheet.pdf', size: 3 }], updatedAt: '',
    occurrences: [{ id: id.toUpperCase(), slotId: id.toUpperCase(), date: '2026-10-28' }] };
  const parsed = lessonSchema.parse(lesson);
  expect([parsed.id, parsed.classId, parsed.slotIds[0], parsed.files[0].id, parsed.links[0].id,
    parsed.occurrences![0].id, parsed.occurrences![0].slotId]).toEqual(Array(7).fill(id));
  expect(lessonSchema.safeParse({ ...lesson, slotIds: [id, id.toUpperCase()] }).success).toBe(false);
});
it('normalises class and calendar references before relational comparisons', () => {
  expect(classSchema.parse({ id: id.toUpperCase(), name: 'Class', yearGroup: '7', division: 'Secondary',
    teachers: [{ id: 1, email: 'teacher@school.test', displayName: 'Teacher' }],
    students: [{ email: 'student@school.test', displayName: 'Student' }] }).id).toBe(id);
  const calendar = academicCalendarSchema.parse({
    years: [{ id, name: 'Year', start: '2026-09-01', end: '2027-07-01' }],
    terms: [{ id, yearId: id.toUpperCase(), name: 'Term', start: '2026-09-01', end: '2026-12-11' }], holidays: [],
  });
  expect(calendar.terms[0].yearId).toBe(id);
});
