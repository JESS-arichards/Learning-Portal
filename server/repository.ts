import { z } from 'zod';
import { classSchema, lessonSchema, structureSchema, type LearningClass, type Lesson, type DaySlot } from '../shared/learning.js';
import { pool, sql } from './db.js';

type Kind = 'class' | 'lesson' | 'structure';
type Connection = sql.ConnectionPool | sql.Transaction;
const structureId = '00000000-0000-4000-8000-000000000001';
export async function snapshot(connection?: Connection) {
  const result = await (connection ?? await pool()).request().query<{ Kind: Kind; Body: string }>('SELECT Kind, Body FROM dbo.LearningDocuments');
  const classes: LearningClass[] = [], lessons: Lesson[] = [];
  let slots: DaySlot[] = [];
  for (const row of result.recordset) {
    const value: unknown = JSON.parse(row.Body);
    if (row.Kind === 'class') classes.push(classSchema.parse(value));
    if (row.Kind === 'lesson') lessons.push(lessonSchema.parse(value));
    if (row.Kind === 'structure') slots = structureSchema.parse(value);
  }
  return { classes, lessons, slots };
}
export async function save(tx: sql.Transaction, kind: Kind, id: string, value: LearningClass | Lesson | DaySlot[]) {
  z.string().uuid().parse(id);
  await tx.request().input('kind', sql.VarChar(16), kind).input('id', sql.UniqueIdentifier, id)
    .input('body', sql.NVarChar(sql.MAX), JSON.stringify(value)).query(`
      UPDATE dbo.LearningDocuments SET Body=@body WHERE Kind=@kind AND Id=@id;
      IF @@ROWCOUNT=0 INSERT dbo.LearningDocuments(Kind,Id,Body) VALUES(@kind,@id,@body);
    `);
}
export function saveStructure(tx: sql.Transaction, slots: DaySlot[]) { return save(tx, 'structure', structureId, slots); }
export async function remove(tx: sql.Transaction, kind: Kind, id: string) {
  await tx.request().input('kind', sql.VarChar(16), kind).input('id', sql.UniqueIdentifier, id)
    .query('DELETE FROM dbo.LearningDocuments WHERE Kind=@kind AND Id=@id');
}
