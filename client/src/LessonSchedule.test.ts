import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { LessonSchedule } from './LessonSchedule';
import type { AcademicCalendar } from '../../shared/calendar';
const calendar: AcademicCalendar = {
  years: [{ id: 'year', name: 'Year', start: '2026-09-01', end: '2027-07-01' }],
  terms: [{ id: 'term', yearId: 'year', name: 'Term', start: '2026-09-01', end: '2026-12-11' }], holidays: [],
};
it('explains term clipping and shows the actual final date before save', () => {
  const html = renderToStaticMarkup(createElement(LessonSchedule, {
    schedule: { startDate: '2026-12-07', frequency: 'weekly', count: 5 }, slotIds: ['period'],
    slots: [{ id: 'period', name: 'P1', day: 0, kind: 'lesson', start: '08:00', end: '09:00' }],
    calendar, onChange: () => {},
  }));
  expect(html).toContain('Actual final lesson date: 2026-12-07');
  expect(html).toContain('Requested end date 2027-01-04');
  expect(html).toContain('term end 2026-12-11');
  expect(html).toContain('does not continue into the next term');
});
it('instructs the teacher to configure the calendar rather than inventing dates', () => {
  const html = renderToStaticMarkup(createElement(LessonSchedule, {
    schedule: { startDate: '2026-12-07', frequency: 'once', count: 1 }, slotIds: [], slots: [], onChange: () => {},
  }));
  expect(html).toContain('inside a term');
});
