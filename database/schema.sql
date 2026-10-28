/*
  Learning Portal: SQL Server 2016+ / Azure SQL, compatibility level 130+.
  Run only in the separate Learning database. Startup also runs this batch.
  Version 1 atomically imports the old JSON store, retaining it unchanged as an
  archive. Runtime reads/writes must use the relational tables, never the archive.
  No central Users/Roles/SSO tables or cross-database foreign keys are created.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @lockResult int;
  EXEC @lockResult = sys.sp_getapplock
    @Resource = N'learning-write', @LockMode = N'Exclusive',
    @LockOwner = N'Transaction', @LockTimeout = 15000;
  IF @lockResult < 0
    THROW 51000, 'Learning schema is busy. Please retry.', 1;

  IF OBJECT_ID(N'dbo.LearningSchemaMigrations', N'U') IS NULL
    CREATE TABLE dbo.LearningSchemaMigrations (
      Version int NOT NULL CONSTRAINT PK_LearningSchemaMigrations PRIMARY KEY,
      AppliedAt datetime2 NOT NULL CONSTRAINT DF_LearningSchemaMigrations_AppliedAt DEFAULT SYSUTCDATETIME()
    );

  IF OBJECT_ID(N'dbo.LearningClasses', N'U') IS NULL
    CREATE TABLE dbo.LearningClasses (
      Id uniqueidentifier NOT NULL CONSTRAINT PK_LearningClasses PRIMARY KEY,
      Name nvarchar(200) NOT NULL,
      YearGroup nvarchar(50) NOT NULL,
      Division nvarchar(100) NOT NULL,
      /* Separate keys, not a delimiter/hash: embedded whitespace is significant. */
      NormalizedName AS LOWER(LTRIM(RTRIM(Name))) COLLATE Latin1_General_100_CI_AS PERSISTED,
      NormalizedYearGroup AS LOWER(LTRIM(RTRIM(YearGroup))) COLLATE Latin1_General_100_CI_AS PERSISTED,
      NormalizedDivision AS LOWER(LTRIM(RTRIM(Division))) COLLATE Latin1_General_100_CI_AS PERSISTED,
      CONSTRAINT UQ_LearningClasses_Identity UNIQUE (NormalizedName, NormalizedYearGroup, NormalizedDivision),
      CONSTRAINT CK_LearningClasses_Names CHECK (
        LEN(LTRIM(RTRIM(Name))) > 0 AND LEN(LTRIM(RTRIM(YearGroup))) > 0 AND LEN(LTRIM(RTRIM(Division))) > 0)
    );

  IF OBJECT_ID(N'dbo.LearningClassTeachers', N'U') IS NULL
    CREATE TABLE dbo.LearningClassTeachers (
      ClassId uniqueidentifier NOT NULL,
      UserId int NOT NULL,
      Email nvarchar(320) COLLATE Latin1_General_100_CI_AS NOT NULL,
      DisplayName nvarchar(200) NOT NULL,
      Position int NOT NULL,
      CONSTRAINT PK_LearningClassTeachers PRIMARY KEY (ClassId, UserId),
      CONSTRAINT UQ_LearningClassTeachers_Email UNIQUE (ClassId, Email),
      CONSTRAINT FK_LearningClassTeachers_Class FOREIGN KEY (ClassId) REFERENCES dbo.LearningClasses(Id) ON DELETE CASCADE,
      CONSTRAINT CK_LearningClassTeachers_Values CHECK (UserId > 0 AND Position >= 0 AND LEN(LTRIM(RTRIM(DisplayName))) > 0)
    );

  IF OBJECT_ID(N'dbo.LearningClassStudents', N'U') IS NULL
    CREATE TABLE dbo.LearningClassStudents (
      ClassId uniqueidentifier NOT NULL,
      Email nvarchar(320) COLLATE Latin1_General_100_CI_AS NOT NULL,
      DisplayName nvarchar(200) NOT NULL,
      Position int NOT NULL,
      CONSTRAINT PK_LearningClassStudents PRIMARY KEY (ClassId, Email),
      CONSTRAINT FK_LearningClassStudents_Class FOREIGN KEY (ClassId) REFERENCES dbo.LearningClasses(Id) ON DELETE CASCADE,
      CONSTRAINT CK_LearningClassStudents_Values CHECK (Position >= 0 AND LEN(LTRIM(RTRIM(DisplayName))) > 0)
    );

  IF OBJECT_ID(N'dbo.LearningPeriodTypes', N'U') IS NULL
    CREATE TABLE dbo.LearningPeriodTypes (
      Id nvarchar(36) COLLATE Latin1_General_100_CI_AS NOT NULL CONSTRAINT PK_LearningPeriodTypes PRIMARY KEY,
      Name nvarchar(100) COLLATE Latin1_General_100_CI_AS NOT NULL CONSTRAINT UQ_LearningPeriodTypes_Name UNIQUE,
      Kind varchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
      Position int NOT NULL,
      CONSTRAINT CK_LearningPeriodTypes_Values CHECK (
        ((Kind = 'lesson' AND DATALENGTH(Kind) = 6) OR (Kind = 'break' AND DATALENGTH(Kind) = 5))
        AND Position >= 0 AND LEN(LTRIM(RTRIM(Name))) > 0),
      CONSTRAINT CK_LearningPeriodTypes_Id CHECK (
        (Id COLLATE Latin1_General_100_BIN2 = N'lesson' AND DATALENGTH(Id) = 12)
        OR (Id COLLATE Latin1_General_100_BIN2 = N'break' AND DATALENGTH(Id) = 10)
        OR (DATALENGTH(Id) = 72 AND TRY_CONVERT(uniqueidentifier, Id) IS NOT NULL))
    );

  IF OBJECT_ID(N'dbo.LearningPeriods', N'U') IS NULL
    CREATE TABLE dbo.LearningPeriods (
      Id uniqueidentifier NOT NULL CONSTRAINT PK_LearningPeriods PRIMARY KEY,
      Day int NOT NULL,
      Name nvarchar(100) NOT NULL,
      TypeId nvarchar(36) COLLATE Latin1_General_100_CI_AS NOT NULL,
      StartTime char(5) COLLATE Latin1_General_100_BIN2 NOT NULL,
      EndTime char(5) COLLATE Latin1_General_100_BIN2 NOT NULL,
      CONSTRAINT FK_LearningPeriods_Type FOREIGN KEY (TypeId) REFERENCES dbo.LearningPeriodTypes(Id),
      CONSTRAINT CK_LearningPeriods_Values CHECK (Day BETWEEN 0 AND 6 AND LEN(LTRIM(RTRIM(Name))) > 0),
      CONSTRAINT CK_LearningPeriods_Times CHECK (
        StartTime LIKE '[0-2][0-9]:[0-5][0-9]' AND LEFT(StartTime, 2) <= '23'
        AND EndTime LIKE '[0-2][0-9]:[0-5][0-9]' AND LEFT(EndTime, 2) <= '23' AND StartTime < EndTime)
    );

  IF OBJECT_ID(N'dbo.LearningLessons', N'U') IS NULL
    CREATE TABLE dbo.LearningLessons (
      Id uniqueidentifier NOT NULL CONSTRAINT PK_LearningLessons PRIMARY KEY,
      ClassId uniqueidentifier NOT NULL,
      Name nvarchar(200) NOT NULL,
      Description nvarchar(max) NOT NULL,
      UpdatedAt datetimeoffset(3) NOT NULL,
      /* Deliberately NO CASCADE: delete lessons explicitly before their class. */
      CONSTRAINT FK_LearningLessons_Class FOREIGN KEY (ClassId) REFERENCES dbo.LearningClasses(Id),
      CONSTRAINT CK_LearningLessons_Values CHECK (LEN(LTRIM(RTRIM(Name))) > 0 AND DATALENGTH(Description) <= 20000)
    );

  IF OBJECT_ID(N'dbo.LearningLessonPeriods', N'U') IS NULL
    CREATE TABLE dbo.LearningLessonPeriods (
      LessonId uniqueidentifier NOT NULL,
      PeriodId uniqueidentifier NOT NULL,
      Position int NOT NULL,
      CONSTRAINT PK_LearningLessonPeriods PRIMARY KEY (LessonId, PeriodId),
      CONSTRAINT FK_LearningLessonPeriods_Lesson FOREIGN KEY (LessonId) REFERENCES dbo.LearningLessons(Id) ON DELETE CASCADE,
      CONSTRAINT FK_LearningLessonPeriods_Period FOREIGN KEY (PeriodId) REFERENCES dbo.LearningPeriods(Id),
      CONSTRAINT CK_LearningLessonPeriods_Position CHECK (Position >= 0)
    );

  IF OBJECT_ID(N'dbo.LearningLessonLinks', N'U') IS NULL
    CREATE TABLE dbo.LearningLessonLinks (
      Id uniqueidentifier NOT NULL CONSTRAINT PK_LearningLessonLinks PRIMARY KEY,
      LessonId uniqueidentifier NOT NULL,
      Kind varchar(5) COLLATE Latin1_General_100_BIN2 NOT NULL,
      Name nvarchar(200) NOT NULL,
      Url nvarchar(2000) NOT NULL,
      Position int NOT NULL,
      CONSTRAINT FK_LearningLessonLinks_Lesson FOREIGN KEY (LessonId) REFERENCES dbo.LearningLessons(Id) ON DELETE CASCADE,
      CONSTRAINT CK_LearningLessonLinks_Values CHECK (
        ((Kind = 'link' AND DATALENGTH(Kind) = 4) OR (Kind = 'teams' AND DATALENGTH(Kind) = 5))
        AND Position >= 0 AND LEN(LTRIM(RTRIM(Name))) > 0)
    );

  IF OBJECT_ID(N'dbo.LearningLessonFiles', N'U') IS NULL
    CREATE TABLE dbo.LearningLessonFiles (
      Id uniqueidentifier NOT NULL CONSTRAINT PK_LearningLessonFiles PRIMARY KEY,
      LessonId uniqueidentifier NOT NULL,
      Name nvarchar(200) NOT NULL,
      Size bigint NOT NULL,
      Position int NOT NULL,
      CONSTRAINT FK_LearningLessonFiles_Lesson FOREIGN KEY (LessonId) REFERENCES dbo.LearningLessons(Id) ON DELETE CASCADE,
      CONSTRAINT CK_LearningLessonFiles_Values CHECK (Size >= 0 AND Position >= 0 AND DATALENGTH(Name) > 0)
    );

  IF NOT EXISTS (SELECT 1 FROM dbo.LearningSchemaMigrations WHERE Version = 1)
  BEGIN
    IF EXISTS (SELECT 1 FROM dbo.LearningClasses)
      OR EXISTS (SELECT 1 FROM dbo.LearningClassTeachers)
      OR EXISTS (SELECT 1 FROM dbo.LearningClassStudents)
      OR EXISTS (SELECT 1 FROM dbo.LearningPeriodTypes)
      OR EXISTS (SELECT 1 FROM dbo.LearningPeriods)
      OR EXISTS (SELECT 1 FROM dbo.LearningLessons)
      OR EXISTS (SELECT 1 FROM dbo.LearningLessonPeriods)
      OR EXISTS (SELECT 1 FROM dbo.LearningLessonLinks)
      OR EXISTS (SELECT 1 FROM dbo.LearningLessonFiles)
      THROW 51001, 'Relational Learning data exists without migration version 1. Refusing to merge or overwrite; reconcile explicitly before retrying.', 1;

    CREATE TABLE #LegacyDocuments (Kind varchar(16), Id uniqueidentifier, Body nvarchar(max));
    /* Dynamic SQL is essential: a clean installation has no archive to bind. */
    IF OBJECT_ID(N'dbo.LearningDocuments', N'U') IS NOT NULL
    BEGIN
      IF (SELECT COUNT(*) FROM sys.columns
          WHERE object_id = OBJECT_ID(N'dbo.LearningDocuments')
            AND ((name = N'Kind' AND system_type_id = TYPE_ID(N'varchar') AND max_length = 16)
              OR (name = N'Id' AND system_type_id = TYPE_ID(N'uniqueidentifier'))
              OR (name = N'Body' AND system_type_id = TYPE_ID(N'nvarchar') AND max_length = -1))) <> 3
        THROW 51002, 'LearningDocuments has incompatible archive columns; expected Kind varchar(16), Id uniqueidentifier, Body nvarchar(max).', 1;
      EXEC sys.sp_executesql N'INSERT #LegacyDocuments(Kind,Id,Body) SELECT Kind,Id,Body FROM dbo.LearningDocuments WITH (TABLOCKX,HOLDLOCK);';
    END;

    IF EXISTS (SELECT 1 FROM #LegacyDocuments WHERE Id IS NULL OR Kind IS NULL OR Body IS NULL
        OR Kind COLLATE Latin1_General_100_BIN2 NOT IN ('class', 'lesson', 'structure') OR ISJSON(Body) <> 1)
      THROW 51003, 'Legacy Learning documents contain a null, unknown kind or malformed JSON.', 1;
    IF EXISTS (SELECT 1 FROM #LegacyDocuments GROUP BY Kind, Id HAVING COUNT(*) > 1)
      OR (SELECT COUNT(*) FROM #LegacyDocuments WHERE Kind = 'structure') > 1
      THROW 51004, 'Legacy Learning documents contain duplicate IDs or multiple structures.', 1;

    DECLARE @defaults nvarchar(max) = N'[{"id":"lesson","name":"Lesson","kind":"lesson"},{"id":"break","name":"Break","kind":"break"}]';
    DECLARE @structure nvarchar(max) = (SELECT Body FROM #LegacyDocuments WHERE Kind = 'structure');
    IF @structure IS NULL SET @structure = N'{"slots":[],"periodTypes":' + @defaults + N'}';
    ELSE IF EXISTS (SELECT 1 FROM OPENJSON(N'[' + @structure + N']') WHERE [type] = 4)
      SET @structure = N'{"slots":' + @structure + N',"periodTypes":' + @defaults + N'}';

    IF EXISTS (SELECT 1 FROM OPENJSON(N'[' + @structure + N']') WHERE [type] <> 5)
      OR (SELECT COUNT(*) FROM OPENJSON(@structure) WHERE [key] = N'slots' COLLATE Latin1_General_100_BIN2 AND [type] = 4) <> 1
      OR (SELECT COUNT(*) FROM OPENJSON(@structure) WHERE [key] = N'periodTypes' COLLATE Latin1_General_100_BIN2 AND [type] = 4) <> 1
      OR EXISTS (SELECT 1 FROM OPENJSON(@structure) GROUP BY [key] COLLATE Latin1_General_100_BIN2 HAVING COUNT(*) > 1)
      THROW 51005, 'Legacy structure must be a slots array or an object containing slots and periodTypes arrays without duplicate properties.', 1;

    CREATE TABLE #Nodes (
      NodeId int IDENTITY NOT NULL PRIMARY KEY,
      Entity varchar(12) NOT NULL,
      OwnerId uniqueidentifier NULL,
      Position int NOT NULL,
      Body nvarchar(max) NOT NULL
    );
    INSERT #Nodes(Entity, OwnerId, Position, Body)
      SELECT Kind, Id, 0, Body FROM #LegacyDocuments WHERE Kind IN ('class', 'lesson');
    IF EXISTS (SELECT 1 FROM #Nodes CROSS APPLY OPENJSON(N'[' + Body + N']') j WHERE j.[type] <> 5)
      THROW 51006, 'Every legacy class and lesson must be a JSON object.', 1;

    /* Do not project into bounded SQL types until all raw lengths/types pass. */
    CREATE TABLE #Fields (
      NodeId int NOT NULL,
      Name nvarchar(4000) COLLATE Latin1_General_100_BIN2 NOT NULL,
      Value nvarchar(max) NULL,
      JsonType int NOT NULL
    );
    INSERT #Fields SELECT n.NodeId, j.[key], j.value, j.[type] FROM #Nodes n CROSS APPLY OPENJSON(n.Body) j;
    IF EXISTS (SELECT 1 FROM #Nodes n CROSS JOIN (VALUES
        ('class','teachers'),('class','students'),('lesson','slotIds'),('lesson','links'),('lesson','files')) a(Entity,Name)
      WHERE n.Entity = a.Entity AND NOT EXISTS (
        SELECT 1 FROM #Fields f WHERE f.NodeId = n.NodeId AND f.Name = a.Name AND f.JsonType = 4))
      THROW 51007, 'Legacy class rosters and lesson slotIds/links/files must be present as arrays.', 1;

    IF EXISTS (
      SELECT 1 FROM #Nodes n CROSS APPLY OPENJSON(n.Body) f
      CROSS APPLY OPENJSON(CASE WHEN f.[type] = 4 THEN f.value ELSE N'[]' END) j
      WHERE ((n.Entity = 'class' AND f.[key] COLLATE Latin1_General_100_BIN2 IN (N'teachers',N'students'))
        OR (n.Entity = 'lesson' AND f.[key] COLLATE Latin1_General_100_BIN2 IN (N'links',N'files'))) AND j.[type] <> 5)
      THROW 51009, 'Legacy rosters and resources must contain only JSON objects.', 1;
    INSERT #Nodes(Entity, OwnerId, Position, Body)
      SELECT a.Entity, n.OwnerId, CONVERT(int,j.[key]), j.value
      FROM #Nodes n CROSS JOIN (VALUES
        ('class','teacher',N'teachers'),('class','student',N'students'),
        ('lesson','link',N'links'),('lesson','file',N'files')) a(Parent,Entity,Property)
      CROSS APPLY OPENJSON(n.Body) f
      CROSS APPLY OPENJSON(CASE WHEN f.[type] = 4 THEN f.value ELSE N'[]' END) j
      WHERE n.Entity = a.Parent AND f.[key] COLLATE Latin1_General_100_BIN2 = a.Property;
    IF EXISTS (SELECT 1 FROM OPENJSON(@structure,'$.periodTypes') WHERE [type] <> 5)
      OR EXISTS (SELECT 1 FROM OPENJSON(@structure,'$.slots') WHERE [type] <> 5)
      THROW 51008, 'Period types and periods must contain only JSON objects.', 1;
    INSERT #Nodes(Entity, OwnerId, Position, Body)
      SELECT 'type', NULL, CONVERT(int,[key]), value FROM OPENJSON(@structure,'$.periodTypes')
      UNION ALL SELECT 'period', NULL, CONVERT(int,[key]), value FROM OPENJSON(@structure,'$.slots');
    IF EXISTS (SELECT 1 FROM #Nodes WHERE ISJSON(Body) <> 1)
      THROW 51009, 'Legacy rosters and resources must contain only JSON objects.', 1;
    IF EXISTS (SELECT 1 FROM #Nodes CROSS APPLY OPENJSON(N'[' + Body + N']') j WHERE j.[type] <> 5)
      THROW 51009, 'Legacy rosters and resources must contain only JSON objects.', 1;

    TRUNCATE TABLE #Fields;
    INSERT #Fields SELECT n.NodeId, j.[key], j.value, j.[type] FROM #Nodes n CROSS APPLY OPENJSON(n.Body) j;
    IF EXISTS (SELECT 1 FROM #Fields GROUP BY NodeId,Name HAVING COUNT(*) > 1)
      THROW 51010, 'Legacy JSON contains duplicate object properties; resolve the ambiguity before migrating.', 1;

    DECLARE @rules TABLE (
      Entity varchar(12), Name nvarchar(40) COLLATE Latin1_General_100_BIN2,
      JsonType int, MaxLength int, Nonblank bit, Required bit
    );
    INSERT @rules VALUES
      ('class','id',1,36,1,1),('class','name',1,200,1,1),('class','yearGroup',1,50,1,1),('class','division',1,100,1,1),
      ('class','teachers',4,NULL,0,1),('class','students',4,NULL,0,1),
      ('teacher','id',2,NULL,0,1),('teacher','email',1,320,1,1),('teacher','displayName',1,200,1,1),
      /* A legacy student's numeric central-user id is intentionally ignored. */
      ('student','email',1,320,1,1),('student','displayName',1,200,1,1),
      ('type','id',1,36,1,1),('type','name',1,100,1,1),('type','kind',1,6,1,1),
      ('period','id',1,36,1,1),('period','day',2,NULL,0,1),('period','name',1,100,1,1),
      ('period','kind',1,6,1,1),('period','typeId',1,36,1,0),('period','start',1,5,1,1),('period','end',1,5,1,1),
      ('lesson','id',1,36,1,1),('lesson','classId',1,36,1,1),('lesson','name',1,200,1,1),
      ('lesson','description',1,10000,0,1),('lesson','updatedAt',1,50,1,1),
      ('lesson','slotIds',4,NULL,0,1),('lesson','links',4,NULL,0,1),('lesson','files',4,NULL,0,1),
      ('link','id',1,36,1,1),('link','kind',1,5,1,1),('link','name',1,200,1,1),('link','url',1,2000,1,1),
      ('file','id',1,36,1,1),('file','kind',1,4,1,1),('file','name',1,200,1,1),('file','size',2,NULL,0,1);
    IF EXISTS (
      SELECT 1 FROM #Nodes n JOIN @rules r ON r.Entity = n.Entity
      LEFT JOIN #Fields f ON f.NodeId = n.NodeId AND f.Name = r.Name
      WHERE (r.Required = 1 AND f.NodeId IS NULL)
        OR (f.NodeId IS NOT NULL AND (f.JsonType <> r.JsonType
          OR (r.MaxLength IS NOT NULL AND DATALENGTH(f.Value) > 2 * r.MaxLength)
          OR (r.Nonblank = 1 AND LEN(LTRIM(RTRIM(f.Value))) = 0))))
      THROW 51011, 'Legacy JSON has missing properties, wrong scalar types, blank names or over-length values.', 1;

    IF EXISTS (
      SELECT 1 FROM #Fields f JOIN #Nodes n ON n.NodeId = f.NodeId
      WHERE ((f.Name = N'id' AND n.Entity IN ('class','lesson','period','link','file')) OR (n.Entity = 'lesson' AND f.Name = N'classId')
          OR (n.Entity = 'type' AND f.Name = N'id'
            AND NOT ((f.Value COLLATE Latin1_General_100_BIN2 = N'lesson' AND DATALENGTH(f.Value) = 12)
              OR (f.Value COLLATE Latin1_General_100_BIN2 = N'break' AND DATALENGTH(f.Value) = 10))))
        /* TRY_CONVERT itself can raise 8152 for nvarchar(max) > 4000,
           even on an unrelated field reordered ahead of the WHERE filter. */
        AND (DATALENGTH(f.Value) <> 72 OR TRY_CONVERT(uniqueidentifier,LEFT(f.Value,36)) IS NULL))
      THROW 51012, 'Legacy JSON contains an invalid UUID. UUIDs must be complete 36-character values.', 1;
    IF EXISTS (SELECT 1 FROM #Nodes n JOIN #Fields f ON f.NodeId = n.NodeId AND f.Name = N'id'
      WHERE n.Entity IN ('class','lesson') AND TRY_CONVERT(uniqueidentifier,LEFT(f.Value,36)) <> n.OwnerId)
      THROW 51013, 'A legacy document ID disagrees with its JSON ID; refusing to change blob or record identity.', 1;
    IF EXISTS (SELECT 1 FROM #Fields f JOIN #Nodes n ON n.NodeId = f.NodeId
      WHERE (n.Entity = 'teacher' AND f.Name = N'id' AND (DATALENGTH(f.Value) > 22
          OR TRY_CONVERT(int,LEFT(f.Value,11)) IS NULL OR TRY_CONVERT(int,LEFT(f.Value,11)) <= 0))
        OR (n.Entity = 'period' AND f.Name = N'day' AND (DATALENGTH(f.Value) > 22
          OR TRY_CONVERT(int,LEFT(f.Value,11)) IS NULL OR TRY_CONVERT(int,LEFT(f.Value,11)) NOT BETWEEN 0 AND 6))
        OR (n.Entity = 'file' AND f.Name = N'size' AND (DATALENGTH(f.Value) > 40
          OR TRY_CONVERT(bigint,LEFT(f.Value,20)) IS NULL
          OR TRY_CONVERT(bigint,LEFT(f.Value,20)) NOT BETWEEN 0 AND 9007199254740991)))
      THROW 51014, 'Legacy teacher IDs, period days or file sizes are invalid integers or exceed JavaScript safe integer range.', 1;
    IF EXISTS (SELECT 1 FROM #Fields f JOIN #Nodes n ON n.NodeId = f.NodeId
      WHERE (n.Entity IN ('type','period') AND f.Name = N'kind'
          AND NOT ((f.Value COLLATE Latin1_General_100_BIN2 = N'lesson' AND DATALENGTH(f.Value) = 12)
            OR (f.Value COLLATE Latin1_General_100_BIN2 = N'break' AND DATALENGTH(f.Value) = 10)))
        OR (n.Entity = 'link' AND f.Name = N'kind'
          AND NOT ((f.Value COLLATE Latin1_General_100_BIN2 = N'link' AND DATALENGTH(f.Value) = 8)
            OR (f.Value COLLATE Latin1_General_100_BIN2 = N'teams' AND DATALENGTH(f.Value) = 10)))
        OR (n.Entity = 'file' AND f.Name = N'kind' AND f.Value COLLATE Latin1_General_100_BIN2 <> N'file'))
      THROW 51015, 'Legacy JSON contains an invalid period, link or file kind.', 1;
    IF EXISTS (SELECT 1 FROM #Fields f JOIN #Nodes n ON n.NodeId = f.NodeId
      WHERE n.Entity = 'lesson' AND f.Name = N'updatedAt' AND (
        TRY_CONVERT(datetimeoffset(3),LEFT(f.Value,50),127) IS NULL
        OR f.Value COLLATE Latin1_General_100_BIN2 NOT LIKE N'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]%'
        OR (RIGHT(f.Value,1) COLLATE Latin1_General_100_BIN2 <> N'Z'
          AND RIGHT(f.Value,6) COLLATE Latin1_General_100_BIN2 NOT LIKE N'[-+][0-9][0-9]:[0-9][0-9]')))
      THROW 51016, 'Legacy lesson updatedAt must be a valid ISO-8601 timestamp with an explicit time zone.', 1;

    IF (SELECT COUNT(*) FROM #Nodes WHERE Entity = 'type') NOT BETWEEN 1 AND 30
      OR (SELECT COUNT(*) FROM #Nodes WHERE Entity = 'period') > 140
      OR EXISTS (SELECT 1 FROM #Nodes n CROSS APPLY OPENJSON(n.Body) f
        CROSS APPLY (SELECT COUNT(*) AS Total FROM OPENJSON(CASE WHEN f.[type] = 4 THEN f.value ELSE N'[]' END)) a
        WHERE ((n.Entity = 'class' AND f.[key] = N'teachers') AND a.Total NOT BETWEEN 1 AND 200)
          OR ((n.Entity = 'class' AND f.[key] = N'students') AND a.Total NOT BETWEEN 1 AND 5000)
          OR ((n.Entity = 'lesson' AND f.[key] = N'slotIds') AND a.Total NOT BETWEEN 1 AND 140)
          OR ((n.Entity = 'lesson' AND f.[key] = N'links') AND a.Total > 30))
      THROW 51017, 'Legacy structure, rosters or lesson resources exceed their permitted counts (or a required roster/slot list is empty).', 1;

    CREATE TABLE #Classes (Id uniqueidentifier, Name nvarchar(200), YearGroup nvarchar(50), Division nvarchar(100));
    INSERT #Classes SELECT OwnerId,JSON_VALUE(Body,'$.name'),JSON_VALUE(Body,'$.yearGroup'),JSON_VALUE(Body,'$.division')
      FROM #Nodes WHERE Entity = 'class';
    CREATE TABLE #Teachers (ClassId uniqueidentifier, UserId int, Email nvarchar(320) COLLATE Latin1_General_100_CI_AS, DisplayName nvarchar(200), Position int);
    INSERT #Teachers SELECT OwnerId,CONVERT(int,JSON_VALUE(Body,'$.id')),LOWER(LTRIM(RTRIM(JSON_VALUE(Body,'$.email')))),
      JSON_VALUE(Body,'$.displayName'),Position FROM #Nodes WHERE Entity = 'teacher';
    CREATE TABLE #Students (ClassId uniqueidentifier, Email nvarchar(320) COLLATE Latin1_General_100_CI_AS, DisplayName nvarchar(200), Position int);
    INSERT #Students SELECT OwnerId,LOWER(LTRIM(RTRIM(JSON_VALUE(Body,'$.email')))),JSON_VALUE(Body,'$.displayName'),Position
      FROM #Nodes WHERE Entity = 'student';
    CREATE TABLE #Types (Id nvarchar(36) COLLATE Latin1_General_100_CI_AS, Name nvarchar(100) COLLATE Latin1_General_100_CI_AS, Kind varchar(6), Position int);
    INSERT #Types SELECT JSON_VALUE(Body,'$.id'),JSON_VALUE(Body,'$.name'),JSON_VALUE(Body,'$.kind'),Position FROM #Nodes WHERE Entity = 'type';
    CREATE TABLE #Periods (Id uniqueidentifier, Day int, Name nvarchar(100), TypeId nvarchar(36) COLLATE Latin1_General_100_CI_AS, Kind varchar(6), StartTime varchar(5), EndTime varchar(5));
    INSERT #Periods SELECT CONVERT(uniqueidentifier,JSON_VALUE(Body,'$.id')),CONVERT(int,JSON_VALUE(Body,'$.day')),
      JSON_VALUE(Body,'$.name'),COALESCE(JSON_VALUE(Body,'$.typeId'),JSON_VALUE(Body,'$.kind')),
      JSON_VALUE(Body,'$.kind'),JSON_VALUE(Body,'$.start'),JSON_VALUE(Body,'$.end') FROM #Nodes WHERE Entity = 'period';
    CREATE TABLE #Lessons (Id uniqueidentifier, ClassId uniqueidentifier, Name nvarchar(200), Description nvarchar(max), UpdatedAt datetimeoffset(3));
    INSERT #Lessons SELECT n.OwnerId,CONVERT(uniqueidentifier,JSON_VALUE(n.Body,'$.classId')),JSON_VALUE(n.Body,'$.name'),
      f.Value,CONVERT(datetimeoffset(3),JSON_VALUE(n.Body,'$.updatedAt'),127)
      FROM #Nodes n JOIN #Fields f ON f.NodeId = n.NodeId AND f.Name = N'description' WHERE n.Entity = 'lesson';
    CREATE TABLE #LessonPeriods (LessonId uniqueidentifier, RawId nvarchar(max), JsonType int, Position int);
    INSERT #LessonPeriods SELECT n.OwnerId,j.value,j.[type],CONVERT(int,j.[key])
      FROM #Nodes n CROSS APPLY OPENJSON(n.Body,'$.slotIds') j WHERE n.Entity = 'lesson';
    CREATE TABLE #Links (Id uniqueidentifier, LessonId uniqueidentifier, Kind varchar(5), Name nvarchar(200), Url nvarchar(2000), Position int);
    INSERT #Links SELECT CONVERT(uniqueidentifier,JSON_VALUE(Body,'$.id')),OwnerId,JSON_VALUE(Body,'$.kind'),
      JSON_VALUE(Body,'$.name'),JSON_VALUE(Body,'$.url'),Position FROM #Nodes WHERE Entity = 'link';
    CREATE TABLE #Files (Id uniqueidentifier, LessonId uniqueidentifier, Name nvarchar(200), Size bigint, Position int);
    INSERT #Files SELECT CONVERT(uniqueidentifier,JSON_VALUE(Body,'$.id')),OwnerId,JSON_VALUE(Body,'$.name'),
      CONVERT(bigint,JSON_VALUE(Body,'$.size')),Position FROM #Nodes WHERE Entity = 'file';

    IF EXISTS (SELECT 1 FROM #Classes GROUP BY Id HAVING COUNT(*) > 1)
      OR EXISTS (SELECT 1 FROM #Lessons GROUP BY Id HAVING COUNT(*) > 1)
      OR EXISTS (SELECT 1 FROM #Periods GROUP BY Id HAVING COUNT(*) > 1)
      OR EXISTS (SELECT 1 FROM #Types GROUP BY Id HAVING COUNT(*) > 1)
      OR EXISTS (SELECT 1 FROM #Links GROUP BY Id HAVING COUNT(*) > 1)
      OR EXISTS (SELECT 1 FROM #Files GROUP BY Id HAVING COUNT(*) > 1)
      THROW 51018, 'Legacy data has duplicate class, lesson, period, period type, link or file IDs.', 1;
    IF EXISTS (SELECT 1 FROM #Classes GROUP BY
        LOWER(LTRIM(RTRIM(Name))) COLLATE Latin1_General_100_CI_AS,
        LOWER(LTRIM(RTRIM(YearGroup))) COLLATE Latin1_General_100_CI_AS,
        LOWER(LTRIM(RTRIM(Division))) COLLATE Latin1_General_100_CI_AS HAVING COUNT(*) > 1)
      OR EXISTS (SELECT 1 FROM #Types GROUP BY LOWER(LTRIM(RTRIM(Name))) COLLATE Latin1_General_100_CI_AS HAVING COUNT(*) > 1)
      THROW 51019, 'Legacy data has duplicate normalized class identities or period type names.', 1;
    IF EXISTS (SELECT 1 FROM #Teachers GROUP BY ClassId,UserId HAVING COUNT(*) > 1)
      OR EXISTS (SELECT 1 FROM #Teachers GROUP BY ClassId,Email HAVING COUNT(*) > 1)
      OR EXISTS (SELECT 1 FROM #Students GROUP BY ClassId,Email HAVING COUNT(*) > 1)
      THROW 51020, 'Legacy class rosters contain duplicate teacher IDs or normalized email addresses.', 1;

    IF EXISTS (SELECT 1 FROM (SELECT Email FROM #Teachers UNION ALL SELECT Email FROM #Students) p
      CROSS APPLY (SELECT
        LEFT(Email,NULLIF(CHARINDEX(N'@',Email),0)-1) AS LocalPart,
        SUBSTRING(Email,CHARINDEX(N'@',Email)+1,320) AS DomainPart) e
      CROSS APPLY (SELECT RIGHT(e.DomainPart,NULLIF(CHARINDEX(N'.',REVERSE(e.DomainPart)),0)-1) AS Tld) d
      WHERE Email NOT LIKE N'%_@_%._%' OR Email LIKE N'%@%@%' OR Email LIKE N'%..%' OR Email LIKE N'.%'
        OR e.LocalPart COLLATE Latin1_General_100_BIN2 LIKE N'%[^-a-z0-9_''+.]%'
        OR RIGHT(e.LocalPart,1) IN (N'.',N'''')
        OR e.DomainPart COLLATE Latin1_General_100_BIN2 LIKE N'%[^-a-z0-9.]%'
        OR LEFT(e.DomainPart,1) COLLATE Latin1_General_100_BIN2 NOT LIKE N'[a-z0-9]'
        OR e.DomainPart LIKE N'%.-%' OR d.Tld IS NULL OR LEN(d.Tld) < 2
        OR d.Tld COLLATE Latin1_General_100_BIN2 LIKE N'%[^a-z]%')
      THROW 51021, 'Legacy class rosters contain malformed email addresses.', 1;
    IF EXISTS (SELECT 1 FROM #Periods WHERE DATALENGTH(StartTime) <> 5 OR DATALENGTH(EndTime) <> 5
        OR StartTime COLLATE Latin1_General_100_BIN2 NOT LIKE '[0-2][0-9]:[0-5][0-9]' OR LEFT(StartTime,2) > '23'
        OR EndTime COLLATE Latin1_General_100_BIN2 NOT LIKE '[0-2][0-9]:[0-5][0-9]' OR LEFT(EndTime,2) > '23' OR StartTime >= EndTime)
      OR EXISTS (SELECT 1 FROM #Periods p JOIN #Periods q ON p.Day = q.Day AND p.Id <> q.Id
        AND p.StartTime < q.EndTime AND q.StartTime < p.EndTime)
      THROW 51022, 'Legacy periods contain invalid HH:mm times, reversed times or overlapping periods on the same day.', 1;
    IF EXISTS (SELECT 1 FROM #Periods p LEFT JOIN #Types t ON t.Id = p.TypeId COLLATE Latin1_General_100_BIN2
        WHERE t.Id IS NULL OR t.Kind <> p.Kind)
      OR EXISTS (SELECT 1 FROM #Lessons l WHERE NOT EXISTS (SELECT 1 FROM #Classes c WHERE c.Id = l.ClassId))
      THROW 51023, 'Legacy periods reference missing/mismatched period types or lessons reference missing classes.', 1;
    IF EXISTS (SELECT 1 FROM #LessonPeriods WHERE JsonType <> 1 OR DATALENGTH(RawId) <> 72 OR TRY_CONVERT(uniqueidentifier,LEFT(RawId,36)) IS NULL)
      THROW 51024, 'Legacy lesson slotIds must contain only complete UUID strings.', 1;
    IF EXISTS (SELECT 1 FROM #LessonPeriods GROUP BY LessonId,CONVERT(uniqueidentifier,RawId) HAVING COUNT(*) > 1)
      OR EXISTS (SELECT 1 FROM #LessonPeriods lp LEFT JOIN #Periods p ON p.Id = CONVERT(uniqueidentifier,lp.RawId)
        LEFT JOIN #Types t ON t.Id = p.TypeId WHERE p.Id IS NULL OR t.Kind <> 'lesson')
      THROW 51025, 'Legacy lessons contain duplicate periods or reference missing/break periods.', 1;

    /* All references are checked, not resolved by filtering inner joins. */
    IF EXISTS (SELECT 1 FROM #Links l CROSS APPLY (
        SELECT LEFT(SUBSTRING(l.Url,9,2000),PATINDEX(N'%[/?#]%',SUBSTRING(l.Url,9,2000) + N'/') - 1) AS Authority) a
      WHERE LOWER(LEFT(l.Url,8)) <> N'https://' OR LEN(a.Authority) = 0 OR a.Authority LIKE N'%@%'
        OR l.Url LIKE N'% %' OR l.Url LIKE N'%' + NCHAR(9) + N'%' OR l.Url LIKE N'%' + NCHAR(10) + N'%'
        OR l.Url LIKE N'%' + NCHAR(13) + N'%' OR l.Url LIKE N'%\%'
        OR (l.Kind = 'teams' AND LOWER(a.Authority) NOT IN (
          N'teams.microsoft.com',N'teams.live.com',N'teams.cloud.microsoft',
          N'teams.microsoft.com:443',N'teams.live.com:443',N'teams.cloud.microsoft:443')))
      THROW 51026, 'Legacy links must be HTTPS URLs without credentials; Teams links must use an approved Microsoft Teams host.', 1;
    IF EXISTS (
      SELECT 1 FROM #LessonPeriods a JOIN #LessonPeriods b
        ON CONVERT(uniqueidentifier,a.RawId) = CONVERT(uniqueidentifier,b.RawId) AND a.LessonId < b.LessonId
      JOIN #Lessons x ON x.Id = a.LessonId JOIN #Lessons y ON y.Id = b.LessonId
      WHERE x.ClassId = y.ClassId
        OR EXISTS (SELECT 1 FROM #Teachers p JOIN #Teachers q ON p.UserId = q.UserId WHERE p.ClassId = x.ClassId AND q.ClassId = y.ClassId)
        OR EXISTS (SELECT 1 FROM #Students p JOIN #Students q ON p.Email = q.Email WHERE p.ClassId = x.ClassId AND q.ClassId = y.ClassId))
      THROW 51027, 'Legacy lessons clash for a class, teacher or student in the same period.', 1;

    INSERT dbo.LearningClasses(Id,Name,YearGroup,Division) SELECT Id,Name,YearGroup,Division FROM #Classes;
    INSERT dbo.LearningClassTeachers(ClassId,UserId,Email,DisplayName,Position) SELECT ClassId,UserId,Email,DisplayName,Position FROM #Teachers;
    INSERT dbo.LearningClassStudents(ClassId,Email,DisplayName,Position) SELECT ClassId,Email,DisplayName,Position FROM #Students;
    INSERT dbo.LearningPeriodTypes(Id,Name,Kind,Position) SELECT Id,Name,Kind,Position FROM #Types;
    INSERT dbo.LearningPeriods(Id,Day,Name,TypeId,StartTime,EndTime) SELECT Id,Day,Name,TypeId,StartTime,EndTime FROM #Periods;
    INSERT dbo.LearningLessons(Id,ClassId,Name,Description,UpdatedAt) SELECT Id,ClassId,Name,Description,UpdatedAt FROM #Lessons;
    INSERT dbo.LearningLessonPeriods(LessonId,PeriodId,Position) SELECT LessonId,CONVERT(uniqueidentifier,RawId),Position FROM #LessonPeriods;
    INSERT dbo.LearningLessonLinks(Id,LessonId,Kind,Name,Url,Position) SELECT Id,LessonId,Kind,Name,Url,Position FROM #Links;
    INSERT dbo.LearningLessonFiles(Id,LessonId,Name,Size,Position) SELECT Id,LessonId,Name,Size,Position FROM #Files;
    INSERT dbo.LearningSchemaMigrations(Version) VALUES (1);

    DROP TABLE #Files, #Links, #LessonPeriods, #Lessons, #Periods, #Types,
      #Students, #Teachers, #Classes, #Fields, #Nodes, #LegacyDocuments;
  END;

  IF COL_LENGTH('dbo.LearningLessons', 'Schedule') IS NULL
    ALTER TABLE dbo.LearningLessons ADD Schedule nvarchar(max) NULL
      CONSTRAINT CK_LearningLessons_Schedule CHECK (Schedule IS NULL OR ISJSON(Schedule)=1);

  IF OBJECT_ID(N'dbo.LearningAcademicYears', N'U') IS NULL
    CREATE TABLE dbo.LearningAcademicYears (
      Id uniqueidentifier NOT NULL PRIMARY KEY, Name nvarchar(100) NOT NULL,
      StartDate date NOT NULL, EndDate date NOT NULL, CHECK (StartDate<=EndDate)
    );
  IF OBJECT_ID(N'dbo.LearningTerms', N'U') IS NULL
    CREATE TABLE dbo.LearningTerms (
      Id uniqueidentifier NOT NULL PRIMARY KEY, YearId uniqueidentifier NOT NULL REFERENCES dbo.LearningAcademicYears(Id),
      Name nvarchar(100) NOT NULL, StartDate date NOT NULL, EndDate date NOT NULL, CHECK (StartDate<=EndDate)
    );
  IF OBJECT_ID(N'dbo.LearningHolidays', N'U') IS NULL
    CREATE TABLE dbo.LearningHolidays (
      Id uniqueidentifier NOT NULL PRIMARY KEY, YearId uniqueidentifier NOT NULL REFERENCES dbo.LearningAcademicYears(Id),
      Name nvarchar(100) NOT NULL, StartDate date NOT NULL, EndDate date NOT NULL, CHECK (StartDate<=EndDate)
    );
  IF OBJECT_ID(N'dbo.LearningOccurrences', N'U') IS NULL
    CREATE TABLE dbo.LearningOccurrences (
      Id uniqueidentifier NOT NULL PRIMARY KEY,
      LessonId uniqueidentifier NOT NULL REFERENCES dbo.LearningLessons(Id) ON DELETE CASCADE,
      PeriodId uniqueidentifier NOT NULL REFERENCES dbo.LearningPeriods(Id),
      LessonDate date NOT NULL, UNIQUE(LessonId,LessonDate,PeriodId)
    );
  IF OBJECT_ID(N'dbo.LearningLiveMeetings', N'U') IS NULL
    CREATE TABLE dbo.LearningLiveMeetings (
      OccurrenceId uniqueidentifier NOT NULL PRIMARY KEY REFERENCES dbo.LearningOccurrences(Id) ON DELETE CASCADE,
      OrganizerUserId int NOT NULL, State varchar(10) NOT NULL CHECK (State IN ('pending','created','cancelled')),
      EventId nvarchar(2048) NULL, JoinUrl nvarchar(2000) NULL,
      UpdatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
  IF NOT EXISTS (SELECT 1 FROM dbo.LearningSchemaMigrations WHERE Version=2)
    INSERT dbo.LearningSchemaMigrations(Version) VALUES(2);

  IF OBJECT_ID(N'dbo.LearningTeamsConnections', N'U') IS NULL
    CREATE TABLE dbo.LearningTeamsConnections (
      UserId int NOT NULL CONSTRAINT PK_LearningTeamsConnections PRIMARY KEY,
      Payload nvarchar(max) NOT NULL,
      UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_LearningTeamsConnections_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT CK_LearningTeamsConnections_UserId CHECK (UserId > 0),
      CONSTRAINT CK_LearningTeamsConnections_Payload CHECK (Payload LIKE N'v1.%')
    );

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
