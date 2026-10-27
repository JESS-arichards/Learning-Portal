import { describe, expect, it, vi } from 'vitest';
import { previewClasses, CSV_HEADERS } from './importClasses.js';
import type { User } from '../shared/learning.js';

const teacher: User = { id: 1, displayName: 'Central teacher', email: 'teacher@school.test', isActive: true, sessionVersion: 0, roles: ['Staff'], studentEmails: [] };
const student: User = { ...teacher, id: 2, displayName: 'Central student', email: 'student@school.test', roles: ['Student'] };
const row = 'Maths,Teacher Display,TEACHER@school.test,Student Display,student@school.test,Year 7,Secondary';
const csv = (...rows: string[]) => CSV_HEADERS.join(',') + '\r\n' + rows.join('\r\n');
const lookup = async (emails: string[]) => [teacher, student].filter((u) => emails.includes(u.email));

describe('class CSV import preview', () => {
  it('matches teacher IDs and stores student emails without user IDs, retaining supplied names', async () => {
    const result = await previewClasses('\ufeff' + csv(row), [], lookup);
    expect(result.errors).toEqual([]);
    expect(result.rowCount).toBe(1);
    expect(result.classes[0].teachers).toEqual([{ id: teacher.id, email: teacher.email, displayName: 'Teacher Display' }]);
    expect(result.classes[0].students).toEqual([{ email: student.email, displayName: 'Student Display' }]);
    expect(result.warnings).toEqual([]);
  });
  it('handles quoted commas and newlines', async () => {
    const result = await previewClasses(csv(row.replace('Maths', '"Maths, advanced"').replace('Teacher Display', '"Teacher\nDisplay"')), [], lookup);
    expect(result.errors).toEqual([]);
    expect(result.classes[0].name).toBe('Maths, advanced');
  });
  it('replaces existing class rosters using stable class identity', async () => {
    const first = await previewClasses(csv(row), [], lookup);
    const next = await previewClasses(csv(row.replace('Maths', 'MATHS')), first.classes, lookup);
    expect(next.classes[0].id).toBe(first.classes[0].id);
  });
  it('deduplicates directory lookups and reports duplicate rows', async () => {
    const spy = vi.fn(lookup);
    const result = await previewClasses(csv(row, row), [], spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith([teacher.email, student.email]);
    expect(result.errors).toEqual([{ row: 3, message: 'Duplicate class/teacher/student row.' }]);
  });
  it('groups multiple students and teachers under one class', async () => {
    const anotherStudent = { ...student, id: 3, email: 'other@school.test' };
    const result = await previewClasses(csv(row, row.replaceAll('student@school.test', anotherStudent.email)), [], async (emails) => [...await lookup(emails), anotherStudent]);
    expect(result.errors).toEqual([]);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].teachers).toHaveLength(1);
    expect(result.classes[0].students).toHaveLength(2);
  });
  it('reports invalid student email with CSV row numbers', async () => {
    const result = await previewClasses(csv(row.replace('student@school.test', 'not-an-email')), [], lookup);
    expect(result.errors[0].row).toBe(2);
    expect(result.errors[0].message).toContain('Invalid teacher or student');
  });
  it('creates classes when all students are unknown, with nonblocking row warnings', async () => {
    const result = await previewClasses(csv(row.replace('student@school.test', ' NEW@school.test ')), [], lookup);
    expect(result.errors).toEqual([]);
    expect(result.classes[0].students).toEqual([{ email: 'new@school.test', displayName: 'Student Display' }]);
    expect(result.warnings).toEqual([{ row: 2, message: expect.stringContaining('new@school.test') }]);
  });
  it('requires an active Staff teacher even when the student is unknown', async () => {
    const result = await previewClasses(csv(row.replace('TEACHER@school.test', 'missing@school.test')), [], lookup);
    expect(result.errors).toEqual([{ row: 2, message: expect.stringContaining('must match an active Staff') }]);
  });
  it('deduplicates unknown students by normalized email across teacher rows', async () => {
    const otherTeacher = { ...teacher, id: 9, email: 'otherteacher@school.test' };
    const result = await previewClasses(csv(
      row.replace('student@school.test', 'unknown@school.test'),
      row.replace('TEACHER@school.test', otherTeacher.email).replace('student@school.test', 'UNKNOWN@school.test'),
    ), [], async (emails) => [...await lookup(emails), otherTeacher]);
    expect(result.errors).toEqual([]);
    expect(result.classes[0].students).toHaveLength(1);
    expect(result.classes[0].teachers).toHaveLength(2);
  });
  it('retains a pending enrolment unchanged when the central student later exists', async () => {
    const first = await previewClasses(csv(row), [], async () => [teacher]);
    const next = await previewClasses(csv(row), first.classes, lookup);
    expect(first.warnings).toHaveLength(1);
    expect(next.warnings).toEqual([]);
    expect(next.classes).toEqual(first.classes);
  });
  it('treats Division as required and part of the class identity', async () => {
    const result = await previewClasses(csv(row, row.replace('Secondary', 'Primary')), [], lookup);
    expect(result.errors).toEqual([]);
    expect(result.classes).toHaveLength(2);
    expect((await previewClasses(csv(row.replace('Secondary', '')), [], lookup)).errors).toHaveLength(1);
  });
  it('rejects inactive users and wrong central roles', async () => {
    const result = await previewClasses(csv(row), [], async (emails) => (await lookup(emails)).map((user) => ({ ...user, roles: ['Parent'], isActive: false })));
    expect(result.errors[0].message).toContain('Teacher');
    expect(result.errors[0].message).toContain('Student');
  });
  it('reports conflicting names instead of choosing one silently', async () => {
    const result = await previewClasses(csv(row, row.replace('Student Display', 'Different name')), [], lookup);
    expect(result.errors[0].message).toContain('Conflicting');
  });
  it('requires the exact seven-column contract and actual data', async () => {
    await expect(previewClasses('wrong,headers\n1,2', [], lookup)).rejects.toThrow('CSV headers');
    await expect(previewClasses(CSV_HEADERS.join(','), [], lookup)).rejects.toThrow('between 1 and 5,000');
    await expect(previewClasses(csv('a,b,c'), [], lookup)).rejects.toThrow('Invalid CSV');
  });
  it('reports missing fields and oversized values', async () => {
    expect((await previewClasses(csv(row.replace('Maths', '')), [], lookup)).errors[0].row).toBe(2);
    expect((await previewClasses(csv(row.replace('Maths', 'x'.repeat(201))), [], lookup)).errors[0].message).toContain('maximum length');
  });
  it('accepts 5,000 rows and bounds directory requests to 200 unique emails per batch', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => row.replace('student@school.test', `student${i}@school.test`));
    const spy = vi.fn(async (emails: string[]) => emails.map((email) => email === teacher.email ? teacher : ({
      ...student, id: Number(email.match(/student(\d+)/)?.[1]) + 100, email,
    })));
    const result = await previewClasses(csv(...rows), [], spy);
    expect(result.rowCount).toBe(5000);
    expect(result.errors).toEqual([]);
    expect(result.classes[0].students).toHaveLength(5000);
    expect(spy).toHaveBeenCalledTimes(26);
    expect(spy.mock.calls.every(([emails]) => emails.length <= 200)).toBe(true);
    spy.mockClear();
    await expect(previewClasses(csv(...rows, row), [], spy)).rejects.toThrow('between 1 and 5,000');
    expect(spy).not.toHaveBeenCalled();
  });
});
