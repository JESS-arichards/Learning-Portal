import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { classKey, emailSchema, normaliseEmail, type ClassInput, type User, type Person, type Student, type LearningClass, type ImportPreview } from '../shared/learning.js';
import { HttpError } from './errors.js';

export const CSV_HEADERS = ['Class Name', 'Teacher Display Name', 'Teacher Email', 'Student Display Name', 'Student Email', 'Year Group', 'Division'];
export async function previewClasses(csv: string, existing: LearningClass[], lookup: (emails: string[]) => Promise<User[]>): Promise<ImportPreview> {
  let records: string[][];
  try { records = parse(csv, { bom: true, skip_empty_lines: true, trim: true, max_record_size: 10000 }); }
  catch { throw new HttpError(400, 'Invalid CSV. Check quoting and that every row has the same number of columns.'); }
  if (!records.length || records[0].length !== CSV_HEADERS.length || CSV_HEADERS.some((h, i) => records[0][i] !== h)) {
    throw new HttpError(400, `CSV headers must be: ${CSV_HEADERS.join(',')}`);
  }
  if (records.length < 2 || records.length > 5001) throw new HttpError(400, 'Upload between 1 and 5,000 data rows.');
  return previewRecords(records.slice(1), existing, lookup);
}
export function previewManualClass(input: ClassInput, lookup: (emails: string[]) => Promise<User[]>): Promise<ImportPreview> {
  const rows = Array.from({ length: Math.max(input.teachers.length, input.students.length) }, (_, index) => {
    const teacher = input.teachers[index % input.teachers.length];
    const student = input.students[index % input.students.length];
    return [input.name, teacher.displayName, teacher.email, student.displayName, student.email, input.yearGroup, input.division];
  });
  return previewRecords(rows, [], lookup);
}
async function previewRecords(records: string[][], existing: LearningClass[], lookup: (emails: string[]) => Promise<User[]>): Promise<ImportPreview> {
  const errors: ImportPreview['errors'] = [];
  const warnings: ImportPreview['warnings'] = [];
  const classes = new Map<string, LearningClass>();
  const users = new Map<string, User>();
  const seen = new Set<string>();
  const emails = [...new Set(records.flatMap((row) => [row[2], row[4]]).flatMap((value) => {
    const result = emailSchema.safeParse(value);
    return result.success ? [result.data] : [];
  }))];
  for (let i = 0; i < emails.length; i += 200) {
    for (const user of await lookup(emails.slice(i, i + 200))) users.set(normaliseEmail(user.email), user);
  }
  function matchTeacher(email: string, name: string): Person | null {
    const user = users.get(email);
    if (!user?.isActive || !user.roles.includes('Staff')) return null;
    return { id: user.id, email: normaliseEmail(user.email), displayName: name };
  }
  for (const [index, row] of records.entries()) {
    const rowNumber = index + 2;
    if (row.length !== 7 || row.some((value) => !value || value.length > 320)) {
      errors.push({ row: rowNumber, message: 'All seven columns are required; values must be at most 320 characters.' }); continue;
    }
    const [name, teacherName, teacherEmail, studentName, studentEmail, yearGroup, division] = row;
    if (name.length > 200 || teacherName.length > 200 || studentName.length > 200 || yearGroup.length > 50 || division.length > 100) {
      errors.push({ row: rowNumber, message: 'Name (200), year group (50) or division (100) exceeds its maximum length.' }); continue;
    }
    const te = emailSchema.safeParse(teacherEmail), se = emailSchema.safeParse(studentEmail);
    if (!te.success || !se.success) { errors.push({ row: rowNumber, message: 'Invalid teacher or student email address.' }); continue; }
    const teacher = matchTeacher(te.data, teacherName);
    const studentUser = users.get(se.data);
    const invalidStudent = studentUser && (!studentUser.isActive || !studentUser.roles.includes('Student'));
    if (!teacher || invalidStudent) {
      errors.push({ row: rowNumber, message: `${!teacher ? `Teacher ${te.data} must match an active Staff account. ` : ''}${invalidStudent ? `Student ${se.data} belongs to an inactive or non-Student account.` : ''}` }); continue;
    }
    const student: Student = { email: se.data, displayName: studentName };
    const key = classKey({ name, yearGroup, division });
    const duplicate = JSON.stringify([key, teacher.id, student.email]);
    let classroom = classes.get(key);
    if (!classroom) {
      classroom = { id: existing.find((c) => classKey(c) === key)?.id ?? randomUUID(), name, yearGroup, division, teachers: [], students: [] };
      classes.set(key, classroom);
    }
    if (classroom.teachers.some((p) => p.id === teacher.id && p.displayName !== teacher.displayName)
      || classroom.students.some((p) => p.email === student.email && p.displayName !== student.displayName)) {
      errors.push({ row: rowNumber, message: 'Conflicting display names for the same user in this class.' }); continue;
    }
    if (seen.has(duplicate)) { errors.push({ row: rowNumber, message: 'Duplicate class/teacher/student row.' }); continue; }
    seen.add(duplicate);
    if (!classroom.teachers.some((t) => t.id === teacher.id)) classroom.teachers.push(teacher);
    if (!classroom.students.some((s) => s.email === student.email)) classroom.students.push(student);
    if (!studentUser) warnings.push({ row: rowNumber, message: `Student ${student.email} is not in the active central directory. Enrolment will be saved by email; access requires an active Student account with this email.` });
  }
  return { classes: [...classes.values()], rowCount: records.length, errors, warnings };
}
