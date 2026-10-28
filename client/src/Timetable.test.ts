import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timetable } from './Timetable';
import { DEFAULT_PERIOD_TYPES, type Snapshot, type Student, type User } from '../../shared/learning';
import { SUNDAY_TEACHING_WEEK, type AcademicCalendar } from '../../shared/calendar';

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

describe('dated timetable', () => {
  function dated(date: string, meeting: Partial<NonNullable<Snapshot['meetings']>[number]> = {}, overrides: Partial<AcademicCalendar> = {}) {
    vi.useFakeTimers(); vi.setSystemTime(new Date(`${date}T04:30:00Z`));
    const snapshot: Snapshot = {
      ...data,
      calendar: {
        years: [{ id: 'year', name: '2026/27', start: '2026-09-01', end: '2027-07-01' }],
        terms: [{ id: 'term', yearId: 'year', name: 'Autumn', start: '2026-09-01', end: '2026-12-11' }],
        holidays: [{ id: 'holiday', yearId: 'year', name: 'Closure', start: '2026-11-09', end: '2026-11-09' }],
        ...overrides,
      },
      lessons: [{ ...data.lessons[0], schedule: { startDate: '2026-10-26', frequency: 'once', count: 1 },
        occurrences: [{ id: 'occurrence', date: '2026-10-26', slotId: 'period' }] }],
      meetings: [{ occurrenceId: 'occurrence', lessonId: 'first', organizerUserId: 1, state: 'created', joinUrl: 'https://teams.microsoft.com/test', ...meeting }],
    };
    return renderToStaticMarkup(createElement(Timetable, { data: snapshot, user, children: [child] }));
  }
  it('shows only this date’s lessons and its live join link', () => {
    const html = dated('2026-10-26');
    expect(html).toContain('Fractions');
    expect(html).toContain('Join live lesson');
    expect(html).toContain('2026-10-26');
    expect(html).toContain('current-period');
  });
  it('uses the saved meeting title for the matching date and hides unconfirmed or other-date links', () => {
    const meeting = { title: 'Fractions group workshop', optionsApplied: true };
    expect(dated('2026-10-26', meeting)).toContain('Fractions group workshop');
    expect(dated('2026-11-02', meeting)).not.toContain('Fractions group workshop');
    expect(dated('2026-10-26', { ...meeting, optionsApplied: false })).not.toContain('https://teams.microsoft.com/test');
    expect(dated('2026-10-26', { ...meeting, state: 'cancelled' })).not.toContain('https://teams.microsoft.com/test');
  });
  it('puts each day and date together in a bold heading above the counts', () => {
    const html = dated('2026-10-28');
    expect(html).toContain('<h2>Wednesday 28/10/2026</h2>');
    expect(html).not.toContain('Wednesday 2026-10-28');
    expect(html).toContain('<strong class="day-tab-heading">Wed - 28/10</strong><small>0 periods</small>');
    expect(html).toContain('<strong class="day-tab-heading">Mon - 26/10</strong>');
    expect(html).toContain('<strong class="day-tab-heading">Fri - 30/10</strong>');
    expect(html).not.toContain('<strong class="day-tab-heading">Sun - 01/11</strong>');
    expect(html).not.toContain('<small>28/10</small>');
  });
  it('does not repeat a one-off lesson on the same weekday next week', () => {
    const html = dated('2026-11-02');
    expect(html).not.toContain('Fractions');
    expect(html).not.toContain('Join live lesson');
    expect(html).toContain('No lesson scheduled');
  });
  it('hides excluded days and orders Sunday-Thursday from the configured week boundary', () => {
    const html = dated('2026-10-28', {}, { years: [{ id: 'year', name: '2026/27', start: '2026-09-01', end: '2027-07-01', week: SUNDAY_TEACHING_WEEK }] });
    expect(html).toContain('<strong class="day-tab-heading">Sun - 25/10</strong>');
    expect(html.indexOf('Sun - 25/10')).toBeLessThan(html.indexOf('Mon - 26/10'));
    expect(html).toContain('<strong class="day-tab-heading">Thu - 29/10</strong>');
    expect(html).not.toContain('Fri - 30/10');
    expect(html).not.toContain('Sat - 31/10');
  });
  it('shows holidays and outside-term dates without teaching periods or highlights', () => {
    const holiday = dated('2026-11-09');
    expect(holiday).toContain('Holiday: Closure');
    expect(holiday).not.toContain('current-period');
    expect(holiday).not.toContain('Fractions');
    expect(dated('2026-12-14')).toContain('Outside school terms');
  });
});

describe('day tab period counts', () => {
  const registrationType = { id: 'registration', name: 'Registration', kind: 'lesson' as const };
  function counts(periodCount: number, registrationCount: number, typeName = 'Registration') {
    const snapshot: Snapshot = {
      ...data,
      periodTypes: [...data.periodTypes, { ...registrationType, name: typeName }],
      slots: [
        ...Array.from({ length: periodCount }, (_, index) => ({ ...data.slots[0], id: `period-${index}` })),
        ...Array.from({ length: registrationCount }, (_, index) => ({
          ...data.slots[0], id: `registration-${index}`, name: 'Morning check-in', typeId: registrationType.id,
        })),
        { ...data.slots[0], id: 'break', kind: 'break', typeId: 'break', name: 'Break' },
      ],
    };
    const html = renderToStaticMarkup(createElement(Timetable, { data: snapshot, user, children: [child] }));
    return html.slice(html.indexOf('aria-label="Day of the week"'), html.indexOf('<div class="day-summary">'));
  }
  it('shows six teaching periods plus registration rather than seven periods', () => {
    const html = counts(6, 1);
    expect(html).toContain('<small>6 periods</small><small>+ 1 registration</small>');
    expect(html).not.toContain('7 periods');
  });
  it('identifies registration by configured type, ignoring case and whitespace', () => {
    expect(counts(6, 1, ' REGISTRATION ')).toContain('+ 1 registration');
  });
  it('keeps ordinary days and empty days free of registration labels', () => {
    expect(counts(1, 0)).toContain('<small>1 period</small>');
    expect(counts(0, 0)).toContain('<small>0 periods</small>');
    expect(counts(1, 0)).not.toContain('registration');
  });
  it('counts multiple registrations without including breaks', () => {
    expect(counts(0, 2)).toContain('<small>0 periods</small><small>+ 2 registrations</small>');
  });
});

describe('current school period', () => {
  function at(iso: string, snapshot = data) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
    return renderToStaticMarkup(createElement(Timetable, { data: snapshot, user, children: [child] }));
  }
  it.each(['2026-10-26T04:00:00Z', '2026-10-26T04:59:59Z'])('highlights a lesson during school time at %s', (iso) => {
    const html = at(iso);
    expect(html).toContain('timeline-row lesson current-period');
    expect(html).toContain('aria-current="time"');
    expect(html).toContain('>Now</span>');
  });
  it.each(['2026-10-26T03:59:59Z', '2026-10-26T05:00:00Z', '2026-10-26T08:00:00Z'])('does not highlight outside the period at %s', (iso) => {
    expect(at(iso)).not.toContain('current-period');
  });
  it('highlights a break and a period without lessons', () => {
    expect(at('2026-10-26T04:30:00Z', { ...data, lessons: [] })).toContain('timeline-row lesson current-period');
    expect(at('2026-10-26T04:30:00Z', { ...data, slots: [{ ...data.slots[0], kind: 'break' }] }))
      .toContain('timeline-row break current-period');
  });
  it('uses the school day rather than the device day around midnight', () => {
    const html = at('2026-10-25T20:30:00Z', {
      ...data, slots: [{ ...data.slots[0], start: '00:00', end: '01:00' }],
    });
    expect(html).toContain('<h2>Monday</h2>');
    expect(html).toContain('current-period');
  });
  it('moves the highlight to the next period at the exact boundary', () => {
    const html = at('2026-10-26T05:00:00Z', {
      ...data, slots: [...data.slots, { ...data.slots[0], id: 'next', name: 'Period 2', start: '09:00', end: '10:00' }],
    });
    expect(html.match(/aria-current="time"/g)).toHaveLength(1);
    expect(html).toContain('Period 2');
    expect(html.indexOf('aria-current="time"')).toBeGreaterThan(html.indexOf('Fractions'));
  });
});

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
