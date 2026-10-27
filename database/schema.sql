/*
  Learning Portal - SQL Server 2016+ / Azure SQL, compatibility level 130+.
  Run in the separate Learning database, NOT the Applications Portal database.
  Creates or updates the Learning table without dropping data. Safe to rerun.
  Startup runs this same script; production builds include an identical copy.
  Invalid existing data or incompatible columns fail explicitly and roll back.
  Central Users/Roles/parent links/SSO/branding remain in Applications Portal.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_WARNINGS ON;
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

  IF OBJECT_ID(N'dbo.LearningDocuments', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.LearningDocuments (
      Kind varchar(16) NOT NULL,
      Id uniqueidentifier NOT NULL,
      Body nvarchar(max) NOT NULL,
      CONSTRAINT PK_LearningDocuments PRIMARY KEY (Kind, Id),
      CONSTRAINT CK_LearningDocuments_Kind CHECK (Kind IN ('class', 'lesson', 'structure')),
      CONSTRAINT CK_LearningDocuments_Json CHECK (ISJSON(Body) = 1)
    );
  END;

  /* Do not guess missing values or truncate data in an incompatible existing table. */
  IF (SELECT COUNT(*) FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.LearningDocuments')
        AND is_nullable = 0 AND is_computed = 0
        AND ((name = N'Kind' AND system_type_id = TYPE_ID(N'varchar') AND max_length = 16)
          OR (name = N'Id' AND system_type_id = TYPE_ID(N'uniqueidentifier'))
          OR (name = N'Body' AND system_type_id = TYPE_ID(N'nvarchar') AND max_length = -1))) <> 3
    THROW 51001, 'LearningDocuments has incompatible columns. Expected Kind varchar(16), Id uniqueidentifier, Body nvarchar(max), all NOT NULL. Correct the schema explicitly before retrying.', 1;

  IF NOT EXISTS (SELECT 1 FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.LearningDocuments') AND type = 'PK')
    ALTER TABLE dbo.LearningDocuments ADD CONSTRAINT PK_LearningDocuments PRIMARY KEY (Kind, Id);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes i
    WHERE i.object_id = OBJECT_ID(N'dbo.LearningDocuments') AND i.is_primary_key = 1
      AND (SELECT COUNT(*) FROM sys.index_columns ic
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0) = 2
      AND EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns c
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal = 1 AND c.name = N'Kind')
      AND EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns c
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal = 2 AND c.name = N'Id')
  )
    THROW 51002, 'LearningDocuments primary key must be (Kind, Id). Correct it explicitly before retrying.', 1;

  /* Repair missing constraints on databases created by earlier app versions. */
  IF OBJECT_ID(N'dbo.CK_LearningDocuments_Kind', N'C') IS NULL
    ALTER TABLE dbo.LearningDocuments WITH CHECK
      ADD CONSTRAINT CK_LearningDocuments_Kind CHECK (Kind IN ('class', 'lesson', 'structure'));
  IF OBJECT_ID(N'dbo.CK_LearningDocuments_Json', N'C') IS NULL
    ALTER TABLE dbo.LearningDocuments WITH CHECK
      ADD CONSTRAINT CK_LearningDocuments_Json CHECK (ISJSON(Body) = 1);

  IF EXISTS (SELECT 1 FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.LearningDocuments')
        AND name = N'CK_LearningDocuments_Kind' AND (is_disabled = 1 OR is_not_trusted = 1))
    ALTER TABLE dbo.LearningDocuments WITH CHECK CHECK CONSTRAINT CK_LearningDocuments_Kind;
  IF EXISTS (SELECT 1 FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.LearningDocuments')
        AND name = N'CK_LearningDocuments_Json' AND (is_disabled = 1 OR is_not_trusted = 1))
    ALTER TABLE dbo.LearningDocuments WITH CHECK CHECK CONSTRAINT CK_LearningDocuments_Json;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
