import { Children, isValidElement, createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PERIOD_TYPES, type Snapshot } from '../../shared/learning';
import { DEFAULT_TEACHING_WEEK, SUNDAY_TEACHING_WEEK, type AcademicCalendar as Calendar, type TeachingWeek } from '../../shared/calendar';

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0, api: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = typeof initial === 'function' ? initial() : initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; }];
  },
}));
vi.mock('./api', () => ({ api: state.api, errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }));
import { AcademicCalendar } from './AcademicCalendar';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const calendar: Calendar = {
  years: [{ id: uuid(1), name: '2026/27', start: '2026-09-01', end: '2027-07-01' }],
  terms: [{ id: uuid(2), yearId: uuid(1), name: 'Autumn', start: '2026-09-01', end: '2026-12-11' },
    { id: uuid(3), yearId: uuid(1), name: 'Spring', start: '2027-01-03', end: '2027-03-26' },
    { id: uuid(4), yearId: uuid(1), name: 'Summer', start: '2027-04-04', end: '2027-06-25' }], holidays: [],
};
const data: Snapshot = { calendar, classes: [], lessons: [], slots: [], periodTypes: DEFAULT_PERIOD_TYPES };
const refresh = vi.fn();
function render() {
  state.index = 0;
  return AcademicCalendar({ data, refresh });
}
function findAll(root: ReactNode, predicate: (props: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  return Children.toArray(root).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [...(predicate(child.props) ? [child.props] : []), ...findAll(child.props.children as ReactNode, predicate)];
  });
}
function click(name: string) {
  const props = findAll(render(), (props) => props.children === name && typeof props.onClick === 'function')[0];
  if (!props) throw new Error(`Missing button: ${name}`);
  return (props.onClick as () => unknown)();
}
function current() { return state.values[0] as Calendar; }
function settings() {
  return findAll(render(), (props) => typeof props.onChange === 'function' && 'value' in props
    && (props.value === undefined || typeof props.value === 'object'));
}
function chooseTerms(...ids: string[]) {
  for (const id of ids) {
    const checkboxes = findAll(render(), (props) => props.type === 'checkbox');
    const index = calendar.terms.findIndex((term) => term.id === id);
    (checkboxes[index].onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    render();
  }
}
beforeEach(() => {
  state.values = []; state.api.mockReset(); refresh.mockReset();
});
it('shows year defaults, individual term inheritance and a bulk term scope', () => {
  state.index = 0;
  const html = renderToStaticMarkup(createElement(AcademicCalendar, { data, refresh }));
  expect(html).toContain('2026/27 teaching week');
  expect(html.match(/Use academic-year teaching week/g)).toHaveLength(3);
  expect(html).toContain('Apply a teaching week to multiple terms');
  expect(html).toContain('Sunday-Thursday');
  expect(html).toContain('First day of week');
});
it('edits a year default and an individual override, then restores inheritance', () => {
  (settings()[0].onChange as (week: TeachingWeek) => void)(SUNDAY_TEACHING_WEEK);
  expect(current().years[0].week).toEqual(SUNDAY_TEACHING_WEEK);
  expect(settings()[1].inherited).toEqual(SUNDAY_TEACHING_WEEK);
  (settings()[1].onChange as (week?: TeachingWeek) => void)(DEFAULT_TEACHING_WEEK);
  expect(current().terms[0].week).toEqual(DEFAULT_TEACHING_WEEK);
  expect(current().terms[1].week).toBeUndefined();
  (settings()[1].onChange as (week?: TeachingWeek) => void)(undefined);
  expect(current().terms[0].week).toBeUndefined();
  expect(state.api).not.toHaveBeenCalled();
});
it('applies and clears overrides for only the selected terms and persists on Save calendar', async () => {
  chooseTerms(uuid(2), uuid(3));
  const bulk = settings().at(-1)!;
  (bulk.onChange as (week: TeachingWeek) => void)(SUNDAY_TEACHING_WEEK);
  click('Apply week to selected terms');
  expect(current().terms.map((term) => term.week)).toEqual([SUNDAY_TEACHING_WEEK, SUNDAY_TEACHING_WEEK, undefined]);
  expect(state.api).not.toHaveBeenCalled();
  state.api.mockImplementation(async (_path, _method, body) => body);
  await click('Save calendar');
  expect(state.api).toHaveBeenCalledWith('/admin/calendar', 'PUT', current());
  expect(refresh).toHaveBeenCalledOnce();
  click('Use year defaults for selected terms');
  expect(current().terms.every((term) => term.week === undefined)).toBe(true);
});
it('keeps unsaved settings and displays a server conflict instead of showing success', async () => {
  state.api.mockRejectedValue(new Error('Calendar changes would affect existing lessons: Fractions 28/10/2026.'));
  await click('Save calendar');
  expect(findAll(render(), (props) => props.role === 'alert')[0].children).toContain('Fractions 28/10/2026');
  expect(refresh).not.toHaveBeenCalled();
  expect(current()).toEqual(calendar);
});
