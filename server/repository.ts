import { z } from 'zod';
import {
  classSchema, lessonSchema, dayStructureSchema, periodTypeId, personSchema, studentSchema,
  periodTypeSchema, slotSchema, linkSchema, fileSchema, meetingOptionsSchema, lessonTypeSchema, type LessonType, type LearningClass, type Lesson, type Snapshot,
} from '../shared/learning.js';
import { sql, transaction } from './db.js';
import { academicCalendarSchema, occurrenceSchema, teachingWeekSchema } from '../shared/calendar.js';
import { uuidSchema } from '../shared/identifiers.js';

type Connection = sql.ConnectionPool | sql.Transaction;
type Structure = Pick<Snapshot, 'slots' | 'periodTypes'>;
const uuid = uuidSchema;
const classRow = classSchema.omit({ teachers: true, students: true });
const teacherRow = personSchema.extend({ classId: uuid });
const studentRow = studentSchema.extend({ classId: uuid });
const lessonRow = lessonSchema.omit({ slotIds: true, links: true, files: true });
const lessonPeriodRow = z.object({ lessonId: uuid, periodId: uuid });
const linkRow = linkSchema.extend({ lessonId: uuid });
const fileRow = fileSchema.extend({ lessonId: uuid });

async function readSnapshot(connection: Connection): Promise<Snapshot> {
  const result = await connection.request().query(`
    SELECT Id AS id, Name AS name, YearGroup AS yearGroup, Division AS division FROM dbo.LearningClasses ORDER BY Name, Id;
    SELECT ClassId AS classId, UserId AS id, Email AS email, DisplayName AS displayName FROM dbo.LearningClassTeachers ORDER BY ClassId, Position;
    SELECT ClassId AS classId, Email AS email, DisplayName AS displayName FROM dbo.LearningClassStudents ORDER BY ClassId, Position;
    SELECT Id AS id, Name AS name, Kind AS kind FROM dbo.LearningPeriodTypes ORDER BY Position;
    SELECT p.Id AS id, p.Day AS day, p.Name AS name, p.TypeId AS typeId, t.Kind AS kind,
      p.StartTime AS start, p.EndTime AS [end]
      FROM dbo.LearningPeriods p JOIN dbo.LearningPeriodTypes t ON t.Id=p.TypeId ORDER BY p.Day, p.StartTime, p.Id;
    SELECT Id AS id, ClassId AS classId, Name AS name, Description AS description, LessonTypeId AS lessonTypeId,
      CONVERT(varchar(40), UpdatedAt, 127) AS updatedAt FROM dbo.LearningLessons ORDER BY Id;
    SELECT LessonId AS lessonId, PeriodId AS periodId FROM dbo.LearningLessonPeriods ORDER BY LessonId, Position;
    SELECT Id AS id, LessonId AS lessonId, Kind AS kind, Name AS name, Url AS url FROM dbo.LearningLessonLinks ORDER BY LessonId, Position;
    SELECT Id AS id, LessonId AS lessonId, 'file' AS kind, Name AS name, CONVERT(float, Size) AS size FROM dbo.LearningLessonFiles ORDER BY LessonId, Position;
    SELECT Id AS id, Name AS name, CONVERT(char(10),StartDate,23) AS start, CONVERT(char(10),EndDate,23) AS [end], TeachingWeek AS week FROM dbo.LearningAcademicYears;
    SELECT Id AS id, YearId AS yearId, Name AS name, CONVERT(char(10),StartDate,23) AS start, CONVERT(char(10),EndDate,23) AS [end], TeachingWeek AS week FROM dbo.LearningTerms;
    SELECT Id AS id, YearId AS yearId, Name AS name, CONVERT(char(10),StartDate,23) AS start, CONVERT(char(10),EndDate,23) AS [end] FROM dbo.LearningHolidays;
    SELECT Id AS id, LessonId AS lessonId, PeriodId AS slotId, CONVERT(char(10),LessonDate,23) AS date FROM dbo.LearningOccurrences ORDER BY LessonDate, PeriodId;
    SELECT Id AS lessonId, Schedule AS schedule FROM dbo.LearningLessons WHERE Schedule IS NOT NULL;
    SELECT m.OccurrenceId AS occurrenceId, o.LessonId AS lessonId, m.OrganizerUserId AS organizerUserId,
      m.State AS state, m.JoinUrl AS joinUrl, m.Title AS title, m.Options AS options, m.OptionsApplied AS optionsApplied
      FROM dbo.LearningLiveMeetings m JOIN dbo.LearningOccurrences o ON o.Id=m.OccurrenceId;
    SELECT Id AS id, Name AS name, Colour AS colour, Icon AS icon FROM dbo.LearningLessonTypes ORDER BY Name, Id;
  `);
  const rows = z.tuple([
    z.array(classRow), z.array(teacherRow), z.array(studentRow), z.array(periodTypeSchema),
    z.array(slotSchema), z.array(lessonRow), z.array(lessonPeriodRow), z.array(linkRow), z.array(fileRow),
    z.array(z.object({ ...academicCalendarSchema.shape.years.element.shape, week: z.string().nullable().optional() })),
    z.array(z.object({ ...academicCalendarSchema.shape.terms.element.shape, week: z.string().nullable().optional() })),
    academicCalendarSchema.shape.holidays,
    z.array(occurrenceSchema.extend({ lessonId: uuid })), z.array(z.object({ lessonId: uuid, schedule: z.string() })),
    z.array(z.object({ occurrenceId: uuid, lessonId: uuid, organizerUserId: z.number(), state: z.enum(['pending', 'created', 'cancelled']), joinUrl: z.string().nullable(),
      title: z.string().nullable().optional(), options: z.string().nullable().optional(), optionsApplied: z.boolean() })),
    z.array(lessonTypeSchema),
  ]).parse(result.recordsets);
  const [classes, teachers, students, periodTypes, slots, lessons, periods, links, files, years, terms, holidays, occurrences, schedules, meetings, lessonTypes] = rows;
  return {
    lessonTypes,
    ...dayStructureSchema.parse({ slots, periodTypes }),
    calendar: academicCalendarSchema.parse({
      years: years.map(({ week, ...year }) => ({ ...year, ...(week != null ? { week: teachingWeekSchema.parse(JSON.parse(week)) } : {}) })),
      terms: terms.map(({ week, ...term }) => ({ ...term, ...(week != null ? { week: teachingWeekSchema.parse(JSON.parse(week)) } : {}) })), holidays,
    }),
    meetings: meetings.map((meeting) => ({ ...meeting, options: meeting.options ? meetingOptionsSchema.parse(JSON.parse(meeting.options)) : null })),
    classes: classes.map((classroom) => classSchema.parse({
      ...classroom,
      teachers: teachers.filter((teacher) => teacher.classId === classroom.id).map(({ classId: _classId, ...teacher }) => teacher),
      students: students.filter((student) => student.classId === classroom.id).map(({ classId: _classId, ...student }) => student),
    })),
    lessons: lessons.map((lesson) => lessonSchema.parse({
      ...lesson,
      ...(schedules.some((item) => item.lessonId === lesson.id) ? {
        schedule: JSON.parse(schedules.find((item) => item.lessonId === lesson.id)!.schedule),
        occurrences: occurrences.filter((item) => item.lessonId === lesson.id).map(({ lessonId: _lessonId, ...item }) => item),
      } : {}),
      slotIds: periods.filter((period) => period.lessonId === lesson.id).map((period) => period.periodId),
      links: links.filter((link) => link.lessonId === lesson.id).map(({ lessonId: _lessonId, ...link }) => link),
      files: files.filter((file) => file.lessonId === lesson.id).map(({ lessonId: _lessonId, ...file }) => file),
    })),
  };
}

export async function snapshot(connection?: Connection): Promise<Snapshot> {
  // Reads take the same transaction lock as writes so all result sets describe one consistent timetable.
  return connection ? readSnapshot(connection) : transaction(readSnapshot);
}

function recordRequest(tx: sql.Transaction, id: string, value: LearningClass | Lesson) {
  id = uuid.parse(id);
  if (value.id !== id) throw new Error('The saved ID must match the record ID.');
  return tx.request().input('id', sql.UniqueIdentifier, id)
    .input('value', sql.NVarChar(sql.MAX), JSON.stringify(value));
}

export async function save(tx: sql.Transaction, kind: 'class' | 'lesson', id: string, value: LearningClass | Lesson): Promise<void> {
  if (kind === 'class') {
    const classroom = classSchema.parse(value);
    await recordRequest(tx, id, classroom).query(`
      UPDATE dbo.LearningClasses SET Name=JSON_VALUE(@value,'$.name'), YearGroup=JSON_VALUE(@value,'$.yearGroup'),
        Division=JSON_VALUE(@value,'$.division') WHERE Id=@id;
      IF @@ROWCOUNT=0 INSERT dbo.LearningClasses(Id,Name,YearGroup,Division)
        VALUES(@id,JSON_VALUE(@value,'$.name'),JSON_VALUE(@value,'$.yearGroup'),JSON_VALUE(@value,'$.division'));
      DELETE FROM dbo.LearningClassTeachers WHERE ClassId=@id;
      INSERT dbo.LearningClassTeachers(ClassId,UserId,Email,DisplayName,Position)
        SELECT @id, p.id, p.email, p.displayName, CONVERT(int,j.[key])
        FROM OPENJSON(@value,'$.teachers') j
        CROSS APPLY OPENJSON(j.value) WITH (id int, email nvarchar(320), displayName nvarchar(200)) p;
      DELETE FROM dbo.LearningClassStudents WHERE ClassId=@id;
      INSERT dbo.LearningClassStudents(ClassId,Email,DisplayName,Position)
        SELECT @id, p.email, p.displayName, CONVERT(int,j.[key])
        FROM OPENJSON(@value,'$.students') j
        CROSS APPLY OPENJSON(j.value) WITH (email nvarchar(320), displayName nvarchar(200)) p;
    `);
    return;
  }
  const lesson = lessonSchema.parse(value);
  await recordRequest(tx, id, lesson).query(`
    UPDATE l SET ClassId=JSON_VALUE(@value,'$.classId'),Name=JSON_VALUE(@value,'$.name'),
      Description=p.description,UpdatedAt=JSON_VALUE(@value,'$.updatedAt'),LessonTypeId=JSON_VALUE(@value,'$.lessonTypeId')
      FROM dbo.LearningLessons l CROSS APPLY OPENJSON(@value) WITH (description nvarchar(max)) p WHERE l.Id=@id;
    IF @@ROWCOUNT=0 INSERT dbo.LearningLessons(Id,ClassId,Name,Description,UpdatedAt,LessonTypeId)
      SELECT @id, JSON_VALUE(@value,'$.classId'),JSON_VALUE(@value,'$.name'),p.description,JSON_VALUE(@value,'$.updatedAt'),JSON_VALUE(@value,'$.lessonTypeId')
      FROM OPENJSON(@value) WITH (description nvarchar(max)) p;
    DELETE FROM dbo.LearningLessonPeriods WHERE LessonId=@id;
    INSERT dbo.LearningLessonPeriods(LessonId,PeriodId,Position)
      SELECT @id, CONVERT(uniqueidentifier,value), CONVERT(int,[key]) FROM OPENJSON(@value,'$.slotIds');
    DELETE FROM dbo.LearningLessonLinks WHERE LessonId=@id;
    INSERT dbo.LearningLessonLinks(Id,LessonId,Kind,Name,Url,Position)
      SELECT p.id,@id,p.kind,p.name,p.url,CONVERT(int,j.[key]) FROM OPENJSON(@value,'$.links') j
      CROSS APPLY OPENJSON(j.value) WITH (id uniqueidentifier,kind varchar(5),name nvarchar(200),url nvarchar(2000)) p;
    DELETE FROM dbo.LearningLessonFiles WHERE LessonId=@id;
    INSERT dbo.LearningLessonFiles(Id,LessonId,Name,Size,Position)
      SELECT p.id,@id,p.name,p.size,CONVERT(int,j.[key]) FROM OPENJSON(@value,'$.files') j
      CROSS APPLY OPENJSON(j.value) WITH (id uniqueidentifier,name nvarchar(200),size bigint) p;
  `);
  await tx.request().input('id', sql.UniqueIdentifier, id)
    .input('schedule', sql.NVarChar(sql.MAX), lesson.schedule ? JSON.stringify(lesson.schedule) : null)
    .input('occurrences', sql.NVarChar(sql.MAX), JSON.stringify(lesson.occurrences ?? []))
    .query(`
      UPDATE dbo.LearningLessons SET Schedule=@schedule WHERE Id=@id;
      DELETE FROM dbo.LearningOccurrences WHERE LessonId=@id AND Id NOT IN (SELECT id FROM OPENJSON(@occurrences) WITH (id uniqueidentifier));
      INSERT dbo.LearningOccurrences(Id,LessonId,PeriodId,LessonDate)
        SELECT id,@id,slotId,date FROM OPENJSON(@occurrences) WITH (id uniqueidentifier,slotId uniqueidentifier,date date) p
        WHERE NOT EXISTS (SELECT 1 FROM dbo.LearningOccurrences o WHERE o.Id=p.id);
    `);
}

export async function saveCalendar(tx: sql.Transaction, input: unknown): Promise<void> {
  const calendar = academicCalendarSchema.parse(input);
  await tx.request().input('calendar', sql.NVarChar(sql.MAX), JSON.stringify(calendar)).query(`
    DELETE FROM dbo.LearningHolidays; DELETE FROM dbo.LearningTerms; DELETE FROM dbo.LearningAcademicYears;
    INSERT dbo.LearningAcademicYears(Id,Name,StartDate,EndDate,TeachingWeek)
      SELECT id,name,start,[end],week FROM OPENJSON(@calendar,'$.years') WITH (id uniqueidentifier,name nvarchar(100),start date,[end] date,week nvarchar(max) AS JSON);
    INSERT dbo.LearningTerms(Id,YearId,Name,StartDate,EndDate,TeachingWeek)
      SELECT id,yearId,name,start,[end],week FROM OPENJSON(@calendar,'$.terms') WITH (id uniqueidentifier,yearId uniqueidentifier,name nvarchar(100),start date,[end] date,week nvarchar(max) AS JSON);
    INSERT dbo.LearningHolidays(Id,YearId,Name,StartDate,EndDate)
      SELECT id,yearId,name,start,[end] FROM OPENJSON(@calendar,'$.holidays') WITH (id uniqueidentifier,yearId uniqueidentifier,name nvarchar(100),start date,[end] date);
  `);
}

export async function saveStructure(tx: sql.Transaction, structure: Structure): Promise<void> {
  const parsed = dayStructureSchema.parse(structure);
  await tx.request()
    .input('types', sql.NVarChar(sql.MAX), JSON.stringify(parsed.periodTypes))
    .input('periods', sql.NVarChar(sql.MAX), JSON.stringify(parsed.slots.map((slot) => ({ ...slot, typeId: periodTypeId(slot) }))))
    .query(`
      DECLARE @typesTable TABLE (id nvarchar(36) COLLATE Latin1_General_100_CI_AS,name nvarchar(100),kind varchar(6),position int);
      INSERT @typesTable SELECT p.id,p.name,p.kind,CONVERT(int,j.[key]) FROM OPENJSON(@types) j
        CROSS APPLY OPENJSON(j.value) WITH (id nvarchar(36),name nvarchar(100),kind varchar(6)) p;
      DECLARE @periodsTable TABLE (id uniqueidentifier,day int,name nvarchar(100),typeId nvarchar(36),startTime char(5),endTime char(5));
      INSERT @periodsTable SELECT id,day,name,typeId,startTime,endTime FROM OPENJSON(@periods)
        WITH (id uniqueidentifier,day int,name nvarchar(100),typeId nvarchar(36),startTime char(5) '$.start',endTime char(5) '$.end');
      UPDATE t SET Name=s.name,Kind=s.kind,Position=s.position FROM dbo.LearningPeriodTypes t JOIN @typesTable s ON s.id=t.Id;
      INSERT dbo.LearningPeriodTypes(Id,Name,Kind,Position)
        SELECT id,name,kind,position FROM @typesTable s WHERE NOT EXISTS (SELECT 1 FROM dbo.LearningPeriodTypes t WHERE t.Id=s.id);
      UPDATE p SET Day=s.day,Name=s.name,TypeId=s.typeId,StartTime=s.startTime,EndTime=s.endTime
        FROM dbo.LearningPeriods p JOIN @periodsTable s ON s.id=p.Id;
      INSERT dbo.LearningPeriods(Id,Day,Name,TypeId,StartTime,EndTime)
        SELECT id,day,name,typeId,startTime,endTime FROM @periodsTable s WHERE NOT EXISTS (SELECT 1 FROM dbo.LearningPeriods p WHERE p.Id=s.id);
      DELETE FROM dbo.LearningPeriods WHERE Id NOT IN (SELECT id FROM @periodsTable);
      DELETE FROM dbo.LearningPeriodTypes WHERE Id NOT IN (SELECT id FROM @typesTable);
    `);
}

export async function saveLessonType(tx: sql.Transaction, input: LessonType): Promise<void> {
  const type = lessonTypeSchema.parse(input);
  await tx.request().input('id', sql.UniqueIdentifier, type.id)
    .input('name', sql.NVarChar(100), type.name).input('colour', sql.VarChar(7), type.colour)
    .input('icon', sql.VarChar(20), type.icon).query(`
      UPDATE dbo.LearningLessonTypes SET Name=@name,Colour=@colour,Icon=@icon WHERE Id=@id;
      IF @@ROWCOUNT=0 INSERT dbo.LearningLessonTypes(Id,Name,Colour,Icon) VALUES(@id,@name,@colour,@icon);
    `);
}

export async function remove(tx: sql.Transaction, kind: 'class' | 'lesson' | 'lessonType', id: string): Promise<void> {
  uuid.parse(id);
  const table = kind === 'class' ? 'LearningClasses' : kind === 'lessonType' ? 'LearningLessonTypes' : 'LearningLessons';
  await tx.request().input('id', sql.UniqueIdentifier, id).query(`DELETE FROM dbo.${table} WHERE Id=@id`);
}
