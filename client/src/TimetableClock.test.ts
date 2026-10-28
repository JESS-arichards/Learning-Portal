import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_PERIOD_TYPES, type Snapshot, type User } from '../../shared/learning';
import { SUNDAY_TEACHING_WEEK } from '../../shared/calendar';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effect: vi.fn(), ref: { current: null as unknown } }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: hooks.effect,
  useRef: () => hooks.ref,
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
    }];
  },
}));
import { Timetable } from './Timetable';

const data: Snapshot = {
  periodTypes: DEFAULT_PERIOD_TYPES, classes: [], lessons: [],
  slots: [
    { id: 'one', day: 0, name: 'P1', kind: 'lesson', start: '08:00', end: '09:00' },
    { id: 'two', day: 0, name: 'P2', kind: 'lesson', start: '09:00', end: '10:00' },
    { id: 'tomorrow', day: 1, name: 'Tuesday P1', kind: 'lesson', start: '09:00', end: '10:00' },
  ],
};
const user: User = { id: 1, email: 'student@school.test', displayName: 'Student', isActive: true, sessionVersion: 0, roles: ['Student'], studentEmails: [] };
function render(snapshot = data) {
  hooks.index = 0;
  return Timetable({ data: snapshot, user, children: [] });
}
function find(root: ReactNode, predicate: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  for (const child of Children.toArray(root)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (predicate(child.props)) return child.props;
    const nested = find(child.props.children as ReactNode, predicate);
    if (nested) return nested;
  }
  return null;
}
afterEach(() => {
  vi.useRealTimers();
  hooks.values = [];
  hooks.effect.mockClear();
  hooks.ref.current = null;
});

it('updates the current period without reloading and cleans up its timer', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T04:59:59Z'));
  const tree = render();
  const current = (props: Record<string, unknown>) => props['aria-current'] === 'time';
  expect(find(tree, current)?.className).toContain('current-period');
  const cleanup = hooks.effect.mock.calls[0][0]();
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(1000);
  const active = find(render(), current);
  expect(find(active?.children as ReactNode, (props) => props.children === '09:00')).not.toBeNull();
  vi.advanceTimersByTime(60 * 60 * 1000);
  expect(find(render(), current)).toBeNull();
  vi.setSystemTime(new Date('2026-10-26T05:30:00Z'));
  vi.advanceTimersByTime(1000);
  expect(find(render(), current)).not.toBeNull();
  const tomorrow = find(render(), (props) => typeof props.onClick === 'function'
    && Children.toArray(props.children as ReactNode).some((child) => isValidElement<{ children: ReactNode }>(child) && child.props.children === 'Tue'));
  expect(tomorrow).not.toBeNull();
  (tomorrow!.onClick as () => void)();
  expect(find(render(), current)).toBeNull();
  cleanup();
  expect(vi.getTimerCount()).toBe(0);
});

it('scrolls only the day region to the current period and preserves the whole day', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T05:30:00Z'));
  const tree = render();
  const region = find(tree, (props) => props['aria-label'] === 'Day timetable periods');
  expect(region?.role).toBe('region');
  expect(region?.tabIndex).toBe(0);
  expect(find(tree, (props) => props.children === '08:00')).not.toBeNull();
  expect(find(tree, (props) => props.children === '09:00')).not.toBeNull();
  const container = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelector: vi.fn(() => ({ getBoundingClientRect: () => ({ top: 350 }) })),
  };
  hooks.ref.current = container;
  const scrollEffect = hooks.effect.mock.calls[1];
  scrollEffect[0]();
  expect(container.scrollTop).toBe(242);
  container.scrollTop = 42;
  hooks.effect.mockClear();
  const cleanup = (() => {
    render();
    return hooks.effect.mock.calls[0][0]();
  })();
  vi.advanceTimersByTime(1000);
  hooks.effect.mockClear();
  render();
  expect(hooks.effect.mock.calls[1][1]).toEqual(scrollEffect[1]);
  expect(container.scrollTop).toBe(42);
  cleanup();
});

it('starts at the top when the selected day has no current period', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T03:00:00Z'));
  render();
  const container = { scrollTop: 200, querySelector: () => null };
  hooks.ref.current = container;
  hooks.effect.mock.calls[1][0]();
  expect(container.scrollTop).toBe(0);
});
it('moves excluded dates to a visible day and navigates Sunday-first weeks without changing weekday IDs', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T04:30:00Z'));
  const snapshot: Snapshot = { ...data, calendar: {
    years: [{ id: 'year', name: '2026/27', start: '2026-09-01', end: '2027-07-01', week: SUNDAY_TEACHING_WEEK }],
    terms: [{ id: 'term', yearId: 'year', name: 'Autumn', start: '2026-09-01', end: '2026-12-11' }], holidays: [],
  } };
  render(snapshot);
  hooks.effect.mock.calls[2][0]();
  expect(hooks.values[3]).toBe('2026-10-25');
  expect(find(render(snapshot), (props) => Children.toArray(props.children as ReactNode).join('') === 'Sunday 25/10/2026')).not.toBeNull();
  (find(render(snapshot), (props) => props.children === 'Next week')!.onClick as () => void)();
  expect(find(render(snapshot), (props) => Children.toArray(props.children as ReactNode).join('') === 'Sunday 01/11/2026')).not.toBeNull();
  (find(render(snapshot), (props) => props.children === 'Previous week')!.onClick as () => void)();
  expect(hooks.values[3]).toBe('2026-10-25');
});
