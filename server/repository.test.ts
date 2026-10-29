import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../shared/learning.js';

const mocks = vi.hoisted(() => ({ query: vi.fn(), input: vi.fn(), transaction: vi.fn() }));
vi.mock('./db.js', async () => {
  const { default: sql } = await import('mssql');
  return { sql, transaction: mocks.transaction };
});
import { snapshot, save, saveLessonType, saveStructure, saveCalendar, remove } from './repository.js';
import { SUNDAY_TEACHING_WEEK, DEFAULT_TEACHING_WEEK } from '../shared/calendar.js';
import { DEFAULT_PERIOD_TYPES } from '../shared/learning.js';
import { sql } from './db.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = { input: mocks.input, query: mocks.query };
const tx = { request: () => request } as unknown as sql.Transaction;
const classroom = {
  id: uuid(1), name: 'Maths', yearGroup: '7', division: 'Secondary',
  teachers: [{ id: 10, email: 'teacher@school.test', displayName: 'Teacher' }],
  students: [{ email: 'pending@school.test', displayName: 'Pending Student' }],
};
const lesson = {
  id: uuid(3), classId: uuid(1), name: 'Fractions', description: 'x'.repeat(5000), updatedAt: '2026-10-27T00:00:00.000Z',
  slotIds: [uuid(2)], links: [{ id: uuid(4), kind: 'link' as const, name: 'Website', url: 'https://school.test/' }],
  files: [{ id: uuid(5), kind: 'file' as const, name: 'Resource.pdf', size: 12 }],
};
function records(): unknown[][] {
  return [
    [{ id: uuid(1), name: 'Maths', yearGroup: '7', division: 'Secondary' }],
    [{ classId: uuid(1), ...classroom.teachers[0] }],
    [{ classId: uuid(1), ...classroom.students[0] }],
    DEFAULT_PERIOD_TYPES,
    [{ id: uuid(2), name: 'P1', day: 0, typeId: 'lesson', kind: 'lesson', start: '08:00', end: '09:00' }],
    [{ id: lesson.id, classId: lesson.classId, name: lesson.name, description: lesson.description, updatedAt: lesson.updatedAt }],
    [{ lessonId: lesson.id, periodId: uuid(2) }],
    [{ lessonId: lesson.id, ...lesson.links[0] }],
    [{ lessonId: lesson.id, ...lesson.files[0] }],
    [], [], [], [], [], [], [],
  ];
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.input.mockReturnValue(request);
  mocks.query.mockResolvedValue({ recordsets: records() });
  mocks.transaction.mockImplementation(async (work: (connection: sql.Transaction) => Promise<Snapshot>) => work(tx));
});

describe('relational Learning repository', () => {
  it('reads stored lesson types and nullable legacy lesson references', async () => {
    const rows = records();
    rows[15] = [{ id: uuid(90), name: 'Seesaw', colour: '#FFC83D', icon: null }];
    rows[5] = [{ ...(rows[5][0] as Record<string, unknown>), lessonTypeId: null }];
    mocks.query.mockResolvedValue({ recordsets: rows });
    expect((await snapshot()).lessonTypes).toEqual(rows[15]);
    expect((await snapshot()).lessons[0].lessonTypeId).toBeNull();
  });
  it('parameterizes lesson type configuration and persists lesson references', async () => {
    const type = { id: uuid(90), name: "Teacher's workshop", colour: '#FFC83D', icon: 'book' as const };
    await saveLessonType(tx, type);
    expect(mocks.input).toHaveBeenCalledWith('name', sql.NVarChar(100), type.name);
    expect(mocks.input).toHaveBeenCalledWith('icon', sql.VarChar(20), type.icon);
    expect(mocks.query.mock.calls[0][0]).not.toContain(type.name);
    await save(tx, 'lesson', lesson.id, { ...lesson, lessonTypeId: type.id });
    expect(mocks.query.mock.calls[1][0]).toContain("LessonTypeId=JSON_VALUE(@value,'$.lessonTypeId')");
    await remove(tx, 'lessonType', type.id);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toContain('DELETE FROM dbo.LearningLessonTypes WHERE Id=@id');
  });
  it('assembles classes, email-only enrolments, periods and complete lesson resources from tables', async () => {
    const data = await snapshot();
    expect(data.classes).toEqual([classroom]);
    expect(data.lessons).toEqual([lesson]);
    expect(data.periodTypes).toEqual(DEFAULT_PERIOD_TYPES);
    expect(data.slots[0]).toMatchObject({ typeId: 'lesson', kind: 'lesson' });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls[0][0]).not.toContain('LearningDocuments');
  });
  it('reuses an existing write transaction without nesting another transaction', async () => {
    await snapshot(tx);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('joins real hexadecimal UUIDs regardless of SQL driver casing and returns browser-compatible IDs', async () => {
    const identifiers = new Map(Array.from({ length: 5 }, (_, index) => [uuid(index + 1), `abcdef0${index + 1}-abcd-4abc-8def-abcdef012345`]));
    const rows = records().map((set, setIndex) => set.map((row) => Object.fromEntries(
      Object.entries(row as Record<string, unknown>).map(([key, value]) => {
        const replacement = typeof value === 'string' ? identifiers.get(value) : undefined;
        return [key, replacement ? setIndex % 2 ? replacement : replacement.toUpperCase() : value];
      }),
    )));
    mocks.query.mockResolvedValue({ recordsets: rows });
    const data = await snapshot();
    expect(data.classes[0].id).toBe(identifiers.get(classroom.id));
    expect(data.classes[0].teachers).toEqual(classroom.teachers);
    expect(data.lessons[0]).toMatchObject({
      id: identifiers.get(lesson.id), classId: identifiers.get(classroom.id),
      slotIds: [identifiers.get(uuid(2))],
      files: [{ ...lesson.files[0], id: identifiers.get(uuid(5)) }],
      links: [{ ...lesson.links[0], id: identifiers.get(uuid(4)) }],
    });
  });
  it('reads named meetings and validates stored options without masking corrupt metadata', async () => {
    const rows = records();
    const meeting = { occurrenceId: uuid(30), lessonId: lesson.id, organizerUserId: 10, state: 'created',
      title: 'Maths workshop', joinUrl: 'https://teams.microsoft.com/test', options: '{"allowBreakoutRooms":true}', optionsApplied: false };
    rows[14] = [meeting];
    mocks.query.mockResolvedValue({ recordsets: rows });
    expect((await snapshot()).meetings?.[0]).toEqual({ ...meeting, options: { allowBreakoutRooms: true } });
    rows[14] = [{ ...meeting, options: '{"allowBreakoutRooms":"yes"}' }];
    await expect(snapshot()).rejects.toThrow();
  });
  it('rejects invalid relational rows and empty type lists instead of silently supplying defaults', async () => {
    const rows = records(); rows[3] = [];
    mocks.query.mockResolvedValue({ recordsets: rows });
    await expect(snapshot()).rejects.toThrow();
    rows[3] = DEFAULT_PERIOD_TYPES; rows[2] = [];
    await expect(snapshot()).rejects.toThrow();
  });
  it('reads inherited and overridden teaching weeks and rejects corrupt database settings', async () => {
    const rows = records();
    const year = { id: uuid(70), name: '2026/27', start: '2026-09-01', end: '2027-07-01' };
    const term = { id: uuid(71), yearId: uuid(70), name: 'Autumn', start: '2026-09-01', end: '2026-12-11' };
    rows[9] = [{ ...year, week: JSON.stringify(SUNDAY_TEACHING_WEEK) }];
    rows[10] = [{ ...term, week: JSON.stringify(DEFAULT_TEACHING_WEEK) }];
    mocks.query.mockResolvedValue({ recordsets: rows });
    expect((await snapshot()).calendar).toEqual({ years: [{ ...year, week: SUNDAY_TEACHING_WEEK }], terms: [{ ...term, week: DEFAULT_TEACHING_WEEK }], holidays: [] });
    rows[9] = [{ ...year, week: null }]; rows[10] = [term];
    expect((await snapshot()).calendar).toEqual({ years: [year], terms: [term], holidays: [] });
    for (const week of ['', 'not json', '{"days":[],"startsOn":0}', '{"days":[0],"startsOn":9}']) {
      rows[9] = [{ ...year, week }];
      await expect(snapshot()).rejects.toThrow();
    }
  });
  it('writes teaching weeks as parameterized JSON without adding defaults to inherited terms', async () => {
    const calendar = {
      years: [{ id: uuid(70), name: '2026/27', start: '2026-09-01', end: '2027-07-01', week: SUNDAY_TEACHING_WEEK }],
      terms: [{ id: uuid(71), yearId: uuid(70), name: 'Autumn', start: '2026-09-01', end: '2026-12-11' }], holidays: [],
    };
    await saveCalendar(tx, calendar);
    expect(mocks.input).toHaveBeenCalledWith('calendar', sql.NVarChar(sql.MAX), expect.any(String));
    expect(JSON.parse(mocks.input.mock.calls[0][2])).toEqual(calendar);
    expect(mocks.query.mock.calls[0][0]).toContain('week nvarchar(max) AS JSON');
    expect(mocks.query.mock.calls[0][0]).toContain('LearningTerms(Id,YearId,Name,StartDate,EndDate,TeachingWeek)');
  });
  it('parameterizes class fields and replaces only the specified roster', async () => {
    await save(tx, 'class', classroom.id, classroom);
    expect(mocks.input).toHaveBeenCalledWith('id', sql.UniqueIdentifier, classroom.id);
    expect(mocks.input).toHaveBeenCalledWith('value', sql.NVarChar(sql.MAX), JSON.stringify(classroom));
    const query = mocks.query.mock.calls[0][0] as string;
    expect(query).toContain('INSERT dbo.LearningClassStudents');
    expect(query).toContain('DELETE FROM dbo.LearningClassTeachers WHERE ClassId=@id');
    expect(query).not.toContain('DELETE FROM dbo.LearningLessons');
    expect(query).not.toContain('LearningDocuments');
  });
  it('preserves long descriptions and resource IDs when replacing a lesson', async () => {
    await save(tx, 'lesson', lesson.id, lesson);
    const query = mocks.query.mock.calls[0][0] as string;
    expect(query).toContain('description nvarchar(max)');
    expect(query).toContain('INSERT dbo.LearningLessonFiles');
    expect(query).toContain('INSERT dbo.LearningLessonPeriods');
    const value = mocks.input.mock.calls.find(([name]) => name === 'value')?.[2];
    expect(JSON.parse(value)).toEqual(lesson);
  });
  it('rejects mismatched IDs and invalid values before issuing any SQL', async () => {
    await expect(save(tx, 'class', uuid(99), classroom)).rejects.toThrow('must match');
    await expect(save(tx, 'lesson', 'invalid', lesson)).rejects.toThrow();
    await expect(save(tx, 'class', classroom.id, { ...classroom, students: [] })).rejects.toThrow();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('upserts periods and types without deleting the referenced periods first', async () => {
    const data = await snapshot(tx);
    mocks.query.mockClear();
    await saveStructure(tx, data);
    const query = mocks.query.mock.calls[0][0] as string;
    expect(query).toContain('UPDATE p SET');
    expect(query).toContain('DELETE FROM dbo.LearningPeriods WHERE Id NOT IN');
    expect(query.indexOf('UPDATE p SET')).toBeLessThan(query.indexOf('DELETE FROM dbo.LearningPeriods'));
    expect(query.indexOf('DELETE FROM dbo.LearningPeriods')).toBeLessThan(query.indexOf('DELETE FROM dbo.LearningPeriodTypes'));
  });
  it('deletes only the requested class or lesson using parameterized IDs', async () => {
    await remove(tx, 'lesson', lesson.id);
    expect(mocks.query).toHaveBeenCalledWith('DELETE FROM dbo.LearningLessons WHERE Id=@id');
    await remove(tx, 'class', classroom.id);
    expect(mocks.query).toHaveBeenCalledWith('DELETE FROM dbo.LearningClasses WHERE Id=@id');
    await expect(remove(tx, 'class', 'invalid')).rejects.toThrow();
  });
});
