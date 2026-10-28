import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../shared/learning.js';

const mocks = vi.hoisted(() => ({ query: vi.fn(), input: vi.fn(), transaction: vi.fn() }));
vi.mock('./db.js', async () => {
  const { default: sql } = await import('mssql');
  return { sql, transaction: mocks.transaction };
});
import { snapshot, save, saveStructure, remove } from './repository.js';
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
    [], [], [], [], [], [],
  ];
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.input.mockReturnValue(request);
  mocks.query.mockResolvedValue({ recordsets: records() });
  mocks.transaction.mockImplementation(async (work: (connection: sql.Transaction) => Promise<Snapshot>) => work(tx));
});

describe('relational Learning repository', () => {
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
  it('rejects invalid relational rows and empty type lists instead of silently supplying defaults', async () => {
    const rows = records(); rows[3] = [];
    mocks.query.mockResolvedValue({ recordsets: rows });
    await expect(snapshot()).rejects.toThrow();
    rows[3] = DEFAULT_PERIOD_TYPES; rows[2] = [];
    await expect(snapshot()).rejects.toThrow();
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
