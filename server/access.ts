import { canManage, mayViewStudent, normaliseEmail, type Snapshot, type User } from '../shared/learning.js';

export function visibleSnapshot(user: User, all: Snapshot): Snapshot {
  const classes = all.classes.filter((c) => canManage(user, c)
    || c.students.some((s) => mayViewStudent(user, s)));
  return {
    slots: all.slots,
    classes: classes.map((c) => canManage(user, c) ? c : {
      ...c, students: c.students.filter((s) => mayViewStudent(user, s)),
    }),
    lessons: all.lessons.filter((l) => classes.some((c) => c.id === l.classId)),
  };
}
export function childrenFor(user: User, all: Snapshot) {
  if (!user.roles.includes('Parent')) return [];
  const linked = new Set(user.studentEmails.map(normaliseEmail));
  const students = all.classes.flatMap((c) => c.students).filter((s) => linked.has(normaliseEmail(s.email)));
  return [...new Map(students.map((s) => [normaliseEmail(s.email), s])).values()];
}
