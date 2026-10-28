import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
const sql = schema.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '');
function table(name: string) {
  const start = sql.indexOf(`CREATE TABLE dbo.${name} (`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('\n    );', start));
}

describe('relational Learning schema (offline contract checks)', () => {
  it('creates every runtime table conditionally and runs as one atomic batch', () => {
    for (const name of [
      'LearningClasses', 'LearningClassTeachers', 'LearningClassStudents',
      'LearningPeriodTypes', 'LearningPeriods', 'LearningLessons',
      'LearningLessonPeriods', 'LearningLessonLinks', 'LearningLessonFiles', 'LearningSchemaMigrations',
    ]) {
      expect(sql).toContain(`IF OBJECT_ID(N'dbo.${name}', N'U') IS NULL`);
      table(name);
    }
    expect(sql).toContain('SET XACT_ABORT ON');
    expect(sql).toContain("@Resource = N'learning-write'");
    expect(sql).toContain("@LockOwner = N'Transaction'");
    expect(sql.indexOf('BEGIN TRANSACTION')).toBeLessThan(sql.indexOf('CREATE TABLE dbo.'));
    expect(sql).toContain('IF XACT_STATE() <> 0 ROLLBACK TRANSACTION');
    expect(sql).not.toMatch(/^\s*GO\s*$/m);
  });

  it('uses the exact relational column types expected by the repository', () => {
    expect(table('LearningClasses')).toMatch(/Name nvarchar\(200\)[\s\S]*YearGroup nvarchar\(50\)[\s\S]*Division nvarchar\(100\)/);
    expect(table('LearningClassTeachers')).toMatch(/UserId int[\s\S]*Email nvarchar\(320\)[\s\S]*DisplayName nvarchar\(200\)[\s\S]*Position int/);
    expect(table('LearningPeriodTypes')).toMatch(/Id nvarchar\(36\)[\s\S]*Name nvarchar\(100\)[\s\S]*Kind varchar\(6\)/);
    expect(table('LearningPeriods')).toMatch(/Day int[\s\S]*TypeId nvarchar\(36\)[\s\S]*StartTime char\(5\)[\s\S]*EndTime char\(5\)/);
    expect(table('LearningPeriods')).not.toMatch(/\bKind\b/);
    expect(table('LearningLessons')).toMatch(/Description nvarchar\(max\)[\s\S]*UpdatedAt datetimeoffset\(3\)/);
    expect(table('LearningLessonLinks')).toMatch(/Kind varchar\(5\)[\s\S]*Url nvarchar\(2000\)/);
    expect(table('LearningLessonFiles')).toContain('Size bigint');
    expect(table('LearningSchemaMigrations')).toMatch(/Version int[\s\S]*PRIMARY KEY[\s\S]*AppliedAt datetime2[\s\S]*DEFAULT SYSUTCDATETIME\(\)/);
  });

  it('guards class/period deletion while cascading owned child rows only', () => {
    expect(table('LearningLessons')).not.toContain('ON DELETE CASCADE');
    for (const name of ['LearningClassTeachers', 'LearningClassStudents']) {
      expect(table(name)).toMatch(/REFERENCES dbo\.LearningClasses\(Id\) ON DELETE CASCADE/);
    }
    for (const name of ['LearningLessonPeriods', 'LearningLessonLinks', 'LearningLessonFiles']) {
      expect(table(name)).toMatch(/REFERENCES dbo\.LearningLessons\(Id\) ON DELETE CASCADE/);
    }
    expect(table('LearningLessonPeriods')).toMatch(/REFERENCES dbo\.LearningPeriods\(Id\),/);
    expect(table('LearningLessonPeriods')).toContain('PRIMARY KEY (LessonId, PeriodId)');
    expect(table('LearningClassTeachers')).toContain('PRIMARY KEY (ClassId, UserId)');
    expect(table('LearningClassTeachers')).toContain('UNIQUE (ClassId, Email)');
    expect(table('LearningClassStudents')).toContain('PRIMARY KEY (ClassId, Email)');
  });

  it('normalizes class identity as separate fields without changing stored names', () => {
    const classes = table('LearningClasses');
    for (const field of ['Name', 'YearGroup', 'Division']) {
      expect(classes).toContain(`Normalized${field} AS LOWER(LTRIM(RTRIM(${field})))`);
    }
    expect(classes).toContain('UNIQUE (NormalizedName, NormalizedYearGroup, NormalizedDivision)');
    expect(classes).not.toMatch(/CONCAT|HASHBYTES/);
  });

  it('imports an optional archive once, without ever creating or modifying it', () => {
    expect(sql).toContain('IF NOT EXISTS (SELECT 1 FROM dbo.LearningSchemaMigrations WHERE Version = 1)');
    expect(sql).toContain("IF OBJECT_ID(N'dbo.LearningDocuments', N'U') IS NOT NULL");
    expect(sql).toContain("EXEC sys.sp_executesql N'INSERT #LegacyDocuments");
    expect(sql).not.toMatch(/(?:CREATE TABLE|ALTER TABLE|DROP TABLE|INSERT(?: INTO)?|UPDATE|DELETE FROM)\s+dbo\.LearningDocuments\b/i);
    expect(sql).toContain('Refusing to merge or overwrite');
    expect(sql.indexOf('INSERT dbo.LearningSchemaMigrations(Version) VALUES (1)'))
      .toBeGreaterThan(sql.indexOf('INSERT dbo.LearningLessonFiles'));
    expect(sql.indexOf('COMMIT TRANSACTION')).toBeGreaterThan(sql.indexOf('INSERT dbo.LearningSchemaMigrations'));
  });

  it('defaults legacy/missing structures and preserves ordered child IDs', () => {
    expect(sql).toContain('{"id":"lesson","name":"Lesson","kind":"lesson"}');
    expect(sql).toContain('{"id":"break","name":"Break","kind":"break"}');
    expect(sql).toContain("IF @structure IS NULL");
    expect(sql).toContain("OPENJSON(N'[' + @structure + N']') WHERE [type] = 4");
    expect(sql).not.toMatch(/\bNEWID\s*\(/i);
    expect(sql).toContain("SELECT OwnerId,LOWER(LTRIM(RTRIM(JSON_VALUE(Body,'$.email')))),JSON_VALUE(Body,'$.displayName'),Position");
    expect(sql).toContain('CONVERT(int,j.[key])');
    expect(sql).toContain('INSERT dbo.LearningLessonFiles(Id,LessonId,Name,Size,Position) SELECT Id,LessonId,Name,Size,Position FROM #Files');
  });

  it('validates raw JSON before bounded projection and rejects dangling references', () => {
    expect(sql.indexOf('THROW 51011')).toBeLessThan(sql.indexOf('CREATE TABLE #Classes'));
    for (let error = 51003; error <= 51027; error++) {
      expect(sql, `validation ${error}`).toContain(`THROW ${error}`);
    }
    expect(sql).toContain('DATALENGTH(f.Value) > 2 * r.MaxLength');
    expect(sql).toContain('GROUP BY NodeId,Name HAVING COUNT(*) > 1');
    expect(sql).toContain('LEFT JOIN #Types t ON t.Id = p.TypeId');
    expect(sql).toContain('WHERE t.Id IS NULL OR t.Kind <> p.Kind');
    expect(sql).toContain("WHERE p.Id IS NULL OR t.Kind <> 'lesson'");
    expect(sql).toContain('document ID disagrees with its JSON ID');
  });

  it('uses only literal JSON paths supported on SQL Server 2016', () => {
    // SQL Server 2017 introduced variable OPENJSON paths. Expressions in the
    // first argument are compatible; any second argument must be a literal.
    expect(sql).not.toMatch(/OPENJSON\([^)]*,\s*(?:@\w+|\w+\.\w+)\s*\)/i);
    expect(sql).not.toMatch(/\b(?:TRIM|STRING_AGG|JSON_PATH_EXISTS|JSON_OBJECT)\s*\(/i);
  });

  it('keeps long descriptions lossless and bounds speculative conversions of raw fields', () => {
    // SQL Server may evaluate a TRY_CONVERT before its field-name predicate.
    // Converting an unrelated >4000-character description to UUID raises 8152.
    expect(sql).toContain('Value nvarchar(max)');
    expect(sql).toContain('Description nvarchar(max)');
    expect(sql).toContain("f.Value,CONVERT(datetimeoffset(3),JSON_VALUE(n.Body,'$.updatedAt'),127)");
    expect(sql).not.toContain("JSON_VALUE(n.Body,'$.description')");
    expect(sql).not.toMatch(/TRY_CONVERT\((?:uniqueidentifier|int|bigint|datetimeoffset\(3\)),\s*(?:f\.Value|RawId)\s*[,)]/i);
    expect(sql).toContain('DATALENGTH(f.Value) <> 72 OR TRY_CONVERT(uniqueidentifier,LEFT(f.Value,36)) IS NULL');
    expect(sql).toContain('DATALENGTH(RawId) <> 72 OR TRY_CONVERT(uniqueidentifier,LEFT(RawId,36)) IS NULL');
  });

  it('treats email hyphens as literal characters, not SQL LIKE ranges', () => {
    expect(sql).toContain("e.LocalPart COLLATE Latin1_General_100_BIN2 LIKE N'%[^-a-z0-9_''+.]%'");
    expect(sql).toContain("e.DomainPart COLLATE Latin1_General_100_BIN2 LIKE N'%[^-a-z0-9.]%'");
    expect(sql).toContain('TRY_CONVERT(bigint,LEFT(f.Value,20)) NOT BETWEEN 0 AND 9007199254740991');
  });
});
