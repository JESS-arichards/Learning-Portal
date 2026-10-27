import { describe, expect, it } from 'vitest';
import { childrenFor, visibleSnapshot } from './access.js';
import { DEFAULT_PERIOD_TYPES, type LearningClass, type Snapshot, type User } from '../shared/learning.js';

const person = (id: number) => ({ id, email: `user${id}@school.test`, displayName: `User ${id}` });
const user = (id: number, roles: string[] = [], studentEmails: string[] = []): User => ({ ...person(id), roles, studentEmails, isActive: true, sessionVersion: 0 });
const classroom = (id: string, teacherId: number, studentIds: number[]): LearningClass => ({
  id, name: id, yearGroup: '7', division: 'Secondary', teachers: [person(teacherId)], students: studentIds.map(person),
});
const data: Snapshot = {
  periodTypes: DEFAULT_PERIOD_TYPES,
  classes: [classroom('one', 1, [2, 3]), classroom('two', 4, [5])],
  slots: [],
  lessons: [{ id: 'lesson1', classId: 'one', name: 'One', description: '', links: [], files: [], slotIds: [], updatedAt: '' },
    { id: 'lesson2', classId: 'two', name: 'Two', description: '', links: [], files: [], slotIds: [], updatedAt: '' }],
};
describe('learning visibility', () => {
  it('students see only enrolled classes, their own roster entry and corresponding lessons', () => {
    const result = visibleSnapshot(user(2, ['Student']), data);
    expect(result.classes.map((c) => c.id)).toEqual(['one']);
    expect(result.classes[0].students.map((s) => s.email)).toEqual([person(2).email]);
    expect(result.lessons.map((l) => l.id)).toEqual(['lesson1']);
  });
  it('parents see linked children and no classmates', () => {
    const parent = user(99, ['Parent'], [person(3).email, person(5).email]);
    const result = visibleSnapshot(parent, data);
    expect(result.classes.flatMap((c) => c.students.map((s) => s.email))).toEqual([person(3).email, person(5).email]);
    expect(childrenFor(parent, data).map((s) => s.email)).toEqual([person(3).email, person(5).email]);
  });
  it('parent links removed centrally immediately remove access', () => {
    expect(visibleSnapshot(user(99, ['Parent']), data).classes).toEqual([]);
    expect(childrenFor(user(99, ['Parent']), data)).toEqual([]);
  });
  it('removing the central Parent role revokes linked-child access even if old links remain', () => {
    const formerParent = user(99, [], [person(2).email]);
    expect(visibleSnapshot(formerParent, data).classes).toEqual([]);
    expect(childrenFor(formerParent, data)).toEqual([]);
  });
  it('removing central Staff role revokes class management while assignments remain', () => {
    expect(visibleSnapshot(user(1, []), data).classes).toEqual([]);
  });
  it('deduplicates a child in more than one class', () => {
    expect(childrenFor(user(99, ['Parent'], [person(2).email]), { ...data, classes: [data.classes[0], { ...data.classes[1], students: [person(2)] }] })).toEqual([person(2)]);
  });
  it('teachers see complete rosters only for their own classes', () => {
    const result = visibleSnapshot(user(1, ['Staff']), data);
    expect(result.classes).toEqual([data.classes[0]]);
  });
  it('parents see and deduplicate children without user IDs before their first login', () => {
    const child = { email: 'pending@school.test', displayName: 'Pending Student' };
    const pending = { ...data, classes: data.classes.map((c) => ({ ...c, students: [child] })) };
    const parent = user(99, ['Parent'], [' PENDING@school.test ']);
    expect(visibleSnapshot(parent, pending).classes).toHaveLength(2);
    expect(childrenFor(parent, pending)).toEqual([child]);
  });
  it('matches the first authenticated Student login by email, not a stored user ID', () => {
    const legacy = { ...data, classes: [{ ...data.classes[0], students: [{ ...person(2), id: 999 }] }] };
    expect(visibleSnapshot(user(2, ['Student']), legacy).classes).toHaveLength(1);
    expect(visibleSnapshot({ ...user(2, ['Student']), email: 'different@school.test' }, data).classes).toEqual([]);
    expect(visibleSnapshot(user(2), data).classes).toEqual([]);
  });
  it('learning admins can see all classes but unrelated app admins cannot', () => {
    expect(visibleSnapshot(user(99, ['Learn Admin']), data)).toEqual(data);
    expect(visibleSnapshot(user(99, ['Admissions Admin']), data).classes).toEqual([]);
  });
});
