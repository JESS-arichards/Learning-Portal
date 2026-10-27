import { z } from 'zod';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export function normaliseEmail(email: string): string { return email.trim().toLowerCase(); }
export const emailSchema = z.string().trim().pipe(z.email().max(320)).transform(normaliseEmail);
export const studentSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1).max(200),
});
export type Student = z.infer<typeof studentSchema>;
export const personSchema = z.object({
  id: z.number().int().positive(),
  email: emailSchema,
  displayName: z.string().trim().min(1).max(200),
});
export type Person = z.infer<typeof personSchema>;
export const userSchema = personSchema.extend({
  isActive: z.boolean(),
  sessionVersion: z.number().int().nonnegative(),
  roles: z.array(z.string()),
  studentEmails: z.array(emailSchema),
});
export type User = z.infer<typeof userSchema>;
export const publicConfigSchema = z.object({
  branding: z.object({
    organisationName: z.string(), primaryColor: z.string(),
    backgroundColor: z.string(), textColor: z.string(), logoUrl: z.string().nullable(),
    accentColor: z.string(), iconUrl: z.string().nullable(), backgroundUrl: z.string().nullable(),
    footerLogoUrl: z.string().nullable(), websiteUrl: z.string().nullable(),
  }),
  profileUrl: z.string().nullable(),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;
export const classSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  yearGroup: z.string().trim().min(1).max(50),
  division: z.string().trim().min(1).max(100),
  teachers: z.array(personSchema).min(1),
  students: z.array(studentSchema).min(1),
});
export type LearningClass = z.infer<typeof classSchema>;
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour time).');
export const slotSchema = z.object({
  id: z.string().uuid(),
  day: z.number().int().min(0).max(6),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['lesson', 'break']),
  start: time,
  end: time,
}).refine((s) => s.start < s.end, { message: 'End time must be after start time.', path: ['end'] });
export type DaySlot = z.infer<typeof slotSchema>;
export const structureSchema = z.array(slotSchema).max(140).superRefine((slots, ctx) => {
  const ids = new Set<string>();
  for (const [index, slot] of slots.entries()) {
    if (ids.has(slot.id)) ctx.addIssue({ code: 'custom', message: 'Slot IDs must be unique.', path: [index, 'id'] });
    ids.add(slot.id);
    if (slots.slice(0, index).some((other) => other.day === slot.day && slot.start < other.end && other.start < slot.end)) {
      ctx.addIssue({ code: 'custom', message: 'Times must not overlap on the same day.', path: [index] });
    }
  }
});
export const linkSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['link', 'teams']),
  name: z.string().trim().min(1).max(200),
  url: z.url().max(2000).refine((v) => {
    const url = new URL(v);
    return url.protocol === 'https:' && !url.username && !url.password;
  }, 'Resources must use HTTPS links without credentials.'),
}).superRefine((link, ctx) => {
  if (link.kind !== 'teams') return;
  const host = new URL(link.url).hostname.toLowerCase();
  if (!['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft'].includes(host)) {
    ctx.addIssue({ code: 'custom', message: 'Use a Microsoft Teams link.', path: ['url'] });
  }
});
export type LinkResource = z.infer<typeof linkSchema>;
export const fileSchema = z.object({
  id: z.string().uuid(), kind: z.literal('file'),
  name: z.string().min(1).max(200), size: z.number().int().nonnegative(),
});
export type FileResource = z.infer<typeof fileSchema>;
export const lessonInputSchema = z.object({
  classId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10000),
  slotIds: z.array(z.string().uuid()).min(1).max(140).refine((ids) => new Set(ids).size === ids.length, 'Duplicate lesson slots.'),
  links: z.array(linkSchema).max(30),
}).strict();
export type LessonInput = z.infer<typeof lessonInputSchema>;
export const lessonSchema = lessonInputSchema.extend({
  id: z.string().uuid(), files: z.array(fileSchema), updatedAt: z.string(),
});
export type Lesson = z.infer<typeof lessonSchema>;
export interface Snapshot { classes: LearningClass[]; slots: DaySlot[]; lessons: Lesson[] }
export interface ImportPreview {
  classes: LearningClass[];
  rowCount: number;
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
}

export function isAdmin(user: Pick<User, 'roles'>): boolean {
  return user.roles.some((role) => role === 'Full Admin' || role === 'Learn Admin');
}
export function canManage(user: Pick<User, 'id' | 'roles'>, classroom: LearningClass): boolean {
  return isAdmin(user) || user.roles.includes('Staff') && classroom.teachers.some((teacher) => teacher.id === user.id);
}
export function classKey(c: Pick<LearningClass, 'name' | 'yearGroup' | 'division'>): string {
  return JSON.stringify([c.name, c.yearGroup, c.division].map((s) => s.trim().toLowerCase()));
}
export function isEnrolledStudent(user: User, student: Student): boolean {
  return user.roles.includes('Student') && normaliseEmail(user.email) === normaliseEmail(student.email);
}
export function mayViewStudent(user: User, student: Student): boolean {
  return isEnrolledStudent(user, student)
    || user.roles.includes('Parent') && user.studentEmails.some((email) => normaliseEmail(email) === normaliseEmail(student.email))
    || isAdmin(user);
}

export function validateSchedule(lesson: LessonInput, lessons: Lesson[], classes: LearningClass[], slots: DaySlot[], excludeId?: string): void {
  const classroom = classes.find((c) => c.id === lesson.classId);
  if (!classroom) throw new Error('Class not found.');
  if (lesson.slotIds.some((id) => !slots.some((s) => s.id === id && s.kind === 'lesson'))) {
    throw new Error('Choose existing lesson periods, not breaks.');
  }
  for (const other of lessons) {
    if (other.id === excludeId || !other.slotIds.some((id) => lesson.slotIds.includes(id))) continue;
    const otherClass = classes.find((c) => c.id === other.classId);
    if (!otherClass) throw new Error('An existing lesson references an unknown class.');
    if (classroom.id === otherClass.id
      || classroom.teachers.some((p) => otherClass.teachers.some((q) => p.id === q.id))
      || classroom.students.some((p) => otherClass.students.some((q) => normaliseEmail(p.email) === normaliseEmail(q.email)))) {
      throw new Error(`Timetable clash with "${other.name}" (${otherClass.name}).`);
    }
  }
}
