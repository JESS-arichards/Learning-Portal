import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type sql from 'mssql';

vi.mock('./db.js', async () => ({ sql: (await import('mssql')).default, transaction: vi.fn() }));
import { snapshot, save, saveStructure, saveCalendar, remove } from './repository.js';
import { DEFAULT_PERIOD_TYPES, type LearningClass, type Lesson } from '../shared/learning.js';
import { SUNDAY_TEACHING_WEEK, DEFAULT_TEACHING_WEEK } from '../shared/calendar.js';

// Explicit opt-in; this suite creates its own LocalDB instance and never uses application credentials.
const enabled = process.env.LEARNING_LOCALDB_TESTS === '1' && process.platform === 'win32';
describe.skipIf(!enabled)('isolated LocalDB relational migration and writes', () => {
  const instance = `LearningTests_${process.pid}`;
  const database = 'LearningMigrationTests';
  let directory: string;
  let created = false;
  let sequence = 0;
  const schema = readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8');
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const quote = (value: string) => `N'${value.replaceAll("'", "''")}'`;
  function run(text: string, db = database): string {
    const file = join(directory, `${sequence++}.sql`);
    writeFileSync(file, `SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET NUMERIC_ROUNDABORT OFF;\n${text}`);
    const result = spawnSync('sqlcmd', ['-S', `(localdb)\\${instance}`, '-E', '-b', '-y', '0', '-w', '65535', '-d', db, '-i', file],
      { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Local SQL batch failed:\n${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  }
  function reset() {
    run(`IF DB_ID('${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END;
      CREATE DATABASE [${database}] ON PRIMARY (NAME=N'LearningData',FILENAME=${quote(join(directory, 'learning.mdf'))})
      LOG ON (NAME=N'LearningLog',FILENAME=${quote(join(directory, 'learning_log.ldf'))});`, 'master');
  }
  const classroom: LearningClass = {
    id: uuid(1), name: "Year 7 Teacher's Maths", yearGroup: '7', division: 'Secondary',
    teachers: [{ id: 12, email: 'teacher@school.test', displayName: 'Teacher' }],
    students: [{ email: 'pending@school.test', displayName: 'Pending Student' }],
  };
  const slot = { id: uuid(2), name: 'P1', day: 0, typeId: 'lesson', kind: 'lesson' as const, start: '08:00', end: '09:00' };
  const lesson: Lesson = {
    id: uuid(3), classId: classroom.id, name: 'Fractions', description: 'Long description '.repeat(400).trim(),
    slotIds: [slot.id], updatedAt: '2026-10-27T00:00:00.000Z',
    links: [{ id: uuid(4), kind: 'link', name: 'Website', url: 'https://school.test/' }],
    files: [{ id: uuid(5), kind: 'file', name: 'Original.pdf', size: 123 }],
  };
  function legacy(structure: unknown = { slots: [slot], periodTypes: DEFAULT_PERIOD_TYPES }, badLesson: unknown = lesson, roster: unknown = classroom) {
    run(`CREATE TABLE dbo.LearningDocuments(Kind varchar(16) NOT NULL,Id uniqueidentifier NOT NULL,Body nvarchar(max) NOT NULL,PRIMARY KEY(Kind,Id));
      INSERT dbo.LearningDocuments VALUES
      ('class','${classroom.id}',${quote(JSON.stringify(roster))}),
      ('structure','00000000-0000-4000-8000-000000000001',${quote(JSON.stringify(structure))}),
      ('lesson','${lesson.id}',${quote(JSON.stringify(badLesson))});`);
  }
  function transaction(): sql.Transaction {
    const inputs = new Map<string, unknown>();
    const request = {
      input(name: string, _type: unknown, value: unknown) { inputs.set(name, value); return request; },
      async query(query: string) {
        const parameters = [...inputs].map(([name, value]) => `DECLARE @${name} nvarchar(max)=${value === null ? 'NULL' : quote(String(value))};`).join('\n');
        run(`SET XACT_ABORT ON; BEGIN TRANSACTION;\n${parameters}\n${query}\nCOMMIT;`);
        return {};
      },
    };
    return { request: () => request } as unknown as sql.Transaction;
  }
  async function readSnapshot(uppercaseGuids = false) {
    const connection = { request: () => ({
      async query(query: string) {
        const selects = query.split(';').map((part) => part.trim()).filter(Boolean);
        const text = selects.map((select) => `SET @result += COALESCE((${select} FOR JSON PATH),N'[]') + N',';`).join('\n');
        const json = run(`DECLARE @result nvarchar(max)=N'['; ${text}
          SET @result=LEFT(@result,LEN(@result)-1)+N']'; SELECT @result;`);
        const recordsets: unknown = JSON.parse(json, (_key, value: unknown) =>
          uppercaseGuids && typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
            ? value.toUpperCase() : value);
        return { recordsets };
      },
    }) } as unknown as sql.Transaction;
    return snapshot(connection);
  }
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'learning-relational-'));
    execFileSync('SqlLocalDB', ['create', instance], { stdio: 'pipe' }); created = true;
    execFileSync('SqlLocalDB', ['start', instance], { stdio: 'pipe' });
    reset();
  }, 60000);
  afterAll(() => {
    if (created) {
      execFileSync('SqlLocalDB', ['stop', instance, '-k'], { stdio: 'pipe' });
      execFileSync('SqlLocalDB', ['delete', instance], { stdio: 'pipe' });
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  it('creates a fresh schema, seeds types and reruns without creating the document archive', () => {
    reset(); run(schema); run(schema);
    expect(run("SELECT COUNT(*) FROM dbo.LearningPeriodTypes;")).toBe('2');
    expect(run("SELECT COUNT(*) FROM sys.tables WHERE name='LearningDocuments';")).toBe('0');
  });
  it.each(['object', 'array'])('migrates a legacy %s structure without losing IDs, content or archive data', (shape) => {
    reset(); legacy(shape === 'array' ? [slot] : undefined); run(schema);
    expect(run('SELECT Description FROM dbo.LearningLessons;')).toBe(lesson.description.trim());
    expect(run('SELECT Email FROM dbo.LearningClassStudents;')).toBe(classroom.students[0].email);
    expect(run('SELECT CONVERT(varchar(36),Id) FROM dbo.LearningLessonFiles;')).toBe(lesson.files[0].id);
    expect(run('SELECT CONVERT(varchar(36),PeriodId) FROM dbo.LearningLessonPeriods;')).toBe(slot.id);
    expect(run("SELECT Body FROM dbo.LearningDocuments WHERE Kind='lesson';")).toBe(JSON.stringify(lesson));
    run("UPDATE dbo.LearningClasses SET Name='Changed after migration';"); run(schema);
    expect(run('SELECT Name FROM dbo.LearningClasses;')).toBe('Changed after migration');
  });
  it('rolls back invalid legacy references and allows correction before retry', () => {
    reset(); legacy(undefined, { ...lesson, classId: uuid(99) });
    expect(() => run(schema)).toThrow();
    expect(run("SELECT COUNT(*) FROM sys.tables WHERE name='LearningClasses';")).toBe('0');
    expect(run('SELECT COUNT(*) FROM dbo.LearningDocuments;')).toBe('3');
    run(`UPDATE dbo.LearningDocuments SET Body=${quote(JSON.stringify(lesson))} WHERE Kind='lesson';`);
    run(schema);
    expect(run('SELECT COUNT(*) FROM dbo.LearningLessons;')).toBe('1');
  });
  it('preserves custom types, multi-day assignments and complete ordered rosters/resources', () => {
    reset();
    const type = { id: uuid(10), name: 'Registration', kind: 'lesson' as const };
    const nextSlot = { ...slot, id: uuid(11), day: 2, typeId: type.id };
    const roster = { ...classroom,
      teachers: [...classroom.teachers, { id: 13, email: 'second@school.test', displayName: 'Second Teacher' }],
      students: [...classroom.students, { id: 999, email: 'second-student@school.test', displayName: 'Second Student' }],
    };
    const content = { ...lesson, slotIds: [nextSlot.id, slot.id],
      links: [...lesson.links, { id: uuid(12), kind: 'teams', name: 'Meeting', url: 'https://teams.microsoft.com/l/meetup-join/test' }],
      files: [...lesson.files, { id: uuid(13), kind: 'file', name: 'Empty.txt', size: 0 }],
    };
    legacy({ slots: [slot, nextSlot], periodTypes: [...DEFAULT_PERIOD_TYPES, type] }, content, roster);
    run(schema); run(schema);
    expect(run('SELECT Name FROM dbo.LearningPeriodTypes ORDER BY Position;').split(/\r?\n/).map((s) => s.trim())).toEqual(['Lesson', 'Break', 'Registration']);
    expect(run('SELECT CONVERT(varchar(36),PeriodId) FROM dbo.LearningLessonPeriods ORDER BY Position;').split(/\r?\n/).map((s) => s.trim())).toEqual(content.slotIds);
    expect(run('SELECT COUNT(*) FROM dbo.LearningClassTeachers;')).toBe('2');
    expect(run('SELECT Email FROM dbo.LearningClassStudents ORDER BY Position;').split(/\r?\n/).map((s) => s.trim())).toEqual(roster.students.map((s) => s.email));
    expect(run('SELECT Kind FROM dbo.LearningLessonLinks ORDER BY Position;').split(/\r?\n/).map((s) => s.trim())).toEqual(['link', 'teams']);
    expect(run('SELECT Name FROM dbo.LearningLessonFiles ORDER BY Position;').split(/\r?\n/).map((s) => s.trim())).toEqual(['Original.pdf', 'Empty.txt']);
  });
  it.each([
    ['duplicate assigned periods', { ...lesson, slotIds: [slot.id, slot.id] }],
    ['missing assigned period', { ...lesson, slotIds: [uuid(99)] }],
    ['empty assigned periods', { ...lesson, slotIds: [] }],
    ['malformed updated time', { ...lesson, updatedAt: 'not a date' }],
    ['mismatched document ID', { ...lesson, id: uuid(99) }],
    ['oversized lesson name', { ...lesson, name: 'x'.repeat(201) }],
    ['oversized description', { ...lesson, description: 'x'.repeat(10001) }],
    ['negative file size', { ...lesson, files: [{ ...lesson.files[0], size: -1 }] }],
    ['duplicate file IDs', { ...lesson, files: [lesson.files[0], lesson.files[0]] }],
    ['invalid resource kind', { ...lesson, links: [{ ...lesson.links[0], kind: 'invalid' }] }],
  ])('rejects %s without partially migrating any records', (_name, content) => {
    reset(); legacy(undefined, content);
    expect(() => run(schema)).toThrow();
    expect(run("SELECT COUNT(*) FROM sys.tables WHERE name='LearningClasses';")).toBe('0');
    expect(run('SELECT COUNT(*) FROM dbo.LearningDocuments;')).toBe('3');
  });
  it('refuses to merge populated relational data when the migration marker is missing', async () => {
    reset(); run(schema);
    await save(transaction(), 'class', classroom.id, classroom);
    run('DELETE FROM dbo.LearningSchemaMigrations;');
    expect(() => run(schema)).toThrow();
    expect(run('SELECT Name FROM dbo.LearningClasses;')).toBe(classroom.name);
  });
  it('executes repository writes and enforces referenced class/period protection', async () => {
    reset(); run(schema);
    await save(transaction(), 'class', classroom.id, classroom);
    await saveStructure(transaction(), { slots: [slot], periodTypes: DEFAULT_PERIOD_TYPES });
    await save(transaction(), 'lesson', lesson.id, lesson);
    const data = await readSnapshot();
    expect(data.classes).toEqual([classroom]);
    expect(data.slots).toEqual([slot]);
    expect(data.lessons[0]).toEqual({ ...lesson, updatedAt: data.lessons[0].updatedAt });
    expect(Date.parse(data.lessons[0].updatedAt)).toBe(Date.parse(lesson.updatedAt));
    expect(run('SELECT Description FROM dbo.LearningLessons;')).toBe(lesson.description.trim());
    await save(transaction(), 'class', classroom.id, { ...classroom, name: 'Renamed' });
    expect(run('SELECT COUNT(*) FROM dbo.LearningLessons;')).toBe('1');
    await expect(remove(transaction(), 'class', classroom.id)).rejects.toThrow();
    await expect(saveStructure(transaction(), { slots: [], periodTypes: DEFAULT_PERIOD_TYPES })).rejects.toThrow();
    expect(run('SELECT COUNT(*) FROM dbo.LearningPeriods;')).toBe('1');
    await save(transaction(), 'lesson', lesson.id, { ...lesson, name: 'Edited', files: [] });
    expect(run('SELECT COUNT(*) FROM dbo.LearningLessonFiles;')).toBe('0');
    await remove(transaction(), 'lesson', lesson.id);
    expect(run('SELECT COUNT(*) FROM dbo.LearningLessonLinks;')).toBe('0');
    await saveStructure(transaction(), { slots: [], periodTypes: DEFAULT_PERIOD_TYPES });
    await remove(transaction(), 'class', classroom.id);
    expect(run('SELECT COUNT(*) FROM dbo.LearningClassStudents;')).toBe('0');
  });
  it('round-trips the calendar and dated series, preserving occurrence IDs on resource edits', async () => {
    reset(); run(schema); run(schema);
    const calendar = {
      years: [{ id: uuid(30), name: '2026/27', start: '2026-09-01', end: '2027-07-01' }],
      terms: [{ id: uuid(31), yearId: uuid(30), name: 'Autumn', start: '2026-09-01', end: '2026-12-11' }],
      holidays: [{ id: uuid(32), yearId: uuid(30), name: 'Closure', start: '2026-10-28', end: '2026-10-28' }],
    };
    await saveCalendar(transaction(), calendar);
    await save(transaction(), 'class', classroom.id, classroom);
    await saveStructure(transaction(), { slots: [slot], periodTypes: DEFAULT_PERIOD_TYPES });
    const dated: Lesson = { ...lesson, schedule: { startDate: '2026-10-26', frequency: 'weekly', count: 2 },
      occurrences: [{ id: uuid(33), date: '2026-10-26', slotId: slot.id }, { id: uuid(34), date: '2026-11-02', slotId: slot.id }] };
    await save(transaction(), 'lesson', dated.id, dated);
    let data = await readSnapshot();
    expect(data.calendar).toEqual(calendar);
    expect(data.lessons[0].schedule).toEqual(dated.schedule);
    expect(data.lessons[0].occurrences).toEqual(dated.occurrences);
    run(`ALTER TABLE dbo.LearningLiveMeetings DROP CONSTRAINT CK_LearningLiveMeetings_Options,DF_LearningLiveMeetings_OptionsApplied;
      ALTER TABLE dbo.LearningLiveMeetings DROP COLUMN Title,Options,OptionsApplied;
      DELETE dbo.LearningSchemaMigrations WHERE Version=3;`);
    run(`INSERT dbo.LearningLiveMeetings(OccurrenceId,OrganizerUserId,State,EventId,JoinUrl)
      VALUES('${uuid(33)}',12,'created',N'event-one',N'https://teams.microsoft.com/test');`);
    run(schema);
    expect((await readSnapshot()).meetings?.[0].optionsApplied).toBe(true);
    run(`UPDATE dbo.LearningLiveMeetings SET Title=N'Live fractions',Options=N'{"allowBreakoutRooms":true}',OptionsApplied=0;`);
    run(schema);
    await save(transaction(), 'lesson', dated.id, { ...dated, files: [] });
    data = await readSnapshot();
    expect(data.meetings?.[0]).toMatchObject({ occurrenceId: uuid(33), state: 'created', title: 'Live fractions',
      options: { allowBreakoutRooms: true }, optionsApplied: false });
    expect(data.lessons[0].occurrences).toEqual(dated.occurrences);
    expect(run('SELECT COUNT(*) FROM dbo.LearningTeamsConnections;')).toBe('0');
    await expect(saveStructure(transaction(), { slots: [], periodTypes: DEFAULT_PERIOD_TYPES })).rejects.toThrow();
    run("UPDATE dbo.LearningLiveMeetings SET State='cancelled',JoinUrl=NULL;");
    await remove(transaction(), 'lesson', dated.id);
    expect(run('SELECT COUNT(*) FROM dbo.LearningOccurrences;')).toBe('0');
    expect(run('SELECT COUNT(*) FROM dbo.LearningLiveMeetings;')).toBe('0');
  });
  it('upgrades existing calendars non-destructively and round-trips year defaults and term overrides', async () => {
    reset(); run(schema);
    const calendar = {
      years: [{ id: uuid(30), name: '2026/27', start: '2026-09-01', end: '2027-07-01' }],
      terms: [{ id: uuid(31), yearId: uuid(30), name: 'Autumn', start: '2026-09-01', end: '2026-12-11' },
        { id: uuid(32), yearId: uuid(30), name: 'Spring', start: '2027-01-03', end: '2027-03-26' }], holidays: [],
    };
    await saveCalendar(transaction(), calendar);
    run(`ALTER TABLE dbo.LearningAcademicYears DROP CONSTRAINT CK_LearningAcademicYears_TeachingWeek;
      ALTER TABLE dbo.LearningTerms DROP CONSTRAINT CK_LearningTerms_TeachingWeek;
      ALTER TABLE dbo.LearningAcademicYears DROP COLUMN TeachingWeek;
      ALTER TABLE dbo.LearningTerms DROP COLUMN TeachingWeek;
      DELETE dbo.LearningSchemaMigrations WHERE Version=4;`);
    run(schema); run(schema);
    expect((await readSnapshot()).calendar).toEqual(calendar);
    const configured = { ...calendar, years: [{ ...calendar.years[0], week: SUNDAY_TEACHING_WEEK }],
      terms: [{ ...calendar.terms[0], week: DEFAULT_TEACHING_WEEK }, calendar.terms[1]] };
    await saveCalendar(transaction(), configured);
    run(schema);
    expect((await readSnapshot()).calendar).toEqual(configured);
    expect(run('SELECT COUNT(*) FROM dbo.LearningSchemaMigrations WHERE Version=4;')).toBe('1');
    await saveCalendar(transaction(), calendar);
    expect((await readSnapshot()).calendar).toEqual(calendar);
  });
  it('preserves hexadecimal lesson and resource identities across uppercase SQL driver results and subsequent writes', async () => {
    reset(); run(schema);
    const id = (n: number) => `abcdef0${n}-abcd-4abc-8def-abcdef012345`;
    const roster = { ...classroom, id: id(1) };
    const period = { ...slot, id: id(2) };
    const dated: Lesson = { ...lesson, id: id(3), classId: roster.id, slotIds: [period.id],
      links: [{ ...lesson.links[0], id: id(4) }], files: [{ ...lesson.files[0], id: id(5) }],
      schedule: { startDate: '2026-10-26', frequency: 'once', count: 1 },
      occurrences: [{ id: id(6), date: '2026-10-26', slotId: period.id }] };
    await save(transaction(), 'class', roster.id, roster);
    await saveStructure(transaction(), { slots: [period], periodTypes: DEFAULT_PERIOD_TYPES });
    await save(transaction(), 'lesson', dated.id, dated);
    const data = await readSnapshot(true);
    expect(data.lessons[0]).toMatchObject({ ...dated, updatedAt: expect.any(String) });
    expect(new Date(data.lessons[0].updatedAt).getTime()).toBe(new Date(dated.updatedAt).getTime());
    expect(data.classes[0].id).toBe(roster.id);
    const edited = { ...data.lessons[0], links: [{ ...dated.links[0], name: 'Updated link' }],
      files: [...dated.files, { id: id(7), kind: 'file' as const, name: 'Second.pdf', size: 3 }] };
    await save(transaction(), 'lesson', dated.id.toUpperCase(), edited);
    expect((await readSnapshot(true)).lessons[0]).toMatchObject(edited);
    expect(run('SELECT COUNT(*) FROM dbo.LearningLessons;')).toBe('1');
  });
});
