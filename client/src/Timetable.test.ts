import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timetable } from './Timetable';
import { DEFAULT_PERIOD_TYPES, type Snapshot, type Student, type User } from '../../shared/learning';

const child: Student = { email: 'pending@school.test', displayName: 'Pending Student' };
const other: Student = { email: 'other@school.test', displayName: 'Other Student' };
const teacher = { id: 1, email: 'teacher@school.test', displayName: 'Teacher' };
const data: Snapshot = {
  periodTypes: DEFAULT_PERIOD_TYPES,
  classes: [
    { id: 'one', name: 'Maths', yearGroup: '7', division: 'Secondary', teachers: [teacher], students: [child] },
    { id: 'two', name: 'English', yearGroup: '8', division: 'Primary', teachers: [teacher], students: [other] },
  ],
  slots: [{ id: 'period', day: 0, name: 'Period 1', kind: 'lesson', start: '08:00', end: '09:00' }],
  lessons: [
    { id: 'first', classId: 'one', name: 'Fractions', description: '', links: [], files: [], slotIds: ['period'], updatedAt: '' },
    { id: 'second', classId: 'two', name: 'Poetry', description: '', links: [], files: [], slotIds: ['period'], updatedAt: '' },
  ],
};
const user: User = { ...teacher, isActive: true, sessionVersion: 0, roles: ['Parent'], studentEmails: [child.email, other.email] };
function render(current: User, children: Student[]) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 26, 12));
  return renderToStaticMarkup(createElement(Timetable, { data, user: current, children }));
}
afterEach(() => vi.useRealTimers());

describe('email-based timetables', () => {
  it('shows the selected child timetable without confusing children that have no IDs', () => {
    const html = render(user, [child, other]);
    expect(html).toContain('Pending Student');
    expect(html).toContain('Other Student');
    expect(html).toContain('Fractions');
    expect(html).not.toContain('Poetry');
  });
  it('shows the first signed-in student timetable using the email, not the user ID', () => {
    const html = render({ ...user, id: 999, email: ' PENDING@school.test ', roles: ['Student'] }, []);
    expect(html).toContain('Fractions');
    expect(html).not.toContain('Poetry');
  });
  it('does not show a timetable to an account without the Student role', () => {
    expect(render({ ...user, email: child.email, roles: [] }, [])).not.toContain('Fractions');
  });
  it('does not select any class when there are no linked children', () => {
    const html = render(user, []);
    expect(html).toContain('No linked students have class data yet');
    expect(html).not.toContain('Fractions');
    expect(html).not.toContain('Poetry');
  });
});
